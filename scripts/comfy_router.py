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


# One line for every job, handed to a card the moment it's free (each card runs one job at a time, so nothing gets stuck
# behind a long video on a card while another card sits idle). Who goes first: writing (planning, prompts) → pictures →
# videos; "front" jobs first within their kind. With 2+ cards the last card is the writer's:
#   * adaptive (default): it plans first, and helps render videos while you're not planning (nothing written for
#     PLAN_RECENT_S) — a video started there finishes there, so a new plan then takes the next card that frees up
#   * keep_writer (Speed-ups → "Always keep a card for planning"): videos never go there; plans start instantly, always
# ROUTE_WRITER=0: no writer's card, every job just takes the first free card.
ROUTE_WRITER = os.environ.get("ROUTE_WRITER", "1") != "0"
PLAN_RECENT_S = int(os.environ.get("PLAN_RECENT_S", "180"))
MODE = {"keep_writer": False}
LAST_PLAN = {"at": 0.0}
RANK = {"writer": 0, "other": 1, "video": 2}


def kind_of(graph: dict) -> str:
    types = {str((n or {}).get("class_type", "")) for n in (graph or {}).values()}
    if any(t.startswith(("MiniMaxH3", "H3Relay")) for t in types): return "video"
    if "LLMTextProcessor" in types: return "writer"
    return "other"


def writer_card():
    return len(BACKENDS) - 1 if ROUTE_WRITER and len(BACKENDS) > 1 else None


def planning_now() -> bool:
    """you're planning: a plan was asked for in the last few minutes, or one is waiting / being written"""
    return time.time() - LAST_PLAN["at"] < PLAN_RECENT_S or any(kinds.get(x) == "writer" for i in busy for x in busy[i]) \
        or any(h["kind"] == "writer" for h in held)


def free_card(kind: str):
    """the card this job should start on right now, or None (it waits in the line)"""
    w = writer_card()
    idle = [i for i in range(len(BACKENDS)) if up(i) and load(i) == 0]
    if not idle: return None
    if w is None: return idle[0]
    if kind == "writer": return w if w in idle else idle[0]
    others = [i for i in idle if i != w]
    if others: return others[0]
    # only the writer's card is free
    if kind == "video" and (MODE["keep_writer"] or planning_now()): return None
    if kind == "other" and MODE["keep_writer"]: return None
    return w


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


async def _fail(j: dict, st_msg: str, etype: str):
    await tell(j["client_id"], {"type": "execution_error", "data": {"prompt_id": j["pid"], "node_type": "Raylight" if j["ray"] else "",
        "exception_message": st_msg, "exception_type": etype, "traceback": []}})


async def _send_held(j: dict, target: int):
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
        await _fail(j, (err.get("message") or "") + (" — " + "; ".join(f"{e.get('message')} {e.get('details', '')}" for e in first.get("errors", [])) if first else ""),
                    err.get("type", "prompt_error"))


def _order() -> list:
    return sorted(held, key=lambda h: (RANK.get(h["kind"], 1), not h["front"], h["number"]))


async def _dispatch_held():
    while held and not ray_pid["id"]:
        moved = False
        ray_waiting = any(h["ray"] for h in held)
        for j in _order():
            if j["ray"]:
                if RAY_STATE["broken"]:
                    held.remove(j); moved = True
                    await _fail(j, f"Splitting videos across cards is off for this rental ({RAY_STATE['broken']}). Press Make video again: it runs on one card.", "RaylightOff")
                    break
                if any(load(i) for i in range(len(BACKENDS))): continue  # waits for every card to be free
                # every per-card ComfyUI gives its card's memory back, so Raylight's workers fit
                for b in BACKENDS:
                    try: await SESSION["s"].post(f"{b}/free", json={"unload_models": True, "free_memory": True})
                    except Exception: pass  # noqa: BLE001
                await asyncio.sleep(2)
                if j not in held: moved = True; break  # taken out of the line while the cards were being freed
                await _send_held(j, -1 if RAY else 0); moved = True
                break
            # a split video is waiting for every card: only writing still starts (it's quick), the rest waits behind it
            if ray_waiting and j["kind"] != "writer": continue
            t = free_card(j["kind"])
            if t is None: continue
            await _send_held(j, t); moved = True
            break
        if not moved: return


