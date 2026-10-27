"""H3 Studio helper API (runs next to ComfyUI, reached through Caddy at /studio-api/*).

  GET/PUT /studio-api/state/<name>   remembered settings, presets, timings (JSON files, backed up to B2)
  POST    /studio-api/upload         save a file from your computer into ComfyUI's input folder
  POST    /studio-api/to-input       copy a generated file (output folder) into the input folder
  GET     /studio-api/recent         newest generated files, for the tray
  POST    /studio-api/finish         trim / join / loop / export a video with ffmpeg (background job)
  GET     /studio-api/finish/<id>    job progress + result
  GET     /studio-api/cost           what this rental has cost so far (via the Vast API)
"""
import asyncio, html, json, os, re, shutil, subprocess, time, uuid
import aiohttp
from urllib.parse import urlparse, quote, unquote
from aiohttp import web

COMFY_DIR = os.environ.get("COMFY_DIR", "/opt/ComfyUI")
# On your own PC (H3_LOCAL=1, "2 - Start Studio.bat") ComfyUI Desktop keeps its folders elsewhere: each can be set on its own
LOCAL = os.environ.get("H3_LOCAL") == "1"
INPUT = os.environ.get("H3_INPUT") or os.path.join(COMFY_DIR, "input")
OUTPUT = os.environ.get("H3_OUTPUT") or os.path.join(COMFY_DIR, "output")
TEMP = os.environ.get("H3_TEMP") or os.path.join(COMFY_DIR, "temp")
MODELS = os.environ.get("H3_MODELS") or os.path.join(COMFY_DIR, "models")
# ComfyUI empties its temp folder every time it starts (and the watchdog restarts it after a crash), so anything that has
# to outlive that — the Proton login, imports arriving, exports being built, training runs — lives here instead
WORK = os.environ.get("H3_WORK") or os.path.expanduser("~/.h3/work")
os.makedirs(WORK, mode=0o700, exist_ok=True)
STATE = os.environ.get("H3_STATE") or os.path.join(COMFY_DIR, "user", "default", "studio")
PORT = int(os.environ.get("STUDIO_PORT", "18190"))
MEDIA = {"image": (".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif"),
         "video": (".mp4", ".mov", ".webm", ".mkv", ".m4v", ".avi"),
         "audio": (".wav", ".mp3", ".flac", ".ogg", ".m4a", ".aac", ".opus")}
NAME_OK = re.compile(r"^[a-z0-9_-]{1,40}$")
KEPT = os.path.join(STATE, "kept")  # files that must survive rentals (characters, style previews); backed up with settings
KEPT_PATH_OK = re.compile(r"^[A-Za-z0-9_.-]+(/[A-Za-z0-9_.-]+){0,4}$")
HTTPS_FILE = "/opt/h3/run/https_url"
LORAS = os.path.join(MODELS, "loras")
LORA_REG = os.path.join(STATE, "loras.json")  # your LoRA library: re-downloaded automatically on every new rental
MODEL_REG = os.path.join(STATE, "models.json")  # your own checkpoints (Krea 2 / Anima fine-tunes…): same, re-downloaded each rental
JOBS: dict[str, dict] = {}
os.makedirs(KEPT, exist_ok=True)


def kind_of(name: str) -> str | None:
    n = name.lower()
    return next((k for k, exts in MEDIA.items() if n.endswith(exts)), None)


def safe_join(root: str, *parts: str) -> str:
    p = os.path.realpath(os.path.join(root, *parts))
    if not p.startswith(os.path.realpath(root) + os.sep):
        raise web.HTTPBadRequest(text="bad path")
    return p


def folder(t: str) -> str:
    roots = {"output": OUTPUT, "input": INPUT, "temp": TEMP, "kept": KEPT}
    if t not in roots:
        raise web.HTTPBadRequest(text="bad type")
    return roots[t]


def probe(path: str) -> dict:
    try:
        r = subprocess.run(["ffprobe", "-v", "error", "-print_format", "json", "-show_format", "-show_streams", path],
                           capture_output=True, text=True, timeout=30)
        d = json.loads(r.stdout or "{}")
    except Exception:
        return {}
    v = next((s for s in d.get("streams", []) if s.get("codec_type") == "video"), None)
    a = next((s for s in d.get("streams", []) if s.get("codec_type") == "audio"), None)
    dur = float(d.get("format", {}).get("duration") or 0)
    out = {"duration": round(dur, 3), "has_audio": bool(a)}
    if v:
        out |= {"width": v.get("width"), "height": v.get("height")}
    return out


def unique_input_name(name: str) -> str:
    base, ext = os.path.splitext(re.sub(r"[^A-Za-z0-9._-]+", "_", os.path.basename(name)) or "file")
    cand = f"studio_{base}{ext}"
    i = 1
    while os.path.exists(os.path.join(INPUT, cand)):
        cand = f"studio_{base}_{i}{ext}"; i += 1
    return cand


# ------------------------------------------------------------------ state
async def get_state(req):
    name = req.match_info["name"]
    if not NAME_OK.match(name): raise web.HTTPBadRequest()
    p = os.path.join(STATE, name + ".json")
    if not os.path.exists(p): return web.json_response(None)
    with open(p) as f: return web.json_response(json.load(f))


# when you last changed your work (characters, settings, presets…): backups are named by it, and "newest" means this — not
# when a machine happened to upload. A machine that restored an old copy uploads it with the old time, so it never wins.
STAMP_FILE = os.path.join(STATE, "last_change.txt")
WORK_STATE = {"characters", "scenes", "presets", "scene_presets", "lora_sets", "my_recipes", "settings", "styles", "loras", "models",
              "prefs", "edit_chats", "favorites", "inspo", "wordbank", "site_addr"}


def last_change() -> float:
    try: return float(open(STAMP_FILE).read().strip() or 0)
    except (OSError, ValueError): return 0.0


def set_last_change(t: float | None = None) -> None:
    os.makedirs(STATE, exist_ok=True)
    with open(STAMP_FILE + ".tmp", "w") as f: f.write(str(t if t is not None else time.time()))
    os.replace(STAMP_FILE + ".tmp", STAMP_FILE)


async def put_state(req):
    name = req.match_info["name"]
    if not NAME_OK.match(name): raise web.HTTPBadRequest()
    data = await req.json()
    p = os.path.join(STATE, name + ".json")
    new = json.dumps(data)
    try: same = open(p).read() == new
    except OSError: same = False
    if same: return web.json_response({"ok": True})  # nothing changed (the Studio re-saves on load): not a change of yours
    with open(p + ".tmp", "w") as f: f.write(new)
    os.replace(p + ".tmp", p)
    if name in WORK_STATE: set_last_change()
    return web.json_response({"ok": True})


# ------------------------------------------------------------------ files
async def delete_output(req):
    """delete one result file (Results → Delete); only inside ComfyUI's output folder"""
    d = await req.json()
    sub, fn = str(d.get("subfolder") or ""), str(d.get("filename") or "")
    if not fn or "/" in fn or fn.startswith("."): raise web.HTTPBadRequest(text="bad name")
    p = safe_join(OUTPUT, sub, fn) if sub else safe_join(OUTPUT, fn)
    try: os.remove(p)
    except FileNotFoundError: pass
    # gone for good: also out of the catalog notes and the cloud backup's results (a restore would bring it back otherwise)
    key = f"{sub}/{fn}"
    meta = _state_json("catalog_meta", {}) or {}
    if isinstance(meta, dict) and meta.pop(key, None) is not None: _state_write("catalog_meta", meta)
    _CAT["at"] = 0.0
    studio_dir = os.path.join(OUTPUT, "studio")
    if _proton_on() and os.path.abspath(p).startswith(os.path.abspath(studio_dir) + os.sep):
        rel = os.path.relpath(p, studio_dir).replace(os.sep, "/")
        folder_ = (os.environ.get("PROTON_FOLDER") or "H3 Studio").strip("/")
        async def _cloud_delete():
            try:
                await _proton_setup()
                # straight out, not into Google Drive's trash (where it would still use your storage for 30 days)
                await _rclone("deletefile", "--drive-use-trash=false", f"proton:{folder_}/results/{rel}", timeout=120)
            except Exception as e:  # noqa: BLE001
                print("!! deleting from the backup:", _redact(str(e))[:200], flush=True)
        _spawn(_cloud_delete())
    return web.json_response({"ok": True})


async def upload(req):
    reader = await req.multipart()
    field = await reader.next()
    if field is None or field.name != "file": raise web.HTTPBadRequest(text="no file")
    name = unique_input_name(field.filename or "upload")
    if not kind_of(name): raise web.HTTPBadRequest(text="unsupported file type")
    dest = os.path.join(INPUT, name)
    with open(dest, "wb") as f:
        while chunk := await field.read_chunk(1 << 20):
            f.write(chunk)
    if req.query.get("convert") == "wav":  # e.g. a voice clip recorded in the browser (webm/ogg) -> wav
        wav = os.path.splitext(dest)[0] + ".wav"
        p = await asyncio.create_subprocess_exec("ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", dest, "-ar", "48000", "-ac", "2", wav)
        await p.wait()
        if p.returncode != 0 or not os.path.exists(wav): raise web.HTTPBadRequest(text="could not convert the recording")
        os.remove(dest); dest = wav; name = os.path.basename(wav)
    return web.json_response({"name": name, "kind": kind_of(name), **(probe(dest) if kind_of(name) != "image" else {})})


async def to_input(req):
    d = await req.json()
    src = safe_join(folder(d.get("type", "output")), d.get("subfolder", ""), d["filename"])
    if not os.path.isfile(src): raise web.HTTPNotFound()
    if d.get("type") == "input" and not d.get("subfolder"):
        name = d["filename"]
    else:
        name = unique_input_name(d["filename"])
        shutil.copy2(src, os.path.join(INPUT, name))
        _remember_input(name, {"type": d.get("type", "output"), "subfolder": d.get("subfolder", ""), "filename": d["filename"]})
    k = kind_of(name)
    return web.json_response({"name": name, "kind": k, **(probe(os.path.join(INPUT, name)) if k != "image" else {})})


def _remember_input(name: str, source: dict):
    """where each input copy came from (kept/…, output/…) — a later rental can make the copy again when a chat, a remix or a
    setting still names it (backups carry this list, not the input folder)"""
    try:
        m = _state_json("input_sources", {}) or {}
        m[name] = source
        if len(m) > 5000: m = dict(list(m.items())[-4000:])
        _state_write("input_sources", m)
    except Exception as e:  # noqa: BLE001
        print("!! input_sources:", e, flush=True)


async def inputs_ensure(req):
    """POST {names} → make missing input files again from where they came from; returns the ones that can't be"""
    d = await req.json()
    names = [n for n in (d.get("names") or []) if isinstance(n, str) and n and "/" not in n and ".." not in n][:64]
    srcs = _state_json("input_sources", {}) or {}
    missing = []
    for n in names:
        dest = os.path.join(INPUT, n)
        if os.path.isfile(dest): continue
        s_ = srcs.get(n)
        try:
            src = safe_join(folder(s_.get("type", "output")), s_.get("subfolder", ""), s_["filename"]) if isinstance(s_, dict) and s_.get("filename") else None
        except web.HTTPException:
            src = None
        if src and os.path.isfile(src):
            shutil.copy2(src, dest); continue
        missing.append(n)
    return web.json_response({"missing": missing})


def _public_host(host: str) -> bool:
    """a web address on the internet (not this rental, not a private network) — so a dropped link can't reach inside"""
    import ipaddress, socket
    if os.environ.get("STUDIO_TEST_LOCAL_FETCH") == "1": return True  # tests only
    try:
        for fam, _, _, _, sa in socket.getaddrinfo(host, None):
            ip = ipaddress.ip_address(sa[0])
            if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast: return False
        return True
    except (OSError, ValueError):
        return False


async def fetch_image(req):
    """POST {url} → a picture dragged in from another tab (Pinterest, Instagram, any site): the image itself, or the page's
    main picture (og:image) when the link is a page like a Pinterest pin. Saved as an input file."""
    import hashlib, html as _html
    d = await req.json()
    url = str(d.get("url") or "").strip()
    if not re.match(r"^https?://", url, re.I): raise web.HTTPBadRequest(text="That isn't a web link")
    hdrs = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15", "Accept": "image/*,text/html;q=0.9,*/*;q=0.5"}
    fallback = None
    async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=40)) as s:
        for hop in range(4):
            host = urlparse(url).hostname or ""
            if not await asyncio.to_thread(_public_host, host): raise web.HTTPBadRequest(text="That address isn't on the public web")
            async with s.get(url, headers=hdrs, allow_redirects=True, max_redirects=5) as r:
                if r.status != 200:
                    if fallback: url, fallback = fallback, None; continue
                    raise web.HTTPBadGateway(text=f"The site answered {r.status} for that picture")
                ct = (r.headers.get("Content-Type") or "").split(";")[0].strip().lower()
                if ct.startswith("image/"):
                    body = await r.content.read(30 * 1024 * 1024 + 1)
                    if len(body) > 30 * 1024 * 1024: raise web.HTTPRequestEntityTooLarge(max_size=30 * 1024 * 1024, actual_size=len(body))
                    ext = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif", "image/avif": ".avif"}.get(ct, ".jpg")
                    name = f"web_{hashlib.sha1(body).hexdigest()[:12]}{ext}"
                    dest = os.path.join(INPUT, name)
                    if not os.path.isfile(dest):
                        with open(dest, "wb") as f: f.write(body)
                    if ext in (".webp", ".avif", ".gif"):  # one plain format for every model
                        from PIL import Image
                        png = os.path.splitext(dest)[0] + ".png"
                        try:
                            with Image.open(dest) as im: im.convert("RGB").save(png)
                            name = os.path.basename(png)
                        except Exception: pass  # noqa: BLE001
                    return web.json_response({"name": name, "kind": "image"})
                if ct in ("text/html", "application/xhtml+xml") and hop < 3:
                    page = (await r.content.read(3 * 1024 * 1024)).decode(errors="ignore")
                    m = re.search(r'<meta[^>]+(?:property|name)=["\'](?:og:image|twitter:image)(?::src)?["\'][^>]+content=["\']([^"\']+)', page, re.I) \
                        or re.search(r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+(?:property|name)=["\'](?:og:image|twitter:image)', page, re.I)
                    if not m: raise web.HTTPBadRequest(text="That page has no main picture — open the picture itself and drag that")
                    url = _html.unescape(m.group(1))
                    # Pinterest serves smaller sizes in og:image; the original is under /originals/ (when it exists)
                    big = re.sub(r"(i\.pinimg\.com)/\d+x/", r"\1/originals/", url)
                    if big != url: fallback, url = url, big
                    continue
                raise web.HTTPBadRequest(text=f"That link isn't a picture ({ct or 'unknown type'})")
    raise web.HTTPBadRequest(text="Couldn't get a picture from that link")


def _make_board(srcs: list[str], dest: str, height: int = 1024, max_w: int = 3072):
    """several pictures of one character side by side (same height, on the first picture's background) — one picture
    the edit model can look at to see every angle at once"""
    from PIL import Image
    ims = [Image.open(p).convert("RGB") for p in srcs]
    h = height
    scaled = [im.resize((max(1, round(im.width * h / im.height)), h), Image.LANCZOS) for im in ims]
    total = sum(x.width for x in scaled) + 16 * (len(scaled) - 1)
    if total > max_w:  # too wide: shrink everything to fit
        f = max_w / total; h = max(256, round(h * f))
        scaled = [im.resize((max(1, round(im.width * h / im.height)), h), Image.LANCZOS) for im in ims]
        total = sum(x.width for x in scaled) + 16 * (len(scaled) - 1)
    bg = scaled[0].getpixel((2, 2))
    board = Image.new("RGB", (total, h), bg)
    x = 0
    for im in scaled:
        board.paste(im, (x, 0)); x += im.width + 16
    board.save(dest)


async def make_board(req):
    """POST {files: [FileRef…]} → one input picture with all of them side by side (Create: the whole character sheet)"""
    d = await req.json()
    files = [f for f in (d.get("files") or []) if isinstance(f, dict) and f.get("filename")][:9]
    if not files: raise web.HTTPBadRequest(text="no pictures")
    srcs = []
    for f in files:
        p = safe_join(folder(f.get("type", "output")), f.get("subfolder", ""), f["filename"])
        if not os.path.isfile(p): raise web.HTTPNotFound(text=f"{f['filename']} not found")
        srcs.append(p)
    import hashlib
    key = hashlib.sha1("|".join(f"{p}:{os.path.getmtime(p)}" for p in srcs).encode()).hexdigest()[:12]
    name = f"board_{key}.png"
    dest = os.path.join(INPUT, name)
    if not os.path.isfile(dest): await asyncio.to_thread(_make_board, srcs, dest)
    return web.json_response({"name": name, "kind": "image"})


async def recent(req):
    limit = int(req.query.get("limit", "40"))
    items = []
    for root, _, files in os.walk(os.path.join(OUTPUT, "studio")):
        if _CAT_SKIP.search(os.path.relpath(root, OUTPUT).replace(os.sep, "/")): continue
        for fn in files:
            k = kind_of(fn)
            if not k or _WORK_FILE.match(fn): continue
            p = os.path.join(root, fn)
            items.append((os.path.getmtime(p), fn, os.path.relpath(root, OUTPUT), k))
    items.sort(reverse=True)
    return web.json_response([{"filename": f, "subfolder": s, "type": "output", "kind": k, "mtime": m} for m, f, s, k in items[:limit]])


# ------------------------------------------------------------------ kept files (survive rentals)
def kept_path(path: str) -> str:
    if not KEPT_PATH_OK.match(path) or ".." in path: raise web.HTTPBadRequest(text="bad path")
    return safe_join(KEPT, path)


async def keep(req):
    set_last_change()
    d = await req.json()
    src_ref, dest = d["from"], kept_path(d["path"])
    src = safe_join(folder(src_ref.get("type", "output")), src_ref.get("subfolder", ""), src_ref["filename"])
    if not os.path.isfile(src): raise web.HTTPNotFound()
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    shutil.copy2(src, dest)
    rel = os.path.relpath(dest, KEPT)
    return web.json_response({"filename": os.path.basename(rel), "subfolder": os.path.dirname(rel), "type": "kept"})


async def get_kept(req):
    p = kept_path(req.match_info["path"])
    if not os.path.isfile(p): raise web.HTTPNotFound()
    return web.FileResponse(p, headers={"Cache-Control": "no-cache"})


async def del_kept(req):
    p = kept_path(req.match_info["path"])
    if os.path.isdir(p): shutil.rmtree(p)
    elif os.path.isfile(p): os.remove(p)
    return web.json_response({"ok": True})


async def https_link(req):
    try:
        with open(HTTPS_FILE) as f: url = f.read().strip()
    except OSError:
        url = ""
    return web.json_response({"url": url or None})


# ------------------------------------------------------------------ LoRA library (survives rentals)
def load_reg() -> dict:
    """your LoRA library: file name → details (anything that isn't a proper entry is left out)"""
    try:
        with open(LORA_REG) as f: d = json.load(f)
    except Exception:
        return {}
    return {k: v for k, v in d.items() if isinstance(v, dict)} if isinstance(d, dict) else {}


def load_models() -> dict:
    try: return json.load(open(MODEL_REG))
    except (OSError, ValueError): return {}


def save_models(reg: dict):
    with open(MODEL_REG + ".tmp", "w") as f: json.dump(reg, f, indent=1)
    os.replace(MODEL_REG + ".tmp", MODEL_REG)


async def my_models(req):
    """your own checkpoints, by family: [{name, title, version, family, folder, here}]"""
    out = []
    for rel, x in load_models().items():
        here = os.path.isfile(os.path.join(MODELS, x.get("folder", "diffusion_models"), rel))
        out.append({"name": rel, "title": x.get("title", rel), "version": x.get("version", ""), "family": x.get("family", "other"),
                    "folder": x.get("folder", "diffusion_models"), "base": x.get("base", ""), "here": here, "model_id": x.get("model_id"), "version_id": x.get("version_id")})
    return web.json_response({"items": out})


async def forget_model(req):
    d = await req.json(); rel = str(d.get("name") or "")
    reg = load_models()
    x = reg.pop(rel, None)
    if x is None: return web.json_response({"error": "Not in your models"}, status=404)
    save_models(reg)
    if d.get("delete"):
        try: os.remove(safe_join(os.path.join(MODELS, x.get("folder", "diffusion_models")), rel))
        except (OSError, web.HTTPException): pass
    return web.json_response({"ok": True})


def save_reg(reg: dict):
    with open(LORA_REG + ".tmp", "w") as f: json.dump(reg, f, indent=1)
    os.replace(LORA_REG + ".tmp", LORA_REG)


def family(base: str) -> str:
    b = (base or "").lower()
    if "anima" in b: return "anima"
    if re.search(r"krea\s*-?\s*2", b): return "krea2"
    if "qwen" in b: return "qwen"
    if "minimax" in b or b.startswith("h3"): return "h3"
    # other video models: their LoRAs don't run here, but their example clips and prompts are worth copying
    if re.search(r"wan\b|wan video|hunyuan|ltx|mochi|cogvideo|\bsvd\b|kling|video", b): return "video"
    if any(k in b for k in ("sdxl", "pony", "illustrious", "noob")): return "sdxl"
    if not b: return "unknown"
    return "other"


def scan_loras() -> list[dict]:
    """every LoRA on disk, with what we know about it (our registry + LoRA Manager's .metadata.json)"""
    reg, changed, out = load_reg(), False, []
    for root, _, files in os.walk(LORAS):
        for fn in files:
            if not fn.endswith((".safetensors", ".pt", ".ckpt")): continue
            rel = os.path.relpath(os.path.join(root, fn), LORAS).replace(os.sep, "/")
            info = reg.get(rel)
            meta_p = os.path.join(root, os.path.splitext(fn)[0] + ".metadata.json")
            if not info and os.path.exists(meta_p):  # downloaded with the LoRA Manager page -> remember it too
                try:
                    m = json.load(open(meta_p))
                    c = m.get("civitai") or {}
                    vid = c.get("id") or m.get("civitai_version_id")
                    if vid:
                        info = {"version_id": int(vid), "model_id": c.get("modelId"), "title": m.get("model_name") or c.get("model", {}).get("name") or fn,
                                "base": m.get("base_model") or c.get("baseModel") or ""}
                        reg[rel] = info; changed = True
                except Exception:
                    pass
            info = info or {}
            guess = "MiniMax H3" if re.search(r"minimax|(^|[_/-])h3", rel, re.I) else "Qwen" if "qwen" in rel.lower() else ""
            out.append({"name": rel, "title": info.get("title") or os.path.splitext(fn)[0], "base": info.get("base") or guess,
                        "family": family(info.get("base") or guess), "trigger": info.get("trigger", ""), "tips": info.get("tips") or {}, "role": info.get("role") or lora_role(None, info.get("title") or "", rel), "remembered": bool(info.get("version_id") or info.get("backed_up")),
                        "size_mb": round(os.path.getsize(os.path.join(root, fn)) / 1e6)})
    if changed: save_reg(reg)
    return sorted(out, key=lambda x: x["name"].lower())


async def fetch_missing_loras(req):
    """LoRAs a job wanted that aren't here: download the ones your library knows (now, in the background); say which it doesn't"""
    names = [str(x) for x in (await req.json()).get("names", [])][:40]
    reg = load_reg()
    by_base = {os.path.basename(k).lower(): k for k in reg}
    want, unknown = {}, []
    for n in names:
        rel = n.replace("\\", "/")
        key = rel if rel in reg else by_base.get(os.path.basename(rel).lower())
        if key: want[key] = reg[key]
        else: unknown.append(os.path.basename(rel).rsplit(".", 1)[0])
    before = set(LORA_JOBS)
    _fetch_missing_loras(want)
    started = [k for k in want if not os.path.isfile(os.path.join(LORAS, k))]
    return web.json_response({"downloading": [os.path.basename(k).rsplit(".", 1)[0] for k in started], "unknown": unknown,
                              "jobs": [j for j in LORA_JOBS if j not in before], "key": bool(civitai_token())})

async def list_loras(req):
    return web.json_response(scan_loras())


def civitai_ids(url: str) -> tuple[int | None, int | None]:
    v = re.search(r"modelVersionId=(\d+)", url) or re.search(r"/api/download/models/(\d+)", url) or re.search(r"/model-versions/(\d+)", url)
    m = re.search(r"/models/(\d+)", url)
    return (int(v.group(1)) if v else None), (int(m.group(1)) if m and "/api/download/" not in url else None)


LORA_JOBS: dict[str, dict] = {}
CIVITAI = os.environ.get("STUDIO_CIVITAI_BASE", "https://civitai.com")  # overridable for tests


KEY_FILE = os.path.join(STATE, "civitai_key")


CIVITAI_KEYS_FILE = os.environ.get("CIVITAI_KEYS_FILE") or os.path.expanduser("~/.h3/civitai_keys.txt")
CIVITAI_GOOD: dict = {"key": ""}  # the key that last worked: tried first next time


def civitai_tokens() -> list[str]:
    """every CivitAI key: the template (CIVITAI_TOKEN / CIVITAI_TOKENS / CIVITAI_API_KEY, several separated by commas),
    the one pasted into the Studio, and civitai_keys.txt (or any key file) on your drive. The last one that worked first."""
    raw = ",".join(os.environ.get(n, "") for n in sorted(os.environ) if re.fullmatch(r"CIVITAI_(TOKENS?|API_KEY)(_?\d+)?", n))
    for p in (KEY_FILE, CIVITAI_KEYS_FILE):
        try:
            with open(p) as f: raw += "," + f.read()
        except OSError:
            pass
    out: list[str] = []
    for k in re.split(r"[\s,;]+", raw):
        if re.fullmatch(r"[A-Za-z0-9_-]{20,128}", k or "") and not k.startswith("hf_") and k not in out: out.append(k)
    if CIVITAI_GOOD["key"] in out: out.remove(CIVITAI_GOOD["key"]); out.insert(0, CIVITAI_GOOD["key"])
    return out


def civitai_token() -> str:
    t = civitai_tokens()
    return t[0] if t else ""


def civitai_auth() -> dict:
    token = civitai_token()
    return {"Authorization": f"Bearer {token}"} if token else {}


async def client_error(req):
    """a crash in the browser: written to the log so the debug report and Claude on the rental can see it"""
    try:
        d = await req.json()
        print(f"!! Studio page error {str(d.get('text', ''))[:6000]}", flush=True)
    except Exception:  # noqa: BLE001
        pass
    return web.json_response({"ok": True})


async def civitai_key(req):
    if req.method == "GET":
        n = len(civitai_tokens())
        src = "template" if (os.environ.get("CIVITAI_TOKEN") or os.environ.get("CIVITAI_TOKENS") or os.environ.get("CIVITAI_API_KEY")) else "studio" if os.path.exists(KEY_FILE) else "drive" if n else None
        return web.json_response({"set": bool(n), "source": src, "count": n})
    if req.method == "DELETE":
        if os.path.exists(KEY_FILE): os.remove(KEY_FILE)
        return web.json_response({"ok": True})
    # one key, or several (one per line, or separated by commas): each is tried in turn when CivitAI says no
    keys = [k for k in re.split(r"[\s,;]+", str((await req.json()).get("key", ""))) if k]
    if not keys or not all(re.fullmatch(r"[A-Za-z0-9_-]{16,128}", k) for k in keys): raise web.HTTPBadRequest(text="That doesn't look like a CivitAI API key")
    key = "\n".join(dict.fromkeys(keys))
    os.makedirs(STATE, exist_ok=True)
    fd = os.open(KEY_FILE, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f: f.write(key)
    # LoRAs CivitAI refused without a key: try them again now
    try: _fetch_missing_loras(load_reg())
    except Exception: pass  # noqa: BLE001
    return web.json_response({"ok": True})


def _explicit(img: dict) -> bool:
    if not isinstance(img, dict): return False
    lvl = img.get("nsfwLevel", img.get("nsfw"))
    if isinstance(lvl, bool): return lvl
    if isinstance(lvl, (int, float)): return lvl >= 4
    return str(lvl) in ("Mature", "X", "XXX", "R")


def _thumb(url: str, w: int = 450) -> str:
    return re.sub(r"/(width=\d+|original=true)(/|$)", f"/width={w}\\2", url) if "image.civitai.com" in url else url


SEARCH_CACHE: dict[str, tuple[float, dict]] = {}
# never offer LoRAs or example prompts that involve minors
MINOR = re.compile(r"\b(loli|lolis|shota|shotacon|lolicon|child|children|kid|kids|toddler|underage|minor|preteen|pre-teen|young girl|young boy|little girl|little boy|elementary|middle school|\d{1,2}\s?(yo|y/o|years? old))\b", re.I)


def _minor_ok(*texts) -> bool:
    for t in texts:
        if not t: continue
        for m in MINOR.finditer(str(t)):
            age = re.match(r"(\d{1,2})", m.group(0))
            if age and int(age.group(1)) >= 18: continue
            return False
    return True


def _strip_html(h: str) -> str:
    t = re.sub(r"<(br|/p|/li|/h\d)[^>]*>", "\n", h or "", flags=re.I)
    t = re.sub(r"<[^>]+>", "", t)
    t = html.unescape(t).replace("\xa0", " ")
    return re.sub(r"\n{3,}", "\n\n", t).strip()


TRIG_RE = re.compile(r"(?:trigger(?:\s*(?:word|words|tag|tags|prompt|phrase))?|activation(?:\s*(?:word|words|tag|tags|token))?|key\s*words?|instance\s*prompt)\s*(?:is|are|=|:|：|-)\s*([^\n]{1,160})", re.I)


def triggers_from(trained: list | None, *descriptions: str) -> str:
    """CivitAI's trained words, or — when the creator left them empty — the trigger words written in the description"""
    words = [w.strip() for w in (trained or []) if w and w.strip()]
    if words: return ", ".join(dict.fromkeys(words))
    for d in descriptions:
        m = TRIG_RE.search(_strip_html(d or ""))
        if not m: continue
        t = re.split(r"(?<=[a-z0-9)\]])\.\s|;|\s{2,}|\s+(?:and|or)\s+(?:use|add|put)\b", m.group(1).strip(), maxsplit=1)[0]
        t = re.sub(r"[`\"“”‘’*_]", "", t).strip(" .,'")
        if 1 < len(t) <= 120 and not re.match(r"(?i)(none|n/?a|not needed|no need|not required|-)$", t): return t
    return ""


_NUM = r"(\d+(?:\.\d+)?)"
TIP_RES = {
    "weight": re.compile(r"(?:recommended|suggested|best|use)?\s*(?:lora\s*)?(?:weight|strength)s?\s*(?:of|is|at|around|between|:|=|-)?\s*" + _NUM + r"(?:\s*(?:-|~|–|to)\s*" + _NUM + r")?", re.I),
    "sampler": re.compile(r"sampler\s*(?:is|:|=|-)\s*([A-Za-z][A-Za-z0-9_+ .]{1,30}?)(?=\s*(?:[,;|\n(]|$|\s{2}|scheduler|steps|cfg))", re.I),
    "scheduler": re.compile(r"(?:scheduler|schedule type)\s*(?:is|:|=|-)\s*([A-Za-z][A-Za-z0-9_ ]{1,20}?)(?=\s*(?:[,;|\n(]|$|\s{2}|steps|cfg))", re.I),
    "cfg": re.compile(r"cfg(?:\s*scale)?\s*(?:is|:|=|-|of|at)?\s*" + _NUM + r"(?:\s*(?:-|~|–|to)\s*" + _NUM + r")?", re.I),
    "steps": re.compile(r"steps\s*(?:is|:|=|-|of|at)?\s*(\d{1,3})(?:\s*(?:-|~|–|to)\s*(\d{1,3}))?", re.I),
    "negative": re.compile(r"negative(?:\s*prompts?)?\s*(?:is|:|=|-)\s*([^\n]{3,300})", re.I),
    "prompt": re.compile(r"(?:recommended|suggested|example|positive)\s+prompts?\s*(?:is|:|=|-)\s*([^\n]{3,300})", re.I),
}


def lora_role(tags: list | None, title: str = "", name: str = "") -> str:
    """what a LoRA does, from its CivitAI tags and name: slider (one attribute, signed strength), character, style, detail,
    concept (pose, clothing, objects…). The Studio's Balance treats them differently: sliders are left alone, the
    character leads, styles and concepts share what's left."""
    t = {str(x).lower() for x in (tags or [])}
    n = f"{title} {name}".lower()
    if "slider" in t or re.search(r"\bslider\b|_slider|slider_", n): return "slider"
    if t & {"character", "characters", "celebrity", "person", "real person", "influencer"} or re.search(r"\b(character|oc)\b", n): return "character"
    if re.search(r"\b(detail|details|detailer|enhancer|quality|realism|skin texture)\b", n) or t & {"detail", "enhancer", "tool"}: return "detail"
    if t & {"style", "art style", "artstyle", "photography style", "artist"} or re.search(r"\bstyle\b", n): return "style"
    return "concept"


def tips_from(*descriptions: str) -> dict:
    """the creator's usage tips written in a LoRA's description: strength, sampler, scheduler, CFG, steps, negative / suggested prompt"""
    out: dict = {}
    for d in descriptions:
        t = _strip_html(d or "")
        if not t: continue
        for k, rx in TIP_RES.items():
            if k in out: continue
            m = rx.search(t)
            if not m: continue
            if k in ("weight", "cfg", "steps"):
                a = float(m.group(1)); b = float(m.group(2)) if m.lastindex and m.lastindex > 1 and m.group(2) else a
                v = round((a + b) / 2, 2)
                if k == "weight" and not 0.05 <= v <= 2: continue
                if k == "cfg" and not 1 <= v <= 30: continue
                if k == "steps" and not 1 <= v <= 150: continue
                out[k] = int(v) if k == "steps" else v
                if a != b: out[f"{k}_range"] = f"{m.group(1)}–{m.group(2)}"
            else:
                v = re.sub(r"[`\"“”*_]", "", m.group(1)).strip(" .,'")
                if 1 < len(v): out[k] = v[:300]
    if out.get("negative") and not _minor_ok(out["negative"]): out.pop("negative")
    if out.get("prompt") and not _minor_ok(out["prompt"]): out.pop("prompt")
    return out


@web.middleware
async def show_errors(req, handler):
    """an unexpected crash comes back as a readable message (and a traceback in the log) instead of a bare 500"""
    try:
        return await handler(req)
    except (web.HTTPException, asyncio.CancelledError):
        raise
    except Exception as e:  # noqa: BLE001
        import traceback; traceback.print_exc()
        return web.json_response({"error": f"{type(e).__name__}: {e}"[:300]}, status=500)


# CivitAI has two sites: civitai.com (family-friendly only) and civitai.red (everything). Pictures, collections and models
# you've saved that are rated above PG only come back from .red, so ask it first and fall back to .com
def civitai_hosts() -> list[str]:
    if os.environ.get("STUDIO_CIVITAI_BASE"): return [CIVITAI]  # tests
    first = (os.environ.get("CIVITAI_HOST") or "https://civitai.red").rstrip("/")
    return [first] + [h for h in ("https://civitai.com", "https://civitai.red") if h != first]


HOST_OF: dict[str, str] = {}  # path -> the site that answered it


def _page_host() -> str:
    """the CivitAI site your links open on: civitai.red unless CIVITAI_HOST says otherwise"""
    h = civitai_hosts()[0]
    return h if h.startswith("https://civitai.") else "https://civitai.red"


def _is_empty(d) -> bool:
    """an answer with a list in it that has nothing in it (so the other site might know better)"""
    if d is None: return True
    try: d = _trpc_data(d)
    except web.HTTPException: return False
    if isinstance(d, dict):
        for k in ("items", "collections", "data", "results"):
            if isinstance(d.get(k), list): return not d[k]
    return False


async def _civitai_get_from(host: str, path: str):
    last = ""
    for attempt in range(4):  # CivitAI is often briefly busy (503 / 429) or slow: wait a little and ask again
        if attempt: await asyncio.sleep(1.5 * attempt)
        try:
            async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=45)) as s:
                async with s.get(f"{host}{path}", headers=civitai_auth()) as r:
                    if r.status != 200:
                        last = f"CivitAI said {r.status}"
                        if r.status in (400, 401, 403, 404): return None, last
                        continue
                    return await r.json(content_type=None), ""
        except asyncio.TimeoutError: last = "CivitAI took too long to answer"
        except (aiohttp.ClientError, ValueError) as e: last = f"CivitAI: {type(e).__name__}: {e}"[:200]
    return None, last or "Couldn't reach CivitAI"


async def civitai_get(path: str) -> dict:
    hit = SEARCH_CACHE.get(path)
    if hit and time.time() - hit[0] < 300: return hit[1]
    errs, got, got_host = [], None, None
    for host in civitai_hosts():
        d, err = await _civitai_get_from(host, path)
        if err: errs.append(err); continue
        if got is None: got, got_host = d, host
        if not _is_empty(d): got, got_host = d, host; break
    if got is None:
        raise web.HTTPBadGateway(text=json.dumps({"error": errs[0] if errs else "Couldn't reach CivitAI"}), content_type="application/json")
    SEARCH_CACHE[path] = (time.time(), got); HOST_OF[path] = got_host
    return got


def _lora_item(m: dict, have: set[str]) -> dict | None:
    """one CivitAI model (v1 API shape) as a Browse LoRAs card — None when it's not one we can show (or an odd shape)"""
    try: return _lora_item_(m, have)
    except (AttributeError, TypeError, KeyError, IndexError, ValueError) as e:
        print("!! CivitAI card skipped:", type(e).__name__, e, flush=True)
        return None


def _lora_item_(m: dict, have: set[str]) -> dict | None:
    if not isinstance(m, dict): return None
    vs = [x for x in m.get("modelVersions") or [] if isinstance(x, dict)]
    if not vs or not _minor_ok(m.get("name"), " ".join(t if isinstance(t, str) else str((t or {}).get("name", "")) for t in (m.get("tags") or []))): return None
    v = vs[0]
    files = [x for x in v.get("files") or [] if isinstance(x, dict)]
    f = next((x for x in files if x.get("primary")), files[0] if files else {})
    imgs = [{"url": _thumb(i["url"]), "explicit": _explicit(i), "video": i.get("type") == "video"} for i in (v.get("images") or []) if isinstance(i, dict) and i.get("url")][:4]
    st = m.get("stats") if isinstance(m.get("stats"), dict) else {}
    creator = m.get("creator")
    return {"model_id": m.get("id"), "version_id": v.get("id"), "name": m.get("name", ""), "version": v.get("name", ""),
            "creator": creator.get("username", "") if isinstance(creator, dict) else str(creator or ""), "base": v.get("baseModel", ""), "family": family(v.get("baseModel", "")),
            "trigger": triggers_from(v.get("trainedWords"), v.get("description") or "", m.get("description") or ""), "size_mb": round((f.get("sizeKB") or f.get("sizeKb") or 0) / 1000),
            "downloads": st.get("downloadCount", 0), "likes": st.get("thumbsUpCount", st.get("favoriteCount", 0)),
            "images": imgs, "installed": str(v.get("id")) in have, "tags": [t if isinstance(t, str) else str((t or {}).get("name", "")) for t in (m.get("tags") or [])][:6],
            "versions": [{"id": x.get("id"), "name": x.get("name", ""), "base": x.get("baseModel", "")} for x in vs[:12]]}


BASE_OK: dict[str, bool] = {}  # which base-model names CivitAI's search accepts (learned when it refuses one)


async def civitai_search(req):
    """browse CivitAI LoRAs from inside the Studio: ?q=&base=Illustrious,NoobAI&sort=&period=&cursor="""
    q = req.query
    params = {"types": "LORA", "limit": "24", "sort": q.get("sort") or "Most Downloaded", "period": q.get("period") or "AllTime",
              "nsfw": "true", "primaryFileOnly": "true"}
    if q.get("q"): params["query"] = q["q"]
    if q.get("tag"): params["tag"] = q["tag"]
    if q.get("cursor"): params["cursor"] = q["cursor"]
    if q.get("liked"):
        if not civitai_token(): return web.json_response({"error": "Add your CivitAI key to see the LoRAs you liked (⋯ menu → CivitAI key)"}, status=401)
        params["favorites"] = "true"
    bases = [b for b in (q.get("base") or "").split(",") if b]
    qs = "&".join(f"{k}={quote(v)}" for k, v in params.items()) + "".join(f"&baseModels={quote(b)}" for b in bases)
    hit = SEARCH_CACHE.get(qs)
    if hit and time.time() - hit[0] < 300: return web.json_response(hit[1])
    want = None  # set when CivitAI didn't know a base-model name: filter by family here instead
    try:
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=25)) as s:
            for attempt in range(4):  # CivitAI often answers 503/429 for a moment: wait and ask again instead of failing
                async with s.get(f"{CIVITAI}/api/v1/models?{qs}", headers=civitai_auth()) as r:
                    status = r.status
                    d = await r.json() if status == 200 else None
                if status not in (429, 500, 502, 503, 504): break
                await asyncio.sleep(1.5 * (attempt + 1))
            if status == 400 and bases:
                # CivitAI refuses the whole search if one base-model name is unknown to it: find out (once) which
                # names it takes and search with those; if none, search without and keep the matching families here
                async def ok(b):
                    if b not in BASE_OK:
                        async with s.get(f"{CIVITAI}/api/v1/models?types=LORA&limit=1&baseModels={quote(b)}", headers=civitai_auth()) as rr:
                            BASE_OK[b] = rr.status == 200
                    return BASE_OK[b]
                good = [b for b in bases if await ok(b)]
                if good and len(good) < len(bases):
                    qs2 = "&".join(f"{k}={quote(v)}" for k, v in params.items()) + "".join(f"&baseModels={quote(b)}" for b in good)
                else:
                    want = {family(b) for b in bases}
                    qs2 = "&".join(f"{k}={quote(v)}" for k, v in params.items())
                async with s.get(f"{CIVITAI}/api/v1/models?{qs2}", headers=civitai_auth()) as r:
                    status = r.status
                    d = await r.json() if status == 200 else None
            if status != 200: return web.json_response({"error": f"CivitAI said {status}"}, status=502)
    except Exception as e:  # noqa: BLE001
        return web.json_response({"error": f"Couldn't reach CivitAI ({type(e).__name__})"}, status=502)
    if want:
        d["items"] = [m for m in d.get("items", []) if (m.get("modelVersions") or [{}])[0].get("baseModel") and family(m["modelVersions"][0]["baseModel"]) in want]
    have = {str(v.get("version_id")) for v in load_reg().values()}
    items = [it for it in (_lora_item(m, have) for m in d.get("items", [])) if it]
    out = {"items": items, "next": (d.get("metadata") or {}).get("nextCursor")}
    SEARCH_CACHE[qs] = (time.time(), out)
    return web.json_response(out)


