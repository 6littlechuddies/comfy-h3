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
busy: dict[int, set] = {i: set() for i in range(len(BACKENDS))}  # running + waiting prompt ids per backend (from /queue polls)
held: list[dict] = []                  # jobs waiting in the router: {"pid", "body", "client_id", "ray", "number"}
ray_pid: dict = {"id": None}           # the Raylight job that has every card right now
clients: dict[str, set] = {}           # client_id → open browser websockets
number = {"n": 0}
SESSION: dict = {}


def is_ray(graph: dict) -> bool:
    return any(str((n or {}).get("class_type", "")).startswith(("Ray", "XFuser")) for n in (graph or {}).values())


def load(i: int) -> int:
    return len(busy[i])


async def poll_loop():
    """what each ComfyUI is doing: its /queue every half second"""
    s = SESSION["s"]
    while True:
        for i, b in enumerate(BACKENDS):
            try:
                async with s.get(f"{b}/queue", timeout=aiohttp.ClientTimeout(total=3)) as r:
                    q = await r.json()
                busy[i] = {str(x[1]) for x in (q.get("queue_running") or []) + (q.get("queue_pending") or [])}
            except Exception:  # noqa: BLE001  (starting up / restarting: keep the last known state)
                pass
        if ray_pid["id"] and RAY:
            try:
                async with s.get(f"{RAY}/queue", timeout=aiohttp.ClientTimeout(total=3)) as r:
                    q = await r.json()
                left = {str(x[1]) for x in (q.get("queue_running") or []) + (q.get("queue_pending") or [])}
                if ray_pid["id"] not in left and time.time() - ray_pid.get("at", 0) > 3:
                    ray_pid["id"] = None  # done: its cards go back to the per-card ComfyUIs
                    try: await s.post(f"{RAY}/free", json={"unload_models": True, "free_memory": True})
                    except Exception: pass  # noqa: BLE001
            except Exception:  # noqa: BLE001
                pass
        await dispatch_held()
        await asyncio.sleep(0.5)


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


async def dispatch_held():
    """jobs the router is holding: a Raylight job once every card is free; the others once the Raylight job is done"""
    while held and not ray_pid["id"]:
        j = held[0]
        if j["ray"]:
            if any(load(i) for i in range(len(BACKENDS))): return
            # every per-card ComfyUI gives its card's memory back, so Raylight's workers fit
            for b in BACKENDS:
                try: await SESSION["s"].post(f"{b}/free", json={"unload_models": True, "free_memory": True})
                except Exception: pass  # noqa: BLE001
            await asyncio.sleep(2)
            target = -1 if RAY else 0
        else:
            target = min(range(len(BACKENDS)), key=lambda i: (load(i), i))
        held.pop(0)
        st, d = await send(target, j["body"])
        if st == 200:
            owner[j["pid"]] = target
            if target >= 0: busy[target].add(j["pid"])
            if j["ray"]: ray_pid.update(id=j["pid"], at=time.time())
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
    if ray or ray_pid["id"] or held:
        # waits in the router (for every card, or behind the Raylight job that has them)
        held.append({"pid": pid, "body": body, "client_id": body.get("client_id"), "ray": ray, "number": number["n"]})
        await dispatch_held()
        return web.json_response({"prompt_id": pid, "number": number["n"], "node_errors": {}})
    target = min(range(len(BACKENDS)), key=lambda i: (load(i), i))
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
    return web.json_response({"cards": len(BACKENDS), "raylight": bool(RAY), "loads": [load(i) for i in range(len(BACKENDS))], "held": len(held), "raylight_running": ray_pid["id"]})


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
