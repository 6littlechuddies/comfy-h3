#!/usr/bin/env python3
"""H3 Hugging Face key helper for macOS.

When a rental asks for fresh Hugging Face keys (you press "Get a fresh key from my PC" on the start page), it leaves
"H3 Studio/hf_key_request.txt" on your Google Drive. This helper notices it (macOS checks once a minute in the
background), signs in to Hugging Face in a hidden browser, makes the keys and adds them to "H3 Studio/hf_tokens.txt".
The rental picks them up within about 2 minutes.

- No window pops up. It only appears when you run "Log in (show window)" yourself, e.g. if Hugging Face wants a code.
- Passwords stay in the Mac's Keychain (service "h3-hf-key-helper"). Keys are never printed in full, only hf_ab…yz.
- Nothing runs unless a request is waiting.

Commands: check | now [N] | login [account] | add-account <login> | remove-account <login> | status
"""
from __future__ import annotations

import fcntl
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path

APP = Path(os.environ.get("H3_HELPER_HOME") or Path.home() / "Library/Application Support/H3KeyHelper")
CONF = APP / "config.json"
STATE = APP / "state.json"
LOG = APP / "helper.log"
RCLONE = os.environ.get("H3_RCLONE") or str(APP / "rclone")
RCLONE_CONF = str(APP / "rclone.conf")
REMOTE = os.environ.get("H3_REMOTE", "h3drive")
FOLDER = os.environ.get("H3_FOLDER", "H3 Studio")
HF = os.environ.get("H3_HF_BASE", "https://huggingface.co").rstrip("/")
SERVICE = "h3-hf-key-helper"
KEYS_FILE = "hf_tokens.txt"
REQUEST = "hf_key_request.txt"
TOKEN_RE = re.compile(r"hf_[A-Za-z0-9]{30,}")


# ---------- small helpers ----------

def mask(s: str) -> str:
    return TOKEN_RE.sub(lambda m: m.group(0)[:5] + "…" + m.group(0)[-2:], s)


def log(*a) -> None:
    line = time.strftime("%Y-%m-%d %H:%M:%S ") + mask(" ".join(str(x) for x in a))
    print(line, flush=True)
    try:
        APP.mkdir(parents=True, exist_ok=True)
        if LOG.exists() and LOG.stat().st_size > 1_000_000:
            LOG.replace(LOG.with_suffix(".old.log"))
        with open(LOG, "a") as f:
            f.write(line + "\n")
    except OSError:
        pass


def notify(text: str, title: str = "H3 key helper") -> None:
    if sys.platform != "darwin" or os.environ.get("H3_NO_NOTIFY"):
        return
    esc = lambda s: s.replace("\\", "\\\\").replace('"', '\\"')
    subprocess.run(["osascript", "-e", f'display notification "{esc(text)}" with title "{esc(title)}"'],
                   capture_output=True)


def load(p: Path, default):
    try:
        return json.loads(p.read_text())
    except (OSError, ValueError):
        return default


def save(p: Path, data) -> None:
    APP.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, indent=2))
    os.chmod(tmp, 0o600)
    tmp.replace(p)


def accounts() -> list[dict]:
    return load(CONF, {}).get("accounts", [])


def password(login: str) -> str | None:
    if os.environ.get("H3_FAKE_KEYCHAIN"):  # tests only
        return load(Path(os.environ["H3_FAKE_KEYCHAIN"]), {}).get(login)
    r = subprocess.run(["security", "find-generic-password", "-s", SERVICE, "-a", login, "-w"],
                       capture_output=True, text=True)
    return r.stdout.rstrip("\n") if r.returncode == 0 else None


# ---------- Google Drive (through rclone, signed in once by the installer) ----------

def rclone(*args: str, inp: str | None = None, timeout: int = 120) -> tuple[int, str]:
    try:
        r = subprocess.run([RCLONE, "--config", RCLONE_CONF, *args], input=inp, capture_output=True, text=True,
                           timeout=timeout)
        return r.returncode, (r.stdout if r.returncode == 0 else r.stderr)
    except (OSError, subprocess.TimeoutExpired) as e:
        return 1, str(e)


def drive(name: str) -> str:
    return f"{REMOTE}:{FOLDER}/{name}"