async def _aria_fetch(url: str, dest: str, size: float, job: dict) -> bool:
    """download one file with aria2c (8 connections), reporting progress into job; False = didn't work, use the plain way"""
    try:
        if os.path.exists(dest): os.remove(dest)
        p = await asyncio.create_subprocess_exec(
            "aria2c", url, "-x", "8", "-s", "8", "-k", "4M", "--file-allocation=none", "--allow-overwrite=true", "--auto-file-renaming=false",
            "--max-tries=5", "--retry-wait=2", "--connect-timeout=20", "--summary-interval=0", "--console-log-level=error",
            "-d", os.path.dirname(dest), "-o", os.path.basename(dest), stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL)
        while p.returncode is None:
            try: await asyncio.wait_for(p.wait(), 0.5)
            except asyncio.TimeoutError: pass
            if size and os.path.exists(dest): job["progress"] = round(min(0.99, os.path.getsize(dest) / size), 3)
        return p.returncode == 0 and os.path.exists(dest) and not os.path.exists(dest + ".aria2")
    except Exception:  # noqa: BLE001
        return False


async def _backfill_tips():
    """LoRAs added before usage tips were read: read their creators' tips once, in the background"""
    await asyncio.sleep(20)
    for rel, info in list(load_reg().items()):
        if ("tips" in info and "role" in info) or not info.get("version_id"): continue
        mtags: list = []
        try:
            v = await civitai_get(f"/api/v1/model-versions/{info['version_id']}")
            md = (await civitai_get(f"/api/v1/models/{v['modelId']}")) if v.get("modelId") else {}
            mdesc, mtags = md.get("description") or "", md.get("tags") or []
            tips = tips_from(v.get("description") or "", mdesc)
            trig = info.get("trigger") or triggers_from(v.get("trainedWords"), v.get("description") or "", mdesc)
        except Exception:  # noqa: BLE001
            tips, trig = info.get("tips") or {}, info.get("trigger", "")
        reg = load_reg()
        if rel in reg:
            reg[rel].update(tips=tips, trigger=trig, role=lora_role(mtags, reg[rel].get("title", ""), rel), tags=[str(x) for x in mtags][:12])
            save_reg(reg)
        await asyncio.sleep(1)


async def lora_job(job: dict, url: str):
    auth = civitai_auth()
    try:
        vid, mid = civitai_ids(url)
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=None, sock_read=120)) as s:
            if not vid and mid:
                d = await civitai_get(f"/api/v1/models/{mid}")
                vid = d["modelVersions"][0]["id"]
            if not vid: raise RuntimeError("That doesn't look like a CivitAI model link")
            # already in the library (e.g. "Send to Animate" on an example of a LoRA you have): nothing to download
            reg0 = load_reg()
            hit = next((k for k, x in reg0.items() if str(x.get("version_id")) == str(vid) and os.path.isfile(os.path.join(LORAS, k))), None)
            if hit:
                job.update(status="done", progress=1.0, name=hit, title=reg0[hit].get("title"), family=family(reg0[hit].get("base", "")), trigger=reg0[hit].get("trigger", ""), tips=reg0[hit].get("tips") or {}, role=reg0[hit].get("role") or lora_role(None, reg0[hit].get("title") or "", hit))
                return
            try: v = await civitai_get(f"/api/v1/model-versions/{vid}")
            except web.HTTPException as e: raise RuntimeError(f"{(json.loads(e.text or '{}').get('error') or 'CivitAI said no')} for that model — if it's an adult model, check your API key in the template (CIVITAI_TOKEN)") from None
            mtype = (v.get("model") or {}).get("type", "LORA").upper()
            is_model = mtype == "CHECKPOINT"
            if not is_model and mtype not in ("LORA", "LOCON", "DORA", "LYCORIS"):
                raise RuntimeError(f"That's a {v['model']['type']} — only LoRAs and checkpoints can be added")
            fam = family(v.get("baseModel", ""))
            files = v.get("files", [])
            if is_model:
                if fam not in ("krea2", "anima", "sdxl"):
                    raise RuntimeError(f"That checkpoint is for {v.get('baseModel') or 'another model'} — the Studio runs Krea 2, Anima and Illustrious/NoobAI")
                files = [x for x in files if str((x.get("metadata") or {}).get("format", "SafeTensor")).lower().startswith("safetensor")] or files
            f = next((x for x in files if x.get("primary")), (files or [None])[0])
            if not f: raise RuntimeError("No file on that model version")
            name = re.sub(r"[^A-Za-z0-9._-]+", "_", f["name"])
            if not name.endswith(".safetensors") and is_model: raise RuntimeError("That checkpoint isn't a .safetensors file (GGUF and others aren't supported here)")
            rel = f"civitai/{name}"
            # Krea 2 / Anima / Qwen fine-tunes are the diffusion model alone (Load Diffusion Model); SDXL ones are full checkpoints
            folder = ("checkpoints" if fam == "sdxl" else "diffusion_models") if is_model else "loras"
            dest = os.path.join(MODELS, folder, "civitai", name)
            if is_model and os.path.isfile(dest):
                job.update(status="done", progress=1.0, name=rel, kind="model", folder=folder, title=v["model"]["name"], family=fam, trigger="")
                return
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            job.update(title=v["model"]["name"], base=v.get("baseModel", ""), total_mb=round(f.get("sizeKB", 0) / 1000))
            # the exact file picked above (its own link), on the site that answered, then the other site; a plain version link last
            vhost = HOST_OF.get(f'/api/v1/model-versions/{vid}', CIVITAI)
            path0 = re.sub(r"^https?://[^/]+", "", str(f.get("downloadUrl") or "")) or f"/api/download/models/{vid}"
            cands = []
            for h in [vhost] + [x for x in civitai_hosts() if x != vhost]:
                for pth in (path0, f"/api/download/models/{vid}" + ("?type=Model&format=SafeTensor" if is_model else ""), f"/api/download/models/{vid}"):
                    if f"{h}{pth}" not in cands: cands.append(f"{h}{pth}")
            loc, dl, statuses = None, cands[0], []
            got_it = False
            # every CivitAI key you have, one after another, when CivitAI says no (401/403) to one
            for key in (civitai_tokens() or [""]):
                auth = {"Authorization": f"Bearer {key}"} if key else {}
                for cand in cands:
                    async with s.get(cand, headers=auth, allow_redirects=False) as r:
                        statuses.append(r.status)
                        if r.status in (301, 302, 303, 307, 308) and r.headers.get("Location") and "/login" not in r.headers["Location"]:
                            loc, dl, got_it = r.headers["Location"], cand, True; break
                        if r.status == 200: dl, got_it = cand, True; break
                if got_it:
                    if key: CIVITAI_GOOD["key"] = key
                    break
            if not got_it:
                if 401 in statuses or 403 in statuses:
                    raise RuntimeError(f"CivitAI said no to all {len(civitai_tokens())} of your keys for this one — it may be early access / members-only for its creator's supporters, or a key has expired (add more in civitai_keys.txt on your drive)")
                raise RuntimeError(f"CivitAI wouldn't hand out the file (tried {len(cands)} links: {', '.join(map(str, sorted(set(statuses))))}) — it may be early access or removed")
            target = loc or dl
            # a signed download link: fetch it with 8 connections at once (much faster from CivitAI's storage)
            if loc and shutil.which("aria2c") and await _aria_fetch(loc, dest + ".part", (f.get("sizeKB") or 0) * 1024, job):
                os.replace(dest + ".part", dest)
            else:
              async with s.get(target, headers={} if loc else auth) as r:
                if r.status != 200: raise RuntimeError(f"Download failed ({r.status})")
                total = int(r.headers.get("Content-Length") or 0)
                got = 0
                with open(dest + ".part", "wb") as out:
                    async for chunk in r.content.iter_chunked(1 << 20):
                        out.write(chunk); got += len(chunk)
                        if total: job["progress"] = round(got / total, 3)
              os.replace(dest + ".part", dest)
        trig = triggers_from(v.get("trainedWords"), v.get("description") or "")
        mdesc, mtags = "", []
        if v.get("modelId"):
            try:
                md = await civitai_get(f"/api/v1/models/{v['modelId']}")
                mdesc, mtags = md.get("description") or "", md.get("tags") or []
            except Exception: pass  # noqa: BLE001
        if not trig and mdesc: trig = triggers_from(None, mdesc)
        tips = tips_from(v.get("description") or "", mdesc)
        if is_model:
            mreg = load_models()
            mreg[rel] = {"version_id": vid, "model_id": v.get("modelId"), "title": v["model"]["name"], "version": v.get("name", ""), "base": v.get("baseModel", ""), "family": fam, "folder": folder}
            save_models(mreg)
            job.update(status="done", progress=1.0, name=rel, kind="model", folder=folder, family=fam, trigger="")
            return
        reg = load_reg()
        role = lora_role(mtags, v["model"]["name"], rel)
        reg[rel] = {"version_id": vid, "model_id": v.get("modelId"), "title": v["model"]["name"], "base": v.get("baseModel", ""), "trigger": trig, "tips": tips,
                    "role": role, "tags": [str(x) for x in mtags][:12]}
        save_reg(reg)
        job.update(status="done", progress=1.0, name=rel, family=family(v.get("baseModel", "")), trigger=reg[rel]["trigger"], tips=tips, role=role)
    except Exception as e:  # noqa: BLE001
        job.update(status="error", error=str(e)[:400])


async def civitai_model(req):
    mid = int(req.match_info["id"])
    d = await civitai_get(f"/api/v1/models/{mid}")
    have = {str(v.get("version_id")) for v in load_reg().values()}
    vs = []
    for v in d.get("modelVersions") or []:
        f = next((x for x in v.get("files", []) if x.get("primary")), (v.get("files") or [{}])[0])
        vs.append({"id": v.get("id"), "name": v.get("name", ""), "base": v.get("baseModel", ""), "family": family(v.get("baseModel", "")),
                   "trigger": triggers_from(v.get("trainedWords"), v.get("description") or "", d.get("description") or ""), "size_mb": round((f.get("sizeKB") or 0) / 1000),
                   "installed": str(v.get("id")) in have, "created": v.get("createdAt", "")})
    st = d.get("stats") or {}
    return web.json_response({"model_id": mid, "name": d.get("name", ""), "creator": (d.get("creator") or {}).get("username", ""),
                              "description": _strip_html(d.get("description") or "")[:4000], "tags": d.get("tags") or [],
                              "downloads": st.get("downloadCount", 0), "likes": st.get("thumbsUpCount", 0), "versions": vs})


def _weight(meta: dict, vid: int, name: str) -> float | None:
    for r in meta.get("civitaiResources") or []:
        if r.get("modelVersionId") == vid and r.get("weight") is not None: return float(r["weight"])
    loras = [r for r in (meta.get("resources") or []) if str(r.get("type", "")).lower() in ("lora", "locon", "lycoris")]
    for r in loras:
        n = str(r.get("name", "")).lower()
        if n and (n in name.lower() or name.lower() in n) and r.get("weight") is not None: return float(r["weight"])
    if len(loras) == 1 and loras[0].get("weight") is not None: return float(loras[0]["weight"])
    m = re.search(r"<lora:[^:>]+:([\d.]+)>", meta.get("prompt") or "")
    return float(m.group(1)) if m else None


async def _gen_meta(iid: int) -> dict:
    """a picture's own generation data (prompt, sampler, seed…) from CivitAI — {} when it has none, CivitAI won't say, or it's slow"""
    try:
        gen = await asyncio.wait_for(civitai_try("/api/trpc/image.getGenerationData?input=" + quote(json.dumps({"json": {"id": iid, "authed": True}}))), 8)
    except asyncio.TimeoutError:
        return {}
    gd = ((gen or {}).get("result") or {}).get("data") or {}
    gd = gd.get("json", gd) if isinstance(gd, dict) else {}
    meta = gd.get("meta") if isinstance(gd, dict) and isinstance(gd.get("meta"), dict) else {}
    if isinstance(meta.get("meta"), dict): meta = {**meta["meta"], **{k: v for k, v in meta.items() if k != "meta"}}
    return meta or {}


async def civitai_images(req):
    """example pictures for one LoRA version, with the prompt and settings that made them"""
    vid = int(req.query["version"]); name = req.query.get("name", "")
    path = f"/api/v1/images?modelVersionId={vid}&limit=40&nsfw=X&sort={quote('Most Reactions')}"
    if req.query.get("cursor"): path += f"&cursor={quote(req.query['cursor'])}"
    d = await civitai_get(path)
    out = []
    items = d.get("items") or []
    # the list often comes without the prompt (CivitAI keeps it in the picture's own generation data): fetch it for those, a few at a time
    sem = asyncio.Semaphore(6)
    async def fill(i):
        m = i.get("meta") if isinstance(i.get("meta"), dict) else {}
        if m.get("prompt") or not i.get("id"): return m
        async with sem:
            return {**m, **(await _gen_meta(int(i["id"])))}
    metas = await asyncio.gather(*(fill(i) for i in items[:30]), return_exceptions=True)
    for n, i in enumerate(items):
        meta = metas[n] if n < len(metas) and isinstance(metas[n], dict) else (i.get("meta") if isinstance(i.get("meta"), dict) else {})
        prompt = meta.get("prompt") or ""
        if not _minor_ok(prompt): continue
        size = meta.get("Size") or (f"{i.get('width')}x{i.get('height')}" if i.get("width") else "")
        out.append({"id": i.get("id"), "url": _thumb(i.get("url", ""), 900), "thumb": _thumb(i.get("url", ""), 360), "explicit": _explicit(i),
                    "video": i.get("type") == "video", "width": i.get("width"), "height": i.get("height"),
                    "prompt": prompt, "negative": meta.get("negativePrompt") or "", "sampler": meta.get("sampler") or "",
                    "scheduler": meta.get("scheduler") or meta.get("Schedule type") or "", "steps": meta.get("steps"), "cfg": meta.get("cfgScale"),
                    "workflow": bool(meta.get("comfy") or meta.get("workflow")),
                    "seed": meta.get("seed"), "size": size, "weight": _weight(meta, vid, name), "reactions": sum((i.get("stats") or {}).get(k, 0) for k in ("likeCount", "heartCount", "laughCount", "cryCount"))})
    return web.json_response({"items": out, "next": (d.get("metadata") or {}).get("nextCursor")})


IMAGE_LINK = re.compile(r"civitai\.(?:com|green|red)/images/(\d+)", re.I)
POST_LINK = re.compile(r"civitai\.(?:com|green|red)/posts/(\d+)", re.I)


def _px(url: str) -> str:
    """a CivitAI picture through this rental (the browser can't always load them directly: blockers, the .red split)"""
    return f"/studio-api/civitai/media?u={quote(url, safe='')}" if url and url.startswith("http") else url


MEDIA_OK = re.compile(r"^https://([a-z0-9-]+\.)*civitai\.(com|red|green)/", re.I)


def _media_ok(u: str) -> bool:
    return bool(MEDIA_OK.match(u)) or bool(os.environ.get("STUDIO_CIVITAI_BASE") and u.startswith("http://127.0.0.1:"))


async def _fetch_pic(u: str, timeout: float = 60) -> tuple[web.Response | None, int]:
    """one CivitAI picture's bytes, trying the other sizes / sites when the first answer fails"""
    tries = [u]
    if re.search(r"/width=\d+", u): tries.append(re.sub(r"/width=\d+", "/original=true", u))
    for a, b in (("image.civitai.com", "image.civitai.red"), ("image.civitai.red", "image.civitai.com")):
        if a in u: tries += [t.replace(a, b) for t in list(tries)]
    last = 0
    async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=timeout)) as s:
        for t in tries:
            try:
                async with s.get(t, headers={"User-Agent": "Mozilla/5.0", "Referer": "https://civitai.com/"}) as r:
                    last = r.status
                    if r.status != 200: continue
                    body = await r.read()
                    return web.Response(body=body, content_type=(r.headers.get("Content-Type") or "image/jpeg").split(";")[0],
                                        headers={"Cache-Control": "public, max-age=86400"}), 200
            except Exception:  # noqa: BLE001
                continue
    return None, last


async def civitai_media(req):
    """fetch one CivitAI picture for the browser"""
    u = req.query.get("u", "")
    if not _media_ok(u): raise web.HTTPBadRequest(text="not a CivitAI picture")
    resp, last = await _fetch_pic(u)
    if resp: return resp
    raise web.HTTPBadGateway(text=f"CivitAI wouldn't give that picture ({last})")


# A collection only lists each picture's id and file key. Building the picture's address from the key alone doesn't always
# work, so each picture is looked up by id exactly like a pasted link (that works), and the address it gives is remembered.
PIC_URL: dict[int, str] = {}
CF_STATE = {"ok": None, "base": ""}  # does a key-built address load? / the real image-server prefix, learned from a looked-up picture
_PIC_PARTS = re.compile(r"^(https://[^/]+/[^/]+/[0-9a-fA-F-]{20,})/([^/]+)/([^/?]+)")


async def _pic_url(iid: int) -> str:
    """the real address of one CivitAI picture or video, found the same way a pasted link is read"""
    if iid in PIC_URL: return PIC_URL[iid]
    v1 = await civitai_try(f"/api/v1/images?imageId={iid}&nsfw=X&limit=1")
    item = next((i for i in (v1 or {}).get("items") or [] if i.get("id") == iid), None)
    url = str((item or {}).get("url") or "")
    if not url:
        try: one = _trpc_data(await civitai_try("/api/trpc/image.get?input=" + quote(json.dumps({"json": {"id": iid}}))))
        except web.HTTPException: one = None
        if isinstance(one, dict) and one.get("url"): url = _media_url(one, None)
    if url:
        PIC_URL[iid] = url
        m = _PIC_PARTS.match(url)
        if m: CF_STATE["base"] = m.group(1).rsplit("/", 1)[0]
    return url


def _sized(url: str, w: int, video: bool) -> str:
    """the same picture at another width (a still frame for a video)"""
    m = _PIC_PARTS.match(url)
    if not m: return _thumb(url, w) if w else url
    name = m.group(3)
    if video and w: name = re.sub(r"\.(mp4|webm|mov)$", ".jpeg", name, flags=re.I)
    params = (f"anim=false,width={w}" if video else f"width={w}") if w else ("transcode=true,original=true" if video else "original=true")
    return f"{m.group(1)}/{params}/{name}"


async def civitai_pic(req):
    """one picture from a collection, by id (?id=&w=&v=1 for a video&u=the key-built address to try first)"""
    try: iid = int(req.query.get("id", ""))
    except ValueError: raise web.HTTPBadRequest(text="id")
    w = int(req.query.get("w") or 0)
    video = req.query.get("v") == "1"
    hint = req.query.get("u", "")
    if hint and _media_ok(hint) and CF_STATE["ok"] is not False and iid not in PIC_URL:
        resp, _ = await _fetch_pic(hint, timeout=15)
        if resp:
            CF_STATE["ok"] = True
            return resp
        CF_STATE["ok"] = False  # key-built addresses don't load here: look every picture up by id from now on
    url = await _pic_url(iid)
    if not url: raise web.HTTPNotFound(text="CivitAI didn't give this picture's address")
    if not w and video: raise web.HTTPFound(_sized(url, 0, True))  # a whole video: the browser plays it straight from CivitAI
    resp, last = await _fetch_pic(_sized(url, w, video))
    if resp: return resp
    raise web.HTTPBadGateway(text=f"CivitAI wouldn't give that picture ({last})")


def _pic_link(i: dict, w: int) -> str:
    video = i.get("type") == "video"
    return f"/studio-api/civitai/pic?id={int(i['id'])}&w={w}&v={1 if video else 0}&u={quote(_media_url(i, w or None), safe='')}"
# settings that are already shown on their own (everything else in the meta is listed under "More")
META_SHOWN = {"prompt", "extra", "negativePrompt", "sampler", "scheduler", "Schedule type", "steps", "cfgScale", "seed", "Size",
              "resources", "civitaiResources", "hashes", "Model hash", "Model", "comfy", "workflow", "TI hashes", "Lora hashes",
              "additionalResources", "external", "software", "draft", "nsfw", "type"}


async def civitai_try(path: str) -> dict | None:
    try:
        return await civitai_get(path)
    except Exception:  # noqa: BLE001
        return None


def _num(v):
    try:
        f = float(v)
        return int(f) if f.is_integer() else f
    except (TypeError, ValueError):
        return None


