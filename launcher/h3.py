#!/usr/bin/env python3
"""
h3.py — one-command ComfyUI + MiniMax H3 on Vast.ai

  python h3.py up              rent 1 fast GPU, wait until ComfyUI is ready, mirror outputs locally
  python h3.py up --count 3    rent 3 in parallel
  python h3.py status          show your H3 instances and their boot progress
  python h3.py watch           re-attach: keep mirroring outputs from running instances
  python h3.py sync            download new outputs once
  python h3.py down            download outputs, then DESTROY all H3 instances (stops all billing)

Requires: Python 3.8+, and the Vast CLI (`pip install vastai`, then `vastai set api-key YOUR_KEY`).
Settings live in config.env next to this file (copy config.env.example).
"""
import argparse, base64, json, os, re, shutil, subprocess, sys, threading, time
import urllib.error, urllib.parse, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
LABEL = "h3-kit"
OUT_ROOT = os.path.join(HERE, "outputs")
PRINT_LOCK = threading.Lock()
PICK_LOCK = threading.Lock()

DEFAULTS = {
    "DOCKER_IMAGE": "", "COMFY_USER": "admin", "COMFY_PASSWORD": "",
    "GPU": "RTX_5090", "MAX_PRICE": "0.80", "MIN_INET_MBIT": "1000", "MIN_RAM_GB": "64",
    "DISK_GB": "180", "MAX_BW_COST_PER_TB": "5", "MIN_RELIABILITY": "0.98",
    "MIN_MBPS": "25", "MAX_ATTEMPTS": "6", "IDLE_MINUTES": "45", "EXTRA_QUERY": "",
}
PULL_TIMEOUT = 15 * 60      # image download + container start
BOOT_TIMEOUT = 30 * 60      # model download + ComfyUI start
UNREACHABLE_LIMIT = 4 * 60  # running but port never answers


def log(tag, msg):
    with PRINT_LOCK:
        print(f"[{time.strftime('%H:%M:%S')}] {tag:<10} {msg}", flush=True)


# ---------------------------------------------------------------- config
def load_config():
    cfg = dict(DEFAULTS)
    path = os.path.join(HERE, "config.env")
    if not os.path.exists(path):
        sys.exit("config.env not found — copy config.env.example to config.env and fill it in.")
    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            cfg[k.strip()] = v.split(" #")[0].split("\t#")[0].strip()
    for k in ("DOCKER_IMAGE", "COMFY_PASSWORD"):
        if not cfg.get(k) or "change-me" in cfg[k] or "yourgithubname" in cfg[k]:
            sys.exit(f"Set {k} in config.env first.")
    for k, v in cfg.items():
        if k in ("COMFY_PASSWORD", "COMFY_USER", "EXTRA_NODES", "CIVITAI_TOKEN", "EXTRA_MODELS") or k.startswith("RCLONE_") or re.fullmatch(r"HF_TOKENS?(_?\d+)?", k):
            if " " in v:
                sys.exit(f"{k} must not contain spaces.")
    return cfg


# ---------------------------------------------------------------- vast CLI wrapper
def vast(*args, raw=True, check=True):
    if not shutil.which("vastai"):
        sys.exit("Vast CLI not found. Run:  pip install vastai   then   vastai set api-key YOUR_KEY")
    cmd = ["vastai", *args] + (["--raw"] if raw else [])
    r = subprocess.run(cmd, capture_output=True, text=True, input="y\n")
    if r.returncode and check:
        raise RuntimeError(f"{' '.join(args[:3])} failed: {(r.stderr or r.stdout).strip()[-400:]}")
    if not raw:
        return r.stdout
    out = r.stdout.strip()
    try:
        return json.loads(out) if out else None
    except json.JSONDecodeError:
        raise RuntimeError(f"unexpected output from vastai {' '.join(args[:3])}: {out[:300]}")


def show_instance(iid):
    try:
        d = vast("show", "instance", str(iid))
    except RuntimeError:
        return None
    if isinstance(d, dict) and "instances" in d:
        d = d["instances"]
    if isinstance(d, list):
        d = d[0] if d else None
    return d or None