def read_request() -> dict | None:
    rc, out = rclone("lsjson", f"{REMOTE}:{FOLDER}", "--files-only", "--include", REQUEST, timeout=60)
    if rc != 0:
        log("!! can't see your Google Drive:", out.strip()[-300:])
        return None
    if REQUEST not in out:
        return None
    rc, txt = rclone("cat", drive(REQUEST))
    if rc != 0:
        log("!! can't read the request:", txt.strip()[-300:])
        return None
    try:
        req = json.loads(txt)
    except ValueError:
        req = {}
    return req if isinstance(req, dict) else {}


def add_keys_to_drive(keys: list[str]) -> bool:
    rc, old = rclone("cat", drive(KEYS_FILE))
    if rc != 0:
        old = ""  # first time: the file isn't there yet
    text = old.rstrip("\n") + ("\n" if old.strip() else "") + "\n".join(keys) + "\n"
    rc, out = rclone("rcat", drive(KEYS_FILE), inp=text)
    if rc != 0:
        log("!! couldn't add the keys to", KEYS_FILE, ":", out.strip()[-300:])
        # never lose a key: keep it here so "now" can be re-run or the file fixed by hand
        with open(APP / "unsent_keys.txt", "a") as f:
            f.write("\n".join(keys) + "\n")
        os.chmod(APP / "unsent_keys.txt", 0o600)
        return False
    return True


def delete_request() -> None:
    rclone("deletefile", drive(REQUEST), "--drive-use-trash=false", timeout=60)


# ---------- Hugging Face, in a hidden browser ----------

def browser(acct: dict, show: bool):
    from playwright.sync_api import sync_playwright
    pw = sync_playwright().start()
    prof = APP / "profiles" / re.sub(r"[^A-Za-z0-9_.-]", "_", acct["login"])
    prof.mkdir(parents=True, exist_ok=True)
    ctx = pw.chromium.launch_persistent_context(str(prof), headless=not show, viewport={"width": 1200, "height": 900})
    return pw, ctx


def whoami(page) -> str | None:
    try:
        res = page.evaluate("""async (u) => { const r = await fetch(u, {credentials: 'include'});
                                              return r.ok ? (await r.json()).name || '' : null }""",
                            HF + "/api/whoami-v2")
        return res or None
    except Exception:  # noqa: BLE001
        return None


def signed_in(page) -> str | None:
    if not page.url.startswith(HF):
        page.goto(HF + "/", wait_until="domcontentloaded")
    return whoami(page)


def sign_in(page, acct: dict) -> str | None:
    name = signed_in(page)
    if name:
        return name
    pw = password(acct["login"])
    if not pw:
        log(f"!! no password in Keychain for {acct['login']} — run \"Add a Hugging Face account\" again")
        return None
    page.goto(HF + "/login", wait_until="domcontentloaded")
    page.fill('input[name="username"]', acct["login"])
    page.fill('input[name="password"]', pw)
    page.press('input[name="password"]', "Enter")
    try:
        page.wait_for_url(lambda u: "/login" not in u, timeout=20_000)
    except Exception:  # noqa: BLE001
        pass
    page.wait_for_timeout(1500)
    return whoami(page)


def confirm_password_if_asked(page, acct: dict) -> None:
    """Hugging Face sometimes asks for your password again before making a key"""
    box = page.locator('input[type="password"]:visible')
    if box.count():
        pw = password(acct["login"])
        if pw:
            box.first.fill(pw)
            box.first.press("Enter")
            page.wait_for_timeout(2000)