async def civitai_image(req):
    """one CivitAI image or video (a civitai.com/images/<id> link, or a /posts/<id> link: its first picture): prompt,
    settings and every resource used"""
    raw = req.query.get("url", "")
    m = IMAGE_LINK.search(raw) or re.fullmatch(r"\s*(\d{3,})\s*", raw)
    pm = POST_LINK.search(raw)
    if not m and pm:  # a post: read its first picture
        pd = await civitai_try(f"/api/v1/images?postId={int(pm.group(1))}&nsfw=X&limit=1")
        first = next(iter((pd or {}).get("items") or []), None)
        if not first or not first.get("id"):
            return web.json_response({"error": "CivitAI didn't list any pictures for that post — it may be private or removed"}, status=404)
        m = re.fullmatch(r"(\d+)", str(first["id"]))
    if not m: return web.json_response({"error": "That isn't a CivitAI picture link — paste one like https://civitai.com/images/12345678 (or civitai.red/images/…, or a /posts/… link)"}, status=400)
    iid = int(m.group(1))
    v1, gen = await asyncio.gather(
        civitai_try(f"/api/v1/images?imageId={iid}&nsfw=X&limit=1"),
        civitai_try("/api/trpc/image.getGenerationData?input=" + quote(json.dumps({"json": {"id": iid, "authed": True}}))))
    if not gen or not (((gen or {}).get("result") or {}).get("data")):
        gen = await civitai_try("/api/trpc/image.getGenerationData?input=" + quote(json.dumps({"json": {"id": iid}}))) or gen
    item = next((i for i in (v1 or {}).get("items") or [] if i.get("id") == iid), None)
    if not item:  # the site's own record of the picture (has its file even when the public list leaves it out)
        one = _trpc_data(await civitai_try("/api/trpc/image.get?input=" + quote(json.dumps({"json": {"id": iid}}))))
        if isinstance(one, dict) and one.get("url"):
            item = {**one, "url": _media_url(one, None if one.get("type") == "video" else 1200)}
    gd = ((gen or {}).get("result") or {}).get("data") or {}
    gd = gd.get("json", gd) if isinstance(gd, dict) else {}
    meta = (item or {}).get("meta") if isinstance((item or {}).get("meta"), dict) else None
    meta = meta or (gd.get("meta") if isinstance(gd.get("meta"), dict) else {}) or {}
    if isinstance(meta.get("meta"), dict): meta = {**meta["meta"], **{k: v for k, v in meta.items() if k != "meta"}}
    if not item and not gd:
        return web.json_response({"error": "CivitAI didn't return that image — it may be private or deleted, or need your API key (⋯ menu → CivitAI key)."}, status=404)
    prompt = meta.get("prompt") or ""
    if not _minor_ok(prompt):
        return web.json_response({"error": "This one can't be used here: its prompt may involve minors."}, status=451)

    # resources: CivitAI's own list first, then what's written in the metadata
    res: list[dict] = []
    for r in gd.get("resources") or []:
        res.append({"version_id": r.get("versionId") or r.get("modelVersionId"), "model_id": r.get("modelId"), "name": r.get("modelName") or r.get("name") or "",
                    "version": r.get("versionName") or "", "type": str(r.get("modelType") or r.get("type") or "").lower(), "base": r.get("baseModel") or "",
                    "weight": _num(r.get("strength") if r.get("strength") is not None else r.get("weight"))})
    if not res:
        for r in meta.get("civitaiResources") or []:
            res.append({"version_id": r.get("modelVersionId"), "model_id": None, "name": "", "version": r.get("modelVersionName") or "",
                        "type": str(r.get("type") or "").lower(), "base": "", "weight": _num(r.get("weight") if r.get("weight") is not None else r.get("strength"))})
        for r in meta.get("resources") or []:
            if not isinstance(r, dict): continue
            res.append({"version_id": None, "model_id": None, "name": r.get("name") or "", "version": "", "type": str(r.get("type") or "").lower(),
                        "base": "", "weight": _num(r.get("weight")), "hash": r.get("hash")})
        for vid in (item or {}).get("modelVersionIds") or []:
            if not any(x.get("version_id") == vid for x in res): res.append({"version_id": vid, "model_id": None, "name": "", "version": "", "type": "", "base": "", "weight": None})
    # fill in names, base model and trigger words from the model-version endpoint (by id, or by file hash)
    async def fill(r: dict):
        path = f"/api/v1/model-versions/{r['version_id']}" if r.get("version_id") else f"/api/v1/model-versions/by-hash/{r['hash']}" if r.get("hash") else None
        if not path: return
        v = await civitai_try(path)
        if not v: return
        r["version_id"] = r.get("version_id") or v.get("id")
        r["model_id"] = r.get("model_id") or v.get("modelId")
        r["name"] = r.get("name") or (v.get("model") or {}).get("name") or ""
        r["version"] = r.get("version") or v.get("name") or ""
        r["type"] = r.get("type") or str((v.get("model") or {}).get("type") or "").lower()
        r["base"] = r.get("base") or v.get("baseModel") or ""
        r["trigger"] = triggers_from(v.get("trainedWords"), v.get("description") or "")
    await asyncio.gather(*(fill(r) for r in res[:14]))
    have = {str(v.get("version_id")): k for k, v in load_reg().items() if v.get("version_id")}
    seen, out_res = set(), []
    for r in res:
        key = r.get("version_id") or r.get("name")
        if not key or key in seen: continue
        seen.add(key)
        t = r.get("type") or ""
        kind = "lora" if t in ("lora", "locon", "lycoris", "dora") else "checkpoint" if t in ("checkpoint", "model") else "embedding" if t in ("embed", "embedding", "textualinversion") else t or "other"
        if kind == "lora" and r.get("weight") is None: r["weight"] = _weight(meta, r.get("version_id") or 0, r.get("name") or "")
        out_res.append({"kind": kind, "model_id": r.get("model_id"), "version_id": r.get("version_id"), "name": r.get("name") or "(unnamed)", "version": r.get("version") or "",
                        "base": r.get("base") or "", "family": family(r.get("base") or ""), "weight": r.get("weight"), "trigger": r.get("trigger") or "",
                        "installed": have.get(str(r.get("version_id"))) if r.get("version_id") else None})
    out_res.sort(key=lambda r: {"checkpoint": 0, "lora": 1}.get(r["kind"], 2))

    url = (item or {}).get("url") or ""
    video = (item or {}).get("type") == "video" or bool(re.search(r"\.(mp4|webm|mov)(\?|$)", url))
    w, h = (item or {}).get("width"), (item or {}).get("height")
    size = meta.get("Size") or (f"{w}x{h}" if w else "")
    base = (item or {}).get("baseModel") or next((r["base"] for r in out_res if r["kind"] == "checkpoint" and r["base"]), "") or next((r["base"] for r in out_res if r["base"]), "")
    more = {k: v for k, v in meta.items() if k not in META_SHOWN and isinstance(v, (str, int, float)) and str(v).strip() and len(str(v)) < 200}
    return web.json_response({
        "id": iid, "page": f"{_page_host()}/images/{iid}", "url": _px(_thumb(url, 1200)) if not video else url, "thumb": _px(_thumb(url, 360)) if url else "",
        "video": video, "width": w, "height": h, "explicit": _explicit(item or {}), "username": (item or {}).get("username") or "",
        "prompt": prompt, "negative": meta.get("negativePrompt") or "", "sampler": meta.get("sampler") or "",
        "scheduler": meta.get("scheduler") or meta.get("Schedule type") or "", "steps": _num(meta.get("steps")), "cfg": _num(meta.get("cfgScale")),
        "seed": _num(meta.get("seed")), "size": size, "base": base, "family": family(base), "process": gd.get("process") or "",
        "comfy": bool(meta.get("comfy") or meta.get("workflow")), "more": more, "resources": out_res,
        "workflow": comfy_summary(_comfy_of(meta)), "workflow_key": (WF_CACHE.__setitem__(f"civitai:{iid}", _comfy_of(meta)) or f"civitai:{iid}") if _comfy_of(meta) else None,
    })


# ------------------------------------------------------------------ your CivitAI collections (needs your API key)
CF_IMAGES = os.environ.get("STUDIO_CIVITAI_IMAGES", "https://image.civitai.com/xG1nkqKTMzGDvpLrqFT7WA")
COLLECTION_LINK = re.compile(r"civitai\.(?:com|green|red)/collections/(\d+)", re.I)


async def civitai_trpc(proc: str, payload: dict):
    """CivitAI's own site API (what civitai.com uses), with your API key — for things the public API doesn't have"""
    if not civitai_token(): raise web.HTTPUnauthorized(text=json.dumps({"error": "Add your CivitAI API key first: ⋯ menu → CivitAI key"}), content_type="application/json")
    path = f"/api/trpc/{proc}?input=" + quote(json.dumps({"json": payload}, separators=(",", ":")))
    try:
        d = await civitai_get(path)
    except web.HTTPException as e:
        why = ""
        try: why = (json.loads(e.text or "{}").get("error") or "")
        except ValueError: pass
        msg = "CivitAI didn't accept your key for this (it needs read access to collections)" if "401" in why or "403" in why else (why or "Couldn't reach CivitAI")
        raise web.HTTPBadGateway(text=json.dumps({"error": msg}), content_type="application/json")
    return _trpc_data(d)


def _trpc_data(d):
    """CivitAI's tRPC answers come in a few shapes (a batch list, a JSON string, {result:{data:{json:…}}}, or the data itself)"""
    for _ in range(4):
        if isinstance(d, str):
            try: d = json.loads(d)
            except ValueError: return None
            continue
        if _looks_flat(d):  # the whole answer as one flat list
            d = _unflatten(d); continue
        if isinstance(d, list) and d and isinstance(d[0], dict) and ("result" in d[0] or "error" in d[0]):
            d = d[0]; continue
        break
    if isinstance(d, dict) and "error" in d and "result" not in d:
        e = d.get("error")
        msg = (((e or {}).get("json") or {}).get("message") if isinstance(e, dict) else str(e)) or "CivitAI refused"
        raise web.HTTPBadGateway(text=json.dumps({"error": f"CivitAI: {msg}"[:300]}), content_type="application/json")
    if isinstance(d, dict) and isinstance(d.get("result"), dict):
        d = d["result"].get("data", d["result"])
    if isinstance(d, dict) and "json" in d:
        d = d["json"]
    if isinstance(d, str):
        try: d = json.loads(d)
        except ValueError: return None
    if _looks_flat(d): d = _unflatten(d)
    return d


def _looks_flat(d) -> bool:
    """CivitAI's newer answers are one flat list where every field is the position of its value in that list
    (the "devalue" format): [{"nextCursor": -1, "items": 1, "source": 208}, [2, 40, …], {"id": 3, "url": 5, …}, 142720337, …]"""
    if not (isinstance(d, list) and len(d) >= 2 and isinstance(d[0], (dict, list)) and d[0]): return False
    vals = list(d[0].values()) if isinstance(d[0], dict) else d[0]
    return all(isinstance(v, int) and not isinstance(v, bool) and -6 <= v < len(d) for v in vals)


def _unflatten(values: list):
    """turn a devalue-style flat list back into the data (positions → values; -1 undefined, -2 hole, -3 NaN, -4/-5 ±inf, -6 -0;
    tagged lists like ["Date", "…"], ["Set", i…], ["Map", k, v…], ["BigInt", "…"])"""
    SPECIAL = {-1: None, -2: None, -3: None, -4: float("inf"), -5: float("-inf"), -6: 0}
    memo: dict[int, object] = {}
    def h(i):
        if not isinstance(i, int) or isinstance(i, bool): return i
        if i in SPECIAL: return SPECIAL[i]
        if i in memo: return memo[i]
        if i < 0 or i >= len(values): return None
        v = values[i]
        if isinstance(v, dict):
            out: dict = {}; memo[i] = out
            for k, x in v.items(): out[k] = h(x)
            return out
        if isinstance(v, list):
            if v and isinstance(v[0], str):
                tag = v[0]
                if tag in ("Date", "RegExp", "BigInt", "Object"): r = (int(v[1]) if tag == "BigInt" and str(v[1]).lstrip("-").isdigit() else v[1]) if len(v) > 1 else None
                elif tag == "Set": r = [h(x) for x in v[1:]]
                elif tag in ("Map", "null"): r = {str(h(v[j])): h(v[j + 1]) for j in range(1, len(v) - 1, 2)} if tag == "Map" else {str(v[j]): h(v[j + 1]) for j in range(1, len(v) - 1, 2)}
                else: r = [h(x) for x in v]
                memo[i] = r; return r
            out_l: list = []; memo[i] = out_l
            out_l.extend(h(x) for x in v)
            return out_l
        return v
    return h(0)


def _items_of(d) -> list:
    """the list of things in an answer: the answer itself, or its items / collections / data list"""
    if isinstance(d, list): return [x for x in d if isinstance(x, dict)]
    if isinstance(d, dict):
        for k in ("items", "collections", "data", "results"):
            if isinstance(d.get(k), list): return [x for x in d[k] if isinstance(x, dict)]
    return []


def _media_url(item: dict, width: int | None) -> str:
    u = str(item.get("url") or "")
    if u.startswith("http"): return _thumb(u, width) if width else u
    video = item.get("type") == "video"
    params = (f"anim=false,width={width}" if video else f"width={width}") if width else ("original=true" if not video else "transcode=true,original=true")
    name = f"{item.get('id', 'image')}.{'jpeg' if (video and width) or not video else 'mp4'}"
    return f"{CF_STATE['base'] or CF_IMAGES}/{u}/{params}/{name}"


async def civitai_collections(req):
    """your own collections on CivitAI (the ones you save posts and pictures into)"""
    d = await civitai_trpc("collection.getAllUser", {"permissions": ["VIEW", "ADD", "MANAGE"], "contributingOnly": True})
    items = _items_of(d)
    if not items and d is not None and not isinstance(d, (list, dict)):
        print("!! CivitAI collections: unexpected answer", type(d).__name__, str(d)[:200], flush=True)
    out = []
    for c in items:
        src = c.get("collection") if isinstance(c.get("collection"), dict) else c
        cid = src.get("id") or c.get("id")
        if not cid: continue
        desc = src.get("description")
        out.append({"id": cid, "name": str(src.get("name") or "Untitled"), "type": str(src.get("type") or "Image"), "description": (desc if isinstance(desc, str) else "")[:200]})
    return web.json_response({"items": out})


LORA_TYPES = {"LORA", "LoCon", "DoRA", "LoRA"}


async def civitai_collection_models(req):
    """the LoRAs saved in one of your model collections, as Browse LoRAs cards (?id=&cursor=)"""
    raw = req.query.get("id", "")
    m = COLLECTION_LINK.search(raw) or re.fullmatch(r"\s*(\d+)\s*", raw)
    if not m: return web.json_response({"error": "Pick a collection"}, status=400)
    payload = {"collectionId": int(m.group(1)), "limit": 24, "sort": "Newest", "period": "AllTime", "browsingLevel": 31}
    if req.query.get("cursor"):
        cur = req.query["cursor"]
        payload["cursor"] = int(cur) if cur.isdigit() else cur
    d = await civitai_trpc("model.getAll", payload) or {}
    ids = [i.get("id") for i in _items_of(d) if i.get("id")]
    # the full details (versions, files, trigger words, examples) come from the regular API, like every other card
    async def one(mid):
        try: return await civitai_get(f"/api/v1/models/{mid}")
        except Exception: return None  # noqa: BLE001
    models = await asyncio.gather(*(one(x) for x in ids))
    have = {str(v.get("version_id")) for v in load_reg().values()}
    items = [it for mm in models if isinstance(mm, dict) and mm.get("type") in LORA_TYPES for it in [_lora_item(mm, have)] if it]
    nxt = d.get("nextCursor") if isinstance(d, dict) else None
    return web.json_response({"items": items, "next": str(nxt) if nxt not in (None, "") else None, "skipped": len(ids) - len(items)})


async def civitai_collection(req):
    """the pictures and videos in one collection (?id= or a civitai.com/collections/… link)"""
    raw = req.query.get("id", "")
    m = COLLECTION_LINK.search(raw) or re.fullmatch(r"\s*(\d+)\s*", raw)
    if not m: return web.json_response({"error": "Pick a collection, or paste a link like https://civitai.com/collections/12345"}, status=400)
    payload = {"collectionId": int(m.group(1)), "limit": 48, "sort": "Newest", "period": "AllTime", "browsingLevel": 31}
    if req.query.get("cursor"):
        cur = req.query["cursor"]
        payload["cursor"] = int(cur) if cur.isdigit() else cur
    try:
        d = await civitai_trpc("image.getInfinite", payload) or {}
    except web.HTTPException:
        d = None
    if not _items_of(d):
        # the public API can list a collection's pictures too
        q = f"/api/v1/images?collectionId={int(m.group(1))}&limit=48&nsfw=X"
        if req.query.get("cursor"): q += f"&cursor={quote(req.query['cursor'])}"
        pub = await civitai_try(q)
        if pub and _items_of(pub):
            d = {"items": _items_of(pub), "nextCursor": (pub.get("metadata") or {}).get("nextCursor") if isinstance(pub.get("metadata"), dict) else None}
        elif d is None:
            raise web.HTTPBadGateway(text=json.dumps({"error": "CivitAI didn't give this collection's pictures — check your key has read access, or that the collection is yours / public"}), content_type="application/json")
    out = []
    for i in _items_of(d):
        try:
            if not isinstance(i, dict) or not i.get("id") or not i.get("url"): continue
            video = i.get("type") == "video"
            out.append({"id": i["id"], "thumb": _pic_link(i, 360), "url": _pic_link(i, 0 if video else 1200), "video": video,
                        "explicit": _explicit(i), "width": i.get("width"), "height": i.get("height"),
                        "has_prompt": i.get("hasPositivePrompt", i.get("hasMeta")), "has_meta": i.get("hasMeta"),
                        # made in ComfyUI = its whole workflow is in the picture (known now when the listing carries the metadata)
                        "has_workflow": (bool(i["meta"].get("comfy") or i["meta"].get("workflow")) if isinstance(i.get("meta"), dict) else (False if i.get("hasMeta") is False else WF_HAS.get(int(i["id"]))))})
        except Exception:  # noqa: BLE001
            continue
    nxt = d.get("nextCursor") if isinstance(d, dict) else None
    return web.json_response({"items": out, "next": str(nxt) if nxt not in (None, "") else None})


WF_HAS: dict[int, bool] = {}


async def civitai_workflows(req):
    """GET ?ids=1,2,3 → {id: true/false}: which of these CivitAI pictures carry a ComfyUI workflow (cached)"""
    ids = [int(x) for x in req.query.get("ids", "").split(",") if x.strip().isdigit()][:48]
    todo = [i for i in ids if i not in WF_HAS]
    sem = asyncio.Semaphore(8)

    async def one(iid: int):
        async with sem:
            try:
                d = await asyncio.wait_for(civitai_try(f"/api/v1/images?imageId={iid}&nsfw=X&limit=1"), 10)
                it = next((x for x in (d or {}).get("items") or [] if x.get("id") == iid), None)
                meta = it.get("meta") if isinstance(it, dict) and isinstance(it.get("meta"), dict) else None
                if meta is None: return
                if isinstance(meta.get("meta"), dict): meta = {**meta["meta"], **meta}
                WF_HAS[iid] = bool(meta.get("comfy") or meta.get("workflow"))
            except Exception:  # noqa: BLE001
                pass
    await asyncio.gather(*(one(i) for i in todo))
    return web.json_response({str(i): WF_HAS.get(i) for i in ids})


async def civitai_workflows_zip(req):
    """POST {links: [...]} (CivitAI picture links or ids) → a .zip: per picture its ComfyUI workflow (API + UI form, when it
    has one) and info.json (model, prompt, settings, resources), plus summary.csv — to study or compare workflows"""
    import csv, io, zipfile
    d = await req.json()
    ids: list[int] = []
    for x in d.get("links") or []:
        m = IMAGE_LINK.search(str(x)) or re.fullmatch(r"\s*(\d{3,})\s*", str(x))
        if m and int(m.group(1)) not in ids: ids.append(int(m.group(1)))
    ids = ids[:200]
    if not ids: return web.json_response({"error": "No CivitAI picture links in that"}, status=400)
    sem = asyncio.Semaphore(6)
    rows: list[dict] = []
    buf = io.BytesIO()
    z = zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED)

    async def one(n: int, iid: int):
        async with sem:
            row = {"n": n + 1, "id": iid, "link": f"https://civitai.com/images/{iid}", "workflow": "", "base": "", "nodes": "", "resources": "", "note": ""}
            try:
                v1, gen = await asyncio.gather(
                    asyncio.wait_for(civitai_try(f"/api/v1/images?imageId={iid}&nsfw=X&limit=1"), 15),
                    asyncio.wait_for(civitai_try("/api/trpc/image.getGenerationData?input=" + quote(json.dumps({"json": {"id": iid, "authed": True}}))), 15))
                item = next((i for i in (v1 or {}).get("items") or [] if i.get("id") == iid), None)
                gd = ((gen or {}).get("result") or {}).get("data") or {}
                gd = gd.get("json", gd) if isinstance(gd, dict) else {}
                meta = (item or {}).get("meta") if isinstance((item or {}).get("meta"), dict) else None
                meta = meta or (gd.get("meta") if isinstance(gd.get("meta"), dict) else {}) or {}
                if isinstance(meta.get("meta"), dict): meta = {**meta["meta"], **{k: v for k, v in meta.items() if k != "meta"}}
                if not item and not gd: row["note"] = "CivitAI didn't return it (private, deleted, or needs your key)"; rows.append(row); return
                prompt = meta.get("prompt") or ""
                if not _minor_ok(prompt): row["note"] = "left out: its prompt may involve minors"; rows.append(row); return
                res = [{"name": r.get("modelName") or r.get("name") or "", "version": r.get("versionName") or "", "type": str(r.get("modelType") or r.get("type") or "").lower(),
                        "base": r.get("baseModel") or "", "weight": r.get("strength") if r.get("strength") is not None else r.get("weight"), "version_id": r.get("versionId") or r.get("modelVersionId")}
                       for r in gd.get("resources") or []]
                comfy = _comfy_of(meta)
                folder = f"{n + 1:03d}_{iid}"
                info = {"link": row["link"], "base_model": (item or {}).get("baseModel") or meta.get("baseModel") or "", "prompt": prompt, "negative": meta.get("negativePrompt") or "",
                        "sampler": meta.get("sampler"), "scheduler": meta.get("scheduler"), "steps": meta.get("steps"), "cfg": meta.get("cfgScale"), "seed": meta.get("seed"),
                        "size": meta.get("Size") or (f"{(item or {}).get('width')}x{(item or {}).get('height')}"), "denoise": meta.get("Denoising strength") or meta.get("denoise"),
                        "resources": res or meta.get("civitaiResources") or meta.get("resources") or [], "made_with": "ComfyUI" if comfy else (meta.get("generationProcess") or "")}
                z.writestr(f"{folder}/info.json", json.dumps(info, indent=1))
                if comfy and comfy.get("prompt"): z.writestr(f"{folder}/workflow_api.json", json.dumps(comfy["prompt"], indent=1))
                if comfy and comfy.get("workflow"): z.writestr(f"{folder}/workflow_ui.json", json.dumps(comfy["workflow"], indent=1))
                nodes = sorted({v.get("class_type", "") for v in (comfy or {}).get("prompt", {}).values() if isinstance(v, dict)}) if comfy and comfy.get("prompt") else \
                        sorted({str(nd.get("type", "")) for nd in ((comfy or {}).get("workflow") or {}).get("nodes", []) if isinstance(nd, dict)}) if comfy else []
                row.update(workflow="yes" if comfy else "no", base=info["base_model"], nodes=" ".join(nodes),
                           resources="; ".join(f"{r['type']}:{r['name']} {r['version']} @{r['weight']}" for r in res) if res else "")
            except Exception as e:  # noqa: BLE001
                row["note"] = f"couldn't read it: {e}"
            rows.append(row)
    await asyncio.gather(*(one(n, i) for n, i in enumerate(ids)))
    out = io.StringIO(); w = csv.DictWriter(out, fieldnames=["n", "id", "link", "workflow", "base", "resources", "nodes", "note"]); w.writeheader()
    for r in sorted(rows, key=lambda r: r["n"]): w.writerow(r)
    z.writestr("summary.csv", out.getvalue())
    z.close()
    return web.Response(body=buf.getvalue(), content_type="application/zip", headers={"Content-Disposition": f'attachment; filename="civitai-workflows-{len(ids)}.zip"'})


async def civitai_debug(req):
    """for the Check-everything report: which key is used, which CivitAI sites answer, and what the first collection looks like"""
    if req.query.get("link"):  # one link you pasted: exactly what each attempt answered
        out = {"link": req.query["link"], "read": await _try_read_image(req.query["link"])}
        mm = IMAGE_LINK.search(req.query["link"]) or POST_LINK.search(req.query["link"])
        if mm:
            iid = mm.group(1)
            for h in civitai_hosts():
                d, err = await _civitai_get_from(h, f"/api/v1/images?{'postId' if POST_LINK.search(req.query['link']) else 'imageId'}={iid}&nsfw=X&limit=1")
                out[f"v1 {h}"] = err or f"{len((d or {}).get('items') or [])} item(s)"
        return web.json_response(out)
    out: dict = {"key": "template" if (os.environ.get("CIVITAI_TOKEN") or os.environ.get("CIVITAI_API_KEY")) else "studio" if civitai_token() else "none", "hosts": [], "keys": len(civitai_tokens())}
    for h in civitai_hosts():
        d, err = await _civitai_get_from(h, "/api/v1/models?limit=1&nsfw=true")
        out["hosts"].append({"host": h, "ok": not err, "error": err, "got": len((d or {}).get("items") or []) if isinstance(d, dict) else 0})
    try:
        cols = _items_of(await civitai_trpc("collection.getAllUser", {"permissions": ["VIEW", "ADD", "MANAGE"], "contributingOnly": True}))
        out["collections"] = len(cols)
        for c in cols[:12]:
            src = c.get("collection") if isinstance(c.get("collection"), dict) else c
            if str(src.get("type")) != "Image": continue
            cid = src.get("id") or c.get("id")
            r = await civitai_collection(type("R", (), {"query": {"id": str(cid)}})())
            body = json.loads(r.text)
            its = body.get("items") or []
            try:  # what CivitAI itself answered for that collection (the first picture's fields, trimmed)
                raw = _items_of(await civitai_trpc("image.getInfinite", {"collectionId": int(cid), "limit": 2, "sort": "Newest", "period": "AllTime", "browsingLevel": 31}))
                out["raw_first_item"] = {k: (v if isinstance(v, (int, float, bool)) or v is None else str(v)[:120]) for k, v in (raw[0] if raw else {}).items()}
            except Exception as e:  # noqa: BLE001
                out["raw_first_item"] = f"{type(e).__name__}: {e}"[:200]
            out["sample"] = {"collection": src.get("name"), "id": cid, "items": len(its), "thumb": its[0]["thumb"] if its else None}
            if its:  # the by-id lookup the collection pictures now use
                try: out["sample"]["by_id"] = (await _pic_url(int(its[0]["id"])))[:160] or "no address"
                except Exception as e: out["sample"]["by_id"] = f"{type(e).__name__}: {e}"[:160]  # noqa: BLE001
                out["sample"]["key_built_loads"] = CF_STATE["ok"]
            if its:
                try:
                    from urllib.parse import parse_qs, urlsplit
                    direct = (parse_qs(urlsplit(its[0]["thumb"]).query).get("u") or [its[0]["thumb"]])[0]
                    out["sample"]["thumb_url"] = direct
                    async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=15)) as s:
                        async with s.get(direct, headers={"User-Agent": "Mozilla/5.0"}) as rr: out["sample"]["thumb_status"] = rr.status
                except Exception as e:  # noqa: BLE001
                    out["sample"]["thumb_status"] = f"{type(e).__name__}: {e}"[:120]
                out["sample"]["image_read"] = (await _try_read_image(its[0]["id"]))
            break
    except web.HTTPException as e:
        out["collections_error"] = e.text[:200]
    return web.json_response(out)


async def _try_read_image(iid) -> str:
    try:
        r = await civitai_image(type("R", (), {"query": {"url": str(iid)}})())
        return "ok" if r.status == 200 else f"{r.status}: {r.text[:120]}"
    except web.HTTPException as e:
        return f"{e.status}: {(e.text or '')[:120]}"


# ------------------------------------------------------------------ workflow observer: what's inside a picture/video
def _comfy_of(meta: dict) -> dict | None:
    """CivitAI keeps a ComfyUI picture's workflow in meta.comfy (a JSON string or object): {prompt: API graph, workflow: UI graph}"""
    c = meta.get("comfy") or meta.get("workflow")
    if isinstance(c, str):
        try: c = json.loads(c)
        except json.JSONDecodeError: return None
    if not isinstance(c, dict): return None
    if "prompt" in c or "workflow" in c:
        p, w = c.get("prompt"), c.get("workflow")
        if isinstance(p, str):
            try: p = json.loads(p)
            except json.JSONDecodeError: p = None
        if isinstance(w, str):
            try: w = json.loads(w)
            except json.JSONDecodeError: w = None
        return {"prompt": p if isinstance(p, dict) else None, "workflow": w if isinstance(w, dict) else None}
    if all(isinstance(v, dict) and "class_type" in v for v in list(c.values())[:3]): return {"prompt": c, "workflow": None}
    if "nodes" in c: return {"prompt": None, "workflow": c}
    return None


SAMPLERS = ("KSampler", "KSamplerAdvanced", "SamplerCustom", "SamplerCustomAdvanced", "KSampler (Efficient)", "KSamplerSelect", "BasicScheduler", "RandomNoise")


def _graph_from_ui(w: dict) -> dict:
    """a UI workflow (nodes + links) → a rough API-style graph (good enough to read prompts and settings)"""
    links = {l[0]: (l[1], l[2]) for l in w.get("links") or [] if isinstance(l, list) and len(l) >= 3}
    g = {}
    for n in w.get("nodes") or []:
        inputs = {}
        for i in n.get("inputs") or []:
            if i.get("link") in links: inputs[i.get("name")] = [str(links[i["link"]][0]), links[i["link"]][1]]
        vals = n.get("widgets_values")
        if isinstance(vals, list):
            for k, v in zip([i.get("name") for i in n.get("inputs") or [] if i.get("widget")] or [], vals): inputs.setdefault(k, v)
            inputs["_widgets"] = vals
        elif isinstance(vals, dict): inputs.update(vals)
        g[str(n.get("id"))] = {"class_type": n.get("type"), "inputs": inputs, "_meta": {"title": n.get("title") or n.get("type")}}
    return g


def _resolve_text(g: dict, link, depth=0) -> str:
    if isinstance(link, str): return link
    if depth > 6 or not isinstance(link, list) or not link: return ""
    n = g.get(str(link[0])) or {}
    ins = n.get("inputs") or {}
    for k in ("text", "prompt", "string", "value", "text_g", "positive", "string_a", "Text", "STRING"):
        v = ins.get(k)
        if isinstance(v, str) and v.strip(): return v
        if isinstance(v, list): 
            t = _resolve_text(g, v, depth + 1)
            if t: return t
    w = ins.get("_widgets")
    if isinstance(w, list):
        t = next((x for x in w if isinstance(x, str) and len(x) > 12), "")
        if t: return t
    for v in ins.values():
        if isinstance(v, list):
            t = _resolve_text(g, v, depth + 1)
            if t: return t
    return ""


def comfy_summary(c: dict | None) -> dict | None:
    """the important parts of a ComfyUI graph: prompts, sampler settings, models, LoRAs, size — plus a node list"""
    if not c: return None
    g = c.get("prompt") or (_graph_from_ui(c["workflow"]) if c.get("workflow") else {})
    if not g: return None
    out = {"nodes": [], "loras": [], "models": [], "prompt": "", "negative": "", "settings": {}, "has_ui": bool(c.get("workflow")), "has_api": bool(c.get("prompt"))}
    for nid, n in g.items():
        if not isinstance(n, dict): continue
        t = str(n.get("class_type") or ""); ins = n.get("inputs") or {}
        vals = {k: v for k, v in ins.items() if not k.startswith("_") and isinstance(v, (str, int, float, bool)) and len(str(v)) < 120}
        out["nodes"].append({"id": nid, "type": t, "title": (n.get("_meta") or {}).get("title") or t, "values": dict(list(vals.items())[:6])})
        for k in ("ckpt_name", "unet_name", "model_name", "clip_name", "vae_name"):
            if isinstance(ins.get(k), str): out["models"].append({"kind": k.split("_")[0], "name": ins[k]})
        if "lora_name" in ins and isinstance(ins.get("lora_name"), str):
            out["loras"].append({"name": ins["lora_name"], "weight": ins.get("strength_model", ins.get("strength"))})
        for k, v in ins.items():  # rgthree Power Lora Loader: lora_1: {on, lora, strength}
            if isinstance(v, dict) and v.get("lora") and v.get("on", True): out["loras"].append({"name": v["lora"], "weight": v.get("strength")})
        if t in SAMPLERS or "sampler" in t.lower():
            for k, nk in (("steps", "steps"), ("cfg", "cfg"), ("sampler_name", "sampler"), ("scheduler", "scheduler"), ("seed", "seed"), ("noise_seed", "seed"), ("denoise", "denoise")):
                if isinstance(ins.get(k), (int, float, str)) and nk not in out["settings"]: out["settings"][nk] = ins[k]
            if not out["prompt"] and "positive" in ins: out["prompt"] = _resolve_text(g, ins["positive"])
            if not out["negative"] and "negative" in ins: out["negative"] = _resolve_text(g, ins["negative"])
        if t in ("EmptyLatentImage", "EmptySD3LatentImage", "EmptyHunyuanLatentVideo") and "size" not in out["settings"]:
            if isinstance(ins.get("width"), int): out["settings"]["size"] = f"{ins['width']}x{ins.get('height')}"
    if not out["prompt"]:  # e.g. guiders / video graphs: the longest prompt-like text
        texts = sorted([v for n in g.values() if isinstance(n, dict) for k, v in (n.get("inputs") or {}).items() if k in ("text", "prompt") and isinstance(v, str)], key=len, reverse=True)
        out["prompt"] = texts[0] if texts else ""
    out["nodes"] = out["nodes"][:80]
    return out


def parse_a1111(text: str) -> dict:
    """'prompt\nNegative prompt: …\nSteps: 30, Sampler: …' → fields"""
    lines = text.strip().split("\n")
    last = lines[-1] if lines and re.search(r"\bSteps: \d", lines[-1]) else ""
    body = "\n".join(lines[:-1] if last else lines)
    neg = ""
    if "\nNegative prompt:" in "\n" + body:
        body, neg = re.split(r"(?:^|\n)Negative prompt:\s*", body, maxsplit=1)
    kv = dict(re.findall(r'\s*([\w ]+):\s*("(?:\\.|[^"])*"|[^,]*)(?:,|$)', last)) if last else {}
    kv = {k.strip(): v.strip().strip('"') for k, v in kv.items()}
    loras = [{"name": m[0], "weight": float(m[1])} for m in re.findall(r"<lora:([^:>]+):([\d.]+)>", body)]
    for item in (kv.get("Lora hashes") or "").split(","):
        if ":" in item and not any(l["name"] == item.split(":")[0].strip() for l in loras): loras.append({"name": item.split(":")[0].strip(), "weight": None})
    return {"prompt": body.strip(), "negative": neg.strip(), "kv": kv, "loras": loras}