async def prompt(req):
    body = await req.json()
    if not isinstance(body, dict) or "prompt" not in body: return await proxy(req, body_override=body)
    pid = str(body.get("prompt_id") or uuid.uuid4()); body["prompt_id"] = pid
    number["n"] += 1
    ray = is_ray(body["prompt"]) and bool(RAY)
    if ray and RAY_STATE["broken"]:
        return web.json_response({"error": {"type": "RaylightOff", "message": f"Splitting videos across cards is off for this rental ({RAY_STATE['broken']}) — make it again, it runs on one card"}, "node_errors": {}}, status=400)
    kind = kind_of(body["prompt"]); kinds[pid] = kind
    if kind == "writer": LAST_PLAN["at"] = time.time()
    front = bool(body.pop("front", False))
    async with DISPATCH:
        # a free card and nobody ahead of it: straight there (ComfyUI checks the job and answers, as it always did)
        ahead = any(RANK.get(h["kind"], 1) <= RANK.get(kind, 1) or h["ray"] for h in held)
        t = None if (ray or ray_pid["id"] or ahead) else free_card(kind)
        if t is not None:
            st, d = await send(t, body)
            if st == 200: owner[pid] = t; busy[t].add(pid)
            return web.json_response(d, status=st)
        held.append({"pid": pid, "body": body, "client_id": body.get("client_id"), "ray": ray, "number": number["n"], "kind": kind, "front": front})
    await dispatch_held()
    return web.json_response({"prompt_id": pid, "number": number["n"], "node_errors": {}})


async def mode(req):
    """the Studio's Speed-ups: {keep_writer: bool}"""
    try: d = await req.json()
    except Exception: d = {}  # noqa: BLE001
    if isinstance(d, dict) and "keep_writer" in d: MODE["keep_writer"] = bool(d["keep_writer"])
    await dispatch_held()
    return web.json_response({"ok": True, **MODE})


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
        "writer_card": writer_card(), "keep_writer": MODE["keep_writer"], "planning_now": planning_now(),
        "card_jobs": [sorted(kinds.get(x, "?") for x in busy[i]) for i in range(len(BACKENDS))],
        "line": [h["kind"] + (" (split)" if h["ray"] else "") for h in _order()],
        "loads": [load(i) for i in range(len(BACKENDS))], "up": [up(i) for i in range(len(BACKENDS))], "raylight_up": up(-1) if RAY else None,
        "held": len(held), "held_jobs": [{"pid": h["pid"], "ray": h["ray"]} for h in held],
        "raylight_running": ray_pid["id"], "raylight_running_s": int(now - ray_pid.get("at", now)) if ray_pid["id"] else None,
        "cards_idle_s": int(now - GPU["busy_at"])})


def tag_preview(data: bytes, pid: str | None) -> bytes:
    """a live preview from one card, labelled with the job it belongs to. ComfyUI's plain previews (type 1) don't say
    which job they're for: with two cards rendering at once the Studio showed both jobs' previews on one tile, flicking
    between them. Rewritten as ComfyUI's own "preview with metadata" message (type 4) carrying the prompt_id."""
    import struct
    if not pid or len(data) < 8 or struct.unpack(">I", data[:4])[0] != 1: return data
    fmt = struct.unpack(">I", data[4:8])[0]
    meta = json.dumps({"prompt_id": pid, "image_type": "image/png" if fmt == 2 else "image/jpeg"}).encode()
    return struct.pack(">II", 4, len(meta)) + meta + data[8:]


async def ws(req):
    """the browser's live connection: every ComfyUI's messages for this client id, merged"""
    cid = req.query.get("clientId") or uuid.uuid4().hex
    out = web.WebSocketResponse(heartbeat=30, max_msg_size=0)
    await out.prepare(req)
    clients.setdefault(cid, set()).add(out)
    remaining: dict[int, int] = {}
    on_card: dict[int, str] = {}  # card → the prompt it's running (from its own messages)

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
                            pid_now = ((d or {}).get("data") or {}).get("prompt_id") if isinstance(d, dict) else None
                            if pid_now: on_card[i] = str(pid_now)  # what this card is working on (for its previews)
                            if d and d.get("type") == "status":
                                # one queue count for all the cards (+ jobs waiting in the router)
                                ei = ((d.get("data") or {}).get("status") or {}).get("exec_info") or {}
                                remaining[i] = int(ei.get("queue_remaining") or 0)
                                ei["queue_remaining"] = sum(remaining.values()) + len(held)
                                await out.send_str(json.dumps(d))
                            else:
                                await out.send_str(m.data)
                        elif m.type == aiohttp.WSMsgType.BINARY:
                            await out.send_bytes(tag_preview(m.data, on_card.get(i)))
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
        try:
            async for chunk in r.content.iter_chunked(1 << 16):
                await resp.write(chunk)
            await resp.write_eof()
        except (ConnectionError, aiohttp.ClientError):
            pass  # the browser stopped loading it (a video preview skipped or closed): nothing to report
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
    app.router.add_post("/h3-router", mode)
    app.router.add_route("*", "/{tail:.*}", proxy)
    print(f"comfy router: {len(BACKENDS)} ComfyUI(s) behind :{PORT} → {', '.join(BACKENDS)}", flush=True)
    web.run_app(app, host="127.0.0.1", port=PORT, print=None)


if __name__ == "__main__":
    main()