def make_key(page, acct: dict, label: str) -> str | None:
    page.goto(HF + "/settings/tokens/new?tokenType=read", wait_until="domcontentloaded")
    page.wait_for_timeout(1000)
    confirm_password_if_asked(page, acct)
    if "/settings/tokens/new" not in page.url:
        page.goto(HF + "/settings/tokens/new?tokenType=read", wait_until="domcontentloaded")
    # "Read" token type, when the page shows the type tabs
    for sel in ('button:has-text("Read")', 'label:has-text("Read")'):
        el = page.locator(sel)
        if el.count():
            try:
                el.first.click(timeout=2000)
            except Exception:  # noqa: BLE001
                pass
            break
    name_box = None
    for sel in ('input[name="displayName"]', 'input[name="name"]', 'input[placeholder*="name" i]',
                'form input[type="text"]:visible', 'input[type="text"]:visible'):
        loc = page.locator(sel)
        if loc.count():
            name_box = loc.first
            break
    if name_box is None:
        log("!! couldn't find the token name box on Hugging Face's page")
        return None
    name_box.fill(label)
    page.locator('button:has-text("Create token"), button[type="submit"]:visible').first.click()
    # the new key is shown once, in a read-only box (or as text)
    for _ in range(30):
        page.wait_for_timeout(500)
        vals = page.evaluate("() => [...document.querySelectorAll('input,textarea')].map(e => e.value).join(' ')"
                             " + ' ' + document.body.innerText")
        m = TOKEN_RE.search(vals or "")
        if m:
            return m.group(0)
    return None


def pick_account(req: dict) -> list[dict]:
    """the accounts to try, best first: not the one the rental found slow, not one already in use, then least recently used"""
    accts = accounts()
    st = load(STATE, {})
    used = st.get("last_used", {})
    avoid = {a.lower() for a in (req.get("avoid_accounts") or []) + [req.get("current_account") or ""] if a}
    busy = {a.lower() for a in req.get("accounts_in_use") or []}

    def rank(a):
        names = {a["login"].lower(), (a.get("name") or "").lower()}
        return (bool(names & avoid), bool(names & busy), used.get(a["login"], 0))

    return sorted(accts, key=rank)


def make_keys(count: int, req: dict, show: bool = False) -> list[str]:
    accts = pick_account(req)
    if not accts:
        log("!! no Hugging Face account set up — run the installer or \"Add a Hugging Face account\"")
        notify("No Hugging Face account set up yet.")
        return []
    keys: list[str] = []
    st = load(STATE, {})
    for acct in accts:
        if len(keys) >= count:
            break
        pw = ctx = None
        try:
            pw, ctx = browser(acct, show)
            page = ctx.pages[0] if ctx.pages else ctx.new_page()
            name = sign_in(page, acct)
            if not name:
                log(f"!! couldn't sign in to Hugging Face as {acct['login']} (wrong password, or it wants a code)")
                notify(f"Couldn't sign in as {acct['login']}. Open \"Log in (show window)\" in your H3 Key Helper folder.")
                continue
            if acct.get("name") != name:
                acct["name"] = name
                conf = load(CONF, {})
                for a in conf.get("accounts", []):
                    if a["login"] == acct["login"]:
                        a["name"] = name
                save(CONF, conf)
            while len(keys) < count:
                label = f"h3-rental-{time.strftime('%m%d-%H%M%S')}-{len(keys) + 1}"
                k = make_key(page, acct, label)
                if not k:
                    log(f"!! Hugging Face didn't show a new key for {name} — trying the next account")
                    break
                keys.append(k)
                log(f"made a key on {name}: {k}")
            st.setdefault("last_used", {})[acct["login"]] = time.time()
        except Exception as e:  # noqa: BLE001
            log(f"!! {acct['login']}: {type(e).__name__}: {str(e)[:300]}")
        finally:
            try:
                ctx and ctx.close()
                pw and pw.stop()
            except Exception:  # noqa: BLE001
                pass
    save(STATE, {**load(STATE, {}), "last_used": st.get("last_used", {})})
    return keys


# ---------- commands ----------

def cmd_check() -> int:
    """run by macOS every minute: does nothing unless a rental left a request"""
    APP.mkdir(parents=True, exist_ok=True)
    lock = open(APP / ".lock", "w")
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        return 0  # the last run is still busy
    req = read_request()
    if req is None:
        return 0
    st = load(STATE, {})
    stamp = str(req.get("at", "")) + ":" + str(req.get("rental", ""))
    if stamp and stamp == st.get("done") and time.time() - st.get("done_at", 0) < 600:
        delete_request()  # already answered this one, the delete just didn't stick
        return 0
    count = max(1, min(5, int(req.get("count") or 1)))
    log(f"a rental asked for {count} key(s): {req.get('reason') or 'no reason given'}")
    keys = make_keys(count, req)
    if keys and add_keys_to_drive(keys):
        delete_request()
        save(STATE, {**load(STATE, {}), "done": stamp, "done_at": time.time()})
        log(f"added {len(keys)} key(s) to {FOLDER}/{KEYS_FILE}")
        notify(f"Made {len(keys)} Hugging Face key(s) for your rental.")
        return 0
    if not keys:
        # leave the request: the next minute tries again, but tell you only once per request
        if st.get("warned") != stamp:
            save(STATE, {**load(STATE, {}), "warned": stamp})
            notify("A rental asked for Hugging Face keys, but none could be made. See helper.log.")
    return 1