def read_media_meta(path: str) -> dict:
    """the prompt / settings / workflow a file carries: PNG text chunks (A1111 'parameters', ComfyUI 'prompt' + 'workflow'),
    JPEG/WEBP EXIF UserComment, or a video's metadata tags"""
    info: dict = {}
    ext = os.path.splitext(path)[1].lower()
    if ext in (".png", ".jpg", ".jpeg", ".webp"):
        from PIL import Image
        with Image.open(path) as im:
            info = {k: v for k, v in (im.info or {}).items() if isinstance(v, (str, bytes))}
            try:
                exif = im.getexif()
                uc = exif.get_ifd(0x8769).get(0x9286) if exif else None  # UserComment
                if uc:
                    b = uc if isinstance(uc, bytes) else str(uc).encode()
                    t = b[8:].decode("utf-16-be", errors="ignore") if b[:8] == b"UNICODE\x00" else b[8:].decode("utf-8", errors="ignore") if b[:5] == b"ASCII" else b.decode("utf-8", errors="ignore")
                    if t.strip(): info.setdefault("parameters", t.strip("\x00 "))
                desc = exif.get(0x010E) if exif else None  # ImageDescription (some tools put the workflow here)
                if desc: info.setdefault("description", desc)
            except Exception:  # noqa: BLE001
                pass
            size = f"{im.width}x{im.height}"
    else:
        r = subprocess.run(["ffprobe", "-v", "error", "-print_format", "json", "-show_format", "-show_streams", path], capture_output=True, text=True, timeout=30)
        d = json.loads(r.stdout or "{}")
        info = {k.lower(): v for k, v in ((d.get("format") or {}).get("tags") or {}).items()}
        v = next((x for x in d.get("streams", []) if x.get("codec_type") == "video"), {})
        size = f"{v.get('width')}x{v.get('height')}" if v else ""
    info = {k: (v.decode("utf-8", errors="ignore") if isinstance(v, bytes) else v) for k, v in info.items()}
    comfy = None
    for key in ("prompt", "workflow", "comment", "description"):
        raw = info.get(key)
        if not isinstance(raw, str) or not raw.lstrip().startswith("{"): continue
        try: j = json.loads(raw)
        except json.JSONDecodeError: continue
        if key == "workflow" or "nodes" in j: comfy = {**(comfy or {}), "workflow": j}
        elif "prompt" in j or "workflow" in j: comfy = _comfy_of(j)
        else: comfy = {**(comfy or {}), "prompt": j}
    summary = comfy_summary(comfy) if comfy else None
    a = parse_a1111(info["parameters"]) if isinstance(info.get("parameters"), str) else None
    st = (summary or {}).get("settings", {})
    kv = (a or {}).get("kv", {})
    reg = load_reg()
    by_file = {os.path.basename(k).rsplit(".", 1)[0].lower(): k for k in reg}
    loras = (a or {}).get("loras") or (summary or {}).get("loras") or []
    res = []
    for l in loras:
        n = os.path.basename(str(l["name"])).rsplit(".", 1)[0]
        hit = by_file.get(n.lower())
        info_ = reg.get(hit, {}) if hit else {}
        res.append({"kind": "lora", "model_id": info_.get("model_id"), "version_id": info_.get("version_id"), "name": info_.get("title") or n, "version": "",
                    "base": info_.get("base", ""), "family": family(info_.get("base", "")) if info_ else "unknown", "weight": l.get("weight"), "trigger": info_.get("trigger", ""), "installed": hit})
    for m in (summary or {}).get("models", [])[:3]:
        if m["kind"] in ("ckpt", "unet"): res.insert(0, {"kind": "checkpoint", "model_id": None, "version_id": None, "name": m["name"], "version": "", "base": "", "family": "unknown", "weight": None, "trigger": "", "installed": None})
    if kv.get("Model"): res.insert(0, {"kind": "checkpoint", "model_id": None, "version_id": None, "name": kv["Model"], "version": "", "base": "", "family": "unknown", "weight": None, "trigger": "", "installed": None})
    def num(x):
        try: f = float(x); return int(f) if f.is_integer() else f
        except (TypeError, ValueError): return None
    return {
        "found": bool(a or summary), "source": "a1111" if a else "comfyui" if summary else None,
        "prompt": (a or {}).get("prompt") or (summary or {}).get("prompt") or "", "negative": (a or {}).get("negative") or (summary or {}).get("negative") or "",
        "sampler": kv.get("Sampler") or str(st.get("sampler") or ""), "scheduler": kv.get("Schedule type") or str(st.get("scheduler") or ""),
        "steps": num(kv.get("Steps") or st.get("steps")), "cfg": num(kv.get("CFG scale") or st.get("cfg")), "seed": num(kv.get("Seed") or st.get("seed")),
        "size": kv.get("Size") or st.get("size") or size, "resources": res, "workflow": summary,
        "more": {k: v for k, v in kv.items() if k not in ("Steps", "Sampler", "Schedule type", "CFG scale", "Seed", "Size", "Model", "Lora hashes") and len(v) < 160},
        "raw_workflow": comfy,
    }


async def media_meta(req):
    """What's inside one of your files (an upload, an output, a tray item)?"""
    d = await req.json()
    src = safe_join(folder(d.get("type", "input")), d.get("subfolder", ""), d["filename"])
    if not os.path.isfile(src): raise web.HTTPNotFound()
    try:
        out = await asyncio.get_running_loop().run_in_executor(None, read_media_meta, src)
    except Exception as e:  # noqa: BLE001
        return web.json_response({"found": False, "error": f"Couldn't read it: {type(e).__name__}"})
    if not _minor_ok(out.get("prompt")): return web.json_response({"found": False, "error": "This one can't be used here: its prompt may involve minors."}, status=451)
    raw = out.pop("raw_workflow", None)
    if raw:
        WF_CACHE[f"file:{d['filename']}"] = raw
        out["workflow_key"] = f"file:{d['filename']}"
    return web.json_response(out)


WF_CACHE: dict[str, dict] = {}
WORKFLOWS = os.environ.get("H3_WORKFLOWS") or os.path.join(COMFY_DIR, "user", "default", "workflows")


async def workflow_save(req):
    """put a picture's workflow into ComfyUI's Workflows list (so 'Open in ComfyUI' shows it there)"""
    d = await req.json()
    raw = WF_CACHE.get(str(d.get("key")))
    if raw is None and d.get("civitai_id"):
        g = await civitai_try(f"/api/v1/images?imageId={int(d['civitai_id'])}&nsfw=X&limit=1")
        item = next((i for i in (g or {}).get("items") or [] if i.get("id") == int(d["civitai_id"])), None)
        raw = _comfy_of((item or {}).get("meta") or {}) if item else None
    if not raw: raise web.HTTPNotFound(text="No workflow found for this one")
    wf = raw.get("workflow") or raw.get("prompt")
    name = re.sub(r"[^A-Za-z0-9_.-]+", "_", str(d.get("name") or "imported"))[:60] + ".json"
    os.makedirs(WORKFLOWS, exist_ok=True)
    with open(os.path.join(WORKFLOWS, name), "w") as f: json.dump(wf, f)
    return web.json_response({"name": name, "format": "ui" if raw.get("workflow") else "api"})


async def civitai_fetch_media(req):
    """copy a CivitAI image/video into ComfyUI's input folder so it can be a reference"""
    d = await req.json()
    url = str(d.get("url") or "")
    if url.startswith("/studio-api/civitai/media?u="):  # a picture shown through this rental: the real link inside it
        from urllib.parse import parse_qs, urlsplit
        url = (parse_qs(urlsplit(url).query).get("u") or [""])[0]
    if url.startswith("/studio-api/civitai/pic?"):  # a collection picture: its real address, looked up by id
        from urllib.parse import parse_qs, urlsplit
        q = parse_qs(urlsplit(url).query)
        iid = int((q.get("id") or ["0"])[0] or 0)
        url = _sized(await _pic_url(iid), 0, (q.get("v") or ["0"])[0] == "1") if iid else ""
        if not url: raise web.HTTPNotFound(text="CivitAI didn't give this picture's address")
    host = re.match(r"https://([^/]+)/", url)
    test_host = re.match(r"https?://([^/]+)", CIVITAI).group(1) if CIVITAI != "https://civitai.com" else None
    if not host and test_host: host = re.match(r"http://([^/]+)/", url)
    if not host or not (re.search(r"(^|\.)civitai\.(com|red|green)$", host.group(1)) or host.group(1) == test_host): raise web.HTTPBadRequest(text="Only CivitAI media can be fetched")
    url = re.sub(r"/(width=\d+|original=true)(/|$)", "/original=true\\2", url)
    async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=300)) as s:
        async with s.get(url) as r:
            if r.status != 200: raise web.HTTPBadGateway(text=f"CivitAI said {r.status}")
            ct = r.headers.get("Content-Type", "")
            ext = ".mp4" if "mp4" in ct else ".webm" if "webm" in ct else ".png" if "png" in ct else ".webp" if "webp" in ct else ".gif" if "gif" in ct else ".jpg"
            name = unique_input_name(f"civitai_{int(d.get('id') or 0)}{ext}")
            dest = os.path.join(INPUT, name)
            size = 0
            with open(dest + ".part", "wb") as f:
                async for chunk in r.content.iter_chunked(1 << 20):
                    size += len(chunk)
                    if size > 1024 ** 3: raise web.HTTPRequestEntityTooLarge(max_size=1024 ** 3, actual_size=size)
                    f.write(chunk)
    os.replace(dest + ".part", dest)
    k = kind_of(name)
    return web.json_response({"name": name, "kind": k, **(probe(dest) if k != "image" else {})})


async def add_lora(req):
    d = await req.json()
    jid = uuid.uuid4().hex[:10]
    LORA_JOBS[jid] = job = {"id": jid, "status": "running", "progress": 0.0}
    asyncio.create_task(lora_job(job, d.get("url", "")))
    return web.json_response({"id": jid})


async def lora_job_status(req):
    j = LORA_JOBS.get(req.match_info["id"])
    if not j: raise web.HTTPNotFound()
    return web.json_response(j)


def safetensors_meta(path: str) -> dict:
    """the training notes inside a .safetensors file (base model, trigger phrase) — no need to load the weights"""
    try:
        with open(path, "rb") as f:
            n = int.from_bytes(f.read(8), "little")
            if not 0 < n < 50_000_000: return {}
            return json.loads(f.read(n)).get("__metadata__") or {}
    except Exception:  # noqa: BLE001
        return {}


def meta_base(m: dict) -> str:
    arch = (m.get("modelspec.architecture") or "").lower()
    ver = (m.get("ss_base_model_version") or "").lower()
    both = f"{arch} {ver} {(m.get('ss_sd_model_name') or '').lower()}"
    if "anima" in both: return "Anima"
    if re.search(r"krea\s*-?\s*2", both): return "Krea 2"
    if "qwen" in both: return "Qwen"
    if "illustrious" in both: return "Illustrious"
    if "noob" in both: return "NoobAI"
    if "pony" in both: return "Pony"
    if "xl" in both or "sdxl" in both: return "SDXL 1.0"
    if "minimax" in both or "h3" in arch: return "MiniMax H3"
    return ""


async def upload_lora(req):
    """your own LoRA file (not on CivitAI): kept in models/loras/uploaded and in your cloud backup, so it comes back on every rental"""
    reader = await req.multipart()
    field = await reader.next()
    if field is None or field.name != "file": raise web.HTTPBadRequest(text="no file")
    fn = re.sub(r"[^A-Za-z0-9._-]+", "_", os.path.basename(field.filename or "lora.safetensors"))
    if not fn.lower().endswith(".safetensors"): raise web.HTTPBadRequest(text="LoRAs must be .safetensors files")
    dest_dir = os.path.join(LORAS, "uploaded"); os.makedirs(dest_dir, exist_ok=True)
    dest = os.path.join(dest_dir, fn)
    size = 0
    with open(dest + ".part", "wb") as f:
        while chunk := await field.read_chunk(1 << 20):
            size += len(chunk)
            if size > 4 * 1024 ** 3: f.close(); os.remove(dest + ".part"); raise web.HTTPRequestEntityTooLarge(max_size=4 * 1024 ** 3, actual_size=size)
            f.write(chunk)
    os.replace(dest + ".part", dest)
    m = safetensors_meta(dest)
    base = meta_base(m)
    trigger = (m.get("modelspec.trigger_phrase") or "").strip()
    title = (m.get("modelspec.title") or m.get("ss_output_name") or os.path.splitext(fn)[0]).strip()
    rel = f"uploaded/{fn}"
    reg = load_reg(); reg[rel] = {"uploaded": True, "title": title, "base": base, "trigger": trigger}; save_reg(reg)
    backed = False
    if os.environ.get("RCLONE_REMOTE"):
        p = await asyncio.create_subprocess_exec("rclone", "copy", dest, f"{os.environ['RCLONE_REMOTE'].rstrip('/')}/_loras",
                                                 stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.PIPE)
        _, err = await p.communicate()
        backed = p.returncode == 0
        if not backed: print("!! LoRA backup failed:", err.decode(errors="ignore")[-300:], flush=True)
    if backed:
        reg = load_reg(); reg.setdefault(rel, {})["backed_up"] = True; save_reg(reg)
    return web.json_response({"name": rel, "title": title, "base": base, "family": family(base) if base else "unknown",
                              "trigger": trigger, "backed_up": backed, "size_mb": round(size / 1e6)})


async def forget_lora(req):
    d = await req.json()
    reg = load_reg(); reg.pop(d.get("name", ""), None); save_reg(reg)
    p = safe_join(LORAS, d.get("name", ""))
    if d.get("delete") and os.path.isfile(p): os.remove(p)
    return web.json_response({"ok": True})


# ------------------------------------------------------------------ finish (ffmpeg)
async def run_ff(args: list[str], job: dict, total: float, part: tuple[float, float]):
    """run ffmpeg, mapping its progress into job['progress'] between part[0]..part[1]"""
    proc = await asyncio.create_subprocess_exec("ffmpeg", "-hide_banner", "-y", "-progress", "pipe:1", "-nostats", *args,
                                                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
    async def watch():
        async for line in proc.stdout:
            m = re.match(rb"out_time_us=(\d+)", line)
            if m and total > 0:
                frac = min(1.0, int(m.group(1)) / 1e6 / total)
                job["progress"] = round(part[0] + (part[1] - part[0]) * frac, 3)
    w = asyncio.create_task(watch())
    err = await proc.stderr.read()
    await proc.wait(); await w
    if proc.returncode != 0:
        raise RuntimeError(err.decode(errors="ignore")[-1500:])


async def finish_job(job: dict, d: dict):
    work = os.path.join(WORK, "studio_finish", job["id"]); os.makedirs(work, exist_ok=True)
    try:
        clips = d["clips"]
        if not clips: raise RuntimeError("no clips")
        W, H = d.get("width"), d.get("height")
        first = probe(safe_join(folder(clips[0].get("type", "output")), clips[0].get("subfolder", ""), clips[0]["filename"]))
        W = int(W or first.get("width") or 1344) // 2 * 2
        H = int(H or first.get("height") or 768) // 2 * 2
        fps = 24
        norm = []
        n = len(clips)
        # 1) trim + normalise every clip (same size, fps, always an audio track)
        for i, c in enumerate(clips):
            src = safe_join(folder(c.get("type", "output")), c.get("subfolder", ""), c["filename"])
            info = probe(src)
            start = max(0.0, float(c.get("start", 0)))
            end = float(c.get("end") or info.get("duration") or 0)
            dur = max(0.1, end - start)
            out = os.path.join(work, f"c{i}.mp4")
            vf = f"scale={W}:{H}:force_original_aspect_ratio=decrease:flags=lanczos,pad={W}:{H}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps={fps},format=yuv420p"
            args = ["-ss", f"{start}", "-t", f"{dur}", "-i", src]
            if info.get("has_audio"):
                amap = ["-map", "0:v:0", "-map", "0:a:0"]
            else:
                args += ["-f", "lavfi", "-t", f"{dur}", "-i", "anullsrc=r=48000:cl=stereo"]
                amap = ["-map", "0:v:0", "-map", "1:a:0"]
            await run_ff(args + amap + ["-vf", vf, "-ar", "48000", "-ac", "2", "-c:v", "libx264", "-crf", "16", "-preset", "veryfast",
                                        "-c:a", "aac", "-b:a", "192k", "-shortest", out], job, dur, (0.4 * i / n, 0.4 * (i + 1) / n))
            norm.append((out, probe(out).get("duration") or dur))
        # 2) join with transitions
        tr = d.get("transition", {}) or {}
        tdur = float(tr.get("duration", 0.5)) if tr.get("type", "cut") != "cut" else 0
        joined = os.path.join(work, "joined.mp4")
        if len(norm) == 1:
            shutil.copy(norm[0][0], joined); total = norm[0][1]
        else:
            ins = sum((["-i", p] for p, _ in norm), [])
            if tdur <= 0:
                fc = "".join(f"[{i}:v][{i}:a]" for i in range(len(norm))) + f"concat=n={len(norm)}:v=1:a=1[v][a]"
                total = sum(x for _, x in norm)
            else:
                kind = {"crossfade": "fade", "black": "fadeblack", "white": "fadewhite", "slide": "slideleft", "wipe": "wipeleft"}.get(tr.get("type"), "fade")
                fc, vprev, aprev, off = "", "[0:v]", "[0:a]", 0.0
                for i in range(1, len(norm)):
                    off += norm[i - 1][1] - tdur
                    fc += f"{vprev}[{i}:v]xfade=transition={kind}:duration={tdur}:offset={off:.3f}[v{i}];"
                    fc += f"{aprev}[{i}:a]acrossfade=d={tdur}[a{i}];"
                    vprev, aprev = f"[v{i}]", f"[a{i}]"
                fc = fc.rstrip(";").replace(f"[v{len(norm)-1}]", "[v]").replace(f"[a{len(norm)-1}]", "[a]")
                total = sum(x for _, x in norm) - tdur * (len(norm) - 1)
            await run_ff(ins + ["-filter_complex", fc, "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-crf", "16", "-preset", "veryfast",
                                "-c:a", "aac", "-b:a", "192k", joined], job, total, (0.4, 0.6))
        # 3) ending + speed + sound
        ending, F = d.get("ending", "once"), max(0.1, float(d.get("fade", 0.8)))
        speed = min(2.0, max(0.5, float(d.get("speed", 1))))
        audio_mode = d.get("audio", "keep")
        fmt = d.get("format", "mp4")
        ins = ["-i", joined]
        if ending == "boomerang":
            v = "[0:v]split[f][r0];[r0]reverse[r];[f][r]concat=n=2:v=1:a=0[v0]"
            a = "[0:a]asplit[af][ar0];[ar0]areverse[ar];[af][ar]concat=n=2:v=0:a=1[a0]"
            length = total * 2
        elif ending == "fade_start":
            first_png = os.path.join(work, "first.png")
            await run_ff(["-i", joined, "-frames:v", "1", first_png], job, 0, (0.6, 0.6))
            ins += ["-loop", "1", "-framerate", str(fps), "-t", f"{F + 0.05}", "-i", first_png]
            v = (f"[0:v]fps={fps},settb=AVTB,format=yuv420p[m];[1:v]fps={fps},settb=AVTB,format=yuv420p,setsar=1[st];"
                 f"[m][st]xfade=transition=fade:duration={F}:offset={max(0.0, total - F):.3f}[v0]")
            a = f"[0:a]afade=t=out:st={max(0.0, total - F):.3f}:d={F}[a0]"
            length = total + 0.05
        elif ending == "fade_black":
            v = f"[0:v]fade=t=in:st=0:d={min(0.4, F)},fade=t=out:st={max(0.0, total - F):.3f}:d={F}[v0]"
            a = f"[0:a]afade=t=in:st=0:d={min(0.4, F)},afade=t=out:st={max(0.0, total - F):.3f}:d={F}[a0]"
            length = total
        else:
            v, a, length = "[0:v]null[v0]", "[0:a]anull[a0]", total
        if audio_mode == "fade" and ending not in ("fade_start", "fade_black"):
            a = a.replace("[a0]", f"[a00];[a00]afade=t=out:st={max(0.0, length - F):.3f}:d={F}[a0]")
        v += f";[v0]setpts=PTS/{speed}[v1]"
        a += f";[a0]atempo={speed}[a1]"
        length /= speed
        os.makedirs(os.path.join(OUTPUT, "studio", "finish"), exist_ok=True)
        stamp = time.strftime("%Y%m%d_%H%M%S")
        if fmt == "gif":
            name = f"finish_{stamp}.gif"
            gw = min(W, 640) // 2 * 2
            fc = f"{v};[v1]fps=15,scale={gw}:-1:flags=lanczos,split[g1][g2];[g1]palettegen=stats_mode=diff[p];[g2][p]paletteuse=dither=sierra2_4a[vo]"
            args = ins + ["-filter_complex", fc, "-map", "[vo]", "-loop", "0"]
        else:
            name = f"finish_{stamp}.{'webm' if fmt == 'webm' else 'mp4'}"
            fc = v if audio_mode == "mute" else f"{v};{a}"
            args = ins + ["-filter_complex", fc, "-map", "[v1]"] + ([] if audio_mode == "mute" else ["-map", "[a1]"])
            if fmt == "webm":
                args += ["-c:v", "libvpx-vp9", "-crf", "32", "-b:v", "0", "-row-mt", "1", "-deadline", "good", "-cpu-used", "4"]
                args += [] if audio_mode == "mute" else ["-c:a", "libopus", "-b:a", "160k"]
            else:
                args += ["-c:v", "libx264", "-crf", "18", "-preset", "medium", "-pix_fmt", "yuv420p", "-movflags", "+faststart"]
                args += [] if audio_mode == "mute" else ["-c:a", "aac", "-b:a", "192k"]
        final = os.path.join(OUTPUT, "studio", "finish", name)
        try:
            await run_ff(args + [final], job, length, (0.6, 1.0))
        except Exception:
            if os.path.exists(final): os.remove(final)
            raise
        job.update(status="done", progress=1.0, output={"filename": name, "subfolder": "studio/finish", "type": "output",
                                                         "duration": round(length, 2)})
    except Exception as e:  # noqa: BLE001
        job.update(status="error", error=str(e)[-1500:])
    finally:
        shutil.rmtree(work, ignore_errors=True)


async def finish(req):
    d = await req.json()
    jid = uuid.uuid4().hex[:12]
    JOBS[jid] = job = {"id": jid, "status": "running", "progress": 0.0, "started": time.time()}
    asyncio.create_task(finish_job(job, d))
    return web.json_response({"id": jid})


async def finish_status(req):
    job = JOBS.get(req.match_info["id"])
    if not job: raise web.HTTPNotFound()
    return web.json_response(job)


# ------------------------------------------------------------------ cost
_cost = {"at": 0, "data": None}
async def cost(req):
    if time.time() - _cost["at"] > 300:
        cid, key = os.environ.get("CONTAINER_ID"), os.environ.get("CONTAINER_API_KEY")
        data = None
        if cid and key and shutil.which("vastai"):
            try:
                p = await asyncio.create_subprocess_exec("vastai", "show", "instance", cid, "--raw", "--api-key", key,
                                                         stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL)
                out, _ = await asyncio.wait_for(p.communicate(), 30)
                i = json.loads(out)
                dph = float(i.get("dph_total") or 0)
                start = float(i.get("start_date") or 0) or float(open("/proc/1/stat").read().split()[21]) / os.sysconf("SC_CLK_TCK")
                hours = max(0.0, (time.time() - start) / 3600) if start > 1e9 else None
                data = {"dph": round(dph, 3), "hours": round(hours, 2) if hours is not None else None,
                        "total": round(dph * hours, 2) if hours is not None else None}
            except Exception:
                data = None
        _cost.update(at=time.time(), data=data)
    return web.json_response(_cost["data"])


# ------------------------------------------------------------------ phone alerts (ntfy)
COMFY = os.environ.get("STUDIO_COMFY", "http://127.0.0.1:18188")
NTFY = os.environ.get("STUDIO_NTFY_BASE", "https://ntfy.sh")
WATCHES = os.path.join(STATE, "watches.json")


def notify_cfg() -> dict:
    try:
        with open(os.path.join(STATE, "notify.json")) as f: d = json.load(f)
        return d if isinstance(d, dict) else {}
    except Exception:  # noqa: BLE001
        return {}


async def push(title: str, body: str, topic: str | None = None) -> str | None:
    """send a phone notification through ntfy; returns an error message or None"""
    topic = topic or notify_cfg().get("topic") or os.environ.get("NTFY_TOPIC", "")
    if not topic: return "No alert name set"
    headers = {"Title": title, "Tags": "clapper"}
    try:
        with open("/opt/h3/run/https_url") as f: url = f.read().strip()
        if url: headers["Click"] = f"{url}/studio/"
    except Exception:  # noqa: BLE001
        pass
    try:
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=15)) as s:
            async with s.post(f"{NTFY}/{quote(topic)}", data=body.encode(), headers=headers) as r:
                return None if r.status < 300 else f"ntfy said {r.status}"
    except Exception as e:  # noqa: BLE001
        return f"Couldn't reach ntfy ({type(e).__name__})"


def load_watches() -> list:
    try:
        with open(WATCHES) as f: return json.load(f)
    except Exception:  # noqa: BLE001
        return []


def save_watches(w: list):
    os.makedirs(STATE, exist_ok=True)
    with open(WATCHES + ".tmp", "w") as f: json.dump(w, f)
    os.replace(WATCHES + ".tmp", WATCHES)


async def watch_loop():
    """every 15 s: are the watched ComfyUI jobs finished? then send one alert per watch"""
    while True:
        await asyncio.sleep(15)
        ws = load_watches()
        if not ws: continue
        changed = False
        try:
            async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=10)) as s:
                for w in ws:
                    for pid in [p for p in w["ids"] if p not in w["done"]]:
                        async with s.get(f"{COMFY}/history/{pid}") as r:
                            h = (await r.json()).get(pid) if r.status == 200 else None
                        st = (h or {}).get("status") or {}
                        if st.get("completed") or st.get("status_str") in ("success", "error"):
                            w["done"][pid] = "ok" if st.get("status_str") != "error" else "failed"; changed = True
                        elif time.time() - w["at"] > 6 * 3600:
                            w["done"][pid] = "lost"; changed = True
                    if len(w["done"]) == len(w["ids"]) and not w.get("sent"):
                        ok = sum(v == "ok" for v in w["done"].values()); bad = len(w["ids"]) - ok
                        await push("H3 Studio", f"{w['title']} — {ok} ready" + (f", {bad} failed" if bad else "") + ".")
                        w["sent"] = True; changed = True
        except Exception:  # noqa: BLE001
            pass
        if changed: save_watches([w for w in ws if not w.get("sent") and time.time() - w["at"] < 12 * 3600])


async def notify_watch(req):
    d = await req.json()
    ids = [str(x) for x in d.get("ids", []) if x]
    if not ids: return web.json_response({"ok": False})
    ws = load_watches(); ws.append({"ids": ids, "done": {}, "title": str(d.get("title", "Your jobs are done"))[:200], "at": time.time()})
    save_watches(ws)
    return web.json_response({"ok": True, "watching": len(ids)})


async def notify_test(req):
    d = await req.json()
    err = await push("H3 Studio", "Test alert — phone alerts are working.", d.get("topic"))
    return web.json_response({"ok": not err, "error": err})


# ------------------------------------------------------------------ live progress for every open tab
# ComfyUI only tells the browser tab that queued a job how it's going. The Studio queues its jobs under one id that this
# server listens to, and passes every message (steps, previews, done) on to every open Studio tab — the plain link, the
# secure link, a phone — so a video queued anywhere shows its live progress everywhere.
RELAY_ID = "h3studiorelay"
RELAY_CLIENTS: set = set()
RELAY_NOW: dict = {}  # the job being made now: its last start / executing / progress messages, for tabs that open mid-way


def _relay_track(raw: str):
    try: m = json.loads(raw)
    except ValueError: return
    t, d = m.get("type"), m.get("data") or {}
    if t == "execution_start": RELAY_NOW.clear(); RELAY_NOW["start"] = raw
    elif t == "executing":
        if d.get("node") is None: RELAY_NOW.clear()
        else: RELAY_NOW["executing"] = raw; RELAY_NOW.pop("progress", None)
    elif t == "progress": RELAY_NOW["progress"] = raw
    elif t in ("execution_success", "execution_error", "execution_interrupted"): RELAY_NOW.clear()


async def _relay_send(data):
    dead = []
    for ws in list(RELAY_CLIENTS):
        try:
            if isinstance(data, str): await ws.send_str(data)
            else: await ws.send_bytes(data)
        except Exception:  # noqa: BLE001
            dead.append(ws)
    for ws in dead: RELAY_CLIENTS.discard(ws)


async def relay_loop():
    url = re.sub(r"^http", "ws", COMFY) + f"/ws?clientId={RELAY_ID}"
    while True:
        try:
            async with aiohttp.ClientSession() as s:
                async with s.ws_connect(url, heartbeat=30, max_msg_size=0) as ws:
                    async for msg in ws:
                        if msg.type == aiohttp.WSMsgType.TEXT:
                            _relay_track(msg.data); await _relay_send(msg.data)
                        elif msg.type == aiohttp.WSMsgType.BINARY:
                            await _relay_send(msg.data)
                        elif msg.type in (aiohttp.WSMsgType.CLOSED, aiohttp.WSMsgType.ERROR):
                            break
        except Exception:  # noqa: BLE001  (ComfyUI still starting / restarting)
            pass
        RELAY_NOW.clear()
        await asyncio.sleep(2)


async def relay_ws(req):
    ws = web.WebSocketResponse(heartbeat=30, max_msg_size=0)
    await ws.prepare(req)
    await ws.send_str(json.dumps({"type": "h3relay", "data": {"client_id": RELAY_ID}}))
    for k in ("start", "executing", "progress"):
        if k in RELAY_NOW: await ws.send_str(RELAY_NOW[k])
    RELAY_CLIENTS.add(ws)
    try:
        async for _ in ws: pass
    finally:
        RELAY_CLIENTS.discard(ws)
    return ws


# ------------------------------------------------------------------ Proton Drive: results + exports copied there automatically
# Set in the Vast template: PROTON_USER, PROTON_PASSWORD, PROTON_2FA_SECRET (the 2FA setup key, so each new rental logs in by
# itself), optional PROTON_MAILBOX_PASSWORD, PROTON_FOLDER (default "H3 Studio"). Uses rclone's Proton Drive backend, which is
# unofficial and in beta: when Proton changes something it can stop working — the status says so, nothing else is affected.
PROTON = {"state": "off", "last_ok": None, "last_try": None, "error": "", "sent": 0, "running": False}
PROTON_CONF = os.path.join(WORK, "h3-proton.conf")
PROTON_EVERY = int(os.environ.get("PROTON_EVERY_MIN", "15")) * 60


def _gdrive_token() -> str:
    t = (os.environ.get("GDRIVE_TOKEN") or "").strip()
    if t and not t.startswith("{"):
        import base64
        try: t = base64.b64decode(t + "=" * (-len(t) % 4)).decode()
        except Exception: t = ""  # noqa: BLE001
    # just the sign-in object: an earlier connector also caught PowerShell's warning text around it
    m = re.search(r'\{\s*"access_token".*?\}', t, re.S)
    return m.group(0) if m else (t if t.startswith('{"') else "")


def _cloud() -> str:
    """the name shown to you: which drive the backups go to"""
    return "Google Drive" if _gdrive_token() else "Proton Drive"


def _proton_on() -> bool:
    """backups on: Google Drive (GDRIVE_TOKEN) or Proton Drive (PROTON_USER + PROTON_PASSWORD) — same folders either way"""
    return bool(_gdrive_token() or (os.environ.get("PROTON_USER") and os.environ.get("PROTON_PASSWORD")))


async def _rclone(*args: str, timeout: int = 1800) -> tuple[int, str]:
    p = await asyncio.create_subprocess_exec("rclone", "--config", PROTON_CONF, *args, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT)
    try:
        out, _ = await asyncio.wait_for(p.communicate(), timeout)
    except asyncio.TimeoutError:
        p.kill(); return 124, "timed out"
    return p.returncode or 0, out.decode(errors="ignore")


async def _proton_setup() -> None:
    """write the rclone remote once per rental (passwords obscured); rclone keeps the login it gets in this file, so later
    copies don't log in again"""
    if os.path.isfile(PROTON_CONF): return
    os.makedirs(os.path.dirname(PROTON_CONF), exist_ok=True)
    if _gdrive_token():  # Google Drive (the remote keeps the name "proton" so every path stays the same)
        # your own Google client (GDRIVE_CLIENT_ID / GDRIVE_CLIENT_SECRET): rclone's shared one is being retired by Google.
        # The token must have been made with the same client (Connect Google Drive.bat passes them to rclone authorize).
        own = [x for kv in (("client_id", os.environ.get("GDRIVE_CLIENT_ID")), ("client_secret", os.environ.get("GDRIVE_CLIENT_SECRET"))) if kv[1] for x in kv]
        rc, out = await _rclone("config", "create", "proton", "drive", "scope", "drive", *own, "token", _gdrive_token(), "--non-interactive", timeout=120)
        if rc != 0:
            try: os.remove(PROTON_CONF)
            except OSError: pass
            raise RuntimeError("couldn't connect Google Drive: " + out[-300:].replace(_gdrive_token(), "•••"))
        return
    args = ["config", "create", "proton", "protondrive", "username", os.environ["PROTON_USER"], "password", os.environ["PROTON_PASSWORD"],
            "replace_existing_draft", "true", "--obscure", "--non-interactive"]
    if os.environ.get("PROTON_2FA_SECRET"): args[6:6] = ["otp_secret_key", re.sub(r"\s+", "", os.environ["PROTON_2FA_SECRET"]).upper()]
    if os.environ.get("PROTON_MAILBOX_PASSWORD"): args[6:6] = ["mailbox_password", os.environ["PROTON_MAILBOX_PASSWORD"]]
    rc, out = await _rclone(*args, timeout=120)
    if rc != 0:
        try: os.remove(PROTON_CONF)
        except OSError: pass
        raise RuntimeError("couldn't log in to Proton: " + _redact(out)[-400:])


def _redact(t: str) -> str:
    for k in ("PROTON_PASSWORD", "PROTON_2FA_SECRET", "PROTON_MAILBOX_PASSWORD"):
        v = os.environ.get(k)
        if v: t = t.replace(v, "•••")
    return t


