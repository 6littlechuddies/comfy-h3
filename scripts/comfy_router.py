"""Several graphics cards: one ComfyUI per card, and this router in front of them on ComfyUI's usual port (18188), so the
Studio, the node editor, the downloader and the watchdog all keep talking to "ComfyUI" as before.

* A new job goes to the card with the least work (pictures, edits, ×4 takes and batches run side by side).
* A job built for Raylight (H3 videos split across every card) waits until every card is free, then gets them all: the
  other ComfyUIs unload their models first and nothing else starts until it's done.
* /ws fans in every ComfyUI's live progress; /queue and /history are merged; the rest (pictures, uploads, the node editor's
  own files) is served by the first ComfyUI — every ComfyUI shares the same input/output folders.

Backends: COMFY_BACKENDS="http://127.0.0.1:18200,http://127.0.0.1:18201,…" — one per card, each seeing only its card.
RAY_BACKEND="http://127.0.0.1:18299": a ComfyUI that sees every card, used only for Raylight jobs (its Ray workers take one
card each); the per-card ComfyUIs unload before it starts, and it unloads again when it's done.
"""
import asyncio, json, os, time, uuid

import aiohttp
from aiohttp import web

BACKENDS = [b.strip().rstrip("/") for b in os.environ.get("COMFY_BACKENDS", "http://127.0.0.1:18200").split(",") if b.strip()]
PORT = int(os.environ.get("ROUTER_PORT", "18188"))
RAY = os.environ.get("RAY_BACKEND", "").strip().rstrip("/")
HOP = {"host", "content-length", "transfer-encoding", "connection", "keep-alive", "upgrade", "proxy-connection", "te", "trailer"}

owner: dict[str, int] = {}             # prompt_id → backend index
kinds: dict[str, str] = {}             # prompt_id → "video" / "writer" / "other"
busy: dict[int, set] = {i: set() for i in range(len(BACKENDS))}  # running + waiting prompt ids per backend (from /queue polls)
held: list[dict] = []                  # jobs waiting in the router: {"pid", "body", "client_id", "ray", "number"}
ray_pid: dict = {"id": None}           # the Raylight job that has every card right now
clients: dict[str, set] = {}           # client_id → open browser websockets
number = {"n": 0}
SESSION: dict = {}
up_at: dict[int, float] = {}           # backend index (-1 = Raylight) → last time it answered
GPU = {"busy_at": time.time()}         # last time any card did real work (nvidia-smi)
RAY_STATE = {"broken": "", "since": 0.0}  # Raylight switched off for this rental after it hung (why, when)
# a Raylight job that has every card but no card has done any work for this long is stuck (Ray workers that never
# start): it's stopped, its cards go back, and videos stop being split for the rest of the rental
RAY_STUCK_S = int(os.environ.get("RAY_STUCK_S", "480"))


def log(*a):
    print(time.strftime("%H:%M:%S"), *a, flush=True)


async def gpu_loop():
    """is any card working? (a stuck Raylight job sits at 0 % on every card)"""
    while True:
        try:
            p = await asyncio.create_subprocess_exec("nvidia-smi", "--query-gpu=utilization.gpu", "--format=csv,noheader,nounits",
                                                     stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL)
            out, _ = await asyncio.wait_for(p.communicate(), 10)
            if any(int(x.strip() or 0) > 5 for x in out.decode().split()): GPU["busy_at"] = time.time()
        except Exception:  # noqa: BLE001  (no nvidia-smi: never call a job stuck)
            GPU["busy_at"] = time.time()
        await asyncio.sleep(5)


def up(i: int) -> bool:
    """a ComfyUI that answered in the last 30 s (one that crashed isn't handed new jobs while the watchdog restarts it)"""
    return time.time() - up_at.get(i, time.time()) < 30


