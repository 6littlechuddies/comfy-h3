#!/usr/bin/env python3
"""Model downloader: fetches models.txt group by group (see the "# @group" lines), so the Studio can open as soon as
the first group is in while the rest keeps downloading. Writes progress to /opt/h3/run/downloads.json (served at
/h3-downloads) and a flag file per finished group (/opt/h3/run/dl_<group>.done, plus dl_first.done).

Files download under "<name>.downloading" and are renamed when complete, so ComfyUI never sees half a model.
Exit codes: 0 all done (or done with some failed groups), 3 host too slow (speed check)."""
import concurrent.futures as cf
import json, os, re, shutil, subprocess, sys, threading, time

import requests

COMFY_DIR = os.environ.get("COMFY_DIR", "/opt/ComfyUI")
RUN = os.environ.get("H3_RUN", "/opt/h3/run")
MODELS_TXT = sys.argv[1] if len(sys.argv) > 1 else "/opt/h3/models.txt"
STATE_DIR = os.path.join(COMFY_DIR, "user", "default", "studio")
OUT = os.path.join(RUN, "downloads.json")
# The speed check judges the host by its best 15-second stretch in the first SPEED_CHECK_SECONDS, so a slow start
# (connections opening, CivitAI's slower servers for your LoRAs) doesn't count against it.
#   below MIN_MBPS  -> keeps going, with a "downloads slowly" warning and a time estimate on the start page
#   below KILL_MBPS -> really unusable: stops (and the rental switches itself off unless AUTO_DESTROY_SLOW=0)
MIN_MBPS = float(os.environ.get("MIN_MBPS", "25"))            # MB/s (25 MB/s ~= 200 Mbit/s)
KILL_MBPS = float(os.environ.get("KILL_MBPS") or min(10.0, MIN_MBPS / 2))
SPEED_CHECK_SECONDS = int(os.environ.get("SPEED_CHECK_SECONDS", "120"))
WINDOW = 15
# Hugging Face keys: HF_TOKENS (several, separated by commas) and/or HF_TOKEN. Hugging Face slows a key down after a
# lot of downloading (a key that gave ~300 MB/s drops to ~50 MB/s after a couple of rentals), so with several keys the
# downloader switches to another one when Hugging Face gets slow, and remembers which were slow (by fingerprint only —
# the keys themselves are never written down) so the next rental starts on a rested one.
# keys from a file instead of the template: the Studio helper copies "hf_tokens.txt" from your Proton Drive here at startup
KEYS_FILE = os.environ.get("HF_KEYS_FILE") or os.path.expanduser("~/.h3/hf_keys.txt")


def _wait_for_key_file():
    """with Proton Drive set up, give the Studio helper up to 90 s to bring hf_tokens.txt (it writes the file even when
    there isn't one, so this only waits as long as the login takes)"""
    cloud = os.environ.get("GDRIVE_TOKEN") or (os.environ.get("PROTON_USER") and os.environ.get("PROTON_PASSWORD"))  # Google Drive or Proton
    if not cloud or os.environ.get("PROTON_KEYS") == "0": return
    for _ in range(90):
        if os.path.exists(KEYS_FILE): return
        time.sleep(1)


# Vast's template caps each environment value (~6 keys), so more keys go in HF_TOKENS_2, HF_TOKENS_3, … (any name that
# starts with HF_TOKENS or HF_TOKEN), read in order.
def _keys() -> list[str]:
    def order(n: str):
        m = re.search(r"(\d+)$", n)
        return (0 if n in ("HF_TOKENS", "HF_TOKEN") else 1, int(m.group(1)) if m else 0, n)
    names = sorted((n for n in os.environ if re.fullmatch(r"HF_TOKENS?(_?\d+)?", n)), key=order)
    raw = ",".join(os.environ.get(n, "") for n in names)
    try: raw += "," + ",".join(re.findall(r"hf_[A-Za-z0-9]{20,}", open(KEYS_FILE).read()))  # hf_tokens.txt from Proton Drive
    except OSError: pass
    out: list[str] = []
    for k in re.split(r"[\s,;]+", raw):
        if k.startswith("hf_") and k not in out: out.append(k)
    return out
if __name__ == "__main__": _wait_for_key_file()
HF_KEYS = _keys()
HF_TOKEN = HF_KEYS[0] if HF_KEYS else ""
ROTATE_MBPS = float(os.environ.get("HF_ROTATE_MBPS", "100"))   # Hugging Face slower than this for a while -> next key
# How patient the switching is: a key gets 40 s to get going after a (re)start, is dropped after 20 s measured slow,
# and switches are at least 60 s apart — and a key that hasn't started moving data yet is never judged (a restart takes
# 30-60 s to reconnect every file; judging it at "0 MB/s" made the downloader throw away good keys one after another). Every switch restarts the downloads (finished pieces are kept); the
# H3_ROT_* variables in the template make it more patient again if that ever costs more than it saves.
ROT_WARMUP = float(os.environ.get("H3_ROT_WARMUP", "40"))        # seconds after a (re)start before speed is judged at all (connections ramping up)
ROT_WINDOW = float(os.environ.get("H3_ROT_WINDOW", "20"))        # speed is measured over this long, not a 3-second blip
ROT_SLOW_FOR = float(os.environ.get("H3_ROT_SLOW_FOR", "20"))      # must stay under ROTATE_MBPS this long before switching...
ROT_SLOW_FOR_FAST = float(os.environ.get("H3_ROT_SLOW_FOR_FAST", "20"))  # ...or this long if this key already did STAY_MBPS on this rental (a dip, not a throttle)
STAY_MBPS = float(os.environ.get("HF_STAY_MBPS", "200"))
ROT_GAP = float(os.environ.get("H3_ROT_GAP", "60"))  # at least this long between two switches
HF_BASE = os.environ.get("H3_HF_BASE", "https://huggingface.co/")  # the local test points this at a fake server
JOBS = max(1, int(os.environ.get("DL_JOBS") or 8))  # files downloaded at once (each uses up to 16 connections); 16 at once (256 connections) got throttled
# a connection slower than this for a while is dropped and retried. Keep it low: 8 files x 16 connections share the line,
# so on a ~10 MB/s host each connection only gets ~80 KB/s — a 100K limit made every file fail within 3 minutes.
LOWEST = os.environ.get("DL_LOWEST_SPEED", "0")
# connections per file. 16 x 8 files = 128 at once, and every slow one dropped and reopened every few seconds, is what got the
# network flagged by Hugging Face ("suspicious activity", 403 for ~30 min) — 8 per file and no dropping keeps it ordinary
CONNS = max(1, int(os.environ.get("DL_CONNS") or 8))
# every CivitAI key: the template (CIVITAI_TOKEN / CIVITAI_TOKENS / CIVITAI_API_KEY, comma-separated), the one pasted in
# the Studio, and civitai_keys.txt on your drive — when CivitAI says no to one, the next is tried
def _civitai_keys() -> list[str]:
    raw = ",".join(os.environ.get(n, "") for n in sorted(os.environ) if re.fullmatch(r"CIVITAI_(TOKENS?|API_KEY)(_?\d+)?", n))
    for p in (os.path.join(COMFY_DIR, "user", "default", "studio", "civitai_key"), os.environ.get("CIVITAI_KEYS_FILE") or os.path.expanduser("~/.h3/civitai_keys.txt")):
        try: raw += "," + open(p).read()
        except OSError: pass
    out: list[str] = []
    for k in re.split(r"[\s,;]+", raw):
        if re.fullmatch(r"[A-Za-z0-9_-]{20,128}", k or "") and not k.startswith("hf_") and k not in out: out.append(k)
    return out