async def proton_sync(full: bool = False, force: bool = False) -> None:
    """new results (studio outputs) + today's export .zip → Proton Drive. `full` also re-checks older results."""
    if not _proton_on() or PROTON["running"]: return
    PROTON.update(running=True, last_try=time.time(), state="sending")
    folder = (os.environ.get("PROTON_FOLDER") or "H3 Studio").strip("/")
    try:
        await _proton_setup()
        src = os.path.join(OUTPUT, "studio")
        if os.path.isdir(src):
            args = ["copy", src, f"proton:{folder}/results", "--transfers", "2", "--checkers", "4", "--retries", "3", "--low-level-retries", "5"]
            if not full: args += ["--max-age", f"{max(1, PROTON_EVERY // 60) * 3}m"]  # only what's new since the last runs
            rc, out = await _rclone(*args)
            if rc != 0: raise RuntimeError("copying results failed: " + _redact(out)[-500:])
            m = re.findall(r"Transferred:\s+(\d+)\s*/\s*\d+", out)
            if m: PROTON["sent"] += int(m[-1])
        try: n_chars = len(json.load(open(CHAR_FILE)))
        except (OSError, ValueError): n_chars = 0
        if not n_chars:  # nothing to save yet — and an empty export must never replace a real one
            PROTON.update(state="ok", last_ok=time.time(), error=""); return
        if not force and last_change() and last_change() <= PROTON.get("sent_change", 0):  # nothing new since the last upload or restore
            PROTON.update(state="ok", last_ok=time.time(), error=""); return
        stamp = last_change()
        path, name = await asyncio.to_thread(_build_export, set(), False)
        try:
            rc, out = await _rclone("copyto", path, f"proton:{folder}/exports/{name}", "--retries", "3", timeout=1800)
            if rc == 0: PROTON["sent_change"] = stamp
            if rc != 0: raise RuntimeError("copying the export failed: " + _redact(out)[-500:])
        finally:
            try: os.remove(path)
            except OSError: pass
        await _proton_prune(folder)
        PROTON.update(state="ok", last_ok=time.time(), error="")
    except Exception as e:  # noqa: BLE001
        PROTON.update(state="error", error=str(e)[:800])
        print(f"!! {_cloud()}:", PROTON["error"], flush=True)
    finally:
        PROTON["running"] = False


RESTORED = asyncio.Event()
HF_KEYS_FILE = os.environ.get("HF_KEYS_FILE") or os.path.expanduser("~/.h3/hf_keys.txt")