def cmd_now(n: int) -> int:
    keys = make_keys(n, {}, show=False)
    if keys and add_keys_to_drive(keys):
        log(f"added {len(keys)} key(s) to {FOLDER}/{KEYS_FILE}")
        print(f"Done: {len(keys)} new key(s) added to {FOLDER}/{KEYS_FILE} on your Google Drive.")
        return 0
    print("No keys were made — see the messages above.")
    return 1


def cmd_login(which: str | None) -> int:
    accts = [a for a in accounts() if not which or a["login"] == which] or accounts()
    if not accts:
        print("No accounts yet. Add one first.")
        return 1
    for acct in accts:
        print(f"\nOpening a window for {acct['login']}. Sign in (enter any code Hugging Face asks for), then close the window.")
        pw, ctx = browser(acct, show=True)
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        name = sign_in(page, acct)
        if not name:
            page.goto(HF + "/login")
            try:
                page.wait_for_event("close", timeout=0)
            except Exception:  # noqa: BLE001
                pass
        else:
            print(f"Signed in as {name}.")
        try:
            ctx.close()
            pw.stop()
        except Exception:  # noqa: BLE001
            pass
    return 0


def cmd_add(login: str) -> int:
    conf = load(CONF, {})
    conf.setdefault("accounts", [])
    if not any(a["login"] == login for a in conf["accounts"]):
        conf["accounts"].append({"login": login})
    save(CONF, conf)
    acct = next(a for a in conf["accounts"] if a["login"] == login)
    print(f"Checking that {login} can sign in (hidden window)…")
    pw = ctx = None
    try:
        pw, ctx = browser(acct, show=False)
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        name = sign_in(page, acct)
    finally:
        try:
            ctx and ctx.close()
            pw and pw.stop()
        except Exception:  # noqa: BLE001
            pass
    if name:
        for a in conf["accounts"]:
            if a["login"] == login:
                a["name"] = name
        save(CONF, conf)
        print(f"OK — signed in as {name}.")
        return 0
    print("Couldn't sign in with that password in the background. If Hugging Face asks for a code,\n"
          "open \"Log in (show window)\" in your H3 Key Helper folder once.")
    return 1


def cmd_remove(login: str) -> int:
    conf = load(CONF, {})
    conf["accounts"] = [a for a in conf.get("accounts", []) if a["login"] != login]
    save(CONF, conf)
    return 0


def cmd_status() -> int:
    print("Accounts:", ", ".join(f"{a['login']} ({a.get('name') or 'not checked yet'})" for a in accounts()) or "none")
    rc, out = rclone("lsjson", f"{REMOTE}:{FOLDER}", "--files-only", timeout=60)
    print("Google Drive:", "connected" if rc == 0 else "NOT connected — " + out.strip()[-200:])
    if rc == 0:
        print("Request waiting:", "yes" if REQUEST in out else "no")
    print("Log:", LOG)
    return 0


def main(argv: list[str]) -> int:
    cmd = argv[1] if len(argv) > 1 else "check"
    if cmd == "check":
        return cmd_check()
    if cmd == "now":
        return cmd_now(max(1, min(5, int(argv[2]) if len(argv) > 2 else 1)))
    if cmd == "login":
        return cmd_login(argv[2] if len(argv) > 2 else None)
    if cmd == "add-account" and len(argv) > 2:
        return cmd_add(argv[2])
    if cmd == "remove-account" and len(argv) > 2:
        return cmd_remove(argv[2])
    if cmd == "status":
        return cmd_status()
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
