"""Idle watchdog + automatic output backup.

Backup: every new file in ComfyUI's output folder is uploaded to your cloud storage within ~30 s
of being created (rclone; set RCLONE_REMOTE + RCLONE_CONFIG_* env vars, e.g. Backblaze B2).

Idle shutdown: after IDLE_MINUTES with no jobs queued AND no ComfyUI tab open, the instance shuts
itself down so a forgotten GPU can't keep billing you. It never throws away unsaved outputs:
  * backup configured and the final upload succeeded (or there are no outputs) -> DESTROY (billing stops)
  * otherwise (no backup set up, or the upload failed)                        -> STOP instead: the GPU
    is released, the disk and your outputs are kept (small daily storage fee) until you start the
    instance again to download them, then destroy it.
"""
import json, os, subprocess, time, urllib.request

COMFY = "http://127.0.0.1:18188"
PUBLIC_PORT = "8188"
IDLE_MINUTES = float(os.environ.get("IDLE_MINUTES", "45"))
REMOTE = os.environ.get("RCLONE_REMOTE", "").strip()
CID = os.environ.get("CONTAINER_ID", "")
OUT_DIR = os.path.join(os.environ.get("COMFY_DIR", "/opt/ComfyUI"), "output")
STATUS = "/opt/h3/run/status.json"
STUDIO_STATE = os.path.join(os.environ.get("COMFY_DIR", "/opt/ComfyUI"), "user", "default", "studio")
STUDIO_SERVER = "/opt/h3/studio_server.py"
CHECK_EVERY = 30  # seconds

state = {"last_backup_ok": None, "last_backup_at": None, "backed_up_sig": None}


def queue_busy():
    try:
        with urllib.request.urlopen(COMFY + "/queue", timeout=10) as r:
            q = json.load(r)
        return bool(q.get("queue_running") or q.get("queue_pending"))
    except Exception:
        return True  # if ComfyUI is unreachable (e.g. mid-crash), don't count it as idle


def open_connections():
    """set of peer addr:port with an established TCP connection to the public port"""
    try:
        r = subprocess.run(["ss", "-Htn", "state", "established", f"( sport = :{PUBLIC_PORT} )"],
                           capture_output=True, text=True, timeout=10)
        return {line.split()[-1] for line in r.stdout.splitlines() if line.strip()}
    except Exception:
        return set()


def claude_working(window=180):
    """Claude Code on this rental (h3-claude) is busy: its conversation file changed in the last few minutes. A session left
    open but quiet doesn't count, so a forgotten one still lets the rental shut down when idle."""
    import glob
    newest = 0
    for f in glob.glob(os.path.expanduser("~/.claude/projects/**/*.jsonl"), recursive=True):
        try: newest = max(newest, os.path.getmtime(f))
        except OSError: pass
    return time.time() - newest < window


def outputs_signature():
    """(file count, newest mtime, total bytes) of finished output files"""
    n, newest, total = 0, 0.0, 0
    for root, _, files in os.walk(OUT_DIR):
        for f in files:
            if f.startswith(".") or f.endswith((".tmp", ".part")):
                continue
            try:
                st = os.stat(os.path.join(root, f))
            except OSError:
                continue
            n += 1; total += st.st_size; newest = max(newest, st.st_mtime)
    return (n, round(newest, 1), total)


def backup():
    """upload new/changed outputs; returns True on success"""
    if not REMOTE:
        return False
    dest = f"{REMOTE.rstrip('/')}/{CID or 'instance'}"
    r = subprocess.run(["rclone", "copy", OUT_DIR, dest, "--transfers", "8",
                        "--exclude", "*.tmp", "--exclude", "*.part", "--exclude", ".*"],
                       capture_output=True, text=True)
    ok = r.returncode == 0
    state["last_backup_ok"] = ok
    state["last_backup_at"] = int(time.time())
    print(("backup ok -> " + dest) if ok else ("!! backup failed: " + r.stderr[-500:]), flush=True)
    return ok


COMFY_CMD_TAG = "main.py --listen 127.0.0.1 --port 18188"


def comfy_running():
    r = subprocess.run(["pgrep", "-f", COMFY_CMD_TAG], capture_output=True)
    return r.returncode == 0


def restart_comfy():
    """ComfyUI died (usually out of RAM loading a big model) -> start it again, same flags"""
    comfy_dir = os.environ.get("COMFY_DIR", "/opt/ComfyUI")
    args = os.environ.get("COMFY_ARGS", "--disable-pinned-memory").split()
    if os.environ.get("H3_SAGE", "0") != "1":  # sage attention makes Qwen-Image-Edit pictures black
        args = [a for a in args if a != "--use-sage-attention"]
    print("!! ComfyUI is not running -> restarting it (see /var/log/comfyui.log for why)", flush=True)
    log = open("/var/log/comfyui.log", "a")
    log.write("\n===== watchdog: ComfyUI exited, restarting =====\n"); log.flush()
    subprocess.Popen(["python", "main.py", "--listen", "127.0.0.1", "--port", "18188"] + args,
                     cwd=comfy_dir, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)