async def _proton_keys():
    """Hugging Face keys from your cloud drive (Google Drive or Proton Drive — whichever the template sets up): any text
    file whose name mentions hf / hugging / token / key, in "H3 Studio" or at the top of the drive (every hf_… in it
    counts). The file is always written (empty when there's none), so the downloader knows to stop waiting for it."""
    keys: list[str] = []
    civ: list[str] = []
    try:
        if _proton_on() and os.environ.get("PROTON_KEYS", "1") != "0":
            await _proton_setup()
            folder = (os.environ.get("PROTON_FOLDER") or "H3 Studio").strip("/")
            # any text file whose name mentions hf / hugging / token / key, in "H3 Studio" or at the top of the drive
            # (hf_tokens.txt, "HF keys (2).txt", tokens.md …) — renamed or re-uploaded copies are still found
            names_ok = re.compile(r"(hf|hugging|token|key|civit)", re.I)
            for where in (folder, ""):
                rc, out = await _rclone("lsjson", f"proton:{where}", "--files-only", timeout=120)
                try: files = json.loads(out[out.index("["): out.rindex("]") + 1]) if rc == 0 else []
                except ValueError: files = []
                for f in files:
                    nm = str(f.get("Name", ""))
                    if not re.search(r"\.(txt|md|text)$", nm, re.I) or not names_ok.search(nm) or (f.get("Size") or 0) > 200_000: continue
                    rc2, txt = await _rclone("cat", f"proton:{where + '/' if where else ''}{nm}", timeout=120)
                    if rc2 == 0:
                        keys += [k for k in re.findall(r"hf_[A-Za-z0-9]{20,}", txt) if k not in keys]
                        # CivitAI keys (32 letters/digits, 0-9 a-f): civitai_keys.txt, or in the same file
                        civ += [k for k in re.findall(r"(?<![0-9a-fA-F])[0-9a-f]{32}(?![0-9a-fA-F])", txt) if k not in civ]
    except Exception as e:  # noqa: BLE001
        print(f"!! Hugging Face keys from {_cloud()}:", _redact(str(e))[:300], flush=True)
    finally:
        try:  # CivitAI keys first: the downloader starts once the Hugging Face file below is written
            os.makedirs(os.path.dirname(CIVITAI_KEYS_FILE), mode=0o700, exist_ok=True)
            fd = os.open(CIVITAI_KEYS_FILE + ".tmp", os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
            with os.fdopen(fd, "w") as f: f.write("\n".join(civ))
            os.replace(CIVITAI_KEYS_FILE + ".tmp", CIVITAI_KEYS_FILE)
            if civ: print(f"CivitAI: {len(civ)} key(s) from {_cloud()}", flush=True)
        except OSError as e:
            print("!! couldn't save the CivitAI keys:", e, flush=True)
        try:
            os.makedirs(os.path.dirname(HF_KEYS_FILE), mode=0o700, exist_ok=True)
            fd = os.open(HF_KEYS_FILE + ".tmp", os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
            with os.fdopen(fd, "w") as f: f.write("\n".join(keys))
            os.replace(HF_KEYS_FILE + ".tmp", HF_KEYS_FILE)
            if keys: print(f"Hugging Face: {len(keys)} key(s) from {_cloud()}", flush=True)
        except OSError as e:
            print("!! couldn't save the Hugging Face keys:", e, flush=True)


async def _proton_boot():
    await _proton_keys()  # first: the downloader is waiting for them
    asyncio.get_running_loop().create_task(_keys_refresh_loop())
    await _proton_restore()


KEY_REQ = {"at": 0.0, "reason": "", "keys_then": 0, "auto": 0.0, "slow_since": 0.0}
KEY_BATCH = max(1, min(5, int(os.environ.get("HF_KEY_BATCH", "5") or 5)))  # fresh keys asked for at a time


def _key_count() -> int:
    try: return len(set(re.findall(r"hf_[A-Za-z0-9]{20,}", open(HF_KEYS_FILE).read())))
    except OSError: return 0


async def _ask_pc_for_key(reason: str) -> None:
    """leave a note on your drive (H3 Studio/hf_key_request.txt) asking your PC for a fresh Hugging Face key: the
    PC's key helper watches for it, makes one in your logged-in Chrome and adds it to hf_tokens.txt — this rental
    picks it up within ~2 minutes. Rentals can't make keys themselves (Hugging Face only makes them for a logged-in browser)."""
    await _proton_setup()
    folder = (os.environ.get("PROTON_FOLDER") or "H3 Studio").strip("/")
    import tempfile
    with tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False, dir=WORK) as f:
        # which accounts just slowed down here: the PC makes the new keys on a different one
        try: k = json.load(open(os.path.join(os.environ.get("H3_RUN", "/opt/h3/run"), "downloads.json"))).get("hf_key") or {}
        except (OSError, ValueError): k = {}
        named = lambda xs: [x for x in xs if x and not str(x).startswith(("key:", "works", "not accepted")) and x not in ("?", "hidden")]
        json.dump({"at": int(time.time()), "reason": reason[:200], "count": KEY_BATCH, "rental": os.environ.get("CONTAINER_ID", ""),
                   "avoid_accounts": named(k.get("tired_accounts") or []), "current_account": k.get("account") or "",
                   "accounts_in_use": sorted(set(named(k.get("accounts") or [])))}, f)
        tmp = f.name
    try:
        rc, out = await _rclone("copyto", tmp, f"proton:{folder}/hf_key_request.txt", timeout=120)
        if rc != 0: raise RuntimeError(_redact(out)[-200:])
        # check it's really there (Google Drive allows two folders with the same name — then the PC may look in the other one)
        rc2, ls = await _rclone("lsjson", f"proton:{folder}", "--files-only", "--include", "hf_key_request.txt", timeout=60)
        rc3, dirs = await _rclone("lsjson", "proton:", "--dirs-only", timeout=60)
        same = len(re.findall(r'"Name":"' + re.escape(folder) + '"', dirs)) if rc3 == 0 else 0
        print(f"request upload: rc={rc}, visible on Drive: {'yes' if rc2 == 0 and 'hf_key_request.txt' in ls else 'NO'}"
              + (f" — WARNING: {same} folders named \"{folder}\" at the top of your Drive; the PC may be reading another one" if same > 1 else ""), flush=True)
    finally:
        try: os.remove(tmp)
        except OSError: pass
    KEY_REQ.update(at=time.time(), reason=reason, keys_then=_key_count())
    print(f"asked your PC for a fresh Hugging Face key ({reason})", flush=True)


async def hf_key_request(req):
    """the start page's "Get a fresh key from my PC" button (POST), and how that request is doing (GET)"""
    if req.method == "POST":
        if not _proton_on(): return web.json_response({"error": "Connect Google Drive first (GDRIVE_TOKEN in the template)"}, status=400)
        if time.time() - KEY_REQ["at"] < 120: return web.json_response({"ok": True, "again": True})
        try: await _ask_pc_for_key("pressed on the start page")
        except Exception as e:  # noqa: BLE001
            return web.json_response({"error": f"Couldn't leave the note on your drive: {e}"}, status=502)
        return web.json_response({"ok": True})
    got = max(0, _key_count() - KEY_REQ["keys_then"]) if KEY_REQ["at"] else 0
    return web.json_response({"asked": KEY_REQ["at"] or None, "reason": KEY_REQ["reason"], "new_keys": got})


async def _keys_refresh_loop():
    """while models are still downloading, fetch the Hugging Face keys file from your drive again every minute: keys
    you make on Hugging Face and add to hf_tokens.txt reach this rental without a reboot (the downloader re-reads it)"""
    run_dir = os.environ.get("H3_RUN", "/opt/h3/run")
    for _ in range(360):  # at most 6 hours
        await asyncio.sleep(60)
        try: active = json.load(open(os.path.join(run_dir, "downloads.json"))).get("active", True)
        except (OSError, ValueError): active = True
        if not active: return
        if not _proton_on(): return
        # stuck slow: ask your PC for fresh keys by itself — when every key was tried, or when Hugging Face has stayed
        # under 100 MB/s for 2 minutes in a row (switching keys didn't help). At most every 20 minutes.
        try:
            k = json.load(open(os.path.join(run_dir, "downloads.json"))).get("hf_key") or {}
            mb = k.get("mbps")
            if mb is not None and mb < 100: KEY_REQ["slow_since"] = KEY_REQ["slow_since"] or time.time()
            elif mb is not None: KEY_REQ["slow_since"] = 0.0
            stuck = str(k.get("last") or "").startswith("every key tried") or (KEY_REQ["slow_since"] and time.time() - KEY_REQ["slow_since"] >= 120)
            if stuck and time.time() - KEY_REQ["auto"] > 1200 and time.time() - KEY_REQ["at"] > 600:
                KEY_REQ["auto"] = time.time()
                await _ask_pc_for_key(f"Hugging Face stuck at {mb} MB/s on this rental")
        except Exception as e:  # noqa: BLE001
            print("!! asking for a fresh key:", _redact(str(e))[:200], flush=True)
        before = ""
        try: before = open(HF_KEYS_FILE).read()
        except OSError: pass
        await _proton_keys()
        try:
            if not open(HF_KEYS_FILE).read().strip() and before.strip():  # a failed fetch never wipes the keys already here
                with open(HF_KEYS_FILE, "w") as f: f.write(before)
        except OSError: pass


async def _proton_prune(folder: str) -> None:
    """keep the newest PROTON_KEEP (3) exports the rental made in "<folder>/exports"; older ones go to Proton's trash.
    Only that folder, and only h3-….zip files — a folder you made yourself is never touched."""
    keep = int(os.environ.get("PROTON_KEEP", "3") or 0)
    if keep <= 0: return
    rc, out = await _rclone("lsjson", f"proton:{folder}/exports", timeout=240)
    try: files = json.loads(out[out.index("["): out.rindex("]") + 1]) if rc == 0 else []
    except ValueError: return
    ours = sorted((f for f in files if re.match(r"^h3-.*\d{4}-\d{2}-\d{2}(-\d{6})?\.zip$", str(f.get("Name", ""))) and not f.get("IsDir")),
                  key=_export_when, reverse=True)
    for f in ours[keep:]:
        await _rclone("deletefile", f"proton:{folder}/exports/{f['Name']}", timeout=240)


async def import_restore(req):
    """"Try again" on a Proton Drive restore that failed (the startup screen and the Studio's import card)"""
    if not _proton_on(): return web.json_response({"error": "Proton Drive isn't set up in the template"}, status=400)
    busy = [v for v in IMPORTS.values() if v.get("source") == "proton" and v.get("state") in ("finding", "fetching", "unpacking")]
    if not busy: _spawn(_proton_restore(force=True))
    return web.json_response({"ok": True})


def _export_time(f: dict) -> float:
    """when the work in a backup was last changed: h3-…-2026-10-20-153012.zip (UTC, to the second); older day-only names and
    files without a date count by their own file time"""
    import calendar
    name = str(f.get("Name", ""))
    m = re.search(r"(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})(\d{2})", name)
    if m: return float(calendar.timegm(tuple(int(x) for x in m.groups()) + (0, 0, 0)))
    mt = str(f.get("ModTime", ""))
    try:
        from datetime import datetime
        return datetime.fromisoformat(mt.replace("Z", "+00:00")[:32]).timestamp()
    except ValueError:
        m = re.search(r"(\d{4})-(\d{2})-(\d{2})", name)
        return float(calendar.timegm(tuple(int(x) for x in m.groups()) + (0, 0, 0, 0, 0, 0))) if m else 0.0


def _export_when(f: dict) -> tuple:
    return (_export_time(f), str(f.get("ModTime", "")))


async def _proton_restore(force: bool = False):
    """a fresh rental (no characters yet) brings back your newest export from Proton Drive by itself — characters, chats,
    presets, settings — then your results in the background. PROTON_RESTORE=0 turns it off. Shown on the startup screen and
    in the Studio like an import."""
    try:
        if not _proton_on() or os.environ.get("PROTON_RESTORE", "1") == "0": return
        try: have = json.load(open(CHAR_FILE))
        except (OSError, ValueError): have = []
        # a machine that already has work only takes the cloud copy when it holds a newer change (checked below)
        folder = (os.environ.get("PROTON_FOLDER") or "H3 Studio").strip("/")
        iid = uuid.uuid4().hex[:12]
        os.makedirs(IMPORT_DIR, exist_ok=True)
        it = {"path": os.path.join(IMPORT_DIR, iid + ".zip"), "size": 0, "got": 0, "state": "finding", "done": 0, "total": 0,
              "name": "", "source": "proton", "at": time.time()}
        IMPORTS[iid] = it
        await _proton_setup()
        # your exports can be in "<folder>/exports" (where the rental puts them) or in a folder you made yourself and
        # uploaded to, e.g. "Exports" at the top of My files — look in all of them and take the newest
        found, errs = [], []
        for where in (f"{folder}/exports", "Exports", "exports", folder):
            rc, out = await _rclone("lsjson", f"proton:{where}", timeout=240)
            try: files = json.loads(out[out.index("["): out.rindex("]") + 1]) if rc == 0 else None
            except ValueError: files = None
            if files is None:
                if "not found" not in out.lower() and "directory not found" not in out.lower(): errs.append(_redact(out)[-200:])
                continue
            found += [{**f, "Where": where} for f in files if not f.get("IsDir") and str(f.get("Name", "")).lower().endswith(".zip") and (f.get("Size") or 0) > 0]
        if not found:
            it.update(state="error" if errs else "none", error=(f"Couldn't look in {_cloud()}: " + errs[0]) if errs else f"No exports in {_cloud()} yet"); return
        # newest = the date in the name (h3-…-2026-10-10.zip, the day it was made — an upload from your PC changes the
        # file's own time), then the file's time
        newest = max(found, key=_export_when)
        cloud_t = _export_time(newest)
        if have and not force and cloud_t <= last_change() + 1:
            # this machine already has the newest work: say so (the card stops looking) — Import brings in a .zip anyway
            it.update(state="none", name=newest["Name"], error="This rental already has your newest backup"); return
        it.update(name=newest["Name"], size=int(newest.get("Size") or 0), state="fetching", at=time.time())
        job = asyncio.create_task(_rclone("copyto", f"proton:{newest['Where']}/{newest['Name']}", it["path"], "--retries", "3", timeout=3600))
        import glob as _glob
        while not job.done():
            await asyncio.sleep(1.5)
            sizes = [os.path.getsize(f) for f in _glob.glob(it["path"] + "*") if os.path.isfile(f)]
            if sizes: it["got"] = max(sizes); it["at"] = time.time()
        rc, out = job.result()
        if rc != 0 or not os.path.isfile(it["path"]):
            it.update(state="error", error=f"Couldn't get the export from {_cloud()}: " + _redact(out)[-300:]); return
        it.update(got=it["size"], state="unpacking")
        MAIN_LOOP[:] = [asyncio.get_running_loop()]
        await asyncio.get_running_loop().run_in_executor(None, _import_run, it)
        if it["state"] == "done":
            # what's here now is that copy: same change time, and nothing to upload until you change something
            set_last_change(max(cloud_t, 0) or time.time()); PROTON["sent_change"] = last_change()
        if it["state"] == "done":  # the result files follow in the background (they sync to Proton on their own)
            it["results"] = "copying"
            rc, out = await _rclone("copy", f"proton:{folder}/results", os.path.join(OUTPUT, "studio"), "--ignore-existing", "--transfers", "4", timeout=7200)
            it["results"] = "done" if rc == 0 or "not found" in out.lower() else "failed"  # no results folder yet is fine
    except Exception as e:  # noqa: BLE001
        print("!! Proton restore:", _redact(str(e)), flush=True)
        try:
            if it.get("state") in ("finding", "fetching", "unpacking"): it.update(state="error", error=_redact(str(e))[:300])
        except NameError: pass
    finally:
        RESTORED.set()


async def _proton_loop():
    if not _proton_on(): return
    PROTON["state"] = "waiting"
    await asyncio.sleep(120)  # let the rental settle (downloads, restores) first
    await RESTORED.wait()  # never send a fresh rental's empty export over the one you're restoring from
    while True:
        await proton_sync(full=PROTON["last_ok"] is None)
        await asyncio.sleep(PROTON_EVERY)


async def proton_status(req):
    if req.method == "POST":
        if not _proton_on(): return web.json_response({"error": "Backups aren't set up — add GDRIVE_TOKEN (Google Drive) or PROTON_USER + PROTON_PASSWORD (Proton Drive) to the Vast template"}, status=400)
        asyncio.create_task(proton_sync(full=True, force=req.query.get("force") == "1"))
        return web.json_response({"ok": True})
    return web.json_response({"on": _proton_on(), "cloud": _cloud(), "folder": (os.environ.get("PROTON_FOLDER") or "H3 Studio"), **{k: v for k, v in PROTON.items()}})


async def _local_library():
    """your PC: no downloader at start-up, so bring the LoRA library and your own checkpoints over here (missing files only)"""
    await asyncio.sleep(15)  # let a Proton restore land first
    for _ in range(40):
        if RESTORED.is_set(): break
        await asyncio.sleep(3)
    try:
        _fetch_missing_loras(load_reg())
        m = load_models()
        if isinstance(m, dict): _fetch_missing_models(m)
    except Exception as e:  # noqa: BLE001
        print("!! LoRA library:", e, flush=True)


async def on_start(app):
    if LOCAL: app["local_library"] = asyncio.create_task(_local_library())
    app["relay"] = asyncio.create_task(relay_loop())
    app["watch"] = asyncio.create_task(watch_loop())
    app["whisper_idle"] = asyncio.create_task(_whisper_idle())
    app["tips"] = asyncio.create_task(_backfill_tips())
    app["proton_restore"] = asyncio.create_task(_proton_boot())
    app["proton"] = asyncio.create_task(_proton_loop())
    try:
        materialize_packs()
    except Exception as e:  # noqa: BLE001
        print("!! prompt packs:", e, flush=True)


# ------------------------------------------------------------------ prompt packs: drop-in system prompts for the Scenes pipeline
# Drop .json / .txt / .md files (LM Studio presets, plain system prompts, JSON templates). Each becomes a "pack" for one
# stage, is kept with your settings (so it comes back on every rental) and is written to models/LLM/prompts, where the
# LLM Text Processor node passes it to llama.cpp as the real system prompt (-sysf). Also selectable in the node editor.
_here = os.path.dirname(os.path.abspath(__file__))
PROMPTS_SRC = os.environ.get("STUDIO_PROMPTS") or ("/opt/h3/prompts" if os.path.isdir("/opt/h3/prompts") else os.path.join(_here, "..", "prompts"))
LLM_PROMPTS = os.path.join(MODELS, "LLM", "prompts")
PACKS_DIR = os.path.join(STATE, "packs")
PACKS_FILE = os.path.join(STATE, "packs.json")
STAGES = {"look": "Look block writer", "krea": "Krea 2 frame builder", "context": "Scene context → blueprint", "compiler": "H3 prompt compiler", "tweak": "Prompt part rewriter",
          "describe": "Character description (Krea 2)", "tags": "Plain words → anime tags", "chat": "Studio assistant",
          "plan": "Plan a video writer (Animate + Plan a video)", "site": "Site profile writer (Your site)",
          "changes": "Picture changes (Create with pictures)", "remix": "Remix merger (Create)", "read": "Picture → prompt (Create)", "match": "Face match check (training set)", "likeness": "Carry a likeness into a prompt (Edit)",
          "editplan": "Edit chat: your words → a precise edit instruction", "sort": "Sort pictures into site sets (Your site)", "setplan": "Plan photo sets for a character (Batch)"}
BUILTIN_FILE = {"krea": "studio_krea.txt", "context": "studio_context.txt", "compiler": "studio_compiler.txt", "look": "studio_look.txt", "tweak": "studio_tweak.txt",
                "describe": "studio_describe.txt", "tags": "studio_tags.txt", "chat": "studio_chat.txt", "plan": "studio_plan.txt", "site": "studio_site.txt",
                "changes": "studio_changes.txt", "remix": "studio_remix.txt", "read": "studio_read.txt", "match": "studio_match.txt", "likeness": "studio_likeness.txt", "editplan": "studio_editplan.txt", "sort": "studio_sort.txt", "setplan": "studio_setplan.txt"}
TEMPLATES = {
    "context": "{seconds} second {mode}. {description}\nCharacters: {characters}",
    "compiler": "We are doing {MODE}. {seconds} seconds, {aspect}.\nReferences: {references}\n\n{blueprint}",
    "krea": "CHARACTER: {character}\nFRAME: {frame}\nEXPRESSION: {expression}\nINSPIRATION: {inspiration}\nASPECT: {aspect}",
    "look": "{notes}",
    "tweak": "FULL PROMPT:\n{prompt}\n\nPART:\n{part}\n\nCHANGE:\n{change}",
    "describe": "{notes}",
    "tags": "TEXT: {text}\nCHARACTER: {character}",
    "chat": "STATE:\n{state}\n\nHISTORY:\n{history}\n\nMESSAGE: {message}",
    "plan": "{request}",
    "site": "CHARACTER: {character}\nNOTES: {notes}",
    "changes": "TAKE: {take}\nBEFORE: {before}\nTEXT: {text}",
    "remix": "ORIGINAL PROMPT:\n{prompt}\n\nCHANGES:\n{change}",
    "read": "MODEL: {model}\nFOCUS: {focus}\nPEOPLE: {people}\nDETAIL: {detail}",
    "match": "LEFT: {who}\nRIGHT: {what}",
    "likeness": "SCENE PROMPT:\n{scene}\n\nNEW PERSON:\n{person}\n\nOUTFIT: {outfit}\nMODEL: {model}",
    "editplan": "PICTURES:\n{pictures}\n\nEARLIER IN THIS CHAT:\n{history}\n\nREQUEST: {request}\nMODEL: {model}",
    "sort": "CHARACTER: {character}\nSETS SO FAR: {existing}\n\nPICTURES:\n{pictures}",
    "setplan": "CHARACTER: {character}\nPROFILE: {profile}\nSETS: {sets}\nPICTURES PER SET: {per}\nMIX: {mix}\nBACKDROP: {backdrop}\nPOSE IDEAS: {poses}\nALREADY MADE: {existing}",
}
PARAMS = {"temperature": 0.6, "top_p": 0.9, "top_k": 40, "repeat_penalty": 1.05, "max_tokens": 8192}
# your own files: the model's own default thinking (as in LM Studio), and no picture unless you switch it on
OPTIONS = {"thinking": "auto", "see_image": False}
PACK_ID = re.compile(r"^[a-z0-9]{6,16}$")


def _load_packs() -> dict:
    try:
        with open(PACKS_FILE) as f: d = json.load(f)
    except Exception:  # noqa: BLE001
        d = {}
    d.setdefault("packs", []); d.setdefault("active", {})
    for p in d["packs"]:
        for k, v in OPTIONS.items(): p.setdefault(k, v)
    return d


def _save_packs(d: dict):
    os.makedirs(STATE, exist_ok=True)
    with open(PACKS_FILE + ".tmp", "w") as f: json.dump(d, f, indent=1)
    os.replace(PACKS_FILE + ".tmp", PACKS_FILE)


def _builtin(stage: str) -> dict:
    return {"id": f"builtin-{stage}", "name": "Built-in", "file": BUILTIN_FILE[stage], "stage": stage, "format": "builtin", "builtin": True,
            "params": dict(PARAMS, **({"temperature": 0.3} if stage in ("compiler", "look", "tweak", "tags") else {}), **({"max_tokens": 600} if stage in ("tweak", "tags") else {}), **({"max_tokens": 1200} if stage == "describe" else {}), **({"max_tokens": 1500} if stage == "chat" else {}), **({"temperature": 0.7, "top_p": 0.8, "top_k": 20, "max_tokens": 4500} if stage == "plan" else {}), **({"temperature": 0.8, "max_tokens": 1500} if stage == "site" else {}), **({"temperature": 0.2, "max_tokens": 300} if stage == "changes" else {}), **({"temperature": 0.3, "max_tokens": 900} if stage == "remix" else {}), **({"temperature": 0.3, "max_tokens": 1400} if stage in ("read", "likeness") else {}), **({"temperature": 0.3, "max_tokens": 700} if stage == "editplan" else {}), **({"temperature": 0.1, "max_tokens": 120} if stage == "match" else {}), **({"temperature": 0.2, "max_tokens": 6000} if stage == "sort" else {}), **({"temperature": 0.8, "max_tokens": 5000} if stage == "setplan" else {})), "template": TEMPLATES[stage],
            "prompt_file": f"studio_builtin_{stage}.txt", "thinking": "off", "see_image": stage not in ("krea", "tweak", "tags", "chat", "changes", "remix", "sort", "setplan")}


def _pack_text(p: dict) -> str:
    path = os.path.join(PROMPTS_SRC, BUILTIN_FILE[p["stage"]]) if p.get("builtin") else os.path.join(PACKS_DIR, p["id"] + ".txt")
    try:
        with open(path, encoding="utf-8") as f: return f.read()
    except FileNotFoundError:
        return ""


def materialize_packs():
    """write every pack where the LLM node can find it (after a restore from backup, on every rental)"""
    os.makedirs(LLM_PROMPTS, exist_ok=True)
    d = _load_packs()
    for p in [_builtin(s) for s in STAGES] + d["packs"]:
        text = _pack_text(p)
        if not text: continue
        dest = os.path.join(LLM_PROMPTS, p.get("prompt_file") or f"studio_pack_{p['id']}.txt")
        try:
            with open(dest, encoding="utf-8") as f:
                if f.read() == text: continue
        except FileNotFoundError:
            pass
        with open(dest, "w", encoding="utf-8") as f: f.write(text)


def _num_or(v, cast=float):
    if isinstance(v, dict):
        if v.get("checked") is False: return None
        v = v.get("value")
    try: return cast(v)
    except (TypeError, ValueError): return None


def _find_system(d, depth=0) -> str | None:
    """the system prompt inside any JSON shape: LM Studio presets (new + old), OpenAI-style messages, plain keys"""
    if depth > 6: return None
    if isinstance(d, dict):
        for f in (d.get("operation") or {}).get("fields") or []:
            if isinstance(f, dict) and f.get("key") == "llm.prediction.systemPrompt" and isinstance(f.get("value"), str): return f["value"]
        ip = d.get("inference_params")
        if isinstance(ip, dict) and isinstance(ip.get("pre_prompt"), str) and ip["pre_prompt"].strip(): return ip["pre_prompt"]
        for k in ("system_prompt", "systemPrompt", "system", "instructions", "pre_prompt", "prompt"):
            v = d.get(k)
            if isinstance(v, str) and len(v.strip()) > 20: return v
        for m in d.get("messages") or []:
            if isinstance(m, dict) and m.get("role") == "system" and isinstance(m.get("content"), str): return m["content"]
        for v in d.values():
            if isinstance(v, (dict, list)):
                r = _find_system(v, depth + 1)
                if r: return r
    elif isinstance(d, list):
        for v in d:
            r = _find_system(v, depth + 1)
            if r: return r
    return None


def _params_from(d) -> dict:
    out = {}
    if not isinstance(d, dict): return out
    keymap = {"llm.prediction.temperature": ("temperature", float), "llm.prediction.topPSampling": ("top_p", float),
              "llm.prediction.topKSampling": ("top_k", int), "llm.prediction.repeatPenalty": ("repeat_penalty", float),
              "llm.prediction.maxPredictedTokens": ("max_tokens", int)}
    for f in (d.get("operation") or {}).get("fields") or []:
        if isinstance(f, dict) and f.get("key") in keymap:
            k, c = keymap[f["key"]]; v = _num_or(f.get("value"), c)
            if v is not None: out[k] = v
    src = dict(d.get("inference_params") or {}) if isinstance(d.get("inference_params"), dict) else {}
    src.update({k: v for k, v in d.items() if not isinstance(v, (dict, list))})
    for k, (name, c) in {"temp": ("temperature", float), "temperature": ("temperature", float), "top_p": ("top_p", float), "top_k": ("top_k", int),
                         "repeat_penalty": ("repeat_penalty", float), "n_predict": ("max_tokens", int), "max_tokens": ("max_tokens", int)}.items():
        v = _num_or(src.get(k), c)
        if v is not None and (c is not int or v > 0): out[name] = v
    if "max_tokens" in out and out["max_tokens"] <= 0: out.pop("max_tokens")
    return out


def detect_stage(name: str, text: str) -> str | None:
    n, t = name.lower(), text.lower()[:6000]
    s = {k: 0 for k in STAGES}
    if re.search(r"context|blueprint", n): s["context"] += 6
    if re.search(r"scene|shot|director|planner", n): s["context"] += 3
    if re.search(r"compil|final", n): s["compiler"] += 6
    if re.search(r"plan|timeline|animate", n): s["plan"] += 6
    s["plan"] += 4 if re.search(r"cut \| start \| end|\bsay \||timeline", t) else 0
    if re.search(r"h3|minimax|video.?prompt", n): s["compiler"] += 2
    if re.search(r"krea|frame|t2i|txt2img|image.?prompt|still", n): s["krea"] += 6
    if re.search(r"\blook\b|appearance|character.?(desc|sheet|block)", n): s["look"] += 5
    s["context"] += 2 * min(3, t.count("blueprint")) + (3 if "scene context" in t else 0)
    s["compiler"] += (4 if "integrated_multimodal_description" in t else 0) + (2 if re.search(r"minimax|\bh3\b", t) else 0) + (2 if "compile" in t else 0)
    s["krea"] += (4 if "krea" in t else 0) + (2 if re.search(r"text-to-image|image prompt|starting frame|start frame", t) else 0)
    s["look"] += 3 if "look block" in t else 0
    best = max(s, key=lambda k: s[k])
    return best if s[best] > 0 else None


FENCE = re.compile(r"```[\w-]*[ \t]*\n(.*?)```", re.S)
TITLE = re.compile(r"^\W*(?:system(?:\s+prompt)?\s*[—–:-]+\s*)?(.{4,80}?)\s*$", re.I)


def _title_of(text: str) -> str | None:
    """'SYSTEM — MINIMAX H3 AUDIOVISUAL PROMPT SPECIALIST' → 'Minimax H3 Audiovisual Prompt Specialist'"""
    first = next((l.strip() for l in text.splitlines() if l.strip()), "")
    if not first or len(first) > 90 or not re.search(r"system|prompt|director|builder|compiler|specialist|writer", first, re.I): return None
    m = TITLE.match(first.lstrip("#").strip())
    t = (m.group(1) if m else first).strip(" =#*")
    return t.title() if t.isupper() else t


def parse_pack(name: str, raw: bytes) -> list[dict]:
    """one file → one or more prompts (a file with several ``` blocks becomes one prompt per block)"""
    text = raw.decode("utf-8", errors="replace").lstrip("\ufeff").replace("\r\n", "\n")
    blocks = [b.strip() for b in FENCE.findall(text) if len(b.strip()) > 200]
    if blocks and (len(blocks) > 1 or len(blocks[0]) > 0.6 * len(text.strip())):
        return [p for i, b in enumerate(blocks) for p in _parse_one(f"{name}#{i + 1}" if len(blocks) > 1 else name, b.encode())]
    return _parse_one(name, raw)


def _parse_one(name: str, raw: bytes) -> list[dict]:
    text = raw.decode("utf-8", errors="replace").lstrip("\ufeff").replace("\r\n", "\n")
    fmt, system, params, template, stage, title, opts = "text", text.strip(), {}, None, None, None, {}
    if name.lower().split("#")[0].endswith(".json") or text.lstrip()[:1] in ("{", "["):
        try:
            d = json.loads(text)
        except json.JSONDecodeError:
            d = None
        if d is not None:
            sp = _find_system(d)
            params = _params_from(d)
            if isinstance(d, dict):
                title = d.get("name") if isinstance(d.get("name"), str) else None
                st = str(d.get("stage") or "").lower()
                stage = st if st in STAGES else None
                tp = d.get("template") or d.get("input_template")
                template = tp if isinstance(tp, str) and "{" in tp else None
                if d.get("thinking") in ("auto", "on", "off"): opts["thinking"] = d["thinking"]
                if isinstance(d.get("see_image"), bool): opts["see_image"] = d["see_image"]
            if sp:
                fmt, system = ("lmstudio" if isinstance(d, dict) and ("operation" in d or "inference_params" in d) else "json"), sp.strip()
            else:
                fmt, system = "json-template", json.dumps(d, indent=2, ensure_ascii=False)  # e.g. an output schema the model should follow
    system = re.sub(r"^```[\w-]*\n|\n?```\s*$", "", system).strip()
    stage = stage or detect_stage(name, system)
    base = os.path.basename(name.split("#")[0])
    return [{"name": (title or _title_of(system) or os.path.splitext(base)[0])[:80], "file": os.path.basename(name)[:120], "format": fmt,
             "system": system, "params": params, "template": template, "stage": stage, "options": opts}]


def _pack_out(p: dict, d: dict) -> dict:
    text = _pack_text(p)
    return {**{k: v for k, v in p.items() if k != "system"}, "chars": len(text), "preview": text[:280],
            "active": d["active"].get(p.get("stage") or "") == p["id"] or (p.get("builtin") and not d["active"].get(p["stage"]))}


async def packs_list(req):
    materialize_packs()
    d = _load_packs()
    ids = {p["id"] for p in d["packs"]}
    for st, pid in list(d["active"].items()):
        if pid not in ids: d["active"].pop(st)
    return web.json_response({"stages": STAGES, "templates": TEMPLATES, "active": {s: d["active"].get(s, f"builtin-{s}") for s in STAGES},
                              "packs": [_pack_out(_builtin(s), d) for s in STAGES] + [_pack_out(p, d) for p in d["packs"]]})


def _store_pack(d: dict, parsed: dict, stage_override: str | None = None) -> dict:
    pid = uuid.uuid4().hex[:10]
    os.makedirs(PACKS_DIR, exist_ok=True)
    with open(os.path.join(PACKS_DIR, pid + ".txt"), "w", encoding="utf-8") as f: f.write(parsed["system"])
    stage = stage_override if stage_override in STAGES else parsed.get("stage")
    p = {"id": pid, "name": parsed["name"], "file": parsed["file"], "stage": stage, "format": parsed["format"],
         "params": {**PARAMS, **parsed.get("params", {})}, "template": parsed.get("template") or (TEMPLATES[stage] if stage else None),
         "prompt_file": f"studio_pack_{pid}.txt", "importedAt": int(time.time()), **OPTIONS, **(parsed.get("options") or {})}
    d["packs"].append(p)
    if stage: d["active"][stage] = pid
    return p


async def packs_add(req):
    """drop one or more files (multipart 'file' fields), or JSON {name, text, stage, template, params}"""
    d = _load_packs()
    added = []
    if req.content_type.startswith("multipart/"):
        reader = await req.multipart()
        stage = None
        while (field := await reader.next()) is not None:
            if field.name == "stage": stage = (await field.text()).strip() or None; continue
            if field.name != "file": continue
            raw = await field.read(decode=False)
            if len(raw) > 512_000: raise web.HTTPBadRequest(text=f"{field.filename}: too big for a system prompt (max 500 KB)")
            for parsed in parse_pack(field.filename or "prompt.txt", raw):
                if not parsed["system"].strip(): raise web.HTTPBadRequest(text=f"{field.filename}: no text found")
                added.append(_store_pack(d, parsed, stage))
        # several files for one stage in one drop: a real system prompt wins over a bare JSON template
        for st in STAGES:
            mine = [p for p in added if p.get("stage") == st]
            if mine: d["active"][st] = ([p for p in mine if p["format"] != "json-template"] or mine)[-1]["id"]
    else:
        b = await req.json()
        parsed = {"name": str(b.get("name") or "My prompt")[:80], "file": "", "format": "edited", "system": str(b.get("text") or ""),
                  "params": {k: v for k, v in (b.get("params") or {}).items() if k in PARAMS}, "template": b.get("template"), "stage": b.get("stage"),
                  "options": {k: b[k] for k in OPTIONS if k in b}}
        if not parsed["system"].strip(): raise web.HTTPBadRequest(text="empty prompt")
        added.append(_store_pack(d, parsed, b.get("stage")))
    _save_packs(d); materialize_packs()
    return web.json_response({"added": [_pack_out(p, d) for p in added]})


async def packs_update(req):
    pid = req.match_info["id"]
    if not PACK_ID.match(pid): raise web.HTTPBadRequest(text="built-in packs can't be changed — save a copy")
    d = _load_packs(); p = next((x for x in d["packs"] if x["id"] == pid), None)
    if not p: raise web.HTTPNotFound()
    b = await req.json()
    if "name" in b: p["name"] = str(b["name"])[:80]
    if "stage" in b and (b["stage"] in STAGES or b["stage"] is None):
        if d["active"].get(p.get("stage") or "") == pid: d["active"].pop(p["stage"])
        p["stage"] = b["stage"]
        if b["stage"]: d["active"][b["stage"]] = pid
        if not p.get("template") and b["stage"]: p["template"] = TEMPLATES[b["stage"]]
    if "template" in b: p["template"] = str(b["template"] or "") or (TEMPLATES.get(p.get("stage") or "") or None)
    if "params" in b: p["params"] = {**p.get("params", {}), **{k: v for k, v in (b["params"] or {}).items() if k in PARAMS}}
    if b.get("thinking") in ("auto", "on", "off"): p["thinking"] = b["thinking"]
    if isinstance(b.get("see_image"), bool): p["see_image"] = b["see_image"]
    if "text" in b:
        if not str(b["text"]).strip(): raise web.HTTPBadRequest(text="empty prompt")
        with open(os.path.join(PACKS_DIR, pid + ".txt"), "w", encoding="utf-8") as f: f.write(str(b["text"]))
    _save_packs(d); materialize_packs()
    return web.json_response(_pack_out(p, d))


async def packs_delete(req):
    pid = req.match_info["id"]
    d = _load_packs()
    d["packs"] = [x for x in d["packs"] if x["id"] != pid]
    d["active"] = {k: v for k, v in d["active"].items() if v != pid}
    for path in (os.path.join(PACKS_DIR, pid + ".txt"), os.path.join(LLM_PROMPTS, f"studio_pack_{pid}.txt")):
        if PACK_ID.match(pid) and os.path.exists(path): os.remove(path)
    _save_packs(d)
    return web.json_response({"ok": True})


async def packs_activate(req):
    b = await req.json()
    st, pid = b.get("stage"), b.get("id")
    if st not in STAGES: raise web.HTTPBadRequest(text="unknown stage")
    d = _load_packs()
    if pid == f"builtin-{st}" or not pid: d["active"].pop(st, None)
    elif any(x["id"] == pid for x in d["packs"]): d["active"][st] = pid
    else: raise web.HTTPNotFound()
    _save_packs(d)
    return web.json_response({"ok": True})


async def packs_text(req):
    pid = req.match_info["id"]
    d = _load_packs()
    p = _builtin(pid[8:]) if pid.startswith("builtin-") and pid[8:] in STAGES else next((x for x in d["packs"] if x["id"] == pid), None)
    if not p: raise web.HTTPNotFound()
    return web.json_response({"text": _pack_text(p)})


# ------------------------------------------------------------------ last frame of a video (continue the next shot from it)
async def last_frame(req):
    d = await req.json()
    src = safe_join(folder(d.get("type", "output")), d.get("subfolder", ""), d["filename"])
    if not os.path.isfile(src): raise web.HTTPNotFound()
    name = unique_input_name(os.path.splitext(os.path.basename(src))[0] + "_last.png")
    dest = os.path.join(INPUT, name)
    p = await asyncio.create_subprocess_exec("ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-sseof", "-0.3", "-i", src,
                                             "-update", "1", "-frames:v", "1", dest, stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.PIPE)
    _, err = await p.communicate()
    if p.returncode != 0 or not os.path.exists(dest): raise web.HTTPBadRequest(text="couldn't read the last frame: " + err.decode(errors="ignore")[-200:])
    return web.json_response({"name": name, "kind": "image"})


# ------------------------------------------------------------------ reference sheets: one picture -> separate views
def split_sheet(path: str, n: int) -> list[tuple[int, int, int, int]]:
    """find the n figures standing on a plain background: columns that differ from the background are 'figure',
    gaps between them are cut points. Falls back to equal slices if the figures touch."""
    from PIL import Image
    import numpy as np
    im = Image.open(path).convert("RGB"); a = np.asarray(im).astype(np.int16)
    h, w, _ = a.shape
    border = np.concatenate([a[:4].reshape(-1, 3), a[-4:].reshape(-1, 3), a[:, :4].reshape(-1, 3), a[:, -4:].reshape(-1, 3)])
    bg = np.median(border, axis=0)
    diff = np.abs(a - bg).max(axis=2) > 28                     # pixel isn't background
    col = diff.mean(axis=0) > 0.012                             # column has some figure in it
    k = max(3, w // 200); col = np.convolve(col.astype(float), np.ones(k) / k, mode="same") > 0.3  # smooth tiny holes
    runs, start = [], None
    for x, v in enumerate(col):
        if v and start is None: start = x
        if not v and start is not None: runs.append([start, x]); start = None
    if start is not None: runs.append([start, w])
    runs = [r for r in runs if r[1] - r[0] > w * 0.03]          # ignore specks
    while len(runs) > n:                                        # merge the closest neighbours (e.g. an arm split off)
        gaps = [runs[i + 1][0] - runs[i][1] for i in range(len(runs) - 1)]
        i = int(np.argmin(gaps)); runs[i] = [runs[i][0], runs[i + 1][1]]; del runs[i + 1]
    if len(runs) != n:
        runs = [[round(i * w / n), round((i + 1) * w / n)] for i in range(n)]
    boxes = []
    for x0, x1 in runs:
        rows = np.where(diff[:, x0:x1].mean(axis=1) > 0.01)[0]
        y0, y1 = (int(rows[0]), int(rows[-1]) + 1) if len(rows) else (0, h)
        pad_x, pad_y = max(12, (x1 - x0) // 10), max(12, (y1 - y0) // 20)
        boxes.append((max(0, x0 - pad_x), max(0, y0 - pad_y), min(w, x1 + pad_x), min(h, y1 + pad_y)))
    return boxes


async def sheet_split(req):
    d = await req.json()
    f = d.get("from") or {}
    base = {"output": OUTPUT, "input": INPUT, "temp": TEMP}.get(f.get("type", "output"), OUTPUT)
    src = safe_join(base, os.path.join(f.get("subfolder", ""), f.get("filename", "")))
    if not os.path.isfile(src): raise web.HTTPNotFound(text="sheet not found")
    n = max(2, min(8, int(d.get("n", 4))))
    from PIL import Image
    boxes = await asyncio.to_thread(split_sheet, src, n)
    im = Image.open(src).convert("RGB")
    sub = f.get("subfolder", "") or "studio/characters"
    stem = os.path.splitext(f.get("filename", "sheet"))[0]
    out = []
    for i, b in enumerate(boxes):
        crop = im.crop(b)
        # make each view a tidy 2:3 portrait on the sheet's background colour
        cw, ch = crop.size; tw = max(cw, round(ch * 2 / 3)); th = max(ch, round(tw * 3 / 2))
        canvas = Image.new("RGB", (tw, th), im.getpixel((2, 2)))
        canvas.paste(crop, ((tw - cw) // 2, (th - ch) // 2))
        name = f"{stem}_part{i + 1}.png"
        os.makedirs(os.path.join(OUTPUT, sub), exist_ok=True)
        canvas.save(os.path.join(OUTPUT, sub, name))
        out.append({"filename": name, "subfolder": sub, "type": "output"})
    return web.json_response({"parts": out, "boxes": boxes})


async def health(req):
    return web.json_response({"ok": True})



# ------------------------------------------------------------------ debug report (Studio ⋯ menu, h3-report, Claude on the rental)
LOG_DIR = os.environ.get("H3_LOG_DIR", "/var/log")
LOGS = ["studio.log", "comfyui.log", "downloader.log", "aria2.log", "h3-start.log", "watchdog.log", "caddy.log", "extra-nodes.log", "cloudflared.log"]
_SECRET_NAME = re.compile(r"(TOKEN|KEY|PASSWORD|PASS|SECRET|HASH|OTP)", re.I)


def _redact(text):
    """passwords, tokens and keys out: every secret-looking environment value, plus well-known token shapes"""
    for k, v in os.environ.items():
        if _SECRET_NAME.search(k) and v and len(v) >= 6:
            for part in [v] + [x for x in re.split(r"[,\s]+", v) if len(x) >= 6]:
                text = text.replace(part, "‹hidden›")
    text = re.sub(r"\bhf_[A-Za-z0-9]{20,}", "‹hidden›", text)
    text = re.sub(r"(?i)(token|key|password|authorization)([\"']?\s*[:=]\s*[\"']?)[A-Za-z0-9._\-]{12,}", r"\1\2‹hidden›", text)
    return text


def _tail(path, n):
    try:
        with open(path, "rb") as f:
            f.seek(0, 2); size = f.tell(); f.seek(max(0, size - 400_000))
            lines = f.read().decode("utf-8", "replace").splitlines()
        return lines[-n:]
    except OSError:
        return None


def _run(cmd, timeout=8):
    try: return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout).stdout.strip()
    except Exception as e: return f"({e.__class__.__name__})"  # noqa: BLE001


async def debug_report_text(lines_per_log=80):
    out = []
    add = out.append
    add(f"H3 rental debug report · {time.strftime('%Y-%m-%d %H:%M:%S %Z')}")
    try:
        with open("/opt/h3/BUILT") as f: built = f.read().strip()
    except OSError: built = "?"
    add(f"Image built: {built} · uptime {_run(['uptime', '-p'])}")
    add("\n== GPU ==")
    add(_run(["nvidia-smi", "--query-gpu=name,memory.used,memory.total,utilization.gpu,temperature.gpu", "--format=csv,noheader"]) or "(no nvidia-smi)")
    add("\n== Disk ==")
    add(_run(["df", "-h", "/", COMFY_DIR]))
    for name in ("status.json", "downloads.json"):
        add(f"\n== {name} ==")
        try:
            d = json.load(open(os.path.join(H3_RUN, name)))
            if name == "downloads.json":
                for g in d.get("groups") or []:
                    add(f"  {g.get('id'):<12} {g.get('state'):<12} {g.get('pct', 0):>3}%  {g.get('error') or ''}")
                add(f"  speed {d.get('mbps')} MB/s · left {d.get('left_s')} s")
            else:
                add(json.dumps(d))
        except Exception as e: add(f"({e.__class__.__name__})")  # noqa: BLE001
    add("\n== ComfyUI ==")
    try:
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=8)) as s:
            async with s.get(f"{COMFY}/system_stats") as r: st = await r.json()
            dev = (st.get("devices") or [{}])[0]
            add(f"ComfyUI {st.get('system', {}).get('comfyui_version')} · torch {st.get('system', {}).get('pytorch_version')} · VRAM free {round((dev.get('vram_free') or 0) / 2**30, 1)} / {round((dev.get('vram_total') or 0) / 2**30, 1)} GB")
            async with s.get(f"{COMFY}/queue") as r: q = await r.json()
            add(f"queue: {len(q.get('queue_running') or [])} running, {len(q.get('queue_pending') or [])} waiting")
            async with s.get(f"{COMFY}/history?max_items=40") as r: hist = await r.json()
        errs = []
        for pid, h in list(hist.items())[-40:]:
            for m in (h.get("status") or {}).get("messages") or []:
                if m and m[0] == "execution_error":
                    e = m[1]
                    tb = "".join(e.get("traceback") or [])[-600:]
                    errs.append(f"- {e.get('node_type')} (node {e.get('node_id')}): {e.get('exception_type')}: {str(e.get('exception_message'))[:300]}\n    {tb.strip().replace(chr(10), chr(10) + '    ')}")
        add(f"recent failed jobs in ComfyUI: {len(errs)}")
        out.extend(errs[-8:])
    except Exception as e: add(f"ComfyUI not reachable: {e.__class__.__name__}")  # noqa: BLE001
    add("\n== Studio jobs that failed (latest first) ==")
    try:
        jobs = json.load(open(os.path.join(STATE, "jobs.json"))) or []
        bad = [j for j in jobs if j.get("status") == "error"][:15]
        for j in bad: add(f"- [{j.get('tab')}] {j.get('label')}: {str(j.get('error'))[:300]}")
        if not bad: add("(none)")
    except Exception: add("(no saved jobs)")  # noqa: BLE001
    add("\n== Custom nodes that failed to load ==")
    comfy_lines = _tail(os.path.join(LOG_DIR, "comfyui.log"), 4000) or []
    failed = [l for l in comfy_lines if "IMPORT FAILED" in l or "Cannot import" in l]
    out.extend(failed[-15:] or ["(none)"])
    for name in LOGS:
        lines = _tail(os.path.join(LOG_DIR, name), lines_per_log)
        if lines is None: continue
        add(f"\n== {name} (last {len(lines)} lines) ==")
        out.extend(lines)
    return _redact("\n".join(out))


async def debug_report(req):
    n = max(20, min(2000, int(req.query.get("lines") or 80)))
    return web.Response(text=await debug_report_text(n), content_type="text/plain", headers={"Cache-Control": "no-store"})

# ------------------------------------------------------------------ characters: export / import as one file
CHAR_FILE = os.path.join(STATE, "characters.json")


DEFAULT_AGE = 25  # a character saved without an age comes in as an adult (the age is written into its prompts)


def _no_age(c: dict) -> bool:
    try: return not float(c.get("age"))
    except (TypeError, ValueError): return True


def _adult(c: dict) -> bool:
    try: return float(c.get("age")) >= 18
    except (TypeError, ValueError): return False


def _state_json(name: str, default=None):
    try:
        with open(os.path.join(STATE, name + ".json")) as f: return json.load(f)
    except (OSError, ValueError):
        return default


def _state_write(name: str, data):
    p = os.path.join(STATE, name + ".json")
    with open(p + ".tmp", "w") as f: json.dump(data, f)
    os.replace(p + ".tmp", p)


async def characters_export(req):
    """characters as projects: every character (or ?ids=a,b) with their pictures and the scenes they're in, plus your presets
    and prompt files — and, for everything at once, your preferences too. One .zip you can keep or drag into any rental."""
    path, name = await asyncio.to_thread(_build_export, {x for x in req.query.get("ids", "").split(",") if x})
    resp = web.FileResponse(path, headers={"Content-Disposition": f'attachment; filename="{name}"', "Content-Type": "application/zip"})
    asyncio.get_event_loop().call_later(3600, lambda: os.path.exists(path) and os.remove(path))
    return resp


MEDIA_EXT = (".png", ".jpg", ".jpeg", ".webp", ".gif", ".mp4", ".webm", ".mov", ".safetensors", ".zip")


def _build_export(want: set, results: bool = True) -> tuple[str, str]:
    """the export .zip on disk (a temp file) and its download name. results=False leaves the result files out (they're
    synced on their own, e.g. to Proton Drive) but keeps the list of them."""
    import zipfile
    try: chars = json.load(open(CHAR_FILE))
    except (OSError, ValueError): chars = []
    chars = [c for c in chars if isinstance(c, dict) and (not want or c.get("id") in want)]
    ids = {c.get("id") for c in chars}
    scenes = [sc for sc in (_state_json("scenes", []) or []) if isinstance(sc, dict) and (not want or ids & set(sc.get("cast") or []))]
    import tempfile
    tmp = tempfile.NamedTemporaryFile(prefix="h3-export-", suffix=".zip", dir=WORK, delete=False)
    tmp.close()
    with zipfile.ZipFile(tmp.name, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("characters.json", json.dumps({"h3_characters": 1, "characters": chars}, indent=1))
        z.writestr("scenes.json", json.dumps(scenes))
        for name in ("presets", "scene_presets", "lora_sets", "my_recipes"):
            d = _state_json(name)
            if d is not None: z.writestr(f"{name}.json", json.dumps(d))
        if not want:  # everything: your preferences come along
            # a full checkpoint: preferences, timings, your LoRA library and own checkpoints (re-downloaded on import), results
            for name in ("settings", "favorites", "styles", "timings", "notify", "loras", "models", "prefs", "edit_chats", "catalog_meta", "input_sources", "site_addr"):
                d = _state_json(name)
                if d is not None: z.writestr(f"{name}.json", json.dumps(d))
            _export_results(z, files=results)
        packs = _load_packs()
        z.writestr("packs.json", json.dumps(packs))
        for pk in packs.get("packs", []):
            f = os.path.join(PACKS_DIR, str(pk.get("id")) + ".txt")
            if os.path.isfile(f): z.write(f, f"packs/{pk['id']}.txt")
        for c in chars:
            d = os.path.join(KEPT, "characters", str(c.get("id")))
            if os.path.isdir(d):
                for fn in os.listdir(d):
                    if os.path.isfile(os.path.join(d, fn)):
                        # pictures are compressed already: storing them as they are is much faster to pack and unpack
                        z.write(os.path.join(d, fn), f"pictures/{c['id']}/{fn}", compress_type=zipfile.ZIP_STORED if fn.lower().endswith(MEDIA_EXT) else zipfile.ZIP_DEFLATED)
    one = str(chars[0].get("name") or "character") if len(chars) == 1 else None
    stem = (re.sub(r"[^\w-]+", "-", one).strip("-").lower() if one else "") or "characters"
    t = last_change() or time.time()
    return tmp.name, f"h3-{stem}-{time.strftime('%Y-%m-%d-%H%M%S', time.gmtime(t))}.zip"


async def trainset_zip(req):
    """POST {name, trigger, items: [{file: FileRef, caption}], readme} → a .zip ready for a LoRA trainer: 001.png + 001.txt, …"""
    import zipfile, tempfile
    d = await req.json()
    items = [x for x in (d.get("items") or []) if isinstance(x, dict) and isinstance(x.get("file"), dict) and x["file"].get("filename")]
    if not items: raise web.HTTPBadRequest(text="no pictures")
    tmp = tempfile.NamedTemporaryFile(prefix="h3-trainset-", suffix=".zip", dir=WORK, delete=False)
    tmp.close()
    n = 0
    with zipfile.ZipFile(tmp.name, "w", zipfile.ZIP_DEFLATED) as z:
        for x in items:
            try: p = _file_of(x["file"])
            except Exception: continue
            if not os.path.isfile(p): continue
            n += 1
            ext = os.path.splitext(p)[1].lower() or ".png"
            z.write(p, f"dataset/{n:03d}{ext}", compress_type=zipfile.ZIP_STORED)
            z.writestr(f"dataset/{n:03d}.txt", str(x.get("caption") or d.get("trigger") or "").strip() + "\n")
        z.writestr("README.txt", str(d.get("readme") or ""))
    if not n:
        os.remove(tmp.name); raise web.HTTPNotFound(text="none of the pictures are on this rental any more")
    stem = re.sub(r"[^\w-]+", "-", str(d.get("name") or "character")).strip("-").lower() or "character"
    resp = web.FileResponse(tmp.name, headers={"Content-Disposition": f'attachment; filename="{stem}-trainset-{n}.zip"', "Content-Type": "application/zip"})
    asyncio.get_event_loop().call_later(3600, lambda: os.path.exists(tmp.name) and os.remove(tmp.name))
    return resp


# ------------------------------------------------------------------ character LoRA training (Krea 2, musubi-tuner)
MUSUBI = os.environ.get("H3_MUSUBI", "/opt/musubi-tuner")
MUSUBI_PY = os.environ.get("H3_MUSUBI_PY", "/opt/musubi-venv/bin/python")
TRAIN_DIR = os.environ.get("H3_TRAIN_DIR") or ("/workspace/h3-train" if os.path.isdir("/workspace") else os.path.join(WORK, "h3-train"))
TRAIN_FILES = {"dit": ("diffusion_models", "krea2_raw_bf16.safetensors"), "te": ("text_encoders", "qwen3vl_4b_bf16.safetensors"), "vae": ("vae", "qwen_image_vae.safetensors")}
TRAIN_JOBS: dict[str, dict] = {}


def _train_model(k: str) -> str:
    sub, name = TRAIN_FILES[k]
    return os.path.join(MODELS, sub, name)


def _train_missing() -> list[str]:
    out = [f"{TRAIN_FILES[k][1]}" for k in TRAIN_FILES if not os.path.isfile(_train_model(k))]
    if not os.path.isfile(os.path.join(MUSUBI, "src", "musubi_tuner", "krea2_train_network.py")): out.append("the trainer (musubi-tuner) — this image is older than the training update")
    return out


def _vram_mb() -> int:
    try:
        out = subprocess.run(["nvidia-smi", "--query-gpu=memory.total", "--format=csv,noheader,nounits"], capture_output=True, text=True, timeout=10).stdout.strip().splitlines()
        return int(float(out[0]))
    except Exception:  # noqa: BLE001
        return 0


async def _train_run(job: dict, cmd: list[str], step: str, cwd: str):
    """one stage of the run, its output parsed for progress (tqdm "12/1500 [..., avr_loss=0.1]") and kept for the log"""
    job["step"] = step
    env = {**os.environ, "PYTHONUNBUFFERED": "1", "PYTHONPATH": os.path.join(MUSUBI, "src")}
    p = await asyncio.create_subprocess_exec(*cmd, cwd=cwd, env=env, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT, start_new_session=True)
    job["pid"] = p.pid
    buf = b""
    while True:
        chunk = await p.stdout.read(4096)
        if not chunk: break
        buf += chunk
        parts = re.split(rb"[\r\n]", buf)
        buf = parts.pop()
        for raw in parts:
            line = raw.decode(errors="ignore").strip()
            if not line: continue
            m = re.search(r"(\d+)/(\d+) \[", line)
            if m and step == "training":
                job["done"], job["total"] = int(m.group(1)), int(m.group(2))
                lm = re.search(r"avr_loss=([\d.]+)", line)
                if lm: job["loss"] = float(lm.group(1))
                eta = re.search(r"<([\d:]+)", line)
                if eta: job["left"] = eta.group(1)
                continue
            job["log"] = (job.get("log", []) + [line[-300:]])[-80:]
    rc = await p.wait()
    job.pop("pid", None)
    if job.get("cancelled"): raise RuntimeError("cancelled")
    if rc != 0:
        tail = "\n".join(job.get("log", [])[-12:])
        raise RuntimeError(f"{step} stopped (exit {rc}):\n{tail}")


async def _train(job: dict, d: dict):
    try:
        miss = _train_missing()
        if miss: raise RuntimeError("Not on this rental yet: " + ", ".join(miss) + " — download “Character LoRA training” on the start page (Later → Download now)")
        name = re.sub(r"[^A-Za-z0-9_-]+", "_", str(d.get("name") or "character")).strip("_")[:40] or "character"
        work = os.path.join(TRAIN_DIR, job["id"]); img_dir = os.path.join(work, "images"); cache = os.path.join(work, "cache"); out = os.path.join(work, "out")
        for x in (img_dir, cache, out): os.makedirs(x, exist_ok=True)
        n = 0
        for it in d.get("items") or []:
            try: src = _file_of(it["file"])
            except Exception: continue  # noqa: BLE001
            if not os.path.isfile(src): continue
            n += 1
            ext = os.path.splitext(src)[1].lower() or ".png"
            shutil.copyfile(src, os.path.join(img_dir, f"{n:03d}{ext}"))
            with open(os.path.join(img_dir, f"{n:03d}.txt"), "w") as f: f.write(str(it.get("caption") or d.get("trigger") or "").strip())
        if n < 5: raise RuntimeError(f"only {n} pictures — keep at least 5 (15–40 is the usual range)")
        steps = max(200, min(6000, int(d.get("steps") or 1500)))
        rank = max(8, min(128, int(d.get("rank") or 32)))
        toml = os.path.join(work, "dataset.toml")
        with open(toml, "w") as f:
            f.write(f'[general]\nresolution = [1024, 1024]\ncaption_extension = ".txt"\nbatch_size = 1\nenable_bucket = true\nbucket_no_upscale = false\n\n'
                    f'[[datasets]]\nimage_directory = "{img_dir}"\ncache_directory = "{cache}"\nnum_repeats = 1\n')
        job.update(pictures=n, total=steps, done=0)
        # the GPU is all the trainer's: ComfyUI lets go of every model first
        try:
            async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=30)) as s:
                async with s.post(f"{COMFY}/free", json={"unload_models": True, "free_memory": True}) as r: await r.read()
        except Exception: pass  # noqa: BLE001
        sm = os.path.join(MUSUBI, "src", "musubi_tuner")
        await _train_run(job, [MUSUBI_PY, os.path.join(sm, "krea2_cache_latents.py"), "--dataset_config", toml, "--vae", _train_model("vae")], "reading the pictures", work)
        await _train_run(job, [MUSUBI_PY, os.path.join(sm, "krea2_cache_text_encoder_outputs.py"), "--dataset_config", toml, "--text_encoder", _train_model("te"), "--batch_size", "4"], "reading the captions", work)
        small = 0 < _vram_mb() < 30000
        cmd = [MUSUBI_PY, "-m", "accelerate.commands.launch", "--num_cpu_threads_per_process", "1", "--mixed_precision", "bf16", os.path.join(sm, "krea2_train_network.py"),
               "--dit", _train_model("dit"), "--vae", _train_model("vae"), "--dataset_config", toml, "--sdpa", "--mixed_precision", "bf16",
               "--fp8_base", "--fp8_scaled", "--gradient_checkpointing", *(["--blocks_to_swap", "10"] if small else []),
               "--timestep_sampling", "krea2_shift", "--weighting_scheme", "none",
               "--optimizer_type", "AdamW",  # plain AdamW: a LoRA's few weights need little memory, and bitsandbytes may not match CUDA 13 "--learning_rate", str(d.get("lr") or 1e-4),
               "--max_data_loader_n_workers", "2", "--persistent_data_loader_workers",
               "--network_module", "networks.lora_krea2", "--network_dim", str(rank), "--network_alpha", str(rank),
               "--max_train_steps", str(steps), "--save_every_n_steps", str(max(100, steps // 3)), "--seed", "42",
               "--output_dir", out, "--output_name", name]
        await _train_run(job, cmd, "training", MUSUBI)
        made = os.path.join(out, f"{name}.safetensors")
        if not os.path.isfile(made): raise RuntimeError("training finished but no LoRA file came out")
        dest_dir = os.path.join(LORAS, "uploaded"); os.makedirs(dest_dir, exist_ok=True)
        fn = f"{name}_krea2_{time.strftime('%m%d%H%M')}.safetensors"
        shutil.copyfile(made, os.path.join(dest_dir, fn))
        rel = f"uploaded/{fn}"
        reg = load_reg(); reg[rel] = {"uploaded": True, "title": f"{d.get('name') or name} (trained here)", "base": "Krea 2", "trigger": str(d.get("trigger") or ""), "role": "character",
                                      "tips": {"weight": 1.0}, "trained": {"steps": steps, "pictures": n, "rank": rank, "at": int(time.time())}}; save_reg(reg)
        job.update(lora=rel, step="backing up")
        if os.environ.get("RCLONE_REMOTE"):
            p = await asyncio.create_subprocess_exec("rclone", "copy", os.path.join(dest_dir, fn), f"{os.environ['RCLONE_REMOTE'].rstrip('/')}/_loras", stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL)
            if await p.wait() == 0:
                reg = load_reg(); reg.setdefault(rel, {})["backed_up"] = True; save_reg(reg); job["backed_up"] = True
        job.update(status="done", step="done")
        shutil.rmtree(cache, ignore_errors=True)
    except Exception as e:  # noqa: BLE001
        job.update(status="cancelled" if job.get("cancelled") else "error", error=str(e)[:1500])


async def train_start(req):
    """POST {char_id, name, trigger, items: [{file, caption}], steps, rank} → a training run (one at a time)"""
    if any(j["status"] == "running" for j in TRAIN_JOBS.values()): return web.json_response({"error": "A LoRA is already training — wait for it or cancel it"}, status=409)
    d = await req.json()
    jid = uuid.uuid4().hex[:10]
    TRAIN_JOBS[jid] = job = {"id": jid, "status": "running", "step": "starting", "done": 0, "total": 0, "char_id": d.get("char_id"), "started": time.time()}
    asyncio.create_task(_train(job, d))
    return web.json_response({"id": jid})


async def train_status(req):
    if req.match_info.get("id") == "ready":  # what's missing before training can start
        return web.json_response({"missing": _train_missing(), "vram_mb": _vram_mb()})
    j = TRAIN_JOBS.get(req.match_info["id"])
    if not j: raise web.HTTPNotFound(text="no such training run")
    return web.json_response({k: v for k, v in j.items() if k != "pid"})


async def train_cancel(req):
    j = TRAIN_JOBS.get(req.match_info["id"])
    if not j: raise web.HTTPNotFound(text="no such training run")
    j["cancelled"] = True
    if j.get("pid"):
        import signal
        try: os.killpg(j["pid"], signal.SIGTERM)
        except OSError: pass
    return web.json_response({"ok": True})


_RESULT_ROOTS = {"output": OUTPUT, "input": INPUT}


def _export_results(z, files: bool = True):
    """your results (the Create / Edit / Animate feed) and the pictures your tabs are using, so a restore looks the same.
    files=False: only the list (jobs.json) — the files travel another way (Proton Drive's results folder)"""
    import zipfile
    jobs = _state_json("jobs", []) or []
    z.writestr("jobs.json", json.dumps(jobs))
    seen = set()
    def add(kind: str, sub: str, fn: str):
        if not files and kind != "input": return
        if kind not in _RESULT_ROOTS or not fn or (kind, sub, fn) in seen: return
        seen.add((kind, sub, fn))
        try: f = safe_join(_RESULT_ROOTS[kind], sub or "", fn)
        except web.HTTPException: return
        if os.path.isfile(f): z.write(f, f"results/{kind}/{sub + '/' if sub else ''}{fn}", compress_type=zipfile.ZIP_STORED)
    for j in jobs if isinstance(jobs, list) else []:
        for o in (j.get("outputs") or []) if isinstance(j, dict) else []:
            if isinstance(o, dict): add(str(o.get("type") or ""), str(o.get("subfolder") or ""), str(o.get("filename") or ""))
    # pictures named in your tab settings (Edit / Animate / Prompt inputs) — anything that is a file in the input folder
    def walk(v):
        if isinstance(v, dict): [walk(x) for x in v.values()]
        elif isinstance(v, list): [walk(x) for x in v]
        elif isinstance(v, str) and 3 < len(v) < 200 and "/" not in v and os.path.isfile(os.path.join(INPUT, v)): add("input", "", v)
    walk(_state_json("settings", {}))
    walk(_state_json("edit_chats", {}))  # the pictures your edit chats use


def _merge_list(have: list, incoming: list, key: str = "id") -> int:
    """add / update items by id (new ones go first, in their order); returns how many came in"""
    fresh, n = [], 0
    for x in incoming:
        if not isinstance(x, dict) or not x.get(key): continue
        n += 1
        i = next((j for j, y in enumerate(have) if isinstance(y, dict) and y.get(key) == x[key]), None)
        if i is None: fresh.append(x)
        else: have[i] = x
    have[:0] = fresh
    return n


def _import_extras(z, refused_ids: set | None = None, tick=None) -> dict:
    """scenes, presets, prompt files and preferences from a project .zip (scenes of refused characters stay out)"""
    names = set(z.namelist())
    got = {}
    def rd(n):
        try: return json.loads(z.read(n))
        except (KeyError, ValueError): return None
    sc = rd("scenes.json") if "scenes.json" in names else None
    if isinstance(sc, list) and refused_ids:
        sc = [x for x in sc if isinstance(x, dict) and not (set(x.get("cast") or []) & refused_ids)]
    if isinstance(sc, list) and sc:
        have = _state_json("scenes", []) or []
        got["scenes"] = _merge_list(have, sc); _state_write("scenes", have)
    for name in ("presets", "scene_presets", "lora_sets", "my_recipes", "favorites", "styles"):
        d = rd(f"{name}.json") if f"{name}.json" in names else None
        if d is None: continue
        cur = _state_json(name)
        if isinstance(d, list): merged = cur if isinstance(cur, list) else []; _merge_list(merged, d) if all(isinstance(x, dict) and x.get("id") for x in d) else merged.extend(x for x in d if x not in merged)
        elif isinstance(d, dict):  # e.g. presets: {section: {name: values}} — merge inside each section, keep yours
            cur = cur if isinstance(cur, dict) else {}
            merged = {**cur, **{k: ({**cur[k], **v} if isinstance(v, dict) and isinstance(cur.get(k), dict) else v) for k, v in d.items()}}
        else: continue
        _state_write(name, merged); got[name] = True
    cm = rd("catalog_meta.json") if "catalog_meta.json" in names else None
    if isinstance(cm, dict) and cm:  # what each result was made from: yours stay, theirs are added
        cur = _state_json("catalog_meta", {}) or {}
        _state_write("catalog_meta", {**cm, **(cur if isinstance(cur, dict) else {})}); got["catalog"] = True
    ins = rd("input_sources.json") if "input_sources.json" in names else None
    if isinstance(ins, dict) and ins:  # where earlier rentals' input copies came from (to make them again when needed)
        cur = _state_json("input_sources", {}) or {}
        _state_write("input_sources", {**ins, **(cur if isinstance(cur, dict) else {})})
    for name in ("timings", "notify", "site_addr"):  # (download "Later" is per rental: it doesn't travel in exports)
        d = rd(f"{name}.json") if f"{name}.json" in names else None
        if d is not None: _state_write(name, d); got[name] = True
    ec = rd("edit_chats.json") if "edit_chats.json" in names else None
    if isinstance(ec, dict) and isinstance(ec.get("chats"), list):  # edit chats: yours stay, theirs are added
        cur = _state_json("edit_chats", {}) or {}
        cur = cur if isinstance(cur, dict) else {}
        have = cur.get("chats") if isinstance(cur.get("chats"), list) else []
        known = {c.get("id") for c in have if isinstance(c, dict)}
        add = [c for c in ec["chats"] if isinstance(c, dict) and c.get("id") not in known]
        if add: _state_write("edit_chats", {**ec, **cur, "chats": have + add}); got["edit_chats"] = len(add)
    pf = rd("prefs.json") if "prefs.json" in names else None
    if isinstance(pf, dict) and pf:  # where you were: each project's Create box, references, selected character, chats…
        cur = _state_json("prefs", {}) or {}
        cur = cur if isinstance(cur, dict) else {}
        now = time.time() * 1000
        # stamped "now" so the browser takes them over what it had (a fresh rental has nothing worth keeping)
        _state_write("prefs", {**cur, **{k: [v[0], now] for k, v in pf.items() if isinstance(v, list) and len(v) == 2}}); got["prefs"] = True
    for name in ("loras", "models"):  # your LoRA library / own checkpoints: merged, then the missing files download
        d = rd(f"{name}.json") if f"{name}.json" in names else None
        if not isinstance(d, dict): continue
        cur = _state_json(name, {}) or {}
        cur = cur if isinstance(cur, dict) else {}
        new = {k: v for k, v in d.items() if isinstance(v, dict) and k not in cur}
        if new:
            _state_write(name, {**cur, **new}); got[name] = len(new)
            if name == "loras": _fetch_missing_loras(new)
            else: _fetch_missing_models(new)
    jb = rd("jobs.json") if "jobs.json" in names else None
    if isinstance(jb, list) and jb:
        have = _state_json("jobs", []) or []
        known = {x.get("id") for x in have if isinstance(x, dict)}
        new = [x for x in jb if isinstance(x, dict) and x.get("id") and x["id"] not in known and x.get("status") in ("done", "error", "cancelled")]
        if new:
            _state_write("jobs", sorted(have + new, key=lambda x: -(x.get("queuedAt") or 0))[:1200]); got["results"] = len(new)
    for info in z.infolist():  # result files
        parts = info.filename.split("/")
        if len(parts) >= 3 and parts[0] == "results" and not info.is_dir() and tick: tick()
        if len(parts) >= 3 and parts[0] == "results" and parts[1] in _RESULT_ROOTS and not info.is_dir():
            try: dest = safe_join(_RESULT_ROOTS[parts[1]], *parts[2:])
            except web.HTTPException: continue
            if os.path.exists(dest): continue  # already here (never written over)
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            with z.open(info) as src, open(dest, "wb") as f: shutil.copyfileobj(src, f, 1 << 20)
    st = rd("settings.json") if "settings.json" in names else None
    if isinstance(st, dict): _state_write("settings", st); got["settings"] = True
    pk = rd("packs.json") if "packs.json" in names else None
    if isinstance(pk, dict) and isinstance(pk.get("packs"), list):
        d = _load_packs()
        os.makedirs(PACKS_DIR, exist_ok=True)
        for p_ in pk["packs"]:
            pid = str(p_.get("id") or "")
            if not PACK_ID.match(pid) or f"packs/{pid}.txt" not in names: continue
            with open(os.path.join(PACKS_DIR, pid + ".txt"), "wb") as f: f.write(z.read(f"packs/{pid}.txt"))
        n = _merge_list(d["packs"], [p_ for p_ in pk["packs"] if PACK_ID.match(str(p_.get("id") or ""))])
        if "settings.json" in names and isinstance(pk.get("active"), dict):  # a full restore: your chosen prompt files too
            d["active"].update({k: v for k, v in pk["active"].items() if k in STAGES})
        _save_packs(d); got["packs"] = n
        try: materialize_packs()
        except Exception as e:  # noqa: BLE001
            print("!! prompt packs:", e, flush=True)
    return got


def _fetch_missing_models(reg: dict):
    """your own checkpoints from an imported checkpoint: downloaded again in the background"""
    for rel, info in reg.items():
        vid = info.get("version_id")
        if not vid or os.path.isfile(os.path.join(MODELS, info.get("folder", "diffusion_models"), rel)): continue
        jid = uuid.uuid4().hex[:10]
        LORA_JOBS[jid] = job = {"id": jid, "status": "running", "progress": 0.0, "from_import": True}
        _spawn(lora_job(job, f"https://civitai.com/api/download/models/{vid}"))


_FETCHING: set = set()


def _fetch_missing_loras(reg: dict):
    """LoRAs from an imported checkpoint that aren't on this rental yet: download them in the background"""
    for rel, info in reg.items():
        if os.path.isfile(os.path.join(LORAS, rel)) or rel in _FETCHING: continue
        _FETCHING.add(rel)
        vid = info.get("version_id")
        url = info.get("url") or (f"https://civitai.com/api/download/models/{vid}" if vid else "")
        if not url: continue
        jid = uuid.uuid4().hex[:10]
        LORA_JOBS[jid] = job = {"id": jid, "status": "running", "progress": 0.0, "from_import": True}
        _spawn(lora_job(job, url))


def _import_zip(z, progress=None) -> dict:
    """a .zip from Export: characters (newer copies win), their pictures, and everything else it carries"""
    try: data = json.loads(z.read("characters.json"))
    except (KeyError, ValueError): raise ValueError("That isn't a characters file from Export (a .zip with characters.json inside)")
    incoming = data.get("characters") if isinstance(data, dict) else data
    if not isinstance(incoming, list): raise ValueError("No characters in that file")
    try: have = json.load(open(CHAR_FILE))
    except (OSError, ValueError): have = []
    files = [i for i in z.infolist() if not i.is_dir() and i.filename.split("/")[0] in ("pictures", "results")]
    done = [0]
    def tick(n=1):
        done[0] += n
        if progress: progress(done[0], len(files))
    tick(0)
    by_char: dict = {}
    for info in files:
        parts = info.filename.split("/")
        if len(parts) == 3 and parts[0] == "pictures": by_char.setdefault(parts[1], []).append(info)
    added = updated = kept_newer = 0; refused = []; refused_ids: set = set(); aged = []
    for c in incoming:
        if not isinstance(c, dict) or not KEPT_PATH_OK.match(str(c.get("id") or "")): continue
        cid = str(c["id"])
        pics = by_char.get(cid, [])
        if _no_age(c):  # no age set: an adult by default (an age under 18 is still refused below)
            c["age"] = DEFAULT_AGE; aged.append(c.get("name") or cid)
        if not _adult(c):
            refused.append(c.get("name") or cid); refused_ids.add(cid); tick(len(pics)); continue
        i = next((j for j, x in enumerate(have) if isinstance(x, dict) and str(x.get("id")) == cid), None)
        # an older copy (an export from before your latest changes) never replaces the newer one you have
        if i is not None and (c.get("updatedAt") or 0) < (have[i].get("updatedAt") or 0):
            kept_newer += 1; tick(len(pics)); continue
        for info in pics:  # its pictures (the same file already here is skipped)
            name = info.filename.split("/")[2]
            if KEPT_PATH_OK.match(name):
                dest = safe_join(KEPT, "characters", cid, name)
                if not (os.path.isfile(dest) and os.path.getsize(dest) == info.file_size):
                    os.makedirs(os.path.dirname(dest), exist_ok=True)
                    with z.open(info) as src, open(dest, "wb") as f: shutil.copyfileobj(src, f, 1 << 20)
            tick()
        if i is not None: have[i] = c; updated += 1
        else: have.insert(0, c); added += 1
    with open(CHAR_FILE + ".tmp", "w") as f: json.dump(have, f)
    os.replace(CHAR_FILE + ".tmp", CHAR_FILE)
    extras = _import_extras(z, refused_ids, tick)
    if progress: progress(len(files), len(files))
    return {"ok": True, "added": added, "updated": updated, "kept_newer": kept_newer, "refused": refused, "aged": aged, "extras": extras}


async def characters_import(req):
    """a .zip from Export in one request (small files; the Studio sends big ones in pieces — see /studio-api/import/*)"""
    import io, zipfile
    body = await req.read()
    try:
        return web.json_response(_import_zip(zipfile.ZipFile(io.BytesIO(body))))
    except zipfile.BadZipFile:
        return web.json_response({"error": "That isn't a .zip file (or it didn't arrive whole)"}, status=400)
    except ValueError as e:
        return web.json_response({"error": str(e)}, status=400)


# ------------------------------------------------------------------ import in pieces, with progress
# The browser sends the file in pieces (several at once) — Cloudflare's secure link refuses one upload over 100 MB, and the
# pieces go faster — then the rental unpacks it from disk in the background while the browser shows the progress.
IMPORTS: dict = {}
IMPORT_DIR = os.path.join(WORK, "h3-imports")
MAIN_LOOP: list = []


def _spawn(coro):
    """start a background task from the server's loop — or, from an import running in a worker thread, hand it to that loop"""
    try:
        return asyncio.get_running_loop().create_task(coro)
    except RuntimeError:
        return asyncio.run_coroutine_threadsafe(coro, MAIN_LOOP[0])


async def import_start(req):
    d = await req.json()
    size = int(d.get("size") or 0)
    if size <= 0: return web.json_response({"error": "Empty file"}, status=400)
    os.makedirs(IMPORT_DIR, exist_ok=True)
    free = shutil.disk_usage(IMPORT_DIR).free
    if size * 2.2 > free:  # the .zip plus what comes out of it
        return web.json_response({"error": f"Not enough disk on this rental: the file needs about {size * 2.2 / 2**30:.1f} GB, {free / 2**30:.1f} GB is free"}, status=507)
    for k, v in list(IMPORTS.items()):  # tidy old ones
        if time.time() - v["at"] > 6 * 3600:
            try: os.remove(v["path"])
            except OSError: pass
            IMPORTS.pop(k, None)
    iid = uuid.uuid4().hex[:12]
    path = os.path.join(IMPORT_DIR, iid + ".zip")
    with open(path, "wb") as f: f.truncate(size)
    IMPORTS[iid] = {"path": path, "size": size, "got": 0, "state": "uploading", "done": 0, "total": 0, "name": str(d.get("name") or "")[:120], "at": time.time()}
    return web.json_response({"id": iid, "chunk": 16 * 1024 * 1024})


async def import_chunk(req):
    it = IMPORTS.get(req.match_info["id"])
    if not it or it["state"] != "uploading": raise web.HTTPNotFound()
    off = int(req.query.get("offset") or -1)
    if off < 0 or off >= it["size"]: raise web.HTTPBadRequest()
    body = await req.read()
    if off + len(body) > it["size"]: raise web.HTTPBadRequest()
    def write():
        with open(it["path"], "r+b") as f: f.seek(off); f.write(body)
    await asyncio.to_thread(write)
    it["got"] += len(body); it["at"] = time.time()
    return web.json_response({"ok": True})


async def import_finish(req):
    it = IMPORTS.get(req.match_info["id"])
    if not it: raise web.HTTPNotFound()
    if it["state"] == "uploading":
        it["state"] = "unpacking"
        MAIN_LOOP[:] = [asyncio.get_running_loop()]
        asyncio.get_running_loop().run_in_executor(None, _import_run, it)
    return web.json_response({"ok": True})


def _import_run(it):
    import zipfile
    def progress(done, total): it.update(done=done, total=total)
    try:
        with zipfile.ZipFile(it["path"]) as z: it["result"] = _import_zip(z, progress)
        it["state"] = "done"
    except zipfile.BadZipFile:
        it.update(state="error", error="That isn't a .zip file (or it didn't arrive whole — try again)")
    except Exception as e:  # noqa: BLE001
        it.update(state="error", error=str(e)[:400])
    finally:
        try: os.remove(it["path"])
        except OSError: pass


async def import_status(req):
    it = IMPORTS.get(req.match_info["id"])
    if not it: raise web.HTTPNotFound()
    return web.json_response({**{k: it.get(k) for k in ("state", "size", "got", "done", "total", "result", "error", "name", "source", "results")}, "cloud": _cloud()})


async def import_latest(req):
    """the import running (or just finished) on this rental — the startup screen and the Studio both show it"""
    if not IMPORTS: return web.json_response(None)
    iid, it = max(IMPORTS.items(), key=lambda kv: kv[1]["at"])
    return web.json_response({"id": iid, **{k: it.get(k) for k in ("state", "size", "got", "done", "total", "result", "error", "name", "source", "results")}, "cloud": _cloud()})


# ------------------------------------------------------------------ download switches ("later" / "Download now")
LATER_FILE = os.path.join(STATE, "download_later.json")
H3_RUN = os.environ.get("H3_RUN", "/opt/h3/run")
# groups that only work with another one in (Krea 2 RAW uses the Krea 2 text encoder and VAE)
NEEDS = {"kedit": ["image"], "kedit2": ["image"], "eros": ["video"]}


async def downloads_later(req):
    """{group, later: bool} — leave a model group out of this rental's download (and the next ones'), or fetch it now.
    {group, next: true} — fetch it now AND move it to the front of the queue (right after the first group)."""
    d = await req.json()
    gid, later, nxt_req = str(d.get("group") or ""), bool(d.get("later")), bool(d.get("next"))
    if nxt_req: later = False
    try:
        groups = json.load(open(os.path.join(H3_RUN, "downloads.json"))).get("groups") or []
    except (OSError, ValueError):
        groups = []
    ids = [g["id"] for g in groups]
    if gid not in ids:
        return web.json_response({"error": "No such download group"}, status=404)
    if ids and gid == ids[0]:
        return web.json_response({"error": "The first group opens the Studio, so it always downloads"}, status=400)
    try:
        cur = json.load(open(LATER_FILE))
    except (OSError, ValueError):
        cur = {}
    lat, now = set(cur.get("later") or []), set(cur.get("now") or [])
    nxt = [x for x in (cur.get("next") or []) if x in ids]
    touched = {gid}
    if later:  # anything that needs this group goes too
        touched |= {k for k, v in NEEDS.items() if gid in v and k in ids}
    else:      # and anything this group needs comes along
        touched |= {x for x in NEEDS.get(gid, []) if x in ids}
    for x in touched:
        (lat.add if later else lat.discard)(x); (now.discard if later else now.add)(x)
    if later:
        nxt = [x for x in nxt if x not in touched]
    elif nxt_req:  # what it needs goes first (Krea 2 before Krea 2 RAW), then the group itself
        front = [x for x in NEEDS.get(gid, []) if x in ids] + [gid]
        nxt = front + [x for x in nxt if x not in front]
    os.makedirs(STATE, exist_ok=True)
    tmp = LATER_FILE + ".tmp"
    with open(tmp, "w") as f:
        json.dump({"later": sorted(lat), "now": sorted(now), "next": nxt}, f)
    os.replace(tmp, LATER_FILE)
    # the downloader picks the change up within a few seconds; if it isn't running any more, start it again
    alive = False
    try:
        pid = int(open(os.path.join(H3_RUN, "downloader.pid")).read().strip())
        os.kill(pid, 0); alive = True
    except (OSError, ValueError):
        pass
    if not later and not alive and os.path.exists("/opt/h3/downloader.py"):
        env = {**os.environ, "COMFY_DIR": COMFY_DIR, "H3_RUN": H3_RUN, "SPEED_CHECK_SECONDS": "999999"}
        subprocess.Popen(["python", "/opt/h3/downloader.py", "/opt/h3/models.txt"], env=env, start_new_session=True,
                         stdout=open("/var/log/downloader.log", "a"), stderr=subprocess.STDOUT)
    return web.json_response({"ok": True, "changed": sorted(touched), "later": later, "next": nxt})


# ------------------------------------------------------------------ voice: speech → text on this rental (Whisper)
WHISPER_ID = os.environ.get("STUDIO_WHISPER", "openai/whisper-large-v3-turbo")
WHISPER = {"pipe": None, "used": 0.0, "lock": None}


def _whisper_load():
    import torch  # noqa: PLC0415 — only when someone actually talks
    from transformers import pipeline  # noqa: PLC0415
    from huggingface_hub import snapshot_download  # noqa: PLC0415
    tok = next((k for k in re.split(r"[\s,;]+", f"{os.environ.get('HF_TOKENS', '')},{os.environ.get('HF_TOKEN', '')}") if k.startswith("hf_")), None)  # sent to huggingface.co only
    path = snapshot_download(WHISPER_ID, cache_dir=os.path.join(MODELS, "whisper"), token=tok,
                             allow_patterns=["*.json", "*.safetensors", "*.txt", "*.model", "*.tiktoken"])
    cuda = torch.cuda.is_available()
    return pipeline("automatic-speech-recognition", model=path, torch_dtype=torch.float16 if cuda else torch.float32, device="cuda:0" if cuda else "cpu")


def _whisper_run(audio: bytes, lang: str | None) -> str:
    if WHISPER["pipe"] is None: WHISPER["pipe"] = _whisper_load()
    WHISPER["used"] = time.time()
    kw = {"generate_kwargs": {"task": "transcribe", **({"language": lang} if lang else {})}, "chunk_length_s": 30, "batch_size": 4}
    out = WHISPER["pipe"](audio, **kw)
    return str((out.get("text") if isinstance(out, dict) else out) or "").strip()


async def _whisper_idle():
    """give the GPU memory back after 5 quiet minutes"""
    while True:
        await asyncio.sleep(60)
        if WHISPER["pipe"] is not None and time.time() - WHISPER["used"] > 300:
            WHISPER["pipe"] = None
            try:
                import gc, torch  # noqa: PLC0415, E401
                gc.collect(); torch.cuda.empty_cache()
            except Exception:  # noqa: BLE001
                pass


async def transcribe(req):
    """POST the recorded audio (webm/ogg/wav…) → {"text": …}. First use downloads Whisper (~1.6 GB)."""
    audio = await req.read()
    if len(audio) < 800: return web.json_response({"error": "Didn't catch anything — hold the mic a bit longer"}, status=400)
    if len(audio) > 40 * 1024 * 1024: return web.json_response({"error": "That recording is too long (max ~10 minutes)"}, status=413)
    if WHISPER["lock"] is None: WHISPER["lock"] = asyncio.Lock()
    async with WHISPER["lock"]:
        try:
            text = await asyncio.get_running_loop().run_in_executor(None, _whisper_run, audio, req.query.get("lang") or None)
        except Exception as e:  # noqa: BLE001
            return web.json_response({"error": f"Speech to text failed: {type(e).__name__}: {str(e)[:200]}"}, status=500)
    return web.json_response({"text": text})


# ------------------------------------------------------------------ your site: send finished characters as drafts
# The "Character factory -> site" API (see the integration spec): PUT the character, upload each file through a
# pre-signed slot, attach avatar / cover / reference pictures, PUT each photo set. Everything lands as a draft. The key
# comes from the template (SITE_FACTORY_TOKEN) or is pasted into the Studio (kept like the CivitAI key, never exported).
SITE_KEY_FILE = os.path.join(STATE, "site_key")
SITE_MEDIA = "site_media"  # state: {file fingerprint: media_id} — a file already uploaded isn't uploaded again
SITE_JOBS: dict[str, dict] = {}


def site_cfg() -> dict:
    saved = {}
    try:
        with open(SITE_KEY_FILE) as f: saved = json.load(f)
    except (OSError, ValueError):
        pass
    # the address isn't written in the code: the template (SITE_FACTORY_URL), or the one you saved in the Studio — kept
    # with your settings (state "site_addr", travels in exports/backups, unlike the key)
    addr = _state_json("site_addr", {}) or {}
    url = (os.environ.get("SITE_FACTORY_URL") or saved.get("url") or (addr.get("url") if isinstance(addr, dict) else "") or "").rstrip("/")
    key = os.environ.get("SITE_FACTORY_TOKEN") or saved.get("key") or ""
    return {"url": url, "key": key, "source": "template" if os.environ.get("SITE_FACTORY_TOKEN") else ("studio" if saved.get("key") else None)}


async def site_config(req):
    if req.method == "GET":
        c = site_cfg()
        return web.json_response({"url": c["url"], "set": bool(c["key"]), "source": c["source"]})
    if req.method == "DELETE":
        if os.path.exists(SITE_KEY_FILE): os.remove(SITE_KEY_FILE)
        return web.json_response({"ok": True})
    d = await req.json()
    cur = {}
    try:
        with open(SITE_KEY_FILE) as f: cur = json.load(f)
    except (OSError, ValueError):
        pass
    if d.get("url"):
        if not re.match(r"^(https://[\w.-]+|http://(127\.0\.0\.1|localhost):\d+)(/[\w./-]*)?$", str(d["url"]).strip()): raise web.HTTPBadRequest(text="The address must start with https://")
        cur["url"] = str(d["url"]).strip().rstrip("/")
        os.makedirs(STATE, exist_ok=True)
        _state_write("site_addr", {"url": cur["url"]}); set_last_change()
    if d.get("key"):
        k = str(d["key"]).strip()
        if not re.fullmatch(r"[\w.-]{16,200}", k): raise web.HTTPBadRequest(text="That doesn't look like an API key")
        cur["key"] = k
    os.makedirs(STATE, exist_ok=True)
    fd = os.open(SITE_KEY_FILE, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f: json.dump(cur, f)
    return web.json_response({"ok": True})


async def _site_call(s, method: str, path: str, body=None) -> tuple[int, object]:
    c = site_cfg()
    if not c["key"]: raise RuntimeError("No site key yet — add it under ⋯ → Your site")
    if not c["url"]: raise RuntimeError("No site address yet — paste your site's API address under ⋯ → Your site")
    url = c["url"] + path
    for attempt in range(3):
        try:
            async with s.request(method, url, json=body, headers={"Authorization": f"Bearer {c['key']}", "Accept": "application/json"}) as r:
                txt = await r.text()
                try: data = json.loads(txt) if txt else None
                except ValueError: data = txt[:500]
                if r.status in (429, 502, 503, 504) and attempt < 2:
                    await asyncio.sleep(2 * (attempt + 1)); continue
                return r.status, data
        except aiohttp.ClientError as e:
            if attempt == 2: raise RuntimeError(f"Couldn't reach the site: {e}") from None
            await asyncio.sleep(2)
    return 0, None


async def site_test(req):
    """what the site answers: the API root and a character that doesn't exist — so the report shows the real shapes"""
    out = {"url": site_cfg()["url"]}
    async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=30)) as s:
        # one character you already sent, as the site stores it: shows every field the site has (to fill more of them)
        sent_id = None
        try:
            for c in json.load(open(CHAR_FILE)):
                if isinstance(c, dict) and ((c.get("site") or {}).get("sent") or {}).get("ok"): sent_id = c.get("id"); break
        except (OSError, ValueError):
            pass
        probes = [("root", ""), ("character", "/characters/h3-connection-test")] + ([("sent_character", f"/characters/{quote('h3-' + sent_id)}")] if sent_id else [])
        for label, path in probes:
            try:
                st, data = await _site_call(s, "GET", path)
                out[label] = {"status": st, "body": data if isinstance(data, (dict, list)) and len(json.dumps(data)) < (20000 if label == "sent_character" else 3000) else str(data)[:600]}
            except RuntimeError as e:
                out[label] = {"error": str(e)}
        # the upload path, end to end, with a REAL picture (a character's front picture, the way a send prepares it):
        # the slot, then the file to the link it hands out, timed — a tiny test file would pass no matter what
        up: dict = {}
        try:
            front = None
            try:
                for c in json.load(open(CHAR_FILE)):
                    ref = (c.get("views") or {}).get("front") if isinstance(c, dict) else None
                    if isinstance(ref, dict) and ref.get("filename") and os.path.isfile(_file_of(ref)):
                        front = _file_of(ref)
                        if c.get("id") == req.query.get("char"): break
            except (OSError, ValueError):
                pass
            if not front: raise RuntimeError("no character with a front picture to test with")
            body, ct, name = await asyncio.to_thread(_site_ready_file, front)
            up["file"] = f"{os.path.basename(front)} ({os.path.getsize(front) // 1024} KB) sent as {name} ({len(body) // 1024} KB)"
            t0 = time.time()
            mid, host = await _site_send_one(s, body, ct, name)
            up.update(link_host=host, put={"status": 200}, seconds=round(time.time() - t0, 1), media_id=mid)
        except RuntimeError as e:
            up["error"] = str(e)
        out["upload"] = up
    ok = any(isinstance(v, dict) and v.get("status") in (200, 204, 404) for k, v in out.items() if k != "upload")
    out["ok"] = ok
    return web.json_response(out)


def _file_of(ref: dict) -> str:
    return safe_join(folder(ref.get("type", "output")), ref.get("subfolder", ""), ref["filename"])


SITE_UPLOAD_SECS = 50  # the site cuts any upload still sending after about a minute
SITE_UPLOAD_PARALLEL = 3  # a few files at a time, not all at once
SITE_MAX_SIDE = 2048


def _site_ready_file(path: str) -> tuple[bytes, str, str]:
    """a picture as the site wants it: JPEG at quality 90 (WebP when it has see-through parts), at most 2048 px on its long
    side — a fraction of a big PNG, so it's sent well inside the site's time limit. Videos and anything else go as they are."""
    import io, mimetypes
    name = os.path.basename(path)
    ct = mimetypes.guess_type(path)[0] or "application/octet-stream"
    if not ct.startswith("image/") or ct == "image/gif":
        with open(path, "rb") as f: return f.read(), ct, name
    from PIL import Image
    with Image.open(path) as im:
        im.load()
        if max(im.size) > SITE_MAX_SIDE:
            k = SITE_MAX_SIDE / max(im.size)
            im = im.resize((round(im.width * k), round(im.height * k)), Image.LANCZOS)
        clear = im.mode in ("RGBA", "LA") or (im.mode == "P" and "transparency" in im.info)
        if clear and im.convert("RGBA").getextrema()[3][0] < 255:
            buf = io.BytesIO(); im.convert("RGBA").save(buf, "WEBP", quality=90, method=4)
            return buf.getvalue(), "image/webp", os.path.splitext(name)[0] + ".webp"
        buf = io.BytesIO(); im.convert("RGB").save(buf, "JPEG", quality=90, optimize=True, progressive=True)
        return buf.getvalue(), "image/jpeg", os.path.splitext(name)[0] + ".jpg"


async def _site_send_one(s, body: bytes, ct: str, name: str) -> tuple[str, str]:
    """one file: ask for an upload slot, send the file to its link with the method and headers the slot names (under the
    site's time limit), then confirm it. A failure gets a NEW slot — the old link is never retried. Returns (media_id, host).
    The slot: {media_id, upload_url, upload_method, upload_headers, confirm: "PUT /api/factory/uploads/<id>", expires_at};
    the storage answers {"storageId": ...}, which the confirm call needs (422 without it)."""
    last, timed_out = "", False
    for attempt in range(3):
        code, slot = await _site_call(s, "POST", "/uploads", {"filename": name, "content_type": ct, "size": len(body)})
        if code not in (200, 201) or not isinstance(slot, dict):
            last = f"upload slot refused ({code}): {_site_err(slot)}"
            if code in (429, 500, 502, 503, 504): await asyncio.sleep(3 * (attempt + 1)); continue
            raise RuntimeError(last)
        put = slot.get("upload_url") or slot.get("url") or slot.get("put_url") or slot.get("uploadUrl")
        mid = slot.get("media_id") or slot.get("mediaId") or slot.get("id")
        if not put or not mid: raise RuntimeError(f"upload slot without a link or media_id: {str(slot)[:300]}")
        host = urlparse(put).netloc or put[:60]
        method = str(slot.get("upload_method") or "PUT").upper()
        extra = slot.get("upload_headers") if isinstance(slot.get("upload_headers"), dict) else slot.get("headers") if isinstance(slot.get("headers"), dict) else {}
        headers = {"Content-Type": ct, "Content-Length": str(len(body)), **{k: str(v) for k, v in extra.items()}}
        try:
            async with s.request(method, put, data=body, headers=headers, timeout=aiohttp.ClientTimeout(total=SITE_UPLOAD_SECS)) as r:
                txt = await r.text()
                if r.status in (200, 201, 204):
                    try: up = json.loads(txt) if txt else {}
                    except ValueError: up = {}
                    sid = (up.get("storageId") or up.get("storage_id")) if isinstance(up, dict) else None
                    conf = str(slot.get("confirm") or "").strip()
                    if conf:  # "PUT /api/factory/uploads/<id>" — _site_call already adds the factory's base path
                        cm, _, cpath = conf.partition(" ")
                        base = urlparse(site_cfg()["url"]).path.rstrip("/")
                        if base and cpath.startswith(base): cpath = cpath[len(base):]
                        ccode, cres = await _site_call(s, cm.upper() or "PUT", cpath or f"/uploads/{mid}", {"media_id": mid, **({"storage_id": sid} if sid else {})})
                        if ccode not in (200, 201, 204): raise RuntimeError(f"the site didn't confirm {name} ({ccode}): {_site_err(cres)}")
                    elif slot.get("complete_url"):  # the older protocol
                        await _site_call(s, "POST", str(slot["complete_url"]).replace(site_cfg()["url"], ""), {"media_id": mid})
                    return str(mid), host
                last = f"upload of {name} ({len(body) // 1024} KB) to {host} failed ({r.status}, {method}): {txt[:200]}"
                timed_out = False
                if r.status not in (408, 429, 500, 502, 503, 504): break
        except (aiohttp.ClientError, asyncio.TimeoutError) as e:
            timed_out = isinstance(e, asyncio.TimeoutError) or "timeout" in type(e).__name__.lower()
            last = f"upload of {name} ({len(body) // 1024} KB) to {host} didn't finish within {SITE_UPLOAD_SECS} s: {type(e).__name__} {e}"[:300]
        await asyncio.sleep(2 * (attempt + 1))
    raise RuntimeError(last + (" — the site cuts uploads that take longer than about a minute; a slow connection on this rental, or the site's side" if timed_out else ""))


# the site's API breaks (500) on curly quotes and dashes in text, so every string sent is made plain first
_PLAIN = str.maketrans({"\u2018": "'", "\u2019": "'", "\u201a": "'", "\u201b": "'", "\u2032": "'", "\u201c": '"', "\u201d": '"', "\u201e": '"',
                        "\u201f": '"', "\u2033": '"', "\u2013": "-", "\u2014": " - ", "\u2026": "...", "\u00a0": " ", "\u202f": " "})


def _plain(v):
    if isinstance(v, str): return re.sub(r"[ \u00a0]*\u2014[ \u00a0]*", " - ", v).translate(_PLAIN)
    if isinstance(v, list): return [_plain(x) for x in v]
    if isinstance(v, dict): return {k: _plain(x) for k, x in v.items()}
    return v


def _site_err(res) -> str:
    """the site's error in words: {"error": {"code", "message", "problems": [{field, message}]}} → "field: message · …" """
    if isinstance(res, dict):
        e = res.get("error", res)
        if isinstance(e, dict):
            probs = e.get("problems") or e.get("details") or e.get("errors")
            if isinstance(probs, list) and probs:
                return " · ".join(f"{p.get('field') or p.get('path') or '?'}: {p.get('message') or p.get('msg') or p}" if isinstance(p, dict) else str(p) for p in probs)[:1400]
            msg = e.get("message") or e.get("code")
            if msg: return str(msg)[:600]
        elif isinstance(e, str): return e[:600]
    return str(res)[:600]


def _site_problems(c: dict, site: dict) -> list[str]:
    """what the site will refuse (it answers 422), checked before anything is uploaded"""
    out = []
    name = str(c.get("name") or "")
    if not name.strip(): out.append("the name is empty")
    if re.search(r"\d", name): out.append(f"the name “{name}” has numbers in it — the site refuses names with numbers")
    if re.search(r"\b(teen|teenage|kid|child|girl ?child|loli|minor|young|underage|year[- ]?old|\d+ ?y/?o)\b", name, re.I): out.append(f"the name “{name}” sounds like an age or a minor")
    if c.get("gender") != "female": out.append("the site takes female characters only (male characters go on urbf.ai)")
    if c.get("style") not in ("realistic", "anime"): out.append("style must be realistic or anime")
    ageword = re.compile(r"\b\d{2}\s*-?\s*(year|yr)s?[- ]?old\b|\baged? \d{2}\b|\b\d{2} ?y/?o\b", re.I)
    for k, label in (("bio", "the bio"), ("persona", "the persona")):
        if not str(site.get(k) or "").strip(): out.append(f"{label} is empty")
        elif ageword.search(str(site.get(k))): out.append(f"{label} states an age (“{ageword.search(str(site.get(k))).group(0)}”) — the site sets the age itself; take it out")
    return out


async def _site_upload(s, path: str, job: dict) -> str:
    """one file through an upload slot; returns its media_id (cached, so it's sent once)"""
    import hashlib
    st = os.stat(path)
    fp = hashlib.sha1(f"{os.path.basename(path)}:{st.st_size}:{int(st.st_mtime)}".encode()).hexdigest()[:16]
    cache = _state_json(SITE_MEDIA, {}) or {}
    if fp in cache: return cache[fp]
    body, ct, name = await asyncio.to_thread(_site_ready_file, path)
    job["step"] = f"uploading {name} ({len(body) // 1024} KB)"
    mid, _host = await _site_send_one(s, body, ct, name)
    cache = _state_json(SITE_MEDIA, {}) or {}
    cache[fp] = mid; _state_write(SITE_MEDIA, cache)
    job["uploaded"] = job.get("uploaded", 0) + 1
    return mid


async def _site_push(job: dict, d: dict):
    try:
        chars = json.load(open(CHAR_FILE))
        c = next((x for x in chars if isinstance(x, dict) and x.get("id") == d.get("char_id")), None)
        if not c: raise RuntimeError("character not found")
        age = c.get("age")
        if not isinstance(age, (int, float)) or age < 18: raise RuntimeError("only characters with an age of 18 or older are sent")
        site = c.get("site") or {}
        probs = _site_problems(c, site)
        if probs: raise RuntimeError("Fix these first (the site would refuse them): " + " · ".join(probs))
        ext = f"h3-{c['id']}"
        views = c.get("views") or {}
        def vpath(v):
            ref = views.get(v)
            return _file_of(ref) if isinstance(ref, dict) and ref.get("filename") else None
        sets = [x for x in (site.get("sets") or []) if isinstance(x, dict) and x.get("items") and (not d.get("sets") or x.get("set_key") in d["sets"])]
        files = []  # (role, path)
        for role, v in (("avatar", site.get("avatar") or "face"), ("cover", site.get("cover") or "front")):
            own = site.get(f"{role}File")  # any picture you picked (tray or their results) wins over a sheet view
            p = None
            if isinstance(own, dict) and own.get("filename"):
                try: p = _file_of(own)
                except web.HTTPException: p = None
            p = p if p and os.path.isfile(p) else (vpath(v) or vpath("front"))
            if p and os.path.isfile(p): files.append((role, p))
        if site.get("send_reference", True):
            for v in ("front", "left", "right", "back", "threeq", "face", "smile", "angry", "surprised"):
                p = vpath(v)
                if p and os.path.isfile(p): files.append(("reference", p))
        for st_ in sets:
            for it in st_["items"]:
                try: p = _file_of(it)
                except web.HTTPException: continue
                if os.path.isfile(p): files.append((f"set:{st_['set_key']}", p))
        job.update(total=len(files), step="uploading")
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=1800)) as s:
            code, existing = await _site_call(s, "GET", f"/characters/{quote(ext)}")
            job["existing"] = code == 200
            mids: dict[str, str] = {}
            # a few at a time (not all at once); the first failure stops the send with its reason
            gate = asyncio.Semaphore(SITE_UPLOAD_PARALLEL)
            async def send(p: str):
                async with gate:
                    mids[p] = await _site_upload(s, p, job)
                    job["done"] = job.get("done", 0) + 1
            uniq = list(dict.fromkeys(p for _, p in files))
            job["total"] = len(uniq)
            await asyncio.gather(*(send(p) for p in uniq))
            gen = ["Krea 2", "MiniMax H3"] if c.get("style") == "realistic" else ["Anima / Illustrious", "MiniMax H3"]
            appearance = {k: c.get(k, "") for k in ("hair", "eyes", "body", "outfit", "details")}
            manifest = {
                "external_id": ext, "name": c.get("name"), "age": int(age), "gender": c.get("gender"), "style": c.get("style"),
                "tags": site.get("tags") or [],
                "profile": {"bio": site.get("bio", ""), "personality": site.get("personality") or c.get("personality", ""), "backstory": site.get("backstory", ""),
                            "greeting": site.get("greeting", ""), "appearance": appearance, "description": c.get("block") or ""},
                "persona_prompt": site.get("persona", ""), "voice_notes": site.get("voice", ""),
                "provenance": {"ai_generated": True, "generator": gen, "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())},
            }
            job["step"] = "character"
            code, res = await _site_call(s, "PUT", f"/characters/{quote(ext)}", _plain(manifest))
            if code not in (200, 201): raise RuntimeError(f"the site refused the character ({code}): {_site_err(res)}")
            job["character"] = res
            media = {"avatar": next((mids[p] for r, p in files if r == "avatar"), None), "cover": next((mids[p] for r, p in files if r == "cover"), None),
                     "reference": [mids[p] for r, p in files if r == "reference"]}
            job["step"] = "media"
            code, res = await _site_call(s, "PUT", f"/characters/{quote(ext)}/media", media)
            if code not in (200, 201, 204): raise RuntimeError(f"the site refused the pictures ({code}): {_site_err(res)}")
            job["sets_done"] = []
            all_sets = [x for x in (site.get("sets") or []) if isinstance(x, dict)]
            for st_ in sets:
                items = []
                for i, it in enumerate(st_["items"]):
                    try: p = _file_of(it)
                    except web.HTTPException: continue
                    if p not in mids: continue
                    kind = "video" if re.search(r"\.(mp4|webm|mov)$", p, re.I) else "image"
                    items.append({"media_id": mids[p], "kind": kind, "order": i + 1, "rating": it.get("rating") or st_.get("rating") or "sfw",
                                  "caption": it.get("caption", ""), **({"duration_s": it["duration"]} if it.get("duration") else {})})
                # a set with no title is refused ("title: Required."): "Premium set 2" / "Free set 1" by its place in the list
                tier = st_.get("tier", "free")
                n = 1 + sum(1 for x in all_sets[: all_sets.index(st_)] if x.get("tier", "free") == tier) if st_ in all_sets else 1
                title = str(st_.get("title") or "").strip() or f"{'Premium' if tier == 'premium' else 'Free'} set {n}"
                body = {"set_key": st_["set_key"], "title": title, "description": st_.get("description", ""), "tier": st_.get("tier", "free"),
                        # no price = the site decides (its own pricing rules)
                        "price_suggestion": st_.get("price") if st_.get("tier") == "premium" and st_.get("price") else None,
                        "cover": items[0]["media_id"] if items else None, "items": items}
                job["step"] = f"set {st_.get('title') or st_['set_key']}"
                code, res = await _site_call(s, "PUT", f"/characters/{quote(ext)}/sets/{quote(st_['set_key'])}", _plain(body))
                if code not in (200, 201): raise RuntimeError(f"the site refused the set “{title}” ({code}): {_site_err(res)}")
                job["sets_done"].append(st_["set_key"])
        job.update(status="done", step="done")
    except Exception as e:  # noqa: BLE001
        job.update(status="error", error=str(e)[:1600])


# ------------------------------------------------------------------ the catalog: every result on this rental's disk
# The Studio's feeds and tray only keep the latest jobs; the files themselves are never deleted. The catalog lists all of
# them straight from output/studio (newest first, by project folder), with what each was made from when the Studio noted it.
CATALOG_META = os.path.join(STATE, "catalog_meta.json")
_CAT = {"at": 0.0, "items": []}
_TABS = {"create", "edit", "animate", "finish", "characters", "batch", "scenes", "prompt", "chat"}
_CAT_SKIP = re.compile(r"(^|/)(chat-draft|_tmp|tmp|_work)(/|$)", re.I)
# helper files from before they moved to studio/_work: SAM outlines, background-free copies, Qwen drafts
_WORK_FILE = re.compile(r"^(mask|plain|chat-draft)_\d+", re.I)


def _catalog_scan() -> list:
    if time.time() - _CAT["at"] < 8: return _CAT["items"]
    root = os.path.join(OUTPUT, "studio")
    items = []
    for dirpath, dirs, files in os.walk(root):
        rel = os.path.relpath(dirpath, OUTPUT).replace(os.sep, "/")
        if _CAT_SKIP.search(rel): continue
        for fn in files:
            ext = os.path.splitext(fn)[1].lower()
            kind = "image" if ext in (".png", ".jpg", ".jpeg", ".webp") else "video" if ext in (".mp4", ".webm", ".mov") else None
            if not kind or _WORK_FILE.match(fn): continue
            try: st = os.stat(os.path.join(dirpath, fn))
            except OSError: continue
            parts = rel.split("/")
            # studio/<project>/<tab>/… — files from before projects had folders are studio/<tab>/…
            old_style = len(parts) > 1 and parts[1] in _TABS
            items.append({"filename": fn, "subfolder": rel, "type": "output", "kind": kind, "size": st.st_size, "mtime": st.st_mtime,
                          "folder": "" if old_style else parts[1] if len(parts) > 1 else "", "tab": parts[1] if old_style else parts[2] if len(parts) > 2 else ""})
    items.sort(key=lambda x: -x["mtime"])
    _CAT.update(at=time.time(), items=items)
    return items


async def catalog(req):
    """GET ?folder=&kind=&q=&offset=&limit= → {items, total, folders: [{name, count}]}"""
    items = await asyncio.to_thread(_catalog_scan)
    meta = _state_json("catalog_meta", {}) or {}
    folder, kind, q = req.query.get("folder", ""), req.query.get("kind", ""), req.query.get("q", "").strip().lower()
    counts: dict = {}
    for it in items: counts[it["folder"]] = counts.get(it["folder"], 0) + 1
    sel = [it for it in items if (not folder or it["folder"] == folder) and (not kind or it["kind"] == kind) and it["folder"] != "Testing"]
    if q:
        sel = [it for it in sel if q in json.dumps(meta.get(f"{it['subfolder']}/{it['filename']}", {})).lower() or q in it["filename"].lower()]
    off, lim = max(0, int(req.query.get("offset", 0) or 0)), min(500, max(1, int(req.query.get("limit", 120) or 120)))
    page = [{**it, **({"meta": meta[k]} if (k := f"{it['subfolder']}/{it['filename']}") in meta else {})} for it in sel[off:off + lim]]
    return web.json_response({"items": page, "total": len(sel), "folders": sorted(({"name": k, "count": v} for k, v in counts.items() if k != "Testing"), key=lambda x: -x["count"])})


async def catalog_meta(req):
    """POST {files: [{subfolder, filename}], label, prompt, tab, character} — what a result was made from, for the catalog"""
    d = await req.json()
    meta = _state_json("catalog_meta", {}) or {}
    info = {k: str(d.get(k) or "")[:800] for k in ("label", "prompt", "tab", "character", "project") if d.get(k)}
    info["at"] = int(time.time())
    for f in (d.get("files") or [])[:64]:
        if isinstance(f, dict) and f.get("filename"): meta[f"{f.get('subfolder', '')}/{f['filename']}"] = info
    _state_write("catalog_meta", meta)
    return web.json_response({"ok": True})


async def site_push(req):
    d = await req.json()
    jid = uuid.uuid4().hex[:10]
    SITE_JOBS[jid] = job = {"id": jid, "status": "running", "step": "starting", "done": 0, "total": 0}
    asyncio.get_event_loop().create_task(_site_push(job, d))
    return web.json_response(job)


async def site_push_status(req):
    j = SITE_JOBS.get(req.match_info["id"])
    if not j: raise web.HTTPNotFound()
    return web.json_response(j)


# ------------------------------------------------------------------ Grok tab relay
# "Prompt writer: Grok tab": the Studio leaves a request here, the H3 Grok helper (a userscript in the owner's own
# browser, on grok.com) picks it up, types it into Grok, and posts Grok's reply back. The helper's routes are under
# /grok-relay/ (no front-door password — the helper can't send it) and need this rental's relay token instead, which the
# Studio hands to the Grok tab it opens. Nothing about Grok (no login) is kept on the rental.
import secrets as _secrets
GROK_TOKEN = _secrets.token_urlsafe(24)
GROK: dict[str, dict] = {}
GROK_SEEN = {"t": 0.0, "where": ""}
USERSCRIPT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "h3-grok.user.js")