def my_instances():
    d = vast("show", "instances") or []
    if isinstance(d, dict):
        d = d.get("instances", [])
    return [i for i in d if (i.get("label") or "") == LABEL]


def destroy(iid, why=""):
    try:
        vast("destroy", "instance", str(iid), "-y", raw=False)
        log(f"#{iid}", f"destroyed {why}".strip())
    except RuntimeError as e:
        log(f"#{iid}", f"!! destroy failed ({e}). Destroy it in the Vast console to stop billing!")


def endpoint(inst):
    """public http://ip:port for container port 8188, or None"""
    ip = (inst.get("public_ipaddr") or "").strip()
    ports = inst.get("ports") or {}
    m = ports.get("8188/tcp")
    if ip and m:
        return f"http://{ip}:{m[0]['HostPort']}"
    return None


# ---------------------------------------------------------------- http helpers (basic auth)
def http_get(url, cfg, timeout=15):
    tok = base64.b64encode(f"{cfg['COMFY_USER']}:{cfg['COMFY_PASSWORD']}".encode()).decode()
    req = urllib.request.Request(url, headers={"Authorization": f"Basic {tok}"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def get_json(url, cfg, timeout=15):
    return json.loads(http_get(url, cfg, timeout))


# ---------------------------------------------------------------- renting
def search_offers(cfg):
    q = (f"gpu_name={cfg['GPU']} num_gpus=1 rentable=true verified=true direct_port_count>=1 "
         f"inet_down>={cfg['MIN_INET_MBIT']} reliability>{cfg['MIN_RELIABILITY']} "
         f"disk_space>={cfg['DISK_GB']} cpu_ram>={cfg['MIN_RAM_GB']} cuda_vers>=12.8 "
         f"dph<={cfg['MAX_PRICE']} {cfg['EXTRA_QUERY']}").strip()
    offers = vast("search", "offers", q, "-o", "dph") or []
    max_bw = float(cfg["MAX_BW_COST_PER_TB"]) / 1000.0  # $/GB
    return [o for o in offers if (o.get("inet_down_cost") or 0) <= max_bw]


def create(cfg, offer_id):
    env = ["-p 8188:8188", "-e OPEN_BUTTON_PORT=8188",
           f"-e COMFY_USER={cfg['COMFY_USER']}", f"-e COMFY_PASSWORD={cfg['COMFY_PASSWORD']}",
           f"-e MIN_MBPS={cfg['MIN_MBPS']}", f"-e IDLE_MINUTES={cfg['IDLE_MINUTES']}"]
    for k in [*sorted(x for x in cfg if re.fullmatch(r"HF_TOKENS?(_?\d+)?", x)), "EXTRA_NODES", "CIVITAI_TOKEN", "EXTRA_MODELS"]:
        if cfg.get(k):
            env.append(f"-e {k}={cfg[k]}")
    env += [f"-e {k}={v}" for k, v in cfg.items() if k.startswith("RCLONE_") and v]
    r = vast("create", "instance", str(offer_id), "--image", cfg["DOCKER_IMAGE"],
             "--disk", str(cfg["DISK_GB"]), "--env", " ".join(env),
             "--onstart-cmd", "bash /opt/h3/start.sh", "--ssh", "--direct", "--label", LABEL)
    if not r or not r.get("success"):
        raise RuntimeError(f"create failed: {r}")
    return r["new_contract"]


class Fleet:
    def __init__(self):
        self.bad_machines = set()
        self.taken_offers = set()


def wait_ready(cfg, iid, tag):
    """returns (url, None) on success or (None, reason) on failure"""
    t0 = time.time(); last_msg = ""
    # phase 1: container pull + start
    while True:
        inst = show_instance(iid)
        if inst is None:
            return None, "instance disappeared"
        st = inst.get("actual_status") or inst.get("status") or "?"
        if st == "running" and endpoint(inst):
            break
        if st in ("exited", "offline", "unknown") and time.time() - t0 > 90:
            return None, f"stuck in '{st}'"
        if time.time() - t0 > PULL_TIMEOUT:
            return None, f"image pull too slow (still '{st}' after {PULL_TIMEOUT//60} min)"
        msg = f"container: {st}"
        if msg != last_msg:
            log(tag, msg); last_msg = msg
        time.sleep(15)

    url = endpoint(inst)
    log(tag, f"container running — waiting for models ({url})")
    t1 = time.time(); last_ok = time.time(); last_print = 0
    while True:
        time.sleep(10)
        try:
            s = get_json(url + "/h3-status", cfg, timeout=10)
            last_ok = time.time()
        except urllib.error.HTTPError as e:
            if e.code == 401:
                return None, "password rejected (check COMFY_USER/COMFY_PASSWORD have no odd characters)"
            s = None
        except Exception:
            s = None
        if s is None:
            if show_instance(iid) is None:
                return None, "instance gone (self-destroyed: likely failed the speed check)"
            if time.time() - last_ok > UNREACHABLE_LIMIT:
                return None, "port 8188 never became reachable"
            continue
        phase = s.get("phase")
        if phase in ("slow", "error"):
            return None, s.get("message", phase)
        # (the instance judges its own speed — best stretch of its first 2 minutes — and reports phase "slow")
        if phase == "ready":
            try:
                get_json(url + "/system_stats", cfg)
                return url, None
            except Exception:
                pass
        if time.time() - last_print > 30 or phase == "ready":
            log(tag, s.get("message", phase)); last_print = time.time()
        if time.time() - t1 > BOOT_TIMEOUT:
            return None, "boot took too long"


def provision(cfg, fleet, n, results):
    tag = f"gpu{n}"
    for attempt in range(1, int(cfg["MAX_ATTEMPTS"]) + 1):
        with PICK_LOCK:
            try:
                offers = search_offers(cfg)
            except RuntimeError as e:
                log(tag, f"search failed: {e}"); time.sleep(20); continue
            offers = [o for o in offers if o["id"] not in fleet.taken_offers
                      and o.get("machine_id") not in fleet.bad_machines]
            if not offers:
                log(tag, "no matching offers right now — raise MAX_PRICE or lower MIN_INET_MBIT. Retrying in 60s")
                time.sleep(60); continue
            o = offers[0]
            fleet.taken_offers.add(o["id"])
        log(tag, f"try {attempt}: renting offer {o['id']} ${o.get('dph_total', 0):.3f}/hr, "
                 f"{o.get('inet_down', 0):.0f} Mbit advertised, {o.get('geolocation', '?')}")
        try:
            iid = create(cfg, o["id"])
        except RuntimeError as e:
            log(tag, f"{e} — trying another"); continue
        tag_i = f"{tag}#{iid}"
        url, why = wait_ready(cfg, iid, tag_i)
        if url:
            log(tag_i, f"READY  ->  {url}   (user: {cfg['COMFY_USER']})")
            results[n] = {"id": iid, "url": url}
            return
        log(tag_i, f"DUD: {why} — replacing")
        fleet.bad_machines.add(o.get("machine_id"))
        if show_instance(iid) is not None:
            destroy(iid, "(dud)")
    log(tag, f"gave up after {cfg['MAX_ATTEMPTS']} hosts")


# ---------------------------------------------------------------- outputs
def iter_outputs(history):
    for item in history.values():
        for node_out in (item.get("outputs") or {}).values():
            for files in node_out.values():
                if not isinstance(files, list):
                    continue
                for f in files:
                    if isinstance(f, dict) and f.get("filename") and f.get("type", "output") == "output":
                        yield f.get("subfolder", ""), f["filename"]


def sync_instance(cfg, iid, url):
    try:
        hist = get_json(url + "/history?max_items=10000", cfg, timeout=30)
    except Exception:
        return 0
    n = 0
    for sub, name in iter_outputs(hist):
        dest = os.path.join(OUT_ROOT, str(iid), sub, name)
        if os.path.exists(dest):
            continue
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        qs = urllib.parse.urlencode({"filename": name, "subfolder": sub, "type": "output"})
        try:
            data = http_get(f"{url}/view?{qs}", cfg, timeout=300)
        except Exception as e:
            log(f"#{iid}", f"download failed for {name}: {e}"); continue
        with open(dest + ".part", "wb") as fh:
            fh.write(data)
        os.replace(dest + ".part", dest)
        n += 1
    if n:
        log(f"#{iid}", f"saved {n} new output(s) -> {os.path.join(OUT_ROOT, str(iid))}")
    return n


def running_targets():
    out = []
    for i in my_instances():
        url = endpoint(i)
        if url and (i.get("actual_status") == "running"):
            out.append((i["id"], url))
    return out


def mirror_loop(cfg, targets):
    print(f"\nMirroring outputs to {OUT_ROOT} every 20s.  Press Ctrl+C to stop.\n", flush=True)
    try:
        while targets:
            for iid, url in list(targets):
                if show_instance(iid) is None:
                    log(f"#{iid}", "instance is gone (idle auto-destroy or manual)"); targets.remove((iid, url))
                    continue
                sync_instance(cfg, iid, url)
            time.sleep(20)
        print("No instances left.")
    except KeyboardInterrupt:
        print("\nFinal output sync…")
        for iid, url in targets:
            sync_instance(cfg, iid, url)
        ans = input(f"Destroy {len(targets)} instance(s) now and stop billing? [Y/n] ").strip().lower()
        if ans in ("", "y", "yes"):
            for iid, _ in targets:
                destroy(iid)
        else:
            print(f"Left running. They self-destroy after {cfg['IDLE_MINUTES']} idle minutes, "
                  f"or run:  python h3.py down")


# ---------------------------------------------------------------- commands
def cmd_up(cfg, count):
    fleet, results = Fleet(), {}
    threads = [threading.Thread(target=provision, args=(cfg, fleet, n, results), daemon=True)
               for n in range(1, count + 1)]
    for t in threads:
        t.start(); time.sleep(2)
    try:
        for t in threads:
            while t.is_alive():
                t.join(1)
    except KeyboardInterrupt:
        print("\nCancelled — destroying anything that was rented…")
        for i in my_instances():
            destroy(i["id"])
        return
    if not results:
        sys.exit("No GPU came up. Check the messages above.")
    print("\n" + "=" * 70)
    for n, r in sorted(results.items()):
        print(f"  GPU {n}:  {r['url']}      login: {cfg['COMFY_USER']} / (your COMFY_PASSWORD)")
    print("=" * 70)
    mirror_loop(cfg, [(r["id"], r["url"]) for r in results.values()])


def cmd_status(cfg):
    inst = my_instances()
    if not inst:
        print("No H3 instances running (nothing is billing)."); return
    for i in inst:
        url = endpoint(i); extra = ""
        if url:
            try:
                s = get_json(url + "/h3-status", cfg, timeout=8)
                extra = s.get("message", "")
                if s.get("auto_destroy_in_s") is not None:
                    extra += f" · auto-destroy in {s['auto_destroy_in_s']//60} min if idle"
            except Exception:
                extra = "(not reachable yet)"
        print(f"#{i['id']}  {i.get('actual_status')}  ${i.get('dph_total', 0):.3f}/hr  {url or ''}  {extra}")


def cmd_down(cfg):
    inst = my_instances()
    if not inst:
        print("Nothing to destroy."); return
    for i in inst:
        url = endpoint(i)
        if url:
            sync_instance(cfg, i["id"], url)
        destroy(i["id"])


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("command", choices=["up", "status", "watch", "sync", "down"])
    ap.add_argument("--count", type=int, default=1, help="how many GPUs to rent (up)")
    a = ap.parse_args()
    cfg = load_config()
    if a.command == "up":
        cmd_up(cfg, max(1, a.count))
    elif a.command == "status":
        cmd_status(cfg)
    elif a.command == "watch":
        mirror_loop(cfg, running_targets())
    elif a.command == "sync":
        for iid, url in running_targets():
            sync_instance(cfg, iid, url)
    elif a.command == "down":
        cmd_down(cfg)


if __name__ == "__main__":
    main()