CIVITAI_KEYS = _civitai_keys()
CIVITAI_TOKEN = CIVITAI_KEYS[0] if CIVITAI_KEYS else ""
REMOTE = os.environ.get("RCLONE_REMOTE", "")
# groups to leave out (Vast template: SKIP_MODELS=anime,autoprompter …). The AutoPrompter extras are only used by the
# old imported workflow in the node editor, so they're skipped unless you set SKIP_MODELS to something else (or empty).
SKIP = {x.strip() for x in os.environ.get("SKIP_MODELS", "").split(",") if x.strip()}
# "Later" switches from the start page / Studio status menu: {"later": [group ids], "now": [group ids]}. Kept with your
# settings, so a group you put off stays off on the next rental until you press "Download now".
# A group is left out when it's in SKIP_MODELS or "later", and not in "now". The first group is always downloaded.
LATER_FILE = os.path.join(STATE_DIR, "download_later.json")
SUFFIX = ".downloading"
T0 = time.time()
MARKS_FILE = os.path.join(STATE_DIR, "hf_keys.json")  # {fingerprint: time it was last found slow, "_seen": [fingerprints]} — backed up with your settings


def _fp(k: str) -> str:
    import hashlib
    return hashlib.sha256(k.encode()).hexdigest()[:12]


def _slow_marks() -> dict:
    try: return json.load(open(MARKS_FILE))
    except (OSError, ValueError): return {}


def _save_marks(d: dict):
    try:
        os.makedirs(STATE_DIR, exist_ok=True)
        with open(MARKS_FILE + ".tmp", "w") as fh: json.dump(d, fh)
        os.replace(MARKS_FILE + ".tmp", MARKS_FILE)
    except OSError:
        pass


def _mark_slow(k: str):
    d = _slow_marks(); d[_fp(k)] = time.time(); _save_marks(d)


def _mark_seen(k: str):
    """a key that has been used on a rental: from now on it's no longer 'brand new'"""
    d = _slow_marks(); seen = set(d.get("_seen") or [])
    if _fp(k) not in seen: seen.add(_fp(k)); d["_seen"] = sorted(seen)[-500:]; _save_marks(d)


ACCT_SLOW_FOR = float(os.environ.get("HF_ACCOUNT_REST", "1800"))  # an account that slowed down is skipped this long
_rot = lambda: globals().get("ROT") or {}  # (the run state is made further down; the first pick happens before it)


def _acct(k: str) -> str:
    """which account a key is on, as far as we know: its name; keys that hide it count as one group ("hidden");
    not looked up yet = its own group"""
    acc = _rot().get("accounts") or []
    try: n = acc[HF_KEYS.index(k)]
    except (ValueError, IndexError): n = None
    if not n or n == "?": return f"key:{_fp(k)}"
    if n.startswith("works"): return "hidden"
    return n


def _dead(k: str) -> bool:
    acc = _rot().get("accounts") or []
    try: return str(acc[HF_KEYS.index(k)] or "").startswith("not accepted")
    except (ValueError, IndexError): return False


def _pick_key(exclude: set[str]) -> str:
    """the next key: one on an account that hasn't just slowed down (Hugging Face slows a whole account, so another key
    on the same tired account stays slow), then a brand-new key (never used on a rental), then the key found slow
    longest ago; keys that can't download at all last; ties at random so rentals spread the load"""
    import random
    marks = _slow_marks(); seen = set(marks.get("_seen") or [])
    tired = {a for a, t in (_rot().get("acct_slow") or {}).items() if time.time() - t < ACCT_SLOW_FOR}
    left = [k for k in HF_KEYS if k not in exclude] or HF_KEYS
    random.shuffle(left)
    return min(left, key=lambda k: (_dead(k), _acct(k) in tired, _fp(k) in seen, marks.get(_fp(k), 0))) if left else ""


def _reload_keys() -> list[str]:
    """keys added to hf_tokens.txt on your drive while this rental runs (the Studio helper fetches the file again every
    couple of minutes): added to the list, so the next switch can use them — no reboot needed"""
    add = [k for k in _keys() if k not in HF_KEYS]
    if add: HF_KEYS.extend(add)
    return add


if len(HF_KEYS) > 1:
    HF_TOKEN = _pick_key(set())
if HF_TOKEN: _mark_seen(HF_TOKEN)


def _hf_accounts():
    """which Hugging Face account each key is on (names only, never the keys). Keys made on one account share its
    download limits, so switching between them can't get around a limit on the account — the page says so."""
    names: dict[int, str] = {}
    def who(i_k):
        i, k = i_k
        try:
            r = requests.get(os.environ.get("H3_HF_WHOAMI", "https://huggingface.co/api/whoami-v2"), headers={"Authorization": f"Bearer {k}"}, timeout=15)
            if r.ok: names[i] = r.json().get("name", "?"); return
            # "whose key is this?" refused doesn't mean the key is dead: a fine-grained key without the "read your
            # profile" permission still downloads fine. Ask for a real file to tell the two apart.
            names[i] = f"not accepted ({r.status_code})"
            probe = None
            try:  # the first Hugging Face file in models.txt (public)
                txt = open(sys.argv[1] if len(sys.argv) > 1 else "/opt/h3/models.txt").read()
                m = re.search(re.escape(HF_BASE) + r"\S+/resolve/\S+", txt)
                probe = m.group(0) if m else None
            except OSError:
                pass
            if probe:
                h = requests.head(probe, headers={"Authorization": f"Bearer {k}"}, allow_redirects=False, timeout=15)
                if h.status_code < 400: names[i] = "works (account not shown)"
        except Exception:
            names[i] = "?"
    # at most 12 keys are asked (spread over the list): asking Hugging Face "whose key is this?" a hundred times at once
    # counts against the account's request limit — the same account the downloads need
    idx = list(range(min(len(HF_KEYS), 40)))
    with cf.ThreadPoolExecutor(4) as ex: list(ex.map(who, [(i, HF_KEYS[i]) for i in idx]))
    ROT["accounts"] = [names.get(i, (ROT.get("accounts") or [])[i] if i < len(ROT.get("accounts") or []) else "?") for i in range(len(HF_KEYS))]
    real = {n for n in ROT["accounts"] if n and n != "?" and not n.startswith("not accepted")}
    log(f"Hugging Face keys belong to {len(real)} account(s): " + ", ".join(f"key {i + 1} = {names.get(i)}" for i in idx) + (f" (checked {len(idx)} of {len(HF_KEYS)})" if len(idx) < len(HF_KEYS) else ""))