async def give_up_ray(why: str):
    """the Raylight job is stuck or its ComfyUI is gone: stop it, give the cards back, tell the Studio, split no more"""
    pid, client = ray_pid["id"], ray_pid.get("client")
    ray_pid["id"] = None
    RAY_STATE.update(broken=why, since=time.time())
    log(f"!! Raylight job {pid}: {why} — stopped; videos run on one card for the rest of this rental")
    s = SESSION["s"]
    for path, body in (("/interrupt", {}), ("/queue", {"clear": True}), ("/free", {"unload_models": True, "free_memory": True})):
        try: await s.post(f"{RAY}{path}", json=body, timeout=aiohttp.ClientTimeout(total=10))
        except Exception: pass  # noqa: BLE001
    await tell(client, {"type": "execution_error", "data": {"prompt_id": pid, "node_type": "Raylight",
        "exception_message": f"Splitting the video across cards got stuck ({why}). Stopped it — press Make video again: it runs on one card now.",
        "exception_type": "RaylightStuck", "traceback": []}})


def is_ray(graph: dict) -> bool:
    return any(str((n or {}).get("class_type", "")).startswith(("Ray", "XFuser")) for n in (graph or {}).values())


# With 2+ cards the last one is the writer's: prompt writing / video planning always goes there and videos never do, so you
# can plan the next video while one renders — and neither model has to be swapped out of a card for the other.
# ROUTE_WRITER=0: every job just goes to the least busy card.
ROUTE_WRITER = os.environ.get("ROUTE_WRITER", "1") != "0"


def kind_of(graph: dict) -> str:
    types = {str((n or {}).get("class_type", "")) for n in (graph or {}).values()}
    if any(t.startswith(("MiniMaxH3", "H3Relay")) for t in types): return "video"
    if "LLMTextProcessor" in types: return "writer"
    return "other"


def pick(graph: dict) -> int:
    """which card a job goes to: the writer's card for writing, the other cards for videos, the least busy for the rest"""
    every = list(range(len(BACKENDS)))
    if ROUTE_WRITER and len(BACKENDS) > 1:
        w = len(BACKENDS) - 1
        k = kind_of(graph)
        if k == "writer" and up(w): return w
        if k == "video":
            rest = [i for i in every if i != w and up(i)]
            if rest: every = rest
        elif k == "other":
            # pictures: a card that isn't rendering a video (they take minutes), then the least busy, the writer's last
            return min(every, key=lambda i: (not up(i), any(kinds.get(x) == "video" for x in busy[i]), load(i), i == w, i))
    return min(every, key=lambda i: (not up(i), load(i), i))


def load(i: int) -> int:
    return len(busy[i])


async def poll_loop():
    """what each ComfyUI is doing: its /queue every half second"""
    while True:
        try: await poll_once()
        except Exception as e:  # noqa: BLE001  (never let one bad turn stop the router handing out jobs)
            log(f"!! router poll: {type(e).__name__}: {e}")
        await asyncio.sleep(0.5)


async def poll_once():
    s = SESSION["s"]
    if True:
        for i, b in enumerate(BACKENDS):
            try:
                async with s.get(f"{b}/queue", timeout=aiohttp.ClientTimeout(total=3)) as r:
                    q = await r.json()
                busy[i] = {str(x[1]) for x in (q.get("queue_running") or []) + (q.get("queue_pending") or [])}
                up_at[i] = time.time()
            except Exception:  # noqa: BLE001  (starting up / restarting: keep the last known state for a while)
                up_at.setdefault(i, time.time())
                if not up(i) and busy[i]:
                    log(f"!! card {i}'s ComfyUI hasn't answered for 30 s — its jobs are forgotten, new ones go to the other cards")
                    busy[i] = set()
        if ray_pid["id"] and RAY:
            try:
                async with s.get(f"{RAY}/queue", timeout=aiohttp.ClientTimeout(total=3)) as r:
                    q = await r.json()
                left = {str(x[1]) for x in (q.get("queue_running") or []) + (q.get("queue_pending") or [])}
                up_at[-1] = time.time()
                if ray_pid["id"] not in left and time.time() - ray_pid.get("at", 0) > 3:
                    ray_pid["id"] = None  # done: its cards go back to the per-card ComfyUIs
                    try: await s.post(f"{RAY}/free", json={"unload_models": True, "free_memory": True})
                    except Exception: pass  # noqa: BLE001
                elif time.time() - ray_pid.get("at", 0) > RAY_STUCK_S and time.time() - max(GPU["busy_at"], ray_pid.get("at", 0)) > RAY_STUCK_S:
                    await give_up_ray(f"no card did any work for {RAY_STUCK_S // 60} minutes")
            except Exception:  # noqa: BLE001
                up_at.setdefault(-1, time.time())
                if ray_pid["id"] and not up(-1): await give_up_ray("the Raylight ComfyUI stopped answering")
        await dispatch_held()


