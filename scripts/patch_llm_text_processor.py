"""Make ComfyUI-LLM-text-processor work on Linux.

Upstream only knows how to download a Windows CUDA build of llama.cpp and raises an error on
Linux. The Docker image compiles llama-cli with CUDA into /opt/llama.cpp; this script:
  1. adds a Linux platform entry to the node's llama_binary.py
  2. copies the prebuilt llama-cli into the folder the node checks, so it never tries to download.
Safe to run repeatedly; does nothing if the node isn't installed.
"""
import pathlib, re, shutil, sys

PREBUILT = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "/opt/llama.cpp")
NODES = pathlib.Path(sys.argv[2] if len(sys.argv) > 2 else "/opt/ComfyUI/custom_nodes")
KEY = "linux-x64-cuda-prebuilt"
MARK = "# h3-kit linux patch"

SPEC = f'''
{MARK}
LINUX_CUDA_PREBUILT = PlatformSpec(
    key="{KEY}",
    cli_executable="llama-cli",
    asset_patterns=(),
    required_files=("llama-cli",),
)
'''
HOOK = f'''    if system == "linux" and machine in {{"x86_64", "amd64"}}:  {MARK}
        return LINUX_CUDA_PREBUILT
    raise RuntimeError('''

patched = 0
for f in NODES.glob("*/llama_binary.py"):
    src = f.read_text()
    if "Windows x64 CUDA 13 only" not in src and MARK not in src:
        continue
    if MARK not in src:
        src = src.replace("\n\ndef _platform_spec()", SPEC + "\n\ndef _platform_spec()", 1)
        src = re.sub(r"(def _platform_spec\(\).*?)\n    raise RuntimeError\(", lambda m: m.group(1) + "\n" + HOOK,
                     src, count=1, flags=re.S)
        if "return LINUX_CUDA_PREBUILT" not in src:
            sys.exit(f"!! could not patch {f} — upstream code changed; check it manually")
        f.write_text(src)
    tag = re.search(r'LLAMA_CPP_RELEASE_TAG\s*=\s*"([^"]+)"', src).group(1)
    dest = f.parent / "vendor" / "llama.cpp" / tag / KEY
    dest.mkdir(parents=True, exist_ok=True)
    for item in PREBUILT.iterdir():
        target = dest / item.name
        if item.is_file():
            shutil.copy2(item, target)
    (dest / "llama-cli").chmod(0o755)
    print(f"patched {f.parent.name}: using prebuilt llama-cli in {dest}")
    patched += 1

# 2. make room on the GPU before llama.cpp starts. The node runs llama-cli as a separate program, so ComfyUI doesn't
# know about it and keeps the last picture model (Krea 2, Qwen…) loaded in VRAM. llama.cpp then fits only part of the
# writer on the GPU and runs the rest on the CPU — a rewrite that takes seconds takes many minutes and looks frozen.
ROOM_MARK = "# h3-kit make room"
ROOM_FN = f'''
{ROOM_MARK}
def _h3_make_room(command):
    try:
        import os
        import comfy.model_management as mm
        def size(flag):
            return os.path.getsize(command[command.index(flag) + 1]) if flag in command else 0
        ctx = int(command[command.index("-c") + 1]) if "-c" in command else 8192
        need = (size("-m") + size("--mmproj")) * 1.1 + ctx * 160_000 + 1.5 * 1024 ** 3
        dev = mm.get_torch_device()
        if mm.get_free_memory(dev) < need:
            mm.unload_all_models()
            mm.soft_empty_cache()
            print(f"[h3] freed the GPU for the writer ({{mm.get_free_memory(dev) / 1024 ** 3:.1f}} GB free now)")
    except Exception as e:  # never stop the writer over this
        print(f"[h3] couldn't free the GPU for the writer: {{e}}")
'''
for f in NODES.glob("*/llama_cli.py"):
    src = f.read_text()
    if ROOM_MARK in src or "def run_llama_cli(" not in src:
        continue
    src = src.replace("\ndef run_llama_cli(", ROOM_FN + "\n\ndef run_llama_cli(", 1)
    src = re.sub(r"(def run_llama_cli\(.*?\).*?:\n)(\s+)process = None", lambda m: f"{m.group(1)}{m.group(2)}_h3_make_room(command)\n{m.group(2)}process = None", src, count=1, flags=re.S)
    if "_h3_make_room(command)" not in src:
        sys.exit(f"!! could not patch {f} (make room) — upstream code changed; check it manually")
    f.write_text(src)
    print(f"patched {f.parent.name}: frees the GPU before the writer runs")

if not patched:
    print("LLM text processor not installed — nothing to patch")