def log(*a):
    print(f"[{time.strftime('%T')}] downloader:", *a, flush=True)


# ------------------------------------------------------------------ the list
def parse() -> list[dict]:
    groups: list[dict] = []
    cur = None
    def group(gid, label):
        g = next((x for x in groups if x["id"] == gid), None)
        if not g:
            g = {"id": gid, "label": label, "files": []}; groups.append(g)
        return g
    with open(MODELS_TXT) as f:
        for raw in f:
            line = raw.strip()
            m = re.match(r"#\s*@group\s+(\S+)\s*(.*)", line)
            if m:
                cur = group(m.group(1), m.group(2).strip() or m.group(1)); continue
            if not line or line.startswith("#"):
                continue
            parts = line.split("#", 1)[0].split() if " #" in line else line.split()
            sub, url = parts[0], parts[1]
            extra = [x for x in parts[2:] if not x.startswith("fallback=")]
            fallback = next((x[len("fallback="):] for x in parts[2:] if x.startswith("fallback=")), "")
            name = extra[0] if extra else os.path.basename(url.split("?")[0])
            (cur or group("models", "Models"))["files"].append({"sub": sub, "url": url, "name": name, "fallback": fallback})
    first = groups[0] if groups else group("models", "Models")
    # your Studio LoRA library (CivitAI links remembered with your settings): its own group, queued right after the
    # first one, so the Studio opens (and the anime tab unlocks) without waiting for CivitAI's slower servers
    lib = {"id": "library", "label": "Your LoRAs and models", "files": []}
    try:
        for rel, info in json.load(open(os.path.join(STATE_DIR, "loras.json"))).items():
            if info.get("version_id"):
                sub = "loras" + ("/" + os.path.dirname(rel) if os.path.dirname(rel) else "")
                lib["files"].append({"sub": sub, "url": f"https://civitai.com/api/download/models/{info['version_id']}", "name": os.path.basename(rel)})
    except FileNotFoundError:
        pass
    except Exception as e:  # noqa: BLE001
        log("couldn't read the LoRA library:", e)
    # your own checkpoints (Krea 2 / Anima fine-tunes from CivitAI) come back the same way
    try:
        for rel, info in json.load(open(os.path.join(STATE_DIR, "models.json"))).items():
            if info.get("version_id"):
                sub = info.get("folder", "diffusion_models") + ("/" + os.path.dirname(rel) if os.path.dirname(rel) else "")
                lib["files"].append({"sub": sub, "url": f"https://civitai.com/api/download/models/{info['version_id']}?type=Model&format=SafeTensor", "name": os.path.basename(rel)})
    except FileNotFoundError:
        pass
    except Exception as e:  # noqa: BLE001
        log("couldn't read your models:", e)
    if lib["files"]:
        groups.insert(groups.index(first) + 1 if first in groups else 0, lib)
    # EXTRA_MODELS from the template:  folder|url|filename, folder|url, ...
    extra = os.environ.get("EXTRA_MODELS", "").strip()
    if extra:
        g = group("extra", "Your extra models")
        for item in extra.split(","):
            bits = [b.strip() for b in item.split("|")]
            if len(bits) >= 2 and bits[0] and bits[1]:
                g["files"].append({"sub": bits[0], "url": bits[1], "name": bits[2] if len(bits) > 2 and bits[2] else os.path.basename(bits[1].split("?")[0])})
    seen: dict[str, dict] = {}
    for g in groups:
        keep = []
        for fl in g["files"]:
            fl["path"] = os.path.join(COMFY_DIR, "models", fl["sub"], fl["name"])
            if fl["path"] in seen:  # shared file (e.g. the Qwen Image VAE of Anima and Krea 2): the first group brings it
                seen[fl["path"]].setdefault("also", []).append(g["id"]); continue
            seen[fl["path"]] = fl; fl["gid"] = g["id"]; keep.append(fl)
        g["files"] = keep
    return [g for g in groups if g["files"] or g is first]