def url_of(i: int) -> str:
    return RAY if i == -1 else BACKENDS[i]


async def send(i: int, body: dict) -> tuple[int, dict]:
    async with SESSION["s"].post(f"{url_of(i)}/prompt", json=body) as r:
        try: d = await r.json()
        except Exception: d = {"error": {"message": await r.text()}}  # noqa: BLE001
        return r.status, d


async def tell(client_id: str | None, msg: dict):
    for ws in list(clients.get(client_id or "", set())) if client_id else [w for s in clients.values() for w in s]:
        try: await ws.send_str(json.dumps(msg))
        except Exception: pass  # noqa: BLE001


DISPATCH = asyncio.Lock()


async def dispatch_held():
    """jobs the router is holding: a Raylight job once every card is free; the others once the Raylight job is done.
    One at a time: the poll loop and a new job both call this, and a Raylight job waits 2 s mid-way — two at once popped
    the same job twice, the second pop crashed the poll loop, and from then on every job waited forever."""
    async with DISPATCH:
        await _dispatch_held()


async def _dispatch_held():
    while held and not ray_pid["id"]:
        j = held[0]
        if j["ray"] and RAY_STATE["broken"]:
            held.pop(0)
            await tell(j["client_id"], {"type": "execution_error", "data": {"prompt_id": j["pid"], "node_type": "Raylight",
                "exception_message": f"Splitting videos across cards is off for this rental ({RAY_STATE['broken']}). Press Make video again: it runs on one card.",
                "exception_type": "RaylightOff", "traceback": []}})
            continue
        if j["ray"]:
            if any(load(i) for i in range(len(BACKENDS))): return
            # every per-card ComfyUI gives its card's memory back, so Raylight's workers fit
            for b in BACKENDS:
                try: await SESSION["s"].post(f"{b}/free", json={"unload_models": True, "free_memory": True})
                except Exception: pass  # noqa: BLE001
            await asyncio.sleep(2)
            target = -1 if RAY else 0
        else:
            target = pick(j["body"]["prompt"])
        kinds[j["pid"]] = kind_of(j["body"]["prompt"])
        if j not in held: continue  # taken out of the line while the cards were being freed
        held.remove(j)
        st, d = await send(target, j["body"])
        if st == 200:
            owner[j["pid"]] = target
            if target >= 0: busy[target].add(j["pid"])
            if j["ray"]: ray_pid.update(id=j["pid"], at=time.time(), client=j["client_id"])
        else:
            # the Studio already has its id: say it failed the way ComfyUI says it, over the live connection
            err = d.get("error") or {}
            ne = d.get("node_errors") or {}
            first = next(iter(ne.values()), {}) if isinstance(ne, dict) else {}
            await tell(j["client_id"], {"type": "execution_error", "data": {"prompt_id": j["pid"], "node_type": first.get("class_type", ""),
                "exception_message": (err.get("message") or "") + (" — " + "; ".join(f"{e.get('message')} {e.get('details', '')}" for e in first.get("errors", [])) if first else ""),
                "exception_type": err.get("type", "prompt_error"), "traceback": []}})


async def prompt(req):
    body = await req.json()
    if not isinstance(body, dict) or "prompt" not in body: return await proxy(req, body_override=body)
    pid = str(body.get("prompt_id") or uuid.uuid4()); body["prompt_id"] = pid
    number["n"] += 1
    ray = is_ray(body["prompt"]) and bool(RAY)
    if ray and RAY_STATE["broken"]:
        return web.json_response({"error": {"type": "RaylightOff", "message": f"Splitting videos across cards is off for this rental ({RAY_STATE['broken']}) — make it again, it runs on one card"}, "node_errors": {}}, status=400)
    if ray or ray_pid["id"] or held:
        # waits in the router (for every card, or behind the Raylight job that has them)
        held.append({"pid": pid, "body": body, "client_id": body.get("client_id"), "ray": ray, "number": number["n"]})
        await dispatch_held()
        return web.json_response({"prompt_id": pid, "number": number["n"], "node_errors": {}})
    target = pick(body["prompt"])
    kinds[pid] = kind_of(body["prompt"])
    st, d = await send(target, body)
    if st == 200: owner[pid] = target; busy[target].add(pid)
    return web.json_response(d, status=st)