def _grok_ok(req) -> bool:
    t = req.headers.get("X-H3-Token") or req.query.get("token") or ""
    return _secrets.compare_digest(t, GROK_TOKEN)


async def grok_status(req):
    return web.json_response({"connected": time.time() - GROK_SEEN["t"] < 25, "seen": GROK_SEEN["t"], "token": GROK_TOKEN})


async def grok_ask(req):
    d = await req.json()
    text = str(d.get("text") or "").strip()
    if not text: raise web.HTTPBadRequest(text="empty")
    for k in [k for k, v in GROK.items() if time.time() - v["t"] > 3600]: GROK.pop(k, None)
    gid = uuid.uuid4().hex[:12]
    pics = []
    for n in (d.get("images") or [])[:6]:
        try:
            p = safe_join(INPUT, str(n))
            if os.path.isfile(p): pics.append(p)
        except web.HTTPException:
            pass
    GROK[gid] = {"id": gid, "text": text, "state": "new", "t": time.time(), "taken": 0.0, "images": pics}
    return web.json_response({"id": gid})


async def grok_result(req):
    j = GROK.get(req.match_info["id"])
    if not j: raise web.HTTPNotFound()
    return web.json_response({k: j.get(k) for k in ("state", "answer", "error")})


async def grok_cancel(req):
    GROK.pop(req.match_info["id"], None)
    return web.json_response({"ok": True})