# ------------------------------------------------------------------ sizes + links
def resolve(fl: dict) -> None:
    """real download URL (CivitAI -> signed link, so the API key never goes to the file host) and its size"""
    url, headers = fl["url"], {}
    fl["resolved"] = time.time(); fl.pop("error", None); fl.pop("get", None)
    if HF_TOKEN and url.startswith(HF_BASE):
        headers["Authorization"] = f"Bearer {HF_TOKEN}"; fl["hf"] = True
    try:
        m = re.match(r"civitai-file:(\d+):(.+)$", url)
        if m:  # one file of a CivitAI version picked by a word in its name (versions with several files: bf16 / int8 / ...)
            r = None
            for key in (_civitai_keys() or [""]):
                r = requests.get(f"https://civitai.com/api/v1/model-versions/{m.group(1)}", headers={"Authorization": f"Bearer {key}"} if key else {}, timeout=30)
                if r.status_code not in (401, 403): break
            files = (r.json() if r.ok else {}).get("files") or []
            models = [f for f in files if (f.get("type") or "Model") == "Model"] or files
            word = m.group(2).lower()
            # by name ("…_int8.safetensors"), else by CivitAI's own labels for the file (precision, size, format)
            hit = next((f for f in models if word in (f.get("name") or "").lower()), None) \
                or next((f for f in models if any(word == str(v).lower() for v in (f.get("metadata") or {}).values())), None) \
                or (models[0] if len(models) == 1 else None)
            if not hit:
                fl["error"] = (f"CivitAI version {m.group(1)}: no file matching '{m.group(2)}' ({r.status_code}; files: "
                               + ", ".join(f"{f.get('name')} {f.get('metadata') or ''}" for f in models)[:300] + ")")
                log(f"{fl['name']}: {fl['error']}"); fl["get"] = url; fl["size"] = 0; return
            url = hit["downloadUrl"]
        if url.startswith("https://civitai.com/"):
            loc, r = "", None
            for key in (_civitai_keys() or [""]):  # each key until CivitAI hands out the file
                r = requests.get(url, headers={"Authorization": f"Bearer {key}"} if key else {}, allow_redirects=False, timeout=30)
                loc = r.headers.get("Location") or ""
                if loc and "/login" not in loc: break
            if loc and "/login" not in loc:  # without a key, some models redirect to the sign-in page instead of the file
                url = loc
            elif fl.get("fallback"):
                log(f"{fl['name']}: CivitAI gave no download link ({r.status_code}{'' if CIVITAI_TOKEN else ', no CIVITAI_TOKEN'}) — using {fl['fallback']}")
                url = fl["fallback"]
                if HF_TOKEN and url.startswith(HF_BASE):
                    headers["Authorization"] = f"Bearer {HF_TOKEN}"; fl["hf"] = True
            else:
                fl["error"] = f"CivitAI gave no download link ({r.status_code}) — check CIVITAI_TOKEN"
        fl["get"] = url
        # requests drops the Authorization header when a redirect leaves the original host
        r = requests.head(url, headers=headers, allow_redirects=True, timeout=30)
        if r.status_code >= 400 and fl.get("fallback") and not url.startswith("https://civitai.com/") and url != fl["fallback"]:
            log(f"{fl['name']}: {r.status_code} from {url.split('/resolve/')[0]} — using {fl['fallback']}")
            url = fl["get"] = fl["fallback"]
            headers = {"Authorization": f"Bearer {HF_TOKEN}"} if HF_TOKEN and url.startswith(HF_BASE) else {}
            fl["hf"] = bool(headers)
            r = requests.head(url, headers=headers, allow_redirects=True, timeout=30)
        fl["size"] = int(r.headers.get("Content-Length") or 0)
        # Hugging Face: download from the file server it redirects to, not from huggingface.co/…/resolve/. aria2 asks the
        # original link again for every 16 MB piece on every connection, and each of those asks counts against the account's
        # "resolver" limit (5,000 per 5 minutes on a free account): 100+ GB burns through it in minutes, then everything
        # crawls — that was the "a key slows to a crawl after one use". The file-server link is signed for about an hour,
        # so it's refreshed every 30 minutes (and after a key switch).
        fl.pop("cdn", None)
        if fl.get("hf") and r.status_code < 400 and r.url and not r.url.startswith(HF_BASE):
            fl["get"] = r.url; fl["cdn"] = True
        why = refused(fl["url"], r.status_code)
        if why and not fl.get("error"): fl["error"] = why; log(f"{fl['name']}: {why}")
    except Exception as e:  # noqa: BLE001
        if "get" not in fl and fl.get("fallback") and url.startswith("https://civitai.com/"):
            log(f"{fl['name']}: couldn't reach CivitAI ({e}) — using {fl['fallback']}")
            fl["get"] = fl["fallback"]; fl.pop("error", None)
            fl["hf"] = bool(HF_TOKEN and fl["get"].startswith(HF_BASE))
            try:
                h = {"Authorization": f"Bearer {HF_TOKEN}"} if fl["hf"] else {}
                fl["size"] = int(requests.head(fl["get"], headers=h, allow_redirects=True, timeout=30).headers.get("Content-Length") or 0)
                return
            except Exception:  # noqa: BLE001
                pass
        fl.setdefault("get", url); fl["size"] = 0
        log("couldn't size", fl["name"], e)


def refused(url: str, code: int) -> str:
    """why a server said no, in words you can act on ("" = it didn't)"""
    if code < 400: return ""
    hf = re.match(r"https://huggingface\.co/([^/]+/[^/]+)/", url)
    if hf and code in (401, 403):
        return (f"Hugging Face won't hand this file out ({code}): {hf.group(1)} is gated — open huggingface.co/{hf.group(1)} signed in "
                f"with the account your HF keys belong to, press 'Agree and access', then Retry" if HF_TOKEN else
                f"Hugging Face needs a key for this file ({code}): add HF_TOKENS to the template (and accept huggingface.co/{hf.group(1)}'s licence)")
    if hf and code == 404: return f"Hugging Face says this file isn't there any more (404) — {hf.group(1)} may have renamed it"
    if "civitai" in url and code in (401, 403): return f"CivitAI refused ({code}) with all {len(_civitai_keys())} of your keys — early access / members-only for the creator's supporters, or the keys expired (add more in civitai_keys.txt on your drive)"
    if "civitai" in url and code == 404: return "CivitAI says this version was removed (404) — re-add the LoRA from its page"
    if code == 429: return "too many requests right now (429) — Retry in a few minutes"
    return f"the server answered {code}"


def on_disk(fl: dict) -> int:
    for p in (fl["path"], fl["path"] + SUFFIX):
        try:
            st = os.stat(p)
            return min(st.st_size, st.st_blocks * 512) if p.endswith(SUFFIX) else st.st_size
        except FileNotFoundError:
            continue
    return 0


def complete(fl: dict) -> bool:
    return os.path.isfile(fl["path"]) and not os.path.exists(fl["path"] + ".aria2")


# ------------------------------------------------------------------ progress file
STATE = {"groups": [], "active": True, "speed_ok": None, "speed_best": None}
# key switches this rental, keys tried, best Hugging Face speed seen per key (a full ROT_WINDOW average), when the
# speed first went under ROTATE_MBPS (None = it isn't), time of the last switch, what happened last (for the page),
# and which Hugging Face account each key belongs to (keys of one account share that account's limits)
ROT = {"n": 0, "tried": set(), "best": {}, "slow_since": None, "last_switch": 0.0, "last": "", "hf_mbps": None, "accounts": None,
       "limited": 0}
RUNNING: set[str] = set()                 # paths in the current download run
FSEEN: dict[str, list] = {}               # path -> [last bytes, last time, time of last progress]


def switches() -> dict:
    try:
        return json.load(open(LATER_FILE))
    except (OSError, ValueError):
        return {}


def gpu_info() -> dict:
    """the card's name and memory (nvidia-smi); {} when there's no GPU to ask"""
    try:
        out = subprocess.run(["nvidia-smi", "--query-gpu=name,memory.total", "--format=csv,noheader,nounits"], capture_output=True, text=True, timeout=10).stdout.strip().splitlines()
        name, mb = [x.strip() for x in out[0].split(",")[:2]]
        return {"name": name, "vram_mb": int(float(mb))}
    except Exception:  # noqa: BLE001
        return {}


GPU = gpu_info()
# Everything is queued by default, in models.txt order; only "Later" (yours), SKIP_MODELS, a group that needs a bigger card,
# or one the disk has no room for waits. Images-only: a card under ~30 GB (4090, 5080, 5070 Ti…) can't run H3 video or the
# 27B writer next to the picture models, so those go to the END of the queue (they still download, last, if there's room).
# H3_IMAGES_ONLY=1/0 forces it on or off; H3_SMALL_LATER=1 makes them "later" instead, like before.
SMALL_GPU = os.environ.get("H3_IMAGES_ONLY") == "1" or (os.environ.get("H3_IMAGES_ONLY") != "0" and 0 < GPU.get("vram_mb", 0) < 30000)
SMALL_SKIP = {"video", "writer_xl", "autoprompter", "eros"}
# Waiting until asked for (status menu → Now, or the tab that needs it): Eros Max (Animate → Video model), LoRA training
# (Characters → Train) and the AutoPrompter extras (old node-editor workflow only) — they ate the disk the 27B writer needs
DEFAULT_LATER = {x.strip() for x in os.environ.get("H3_DEFAULT_LATER", "eros,autoprompter,trainer").split(",") if x.strip()}