async def queue(req):
    s = SESSION["s"]
    if req.method == "POST":
        body = await req.json()
        if body.get("clear"): held.clear()
        dele = [str(x) for x in body.get("delete") or []]
        held[:] = [h for h in held if h["pid"] not in dele]
        for i, b in [(i, url_of(i)) for i in list(range(len(BACKENDS))) + ([-1] if RAY else [])]:
            mine = [x for x in dele if owner.get(x, i) == i]
            if body.get("clear") or mine:
                try: await s.post(f"{b}/queue", json={**body, **({"delete": mine} if dele else {})})
                except Exception: pass  # noqa: BLE001
        return web.json_response({})
    running, pending = [], []
    for b in BACKENDS + ([RAY] if RAY else []):
        try:
            async with s.get(f"{b}/queue") as r: q = await r.json()
            running += q.get("queue_running") or []; pending += q.get("queue_pending") or []
        except Exception: pass  # noqa: BLE001
    pending += [[h["number"], h["pid"], h["body"]["prompt"], {"client_id": h["client_id"]}, []] for h in held]
    return web.json_response({"queue_running": running, "queue_pending": pending})


async def history(req):
    s = SESSION["s"]
    pid = req.match_info.get("pid")
    if req.method == "POST":
        body = await req.json()
        for b in BACKENDS + ([RAY] if RAY else []):
            try: await s.post(f"{b}/history", json=body)
            except Exception: pass  # noqa: BLE001
        return web.json_response({})
    every = list(range(len(BACKENDS))) + ([-1] if RAY else [])
    order = [owner[pid]] + [i for i in every if i != owner[pid]] if pid and pid in owner else every
    out: dict = {}
    for i in order:
        try:
            async with s.get(f"{url_of(i)}/history{'/' + pid if pid else ''}", params=req.query) as r: d = await r.json()
        except Exception: continue  # noqa: BLE001
        out.update(d or {})
        if pid and out.get(pid): break
    return web.json_response(out)


async def interrupt(req):
    """with {prompt_id}: only the card running it; without (old callers): every card"""
    try: body = await req.json()
    except Exception: body = {}  # noqa: BLE001
    pid = (body or {}).get("prompt_id")
    targets = [owner[pid]] if pid and pid in owner else list(range(len(BACKENDS))) + ([-1] if RAY else [])
    for i in targets:
        try: await SESSION["s"].post(f"{url_of(i)}/interrupt", json=body or {})
        except Exception: pass  # noqa: BLE001
    return web.json_response({})


async def free(req):
    body = await req.read()
    for b in BACKENDS + ([RAY] if RAY else []):
        try: await SESSION["s"].post(f"{b}/free", data=body, headers={"Content-Type": "application/json"})
        except Exception: pass  # noqa: BLE001
    return web.json_response({})


async def system_stats(req):
    """the first ComfyUI's stats, with every card listed"""
    out, devices = None, []
    for b in BACKENDS:
        try:
            async with SESSION["s"].get(f"{b}/system_stats") as r: d = await r.json()
        except Exception: continue  # noqa: BLE001
        out = out or d
        devices += (d.get("devices") or [])[:1]  # each ComfyUI works on one card: its first one
    if out is None: return web.json_response({"error": "ComfyUI is starting"}, status=503)
    for k, dv in enumerate(devices): dv["index"] = k
    out["devices"] = devices
    out["h3_router"] = {"cards": len(BACKENDS), "raylight": bool(RAY), "raylight_running": ray_pid["id"] is not None, "held": len(held)}
    return web.json_response(out)


async def router_info(req):
    now = time.time()
    return web.json_response({"cards": len(BACKENDS), "raylight": bool(RAY) and not RAY_STATE["broken"], "raylight_off_why": RAY_STATE["broken"] or None,
        "writer_card": len(BACKENDS) - 1 if ROUTE_WRITER and len(BACKENDS) > 1 else None,
        "loads": [load(i) for i in range(len(BACKENDS))], "up": [up(i) for i in range(len(BACKENDS))], "raylight_up": up(-1) if RAY else None,
        "held": len(held), "held_jobs": [{"pid": h["pid"], "ray": h["ray"]} for h in held],
        "raylight_running": ray_pid["id"], "raylight_running_s": int(now - ray_pid.get("at", now)) if ray_pid["id"] else None,
        "cards_idle_s": int(now - GPU["busy_at"])})