async def relay_next(req):
    if not _grok_ok(req): raise web.HTTPForbidden(text="bad token — open the Grok tab again from the Studio")
    GROK_SEEN["t"] = time.time()
    now = time.time()
    # a request the Grok tab took but never answered (tab closed, reloaded) is offered again after 8 minutes
    for j in sorted(GROK.values(), key=lambda x: x["t"]):
        if j["state"] == "new" or (j["state"] == "taken" and now - j["taken"] > 480):
            j["state"], j["taken"] = "taken", now
            return web.json_response({"id": j["id"], "text": j["text"],
                                      "images": [{"url": f"/grok-relay/img/{j['id']}/{i}", "name": os.path.basename(p)} for i, p in enumerate(j.get("images") or [])]})
    return web.json_response({})


async def relay_answer(req):
    if not _grok_ok(req): raise web.HTTPForbidden(text="bad token")
    GROK_SEEN["t"] = time.time()
    d = await req.json()
    j = GROK.get(str(d.get("id") or ""))
    if not j: return web.json_response({"ok": False, "why": "gone"})
    if d.get("error"): j["state"], j["error"] = "error", str(d["error"])[:500]
    else: j["state"], j["answer"] = "done", str(d.get("text") or "")
    return web.json_response({"ok": True})


async def relay_img(req):
    """a picture attached to a request, for the Grok tab (token-checked like the rest of the relay)"""
    if not _grok_ok(req): raise web.HTTPForbidden(text="bad token")
    j = GROK.get(req.match_info["id"])
    try: p = (j or {}).get("images", [])[int(req.match_info["n"])]
    except (IndexError, ValueError): raise web.HTTPNotFound()
    return web.FileResponse(p)


async def relay_script(req):
    try:
        with open(USERSCRIPT, encoding="utf-8") as f: body = f.read()
    except OSError: raise web.HTTPNotFound()
    return web.Response(text=body, content_type="text/javascript", headers={"Cache-Control": "no-store"})


# ------------------------------------------------------------------ your own PC (H3_LOCAL=1): this helper is also the front door
# On a rental Caddy serves the Studio, routes /studio-api to this helper and everything else to ComfyUI. On your PC there's no
# Caddy: this helper serves the Studio's files, reports which models are on your PC (/h3-downloads) and passes everything
# else through to ComfyUI Desktop (STUDIO_COMFY, normally http://127.0.0.1:8000), websockets included.
STUDIO_DIST = os.environ.get("H3_STUDIO_DIST") or os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "studio", "dist")
MODELS_TXT = os.environ.get("H3_MODELS_TXT") or os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "models.txt")
# picture work that fits a 16 GB card; the rest needs the rental's NVIDIA card
LOCAL_GROUPS = {"image", "krea_te", "kedit", "kedit2", "sam", "anime", "animeref"}
LOCAL_WHY = {"writer": "On your PC prompts come from your Grok tab: Prompt writer → Grok tab", "writer_xl": "On your PC prompts come from your Grok tab"}
_HOP = {"host", "content-length", "transfer-encoding", "connection", "keep-alive", "upgrade", "origin", "referer", "accept-encoding"}


def _local_groups() -> list[dict]:
    groups, cur = [], None
    try:
        lines = open(MODELS_TXT, encoding="utf-8").read().splitlines()
    except OSError:
        return []
    for ln in lines:
        m = re.match(r"#\s*@group\s+(\S+)\s+(.+)", ln)
        if m:
            cur = {"id": m.group(1), "label": m.group(2).strip(), "files": []}; groups.append(cur); continue
        if not cur or not ln.strip() or ln.lstrip().startswith("#"): continue
        parts = ln.split()
        if len(parts) < 2: continue
        name = parts[2] if len(parts) > 2 and "=" not in parts[2] else unquote(urlparse(parts[1]).path.rsplit("/", 1)[-1])
        cur["files"].append(os.path.join(MODELS, parts[0], name))
    out = []
    for g in groups:
        here = g["id"] in LOCAL_GROUPS
        have = here and g["files"] and all(os.path.isfile(f) for f in g["files"])
        state = "done" if have else "waiting" if here else "skipped"
        why = None if have else ("Not on your PC yet — run “1 - Setup (run once).bat” again" if here else LOCAL_WHY.get(g["id"], "Rental only — needs the rental's NVIDIA card"))
        out.append({"id": g["id"], "label": g["label"], "state": state, "error": None, "why": why, "pct": 100 if have else 0, "left_s": 0 if have else -1,
                    "total_mb": 0, "done_mb": 0, "can_later": False})
    return out


async def local_downloads(req):
    return web.json_response({"active": False, "local": True, "groups": _local_groups(), "pct": 100, "mbps": 0, "left_s": -1,
                              "gpu": {"name": os.environ.get("H3_GPU_NAME", "your PC"), "vram_mb": int(os.environ.get("H3_VRAM_MB", "16000")), "images_only": True}})


async def local_studio(req):
    rel = req.match_info.get("tail", "")
    root = os.path.abspath(STUDIO_DIST)
    path = os.path.abspath(os.path.join(root, rel)) if rel else ""
    if not rel or not path.startswith(root) or not os.path.isfile(path):
        path = os.path.join(root, "index.html")
        return web.FileResponse(path, headers={"Cache-Control": "no-store"})
    return web.FileResponse(path, headers={"Cache-Control": "public, max-age=31536000, immutable"} if "/assets/" in path.replace(os.sep, "/") else {})


async def local_view(req):
    """pictures and videos straight from the folders (faster than going through ComfyUI, and ComfyUI Desktop may not serve
    every folder the Studio uses); anything not found here still goes to ComfyUI"""
    q = req.query
    try:
        p = safe_join(folder(q.get("type", "output")), q.get("subfolder", "") or "", q.get("filename", ""))
    except web.HTTPException:
        p = ""
    if p and os.path.isfile(p):
        return web.FileResponse(p, headers={"Cache-Control": "public, max-age=86400"})
    return await comfy_proxy(req)


# Windows ComfyUI names model files in subfolders with a backslash ("Krea2\\x.safetensors"); the Studio (built for Linux
# rentals) uses "/". Translate both ways: the model lists ComfyUI sends get "/", the jobs the Studio sends get "\\".
_MODEL_FILE = re.compile(r"\.(safetensors|sft|gguf|ckpt|pt|pth|bin|onnx)$", re.I)
_WIN = os.name == "nt"


def _slashes(o, to: str):
    frm = "\\" if to == "/" else "/"
    if isinstance(o, str):
        return o.replace(frm, to) if frm in o and _MODEL_FILE.search(o) and "://" not in o else o
    if isinstance(o, list): return [_slashes(x, to) for x in o]
    if isinstance(o, dict): return {k: _slashes(v, to) for k, v in o.items()}
    return o


# On a 16 GB card the full Krea 2 (12 GB, fp8 - which AMD cards can't even compute in) doesn't fit next to everything else, so
# ComfyUI keeps swapping pieces in and out (minutes per step). The compressed Q5 copy (~9 GB) fits: every job that loads
# Krea 2 gets it instead. H3_USE_GGUF=0 in keys.txt switches this off.
KREA_FULL = "krea2_turbo_fp8_scaled.safetensors"
KREA_GGUF = os.environ.get("H3_KREA_GGUF", "krea2_turbo_bf16-Q5_0.gguf")


def _local_steps(graph: dict):
    """Krea 2 Turbo is made for 4-8 steps; on your PC every step counts, so pictures that use it run at most H3_MAX_STEPS (8)"""
    cap = int(os.environ.get("H3_MAX_STEPS", "8") or 0)
    nodes = (graph.get("prompt") or {}).values()
    krea = any(isinstance(n, dict) and n.get("class_type") in ("UNETLoader", "UnetLoaderGGUF") and "krea2_turbo" in str(n.get("inputs", {}).get("unet_name", "")) for n in nodes)
    if not cap or not krea: return
    for n in nodes:
        if isinstance(n, dict) and n.get("class_type") in ("KSampler", "KSamplerAdvanced") and isinstance(n.get("inputs", {}).get("steps"), int) and n["inputs"]["steps"] > cap:
            n["inputs"]["steps"] = cap


def _use_gguf(graph: dict):
    _local_steps(graph)
    if os.environ.get("H3_USE_GGUF", "1") == "0": return
    if not any(os.path.isfile(os.path.join(MODELS, d, KREA_GGUF)) for d in ("diffusion_models", "unet")): return
    for n in (graph.get("prompt") or {}).values():
        if isinstance(n, dict) and n.get("class_type") == "UNETLoader" and str(n.get("inputs", {}).get("unet_name", "")).replace("\\", "/").endswith(KREA_FULL):
            n["class_type"] = "UnetLoaderGGUF"
            n["inputs"] = {"unet_name": KREA_GGUF}


async def comfy_proxy(req):
    target = COMFY.rstrip("/") + req.rel_url.path_qs
    path = req.rel_url.path
    if _WIN and req.method == "GET" and re.search(r"/(object_info|models)(/|$)", path):
        try:
            async with aiohttp.ClientSession() as s:
                async with s.get(target) as r:
                    if r.status == 200 and "json" in r.headers.get("Content-Type", ""):
                        return web.json_response(_slashes(await r.json(), "/"))
        except aiohttp.ClientConnectorError:
            return web.Response(status=502, text="ComfyUI isn't running — open the ComfyUI app first, then reload this page.")
    if LOCAL and req.method == "POST" and re.search(r"/prompt$", path):
        try:
            d = await req.json()
            if _WIN: d = _slashes(d, "\\")
            _use_gguf(d)
            async with aiohttp.ClientSession() as s:
                async with s.post(target, json=d) as r:
                    return web.Response(status=r.status, body=await r.read(), content_type=r.content_type)
        except aiohttp.ClientConnectorError:
            return web.Response(status=502, text="ComfyUI isn't running — open the ComfyUI app first, then reload this page.")
    if req.headers.get("Upgrade", "").lower() == "websocket":
        down = web.WebSocketResponse(max_msg_size=0); await down.prepare(req)
        async with aiohttp.ClientSession() as s:
            async with s.ws_connect("ws" + target[4:], max_msg_size=0) as up:
                async def pipe(a, b):
                    async for m in a:
                        if m.type == aiohttp.WSMsgType.TEXT: await b.send_str(m.data)
                        elif m.type == aiohttp.WSMsgType.BINARY: await b.send_bytes(m.data)
                        else: break
                tasks = [asyncio.create_task(pipe(down, up)), asyncio.create_task(pipe(up, down))]
                await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
                for t in tasks: t.cancel()
        return down
    headers = {k: v for k, v in req.headers.items() if k.lower() not in _HOP}
    body = await req.read()
    try:
        async with aiohttp.ClientSession() as s:
            async with s.request(req.method, target, data=body or None, headers=headers, allow_redirects=False) as r:
                resp = web.StreamResponse(status=r.status, headers={k: v for k, v in r.headers.items() if k.lower() not in _HOP | {"content-encoding"}})
                await resp.prepare(req)
                async for chunk in r.content.iter_chunked(1 << 16): await resp.write(chunk)
                await resp.write_eof()
                return resp
    except aiohttp.ClientConnectorError:
        return web.Response(status=502, text="ComfyUI isn't running — open the ComfyUI app first, then reload this page.")


def main():
    app = web.Application(client_max_size=2 * 1024 ** 3, middlewares=[show_errors])
    app.on_startup.append(on_start)
    app.add_routes([
        web.get("/studio-api/grok/status", grok_status), web.post("/studio-api/grok/ask", grok_ask), web.get("/studio-api/grok/result/{id}", grok_result), web.delete("/studio-api/grok/result/{id}", grok_cancel),
        web.get("/grok-relay/next", relay_next), web.post("/grok-relay/answer", relay_answer), web.get("/grok-relay/h3-grok.user.js", relay_script), web.get("/grok-relay/img/{id}/{n}", relay_img),
        web.get("/studio-api/health", health), web.get("/studio-api/debug-report", debug_report), web.get("/studio-api/ws", relay_ws),
        web.route("*", "/studio-api/site/config", site_config), web.get("/studio-api/site/test", site_test),
        web.post("/studio-api/site/push", site_push), web.get("/studio-api/site/push/{id}", site_push_status),
        web.get("/studio-api/state/{name}", get_state), web.put("/studio-api/state/{name}", put_state),
        web.post("/studio-api/upload", upload), web.post("/studio-api/to-input", to_input), web.post("/studio-api/inputs/ensure", inputs_ensure), web.post("/studio-api/fetch-image", fetch_image), web.route("*", "/studio-api/proton", proton_status), web.post("/studio-api/board", make_board), web.post("/studio-api/trainset/zip", trainset_zip),
        web.post("/studio-api/train", train_start), web.get("/studio-api/train/{id}", train_status), web.post("/studio-api/train/{id}/cancel", train_cancel),
        web.get("/studio-api/recent", recent),
        web.post("/studio-api/finish", finish), web.get("/studio-api/finish/{id}", finish_status),
        web.get("/studio-api/cost", cost),
        web.post("/studio-api/hf/request-key", hf_key_request), web.get("/studio-api/hf/request-key", hf_key_request),
        web.post("/studio-api/output/delete", delete_output), web.post("/studio-api/keep", keep), web.get("/studio-api/kept/{path:.+}", get_kept), web.delete("/studio-api/kept/{path:.+}", del_kept),
        web.get("/studio-api/https", https_link),
        web.get("/studio-api/loras", list_loras), web.post("/studio-api/loras/fetch-missing", fetch_missing_loras), web.post("/studio-api/loras/add", add_lora),
        web.get("/studio-api/loras/job/{id}", lora_job_status), web.post("/studio-api/loras/forget", forget_lora),
        web.post("/studio-api/loras/upload", upload_lora),
        web.post("/studio-api/client-error", client_error),
        web.get("/studio-api/civitai/key", civitai_key), web.put("/studio-api/civitai/key", civitai_key), web.delete("/studio-api/civitai/key", civitai_key), web.post("/studio-api/sheet/split", sheet_split),
        web.get("/studio-api/civitai/search", civitai_search), web.get("/studio-api/civitai/model/{id}", civitai_model),
        web.get("/studio-api/civitai/images", civitai_images), web.get("/studio-api/civitai/workflows", civitai_workflows), web.post("/studio-api/civitai/workflows/zip", civitai_workflows_zip),
        web.get("/studio-api/civitai/image", civitai_image), web.get("/studio-api/civitai/media", civitai_media), web.get("/studio-api/civitai/pic", civitai_pic),
        web.get("/studio-api/civitai/collections", civitai_collections), web.get("/studio-api/civitai/debug", civitai_debug), web.get("/studio-api/civitai/collection", civitai_collection), web.get("/studio-api/civitai/collection-models", civitai_collection_models), web.post("/studio-api/civitai/fetch-media", civitai_fetch_media),
        web.post("/studio-api/notify/watch", notify_watch), web.post("/studio-api/notify/test", notify_test),
        web.get("/studio-api/packs", packs_list), web.post("/studio-api/packs", packs_add), web.put("/studio-api/packs/active", packs_activate),
        web.patch("/studio-api/packs/{id}", packs_update), web.delete("/studio-api/packs/{id}", packs_delete), web.get("/studio-api/packs/{id}/text", packs_text),
        web.post("/studio-api/last-frame", last_frame),
        web.post("/studio-api/media-meta", media_meta), web.post("/studio-api/workflow/save", workflow_save),
        web.post("/studio-api/downloads/later", downloads_later),
        web.get("/studio-api/models", my_models), web.post("/studio-api/models/forget", forget_model),
        web.post("/studio-api/transcribe", transcribe),
        web.get("/studio-api/characters/export", characters_export), web.post("/studio-api/characters/import", characters_import),
        web.post("/studio-api/import/start", import_start), web.put("/studio-api/import/{id}/chunk", import_chunk),
        web.post("/studio-api/import/{id}/finish", import_finish), web.get("/studio-api/import/latest", import_latest), web.get("/studio-api/catalog", catalog), web.post("/studio-api/catalog/meta", catalog_meta), web.post("/studio-api/import/restore", import_restore), web.get("/studio-api/import/{id}", import_status),
    ])
    if LOCAL:
        app.router.add_get("/h3-downloads", local_downloads)
        async def local_status(_r): return web.json_response({"phase": "ready", "local": True})
        app.router.add_get("/h3-status", local_status)
        async def to_studio(_r): raise web.HTTPFound("/studio/")
        app.router.add_get("/", to_studio)
        app.router.add_get("/studio", to_studio)
        app.router.add_get("/studio/{tail:.*}", local_studio)
        app.router.add_get("/view", local_view)
        app.router.add_get("/api/view", local_view)
        app.router.add_route("*", "/{tail:.*}", comfy_proxy)
        print(f"H3 Studio on your PC: http://127.0.0.1:{PORT}/studio/  (ComfyUI at {COMFY})", flush=True)
    web.run_app(app, host="127.0.0.1", port=PORT, print=None)


if __name__ == "__main__":
    main()