def queue_order(groups, nxt=()) -> list:
    """the download order: the first group, then what you asked for next, then the rest in models.txt order — on a small
    card the groups it can't run go last"""
    rest = [g for g in groups[1:] if g["id"] not in nxt]
    if SMALL_GPU: rest = [g for g in rest if g["id"] not in SMALL_SKIP] + [g for g in rest if g["id"] in SMALL_SKIP]
    return groups[:1] + [g for x in nxt for g in groups if g["id"] == x] + rest


# the bf16 Qwen build only runs on 48 GB+ cards, the 27B writer on 28 GB+ (on smaller ones it spills onto the CPU and times
# out, so the Studio uses the 9B there): on a smaller card they never download, even if a past rental said "now"
BIG_ONLY = {"qwen_full": 44000, "writer_xl": 28000}
# room kept free on the disk for your results, imports, LoRAs, the writer's scratch files and ComfyUI's temp files
DISK_RESERVE = int(float(os.environ.get("DISK_RESERVE_GB", "15")) * 2**30)


def later_ids(groups) -> set[str]:
    d = switches()
    small = SMALL_SKIP if SMALL_GPU and os.environ.get("H3_SMALL_LATER") == "1" else set()
    ids = (SKIP | DEFAULT_LATER | small | set(d.get("later") or [])) - set(d.get("now") or [])
    vram = GPU.get("vram_mb", 0)
    ids |= {g for g, need in BIG_ONLY.items() if 0 < vram < need}
    if groups: ids.discard(groups[0]["id"])
    return ids


def room_for(groups, later: set[str]) -> set[str]:
    """groups that don't fit on the disk: walking the queue in order, a group whose missing bytes would leave less than
    DISK_RESERVE free waits (as "later", saying why) — a full disk breaks everything else on the rental"""
    models = os.path.join(COMFY_DIR, "models")
    try: free = shutil.disk_usage(models if os.path.isdir(models) else COMFY_DIR).free
    except OSError: return set()
    left, out = free - DISK_RESERVE, set()
    for i, g in enumerate(queue_order(groups, next_ids(groups))):
        if g["id"] in later: continue
        need = sum(max(0, f.get("size", 0) - on_disk(f)) for f in g["files"] if not complete(f))
        if i and need > left: out.add(g["id"]); continue
        left -= need
    return out


def next_ids(groups) -> list[str]:
    """groups you asked for next ("Next"), most recent first — they jump the queue right after the first group"""
    have = {g["id"] for g in groups[1:]}
    return [x for x in (switches().get("next") or []) if x in have]


def source(fl: dict) -> str:
    u = fl.get("get") or fl["url"]
    hf = "huggingface" in fl["url"] or "hf.co" in fl["url"] or "huggingface" in u or "hf.co" in u
    # no HF_TOKEN on the rental: Hugging Face serves it much slower — say so on the download screen
    key = f" · key {HF_KEYS.index(HF_TOKEN) + 1}/{len(HF_KEYS)}" if len(HF_KEYS) > 1 and HF_TOKEN in HF_KEYS else ""
    return "CivitAI" if "civitai" in fl["url"] or "civitai" in u else (f"Hugging Face{key}" if HF_TOKEN else "Hugging Face · no token") if hf else (re.sub(r"^https?://([^/]+).*", r"\1", u))


def file_info(g: dict, f: dict, now: float) -> dict:
    have = on_disk(f); size = f.get("size", 0)
    seen = FSEEN.setdefault(f["path"], [have, now, now])
    speed = max(0.0, (have - seen[0]) / 1048576 / max(0.5, now - seen[1])) if now > seen[1] else 0.0
    if have > seen[0]: seen[2] = now
    seen[0], seen[1] = have, now
    if complete(f): st = "done"
    elif f.get("error"): st = "failed"
    elif g.get("later"): st = "later"
    elif f["path"] in RUNNING:
        st = "queued" if have == 0 and now - seen[2] < 60 else "stalled" if now - seen[2] >= 30 else "active"
    else: st = "waiting"
    return {"n": f["name"], "group": g["id"], "g": min(have, size or have) // 1048576, "t": size // 1048576,
            "src": source(f), "s": round(speed, 1), "st": st, "err": f.get("error")}


def queue_wait(files: list[dict]) -> list[dict]:
    """aria2c only moves 8 files at once; the rest sit at 0 bytes in its queue. That's waiting for a free slot, not stuck."""
    moving = sum(1 for f in files if f["st"] == "active")
    if moving >= max(4, JOBS - 2):  # all slots busy: a file that never started is in line
        for f in files:
            if f["st"] in ("stalled", "queued") and f["g"] == 0: f["st"] = "waiting"
    return files


def write(groups, rate_now=0.0, rate_avg=0.0, note=""):
    now = time.time()
    live = [g for g in groups if not g.get("later")]
    total = sum(f.get("size", 0) for g in live for f in g["files"])
    done = sum(min(on_disk(f), f.get("size", 0) or on_disk(f)) for g in live for f in g["files"])
    out_groups, ahead = [], 0
    for g in groups:
        gt = sum(f.get("size", 0) for f in g["files"]); gd = sum(min(on_disk(f), f.get("size", 0) or on_disk(f)) for f in g["files"])
        if not g.get("later"): ahead += max(0, gt - gd)
        left = 0 if g["state"] == "done" else -1 if g.get("later") or rate_avg <= 0 else int(ahead / 1048576 / rate_avg)
        out_groups.append({"id": g["id"], "label": g["label"], "state": g["state"], "error": g.get("error"),
                           "total_mb": gt // 1048576, "done_mb": gd // 1048576, "can_later": g is not groups[0], "why": g.get("why"),
                           "pct": 100 if g["state"] == "done" else (min(99, int(gd * 100 / gt)) if gt else 0), "left_s": left})
    s = {"active": any(g["state"] in ("waiting", "downloading", "checking") for g in groups),
         "first": groups[0]["id"] if groups else None,
         "groups": out_groups, "total_mb": total // 1048576, "done_mb": done // 1048576, "gpu": {**GPU, "images_only": SMALL_GPU},
         "pct": int(done * 100 / total) if total else (100 if all(g["state"] in ("done", "later") for g in groups) else 0),
         "mbps": round(rate_now), "avg_mbps": round(rate_avg),
         "left_s": int((total - done) / 1048576 / rate_avg) if rate_avg > 0 else -1,
         "elapsed_s": int(now - T0), "note": note, "hf_key": ({"n": HF_KEYS.index(HF_TOKEN) + 1, "of": len(HF_KEYS), "switches": ROT["n"], "last": ROT["last"], "mbps": ROT["hf_mbps"], "accounts": ROT["accounts"], "limited": ROT["limited"],
                    "account": _acct(HF_TOKEN), "tired_accounts": sorted(a for a, t in (ROT.get("acct_slow") or {}).items() if time.time() - t < ACCT_SLOW_FOR)} if HF_TOKEN in HF_KEYS else None), "speed_ok": STATE["speed_ok"], "speed_best": STATE["speed_best"],
         "files": queue_wait([file_info(g, f, now) for g in groups for f in g["files"]])}
    tmp = OUT + ".tmp"
    with open(tmp, "w") as fh:
        json.dump(s, fh)
    os.replace(tmp, OUT)