async def ws(req):
    """the browser's live connection: every ComfyUI's messages for this client id, merged"""
    cid = req.query.get("clientId") or uuid.uuid4().hex
    out = web.WebSocketResponse(heartbeat=30, max_msg_size=0)
    await out.prepare(req)
    clients.setdefault(cid, set()).add(out)
    remaining: dict[int, int] = {}

    async def pump(i: int, b: str):
        url = b.replace("http", "ws", 1) + f"{req.path}?clientId={cid}"
        while not out.closed:
            try:
                async with SESSION["s"].ws_connect(url, heartbeat=30, max_msg_size=0) as up:
                    async for m in up:
                        if out.closed: return
                        if m.type == aiohttp.WSMsgType.TEXT:
                            try: d = json.loads(m.data)
                            except ValueError: d = None
                            if d and d.get("type") == "status":
                                # one queue count for all the cards (+ jobs waiting in the router)
                                ei = ((d.get("data") or {}).get("status") or {}).get("exec_info") or {}
                                remaining[i] = int(ei.get("queue_remaining") or 0)
                                ei["queue_remaining"] = sum(remaining.values()) + len(held)
                                await out.send_str(json.dumps(d))
                            else:
                                await out.send_str(m.data)
                        elif m.type == aiohttp.WSMsgType.BINARY:
                            await out.send_bytes(m.data)
                        elif m.type in (aiohttp.WSMsgType.CLOSED, aiohttp.WSMsgType.ERROR):
                            break
            except Exception:  # noqa: BLE001  (that ComfyUI is restarting)
                pass
            await asyncio.sleep(1)

    tasks = [asyncio.create_task(pump(i, b)) for i, b in enumerate(BACKENDS + ([RAY] if RAY else []))]
    try:
        async for _ in out: pass  # the browser sends nothing ComfyUI needs
    finally:
        for t in tasks: t.cancel()
        clients.get(cid, set()).discard(out)
    return out


async def proxy(req, body_override=None):
    """anything else: the first ComfyUI (pictures, uploads, the node editor's files and settings — shared folders)"""
    url = BACKENDS[0] + req.rel_url.path_qs
    headers = {k: v for k, v in req.headers.items() if k.lower() not in HOP}
    data = json.dumps(body_override).encode() if body_override is not None else (await req.read() if req.can_read_body else None)
    async with SESSION["s"].request(req.method, url, headers=headers, data=data, allow_redirects=False) as r:
        resp = web.StreamResponse(status=r.status, headers={k: v for k, v in r.headers.items() if k.lower() not in HOP})
        await resp.prepare(req)
        async for chunk in r.content.iter_chunked(1 << 16):
            await resp.write(chunk)
        await resp.write_eof()
        return resp


async def start(app):
    SESSION["s"] = aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=None, sock_connect=10))
    app["poll"] = asyncio.create_task(poll_loop())
    app["gpu"] = asyncio.create_task(gpu_loop())


def main():
    app = web.Application(client_max_size=1 << 34)
    app.on_startup.append(start)
    for pre in ("", "/api"):
        app.router.add_post(f"{pre}/prompt", prompt)
        app.router.add_route("*", f"{pre}/queue", queue)
        app.router.add_route("*", f"{pre}/history", history)
        app.router.add_get(pre + "/history/{pid}", history)
        app.router.add_post(f"{pre}/interrupt", interrupt)
        app.router.add_post(f"{pre}/free", free)
        app.router.add_get(f"{pre}/system_stats", system_stats)
        app.router.add_get(f"{pre}/ws", ws)
    app.router.add_get("/h3-router", router_info)
    app.router.add_route("*", "/{tail:.*}", proxy)
    print(f"comfy router: {len(BACKENDS)} ComfyUI(s) behind :{PORT} → {', '.join(BACKENDS)}", flush=True)
    web.run_app(app, host="127.0.0.1", port=PORT, print=None)


if __name__ == "__main__":
    main()