def studio_upkeep(state_sig):
    """keep the Studio helper running, and back up remembered settings when they change"""
    if os.path.exists(STUDIO_SERVER) and subprocess.run(["pgrep", "-f", STUDIO_SERVER], capture_output=True).returncode != 0:
        print("!! Studio helper not running -> restarting it", flush=True)
        subprocess.Popen(["python", STUDIO_SERVER], stdout=open("/var/log/studio.log", "a"), stderr=subprocess.STDOUT,
                         start_new_session=True)
    if not REMOTE or not os.path.isdir(STUDIO_STATE):
        return state_sig
    sig = sorted((os.path.join(r, f), os.path.getmtime(os.path.join(r, f)))
                 for r, _, fs in os.walk(STUDIO_STATE) for f in fs)
    if sig != state_sig:
        r = subprocess.run(["rclone", "copy", STUDIO_STATE, f"{REMOTE.rstrip('/')}/_studio"], capture_output=True, text=True)
        if r.returncode == 0:
            return sig
        print("!! Studio settings backup failed: " + r.stderr[-300:], flush=True)
    return state_sig


def write_status(idle_s, tab_open, busy, sig, claude=False):
    left = max(0, int(IDLE_MINUTES * 60 - idle_s)) if IDLE_MINUTES > 0 else None
    msg = "ComfyUI is up" + (" · generating" if busy else "") + (" · browser tab open" if tab_open else "") + (" · Claude is working" if claude else "")
    s = {"phase": "ready", "message": msg, "idle_s": int(idle_s), "auto_shutdown_in_s": left,
         "auto_destroy_in_s": left, "browser_open": tab_open, "busy": busy,
         "outputs": sig[0], "backup": REMOTE or None,
         "all_outputs_backed_up": (sig == state["backed_up_sig"]) if REMOTE else None,
         "last_backup_ok": state["last_backup_ok"], "last_backup_at": state["last_backup_at"]}
    tmp = STATUS + ".tmp"
    with open(tmp, "w") as f:
        json.dump(s, f)
    os.replace(tmp, STATUS)


def vast(action):
    if not CID:
        print(f"(no CONTAINER_ID; would {action})", flush=True); return
    cmd = ["vastai", action, "instance", CID] + (["-y"] if action == "destroy" else [])
    if os.environ.get("CONTAINER_API_KEY"):
        cmd += ["--api-key", os.environ["CONTAINER_API_KEY"]]
    subprocess.run(cmd)


def shutdown():
    sig = outputs_signature()
    if sig[0] == 0:
        print("idle, no outputs -> destroying", flush=True); vast("destroy"); return
    if REMOTE and backup():
        state["backed_up_sig"] = outputs_signature()
        print("idle, outputs backed up -> destroying", flush=True); vast("destroy"); return
    if not REMOTE and proton_final():
        print("idle, results and export saved to Proton Drive -> destroying", flush=True); vast("destroy"); return
    why = "backup failed" if REMOTE else "Proton Drive save failed" if PROTON else "no backup configured"
    print(f"idle, {why} -> STOPPING (not destroying) so your outputs are kept", flush=True)
    vast("stop")


PROTON = bool(os.environ.get("PROTON_USER") and os.environ.get("PROTON_PASSWORD"))
STUDIO_API = "http://127.0.0.1:18190/studio-api/proton"


def proton_final(timeout=1800):
    """Proton Drive as the backup: one last full save (your Studio results + an export of everything else), and only a
    save that finished without an error counts — otherwise the rental is stopped, not destroyed"""
    if not PROTON: return False
    try:
        t0 = time.time()
        urllib.request.urlopen(urllib.request.Request(STUDIO_API, data=b"", method="POST"), timeout=30).read()
        time.sleep(5)
        while time.time() - t0 < timeout:
            with urllib.request.urlopen(STUDIO_API, timeout=15) as r: st = json.load(r)
            if not st.get("running"):
                ok = st.get("state") == "ok" and (st.get("last_ok") or 0) >= t0
                print(("Proton Drive: final save ok" if ok else f"!! Proton Drive final save failed: {st.get('error', '')[:300]}"), flush=True)
                return ok
            time.sleep(10)
    except Exception as e:  # noqa: BLE001
        print(f"!! Proton Drive final save: {e}", flush=True)
    return False


def main():
    last_active = time.time()
    prev_conns = set()
    restarts = 0
    state_sig = None
    print(f"watchdog: idle limit {IDLE_MINUTES} min, backup -> {REMOTE or 'off'}", flush=True)
    while True:
        time.sleep(CHECK_EVERY)
        now = time.time()
        conns = open_connections()
        # a connection present in two samples 30s apart is a long-lived websocket = open browser tab
        tab_open = bool(conns & prev_conns)
        prev_conns = conns
        alive = comfy_running()
        if not alive and restarts < 5:
            restarts += 1
            restart_comfy()
            alive = True
        # dead and out of restarts -> don't treat "unreachable" as busy, so idle shutdown still happens
        busy = queue_busy() if alive else False
        claude = claude_working()
        if busy or tab_open or claude:
            last_active = now
        idle = now - last_active

        # upload new outputs as soon as they appear (and the file has stopped changing)
        sig = outputs_signature()
        if REMOTE and sig[0] and sig != state["backed_up_sig"] and now - sig[1] > 5:
            if backup():
                state["backed_up_sig"] = sig

        state_sig = studio_upkeep(state_sig)
        write_status(idle, tab_open, busy, sig, claude)
        if IDLE_MINUTES > 0 and idle >= IDLE_MINUTES * 60:
            shutdown()
            return


if __name__ == "__main__":
    main()