def flag(name):
    open(os.path.join(RUN, f"dl_{name}.done"), "w").close()


# ------------------------------------------------------------------ main
def main() -> int:
    global HF_TOKEN
    os.makedirs(RUN, exist_ok=True)
    if HF_KEYS: log(f"{len(HF_KEYS)} Hugging Face key(s); starting on key {HF_KEYS.index(HF_TOKEN) + 1}")
    if len(HF_KEYS) > 1:
        import threading
        threading.Thread(target=_hf_accounts, daemon=True).start()
    # "Later" is for this rental only: a fresh rental starts with everything queued again (a past rental's — or an
    # imported export's — Later doesn't carry over; nor does "Next")
    try:
        d = json.load(open(LATER_FILE))
        if d.get("later") or d.get("next"):
            d.pop("later", None); d.pop("next", None)
            with open(LATER_FILE + ".tmp", "w") as fh: json.dump(d, fh)
            os.replace(LATER_FILE + ".tmp", LATER_FILE); log("starting with every group queued (Later is per rental)")
    except (OSError, ValueError): pass
    groups = parse()
    for g in groups:
        g["state"] = "checking"
    write(groups, note="checking model files")
    with cf.ThreadPoolExecutor(16) as ex:
        list(ex.map(resolve, [f for g in groups for f in g["files"]]))
    for g in groups:
        g["state"] = "done" if all(complete(f) for f in g["files"]) else "waiting"
    write(groups)
    hook = os.path.join(RUN, "aria_done.sh")
    with open(hook, "w") as fh:
        fh.write('#!/bin/bash\n# aria2 calls this with: GID NUM_FILES PATH — drop the ".downloading" suffix of a finished file\n'
                 f'[[ "$3" == *{SUFFIX} ]] && mv -f "$3" "${{3%{SUFFIX}}}"\nexit 0\n')
    os.chmod(hook, 0o755)

    if REMOTE:
        # LoRAs you uploaded yourself live in your cloud backup
        dest = os.path.join(COMFY_DIR, "models", "loras", "uploaded")
        os.makedirs(dest, exist_ok=True)
        subprocess.run(["timeout", "600", "rclone", "copy", f"{REMOTE.rstrip('/')}/_loras", dest], capture_output=True)

    # One queue for everything, in group order, up to 8 files at a time: when a file finishes the next one starts, so
    # one slow file (often a LoRA from CivitAI) never leaves the line idle while it crawls. Groups still arrive in order
    # because they're queued in order; each group is flagged done the moment its own files are in. Groups switched to
    # "later" are left out; switching one (either way) restarts the queue, and partly downloaded files carry on.
    flagged: set[str] = set()
    NOSPACE_LOGGED: set[str] = set(); PRUNED: set[str] = set(); prune = False
    def mark_later():
        later = later_ids(groups)
        full = room_for(groups, later)
        vram = GPU.get("vram_mb", 0)
        for g in groups:
            g["later"] = (g["id"] in later or g["id"] in full) and not all(complete(f) for f in g["files"])
            g["why"] = ("not enough disk — rent with a bigger disk, or press Later on another group" if g["id"] in full
                        else f"needs a {BIG_ONLY[g['id']] // 1000 + 4} GB+ card" if g["id"] in BIG_ONLY and 0 < vram < BIG_ONLY[g["id"]] else None) if g["later"] else None
            if g["id"] in full and g["id"] not in NOSPACE_LOGGED: NOSPACE_LOGGED.add(g["id"]); log(f"{g['label']}: waiting — not enough disk")
    def check_groups(final=False):
        for gi, g in enumerate(groups):
            if g["id"] in flagged:
                continue
            files = g["files"]
            if all(complete(f) for f in files):
                g["state"] = "done"; g.pop("error", None); flag(g["id"]); flagged.add(g["id"]); log(f"{g['label']}: done")
            elif g.get("later"):
                g["state"] = "later"
            elif final or all(complete(f) or f.get("error") for f in files):
                missing = [f for f in files if not complete(f)]
                why = next((f["error"] for f in missing if f.get("error") and f["error"] != "download failed"), "")
                g["state"] = "error"; g["error"] = f"{len(missing)} file(s) failed: " + ", ".join(f["name"] for f in missing[:3]) + (f" — {why}" if why else "")
            elif any(on_disk(f) for f in files if not complete(f)) or any(f["path"] in RUNNING for f in files):
                g["state"] = "downloading"
            else:
                g["state"] = "waiting"
            if gi == 0 and "first" not in flagged and (final or g["state"] in ("done", "error")):
                flag("first"); flagged.add("first")  # the Studio opens even if a file of the first group failed
    def wanted(f: dict) -> bool:  # a shared file is wanted if any group that uses it is wanted
        return any(not next(g for g in groups if g["id"] == gid).get("later") for gid in [f["gid"], *f.get("also", [])])
    def drop_partial(f: dict):  # start a file over (a server that can't resume a half-downloaded file)
        for x in (f["path"] + SUFFIX, f["path"] + SUFFIX + ".aria2"):
            try: os.remove(x)
            except FileNotFoundError: pass
    def finish_parts():  # finished files the hook missed (e.g. resumed ones) get their real name too
        for f in [f for g in groups for f in g["files"]]:
            part = f["path"] + SUFFIX
            if os.path.exists(part) and not os.path.exists(part + ".aria2"):
                shutil.move(part, f["path"])
    with open(os.path.join(RUN, "downloader.pid"), "w") as fh:
        fh.write(str(os.getpid()))
    mark_later(); check_groups(); write(groups)
    lf_mtime = os.path.getmtime(LATER_FILE) if os.path.exists(LATER_FILE) else 0

    p = None; dl_start = None; dl_base = 0; launched_order: tuple = ()
    last_t, last_b = time.time(), sum(on_disk(f) for g in groups for f in g["files"])
    rate_now = rate_avg = 0.0
    samples: list[tuple[float, int]] = []  # (time, bytes on disk) for the speed check
    hf_samples: list[tuple[float, int, int]] = []  # (time, bytes of the Hugging Face files in this run, how many are running)
    launched_at = time.time(); by_path = {}; run_hf: list[dict] = []; log_pos = 0
    shown: list[tuple[float, int]] = []  # (time, bytes) of the last ~12 s, for the speed on the page (3 s alone jumps around)
    log_out = open("/var/log/aria2.log" if os.path.isdir("/var/log") and os.access("/var/log", os.W_OK) else os.devnull, "a")
    while True:
        mark_later()
        m = os.path.getmtime(LATER_FILE) if os.path.exists(LATER_FILE) else 0
        if m != lf_mtime:  # a switch was pressed: "Download now" on a failed group retries its files
            lf_mtime = m
            prune = True
            for g in groups:
                if g.get("later"): continue
                for f in g["files"]:
                    if f.get("error") and not complete(f):
                        log(f"{f['name']}: trying again"); drop_partial(f); f.pop("fresh", None); resolve(f)
        nxt = next_ids(groups)
        order = queue_order(groups, nxt)
        want = [f for g in order for f in g["files"] if wanted(f) and not complete(f) and not f.get("error")]
        keys = {f["path"] for f in want}
        by_path = {f["path"]: f for g in groups for f in g["files"]}
        # restart only when you switched something: a group added or dropped, or a group moved up with "Next"
        # (files finishing on their own don't count)
        changed = bool(keys - RUNNING) or any(not complete(by_path[x]) and not by_path[x].get("error") for x in RUNNING - keys) \
            or tuple(nxt) != launched_order
        if p is not None and p.poll() is None and changed:
            log("queue changed (Later, Download now or Next was pressed) — restarting it")
            p.terminate()
            try: p.wait(timeout=30)
            except subprocess.TimeoutExpired: p.kill(); p.wait()
            finish_parts(); p = None; RUNNING.clear(); continue
        if p is not None and p.poll() is not None:  # the run ended: whatever it couldn't fetch is marked failed
            finish_parts()
            for f in want:
                if f["path"] in RUNNING and not complete(f):
                    if on_disk(f) and not f.get("fresh"):  # failed part-way: once more from the start, automatically
                        f["fresh"] = True; drop_partial(f); log(f"{f['name']}: failed part-way — starting it over")
                        continue
                    f["error"] = "download failed"; log(f"{f['name']}: download failed")
            p = None; RUNNING.clear(); check_groups(); write(groups, 0, rate_avg); continue
        if p is None and (prune or NOSPACE_LOGGED - PRUNED):
            # groups left for later (or waiting for disk room): their half-downloaded files go — tens of GB on a small disk
            prune = False
            for g in groups:
                if not g.get("later"): continue
                PRUNED.add(g["id"])
                for f in g["files"]:
                    if not complete(f) and not wanted(f) and os.path.exists(f["path"] + SUFFIX):
                        log(f"{f['name']}: left for later — removing the part downloaded ({on_disk(f) // 2**20} MB)"); drop_partial(f)
        if p is None and want:
            # CivitAI's download links expire: refresh any older than half an hour (e.g. a group started "later")
            stale = [f for f in want if (f["url"].startswith(("https://civitai.com/", "civitai-file:")) and time.time() - f.get("resolved", 0) > 1800)
                     or (f.get("cdn") and (time.time() - f.get("resolved", 0) > 1800 or f.get("resolved", 0) < ROT["last_switch"]))]
            if stale:
                with cf.ThreadPoolExecutor(8) as ex: list(ex.map(resolve, stale))
                want = [f for f in want if not f.get("error")]
                keys = {f["path"] for f in want}
                if not want: continue
            inp = os.path.join(RUN, "aria2_all.txt")
            with open(inp, "w") as fh:
                for f in want:
                    os.makedirs(os.path.dirname(f["path"]), exist_ok=True)
                    fh.write(f"{f['get']}\n  dir={os.path.dirname(f['path'])}\n  out={f['name']}{SUFFIX}\n")
                    if f.get("hf") and f["get"].startswith(HF_BASE):
                        fh.write(f"  header=Authorization: Bearer {HF_TOKEN}\n")
            log(f"downloading {len(want)} files in one queue")
            if dl_start is None:
                dl_start, dl_base = time.time(), sum(on_disk(f) for g in groups for f in g["files"])
                last_t, last_b = dl_start, dl_base
            RUNNING.clear(); RUNNING.update(keys); launched_order = tuple(nxt); launched_at = time.time(); hf_samples.clear()
            run_hf = [f for f in want if f.get("hf")]; ROT["slow_since"] = None
            try: log_pos = os.path.getsize(log_out.name) if log_out.name != os.devnull else 0
            except OSError: log_pos = 0
            p = subprocess.Popen(["aria2c", f"--input-file={inp}", "-j", str(JOBS), "-x", str(CONNS), "-s", str(CONNS), "-k", "64M", "--continue=true",
                                  "--file-allocation=none", "--auto-file-renaming=false", "--allow-overwrite=true",
                                  # a connection that really stalls (under LOWEST for a while) is dropped and retried instead of hanging
                                  f"--lowest-speed-limit={LOWEST}", "--max-tries=20", "--retry-wait=15", "--timeout=30", "--connect-timeout=15",
                                  "--summary-interval=0", "--console-log-level=warn", f"--on-download-complete={hook}"],
                                 stdout=log_out, stderr=subprocess.STDOUT)
        if p is None and not want:
            if not any(g.get("later") for g in groups):
                break
            # only "later" groups left: wait here until one is asked for (Download now)
        time.sleep(3)
        now = time.time(); b = sum(on_disk(f) for g in groups for f in g["files"])
        shown.append((now, b)); del shown[:-5]
        rate_now = max(0.0, (b - shown[0][1]) / 1048576 / max(0.5, now - shown[0][0])) if len(shown) > 1 else 0.0
        last_t, last_b = now, b
        if dl_start is not None:
            rate_avg = (b - dl_base) / 1048576 / max(1.0, now - dl_start)
        # Hugging Face slow on this key: switch keys (aria2 carries on where each file stopped).
        # Measured over every Hugging Face file in this run, finished ones included — a file finishing must not look
        # like the speed dropping to zero (that was what made it switch while it was going fast).
        # new keys on your drive (made on Hugging Face while this runs): picked up without a reboot
        if now - ROT.get("reloaded", 0) >= 60:
            ROT["reloaded"] = now
            added = _reload_keys()
            if added:
                log(f"{len(added)} new Hugging Face key(s) from your drive — now {len(HF_KEYS)}")
                ROT["last"] = f"{len(added)} new key(s) from your drive"
                threading.Thread(target=_hf_accounts, daemon=True).start()  # which account the new keys are on
                if ROT.get("slow_since") is not None: ROT["last_switch"] = 0.0  # slow right now: try the new key at once
        if p is not None and p.poll() is None and len(HF_KEYS) > 1 and run_hf:
            hb = sum(on_disk(f) for f in run_hf)
            n_live = sum(1 for f in run_hf if not complete(f))
            hf_samples.append((now, hb, n_live))
            del hf_samples[:-120]
            # from the newest sample that is at least a full window old (none yet = not judged yet)
            old = next(((t, x, n) for t, x, n in reversed(hf_samples) if now - t >= ROT_WINDOW), None)
            span = now - old[0] if old else 0
            hf_rate = max(0.0, (hb - old[1]) / 1048576 / span) if old and span > 0 else None
            if hf_rate is not None:
                ROT["hf_mbps"] = round(hf_rate)
            # rate limited ("429 Too Many Requests" in aria2's log since this run started): the key is the problem
            limited = False
            if log_out.name != os.devnull:
                try:
                    with open(log_out.name, "rb") as lf:
                        lf.seek(max(log_pos, os.path.getsize(log_out.name) - 262144)); tail = lf.read()
                    limited = b"status=429" in tail or b"Too Many Requests" in tail
                except OSError:
                    pass
            # only judge with a fair picture: past the ramp-up, a full window, and at least 3 files still going
            # (2 big files at the end can't fill the line by themselves — that's the tail, not a throttle)
            # still starting (under 50 MB moved since this key began, for up to 90 s): not judged yet
            started = hf_samples and (hb - hf_samples[0][1]) >= 50 * 1048576
            fair = hf_rate is not None and now - launched_at >= ROT_WARMUP and min(n for t, _, n in hf_samples if t >= old[0]) >= 3 \
                and (started or now - launched_at >= 90)
            # slow = under half of what this key did here (it started fast, then got throttled), or under ROTATE_MBPS
            mine = ROT["best"].get(HF_TOKEN, 0.0)
            slow_mark = min(ROTATE_MBPS, mine * 0.5) if mine >= 20 else ROTATE_MBPS
            if fair:
                ROT["best"][HF_TOKEN] = max(mine, hf_rate)
                ROT["tried"].add(HF_TOKEN)
                if hf_rate >= slow_mark:
                    ROT["slow_since"] = None
                elif ROT["slow_since"] is None:
                    ROT["slow_since"] = now
            elif hf_rate is not None and hf_rate >= slow_mark:
                ROT["slow_since"] = None
            need = ROT_SLOW_FOR_FAST if ROT["best"].get(HF_TOKEN, 0) >= STAY_MBPS else ROT_SLOW_FOR
            slow_long = ROT["slow_since"] is not None and now - ROT["slow_since"] >= need
            if limited and fair and hf_rate < slow_mark:
                slow_long = True; ROT["limited"] += 1
            if slow_long and fair and now - ROT["last_switch"] >= ROT_GAP:
                untried = [k for k in HF_KEYS if k not in ROT["tried"]]
                why = "Hugging Face said too many requests" if limited else f"{hf_rate:.0f} MB/s for {int(now - ROT['slow_since'])} s"
                nk = None
                if untried:
                    _mark_slow(HF_TOKEN); ROT.setdefault("acct_slow", {})[_acct(HF_TOKEN)] = now; nk = _pick_key(ROT["tried"])
                else:
                    # every key tried: settle on the one that was fastest, if it was clearly faster (then stop switching)
                    # every key tried: keys recover after a while, so go round again, starting with the one slowed longest
                    # ago — unless no key ever did better than this one (then the limit is the machine, not the key)
                    if len(HF_KEYS) > 1 and max(ROT["best"].values(), default=0.0) > hf_rate * 1.5:
                        _mark_slow(HF_TOKEN); ROT.setdefault("acct_slow", {})[_acct(HF_TOKEN)] = now; ROT["tried"] = {HF_TOKEN}; nk = _pick_key({HF_TOKEN})
                    else:
                        ROT["slow_since"] = None
                        ROT["last"] = f"every key tried — staying on key {HF_KEYS.index(HF_TOKEN) + 1} ({hf_rate:.0f} MB/s; no key was faster, so the limit is the machine)"
                if nk:
                    msg = f"key {HF_KEYS.index(HF_TOKEN) + 1} → key {HF_KEYS.index(nk) + 1} ({why})"
                    log(f"switching Hugging Face key: {msg}")
                    HF_TOKEN = nk; ROT["n"] += 1; ROT["last_switch"] = now; ROT["last"] = msg; _mark_seen(nk)
                    p.terminate()
                    try: p.wait(timeout=30)
                    except subprocess.TimeoutExpired: p.kill(); p.wait()
                    finish_parts(); p = None; RUNNING.clear(); hf_samples.clear(); continue
        # Hugging Face file-server links run out after about an hour: restart before they do (finished pieces are kept)
        if p is not None and p.poll() is None and any(f.get("cdn") and f["path"] in RUNNING and not complete(f) and now - f.get("resolved", 0) > 2700
                                                      for g in groups for f in g["files"]):
            log("refreshing Hugging Face download links (they expire after about an hour)")
            p.terminate()
            try: p.wait(timeout=30)
            except subprocess.TimeoutExpired: p.kill(); p.wait()
            finish_parts(); p = None; RUNNING.clear(); hf_samples.clear(); continue
        if STATE["speed_ok"] is None and p is not None:
            samples.append((now, b))
            best = 0.0
            for t1, b1 in samples:  # best WINDOW-second stretch so far
                t0, b0 = next(((t, x) for t, x in reversed(samples) if t1 - t >= WINDOW), (None, None))
                if t0 is not None: best = max(best, (b1 - b0) / 1048576 / (t1 - t0))
            STATE["speed_best"] = round(best)
            # judge once it has had a fair go — nothing at all arriving is more likely a hiccup at the model site
            # than a slow machine, so give that longer before deciding
            if now - dl_start >= SPEED_CHECK_SECONDS and (b > dl_base or now - dl_start >= SPEED_CHECK_SECONDS * 3):
                if best < KILL_MBPS:
                    STATE["speed_ok"] = False
                    p.terminate()
                    g0 = next((g for g in groups if g["id"] not in flagged), groups[0])
                    g0["state"] = "error"; g0["error"] = f"too slow: {best:.0f} MB/s at best"
                    write(groups, rate_now, rate_avg, note="slow"); log(f"host too slow ({best:.0f} MB/s at best)")
                    return 3
                STATE["speed_ok"] = best >= MIN_MBPS
                log(f"speed check {'passed' if STATE['speed_ok'] else 'slow but usable'}: best {best:.0f} MB/s, average {rate_avg:.0f} MB/s")
        check_groups()
        write(groups, rate_now, rate_avg)
    check_groups(final=True)
    write(groups, 0, rate_avg, note="done")
    log("all groups finished")
    return 0


if __name__ == "__main__":
    sys.exit(main())
