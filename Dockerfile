# ComfyUI + MiniMax H3 image for Vast.ai (RTX 5090 / Blackwell ready)
# Models are NOT baked in — scripts/start.sh downloads them at boot.

# ---------------------------------------------------------------------------------------------
# Stage 1: compile llama.cpp's llama-cli with CUDA (needed by ComfyUI-LLM-text-processor, whose
# own auto-download only exists for Windows). Cached by GitHub Actions, so it only rebuilds
# when LLAMA_TAG changes. Note: llama-cli is part of the server tools, so LLAMA_BUILD_SERVER must stay ON.
# ---------------------------------------------------------------------------------------------
FROM nvidia/cuda:12.8.1-devel-ubuntu24.04 AS llama
# Keep in sync with LLAMA_CPP_RELEASE_TAG in ComfyUI-LLM-text-processor/llama_binary.py
ARG LLAMA_TAG=b10472
# 120 = RTX 5090 / RTX PRO 6000 (Blackwell), 89 = RTX 4090 / L40 (Ada). Add 86;90 for A-series/H100.
ARG CUDA_ARCHS="89;120"
RUN apt-get update && apt-get install -y --no-install-recommends git cmake build-essential ca-certificates \
    && rm -rf /var/lib/apt/lists/*
RUN git clone --depth 1 --branch "${LLAMA_TAG}" https://github.com/ggml-org/llama.cpp /src \
    && cmake -S /src -B /build -DCMAKE_BUILD_TYPE=Release \
         -DGGML_CUDA=ON -DGGML_NATIVE=OFF -DCMAKE_CUDA_ARCHITECTURES="${CUDA_ARCHS}" \
         -DLLAMA_CURL=OFF -DLLAMA_BUILD_TESTS=OFF \
         -DCMAKE_BUILD_WITH_INSTALL_RPATH=ON -DCMAKE_INSTALL_RPATH='$ORIGIN' \
         -DCMAKE_EXE_LINKER_FLAGS=-Wl,--allow-shlib-undefined \
    && cmake --build /build --target llama-cli -j"$(nproc)" \
    && mkdir -p /out && cp -a /build/bin/llama-cli /build/bin/*.so* /out/ \
    && ls -la /out

# ---------------------------------------------------------------------------------------------
# Stage 2: the actual runtime image
# ---------------------------------------------------------------------------------------------
# ---- H3 Studio web app (static files; served by Caddy at /studio/) ----------------------------
FROM node:22-slim AS studio
WORKDIR /src
COPY studio/package.json studio/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY studio/ ./
RUN npm run build

FROM nvidia/cuda:12.8.1-cudnn-runtime-ubuntu24.04

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    VENV=/opt/venv \
    PATH=/opt/venv/bin:$PATH \
    COMFY_DIR=/opt/ComfyUI

# System packages: python, build tools (Triton/SageAttention JIT needs gcc + headers),
# aria2 for fast parallel downloads, ssh so Vast's SSH button works, iproute2 procps for the idle watchdog.
RUN apt-get update && apt-get install -y --no-install-recommends \
        python3 python3-venv python3-dev build-essential git curl ca-certificates \
        aria2 ffmpeg libgl1 libglib2.0-0 openssh-server tini jq unzip iproute2 procps libgomp1 tmux \
    && rm -rf /var/lib/apt/lists/*

# Claude on the rental: Claude Code (talk to it from claude.ai/code or the Claude app via Remote Control) + ttyd, a small
# web terminal behind the same password (Studio ⋯ → Terminal / Claude on this rental), so no SSH is needed
ARG TTYD_VERSION=1.7.7
RUN curl -fsSL "https://github.com/tsl0922/ttyd/releases/download/${TTYD_VERSION}/ttyd.x86_64" -o /usr/local/bin/ttyd \
    && chmod +x /usr/local/bin/ttyd && ttyd --version
RUN curl -fsSL https://claude.ai/install.sh | bash -s stable \
    && ln -sf /root/.local/bin/claude /usr/local/bin/claude && claude --version

# Caddy = password-protected front door for ComfyUI (ComfyUI itself has no login)
ARG CADDY_VERSION=2.10.0
RUN curl -fsSL "https://github.com/caddyserver/caddy/releases/download/v${CADDY_VERSION}/caddy_${CADDY_VERSION}_linux_amd64.tar.gz" \
      | tar -xz -C /usr/local/bin caddy && caddy version

# rclone = optional backup of outputs to Cloudflare R2 / Backblaze B2 before auto-destroy
RUN curl -fsSL https://downloads.rclone.org/rclone-current-linux-amd64.zip -o /tmp/rclone.zip \
    && unzip -j /tmp/rclone.zip '*/rclone' -d /usr/local/bin && chmod +x /usr/local/bin/rclone && rm /tmp/rclone.zip

# llama-cli from stage 1. Deliberately NOT registered with ldconfig: llama-cli finds its libraries next to
# itself ($ORIGIN rpath), and a system-wide libmtmd/libllama from this older build would be picked up by
# llama-cpp-python (it tries find_library() first) -> "None of the shared library symbols were found".
COPY --from=llama /out/ /opt/llama.cpp/
RUN rm -f /etc/ld.so.conf.d/llama.conf && ldconfig \
    && readelf -d /opt/llama.cpp/llama-cli | grep -q 'R.*PATH.*\$ORIGIN' \
    && missing="$(ldd /opt/llama.cpp/llama-cli | grep 'not found' | grep -v 'libcuda.so.1' || true)" \
    && if [ -n "$missing" ]; then echo "llama-cli libs missing:"; echo "$missing"; exit 1; fi

RUN python3 -m venv $VENV && pip install --upgrade pip wheel setuptools

# PyTorch built for CUDA 13.0: ComfyUI's optimized kernels (comfy_kitchen CUDA backend, used for
# H3's INT8/NVFP4 weights) need cu130+; on cu128 it falls back to a slower, more memory-hungry path.
# Requires Vast hosts with "Max CUDA" 13.0 or higher.
ARG TORCH_INDEX=https://download.pytorch.org/whl/cu130
RUN pip install torch torchvision torchaudio --index-url $TORCH_INDEX

# ComfyUI (native MiniMax H3 support is in mainline ComfyUI)
ARG COMFY_REF=master
RUN git clone https://github.com/comfyanonymous/ComfyUI.git $COMFY_DIR \
    && cd $COMFY_DIR && git checkout $COMFY_REF \
    && pip install -r requirements.txt

# SageAttention (used via --use-sage-attention) + Vast CLI (for self-destroy) + HF tools
RUN pip install sageattention vastai "huggingface_hub[hf_transfer]" requests

# Vision-capable llama-cpp-python for ComfyUI-QwenVL's GGUF nodes (used by the H3 AutoPrompter).
# The PyPI build lacks Qwen3VLChatHandler; JamePeng's fork ships prebuilt CUDA 12.8 wheels that
# match this base image's CUDA runtime. --no-deps so it can't replace torch/numpy.
ARG LLAMA_CPP_PY_WHEEL=https://github.com/JamePeng/llama-cpp-python/releases/download/v0.3.49-cu128-linux-20260831/llama_cpp_python-0.3.49%2Bcu128-cp312-cp312-linux_x86_64.whl
RUN pip install --no-deps "$LLAMA_CPP_PY_WHEEL" && pip install diskcache jinja2 \
    && grep -rq "class Qwen3VLChatHandler" /opt/venv/lib/python3.12/site-packages/llama_cpp/ \
    && grep -q "Qwen3VLChatHandler" /opt/venv/lib/python3.12/site-packages/llama_cpp/llama_chat_format.py \
    && echo "llama-cpp-python vision handlers present" \
    && missing="$(ldd /opt/venv/lib/python3.12/site-packages/llama_cpp/lib/libggml-cuda.so | grep 'not found' | grep -v 'libcuda.so.1' || true)" \
    && if [ -n "$missing" ]; then echo "llama-cpp-python CUDA libs missing:"; echo "$missing"; exit 1; fi \
    && python -c "from ctypes.util import find_library as f; bad=[n for n in ('mtmd','llama','ggml','ggml-base') if f(n)]; assert not bad, f'system copies would shadow llama-cpp-python: {bad}'" \
    && nm -D /opt/venv/lib/python3.12/site-packages/llama_cpp/lib/libmtmd.so | grep -q mtmd_bitmap_set_mergeable

# Custom nodes — edit custom_nodes.txt to add/remove; GitHub rebuilds the image on push
COPY custom_nodes.txt /opt/h3/custom_nodes.txt
COPY scripts/install_nodes.sh scripts/patch_llm_text_processor.py /opt/h3/
RUN bash /opt/h3/install_nodes.sh /opt/h3/custom_nodes.txt \
    && python /opt/h3/patch_llm_text_processor.py /opt/llama.cpp $COMFY_DIR/custom_nodes

# NVIDIA RTX Video Super Resolution (Animate → "Upscale with RTX"): its nvidia-vfx library comes from NVIDIA's own package
# index, so it's installed apart — if that fails the build carries on without it (the Studio then hides the option)
ARG NVVFX_REF=38d790ded00650681fa3645362efe28c8560cf40
RUN cd $COMFY_DIR/custom_nodes && git clone https://github.com/Comfy-Org/ComfyUI_Nvidia_VFX_Nodes \
    && cd ComfyUI_Nvidia_VFX_Nodes && git checkout $NVVFX_REF \
    && (pip install --no-deps "nvidia-vfx>=0.2" && pip show nvidia-vfx >/dev/null) \
       || (echo "nvidia-vfx didn't install: leaving RTX upscaling out"; rm -rf $COMFY_DIR/custom_nodes/ComfyUI_Nvidia_VFX_Nodes) \
    ; python -c "import torch; assert torch.version.cuda and torch.version.cuda.startswith('13.'), torch.version.cuda"

# Character LoRA training (Krea 2): kohya-ss/musubi-tuner in its own venv. Its pinned transformers/diffusers/accelerate
# stay inside that venv (they'd clash with ComfyUI's); a .pth line adds this image's venv after them, so it reuses the
# CUDA 13 torch instead of installing another one. The Studio runs it from Characters → Training set → Train.
ARG MUSUBI_REF=f8a1b03
RUN git clone https://github.com/kohya-ss/musubi-tuner /opt/musubi-tuner && cd /opt/musubi-tuner && git checkout $MUSUBI_REF \
    && $VENV/bin/python -m venv /opt/musubi-venv \
    && echo "$VENV/lib/python3.12/site-packages" > /opt/musubi-venv/lib/python3.12/site-packages/zz_comfy.pth \
    && /opt/musubi-venv/bin/pip install --no-cache-dir --no-deps -e /opt/musubi-tuner \
    && /opt/musubi-venv/bin/pip install --no-cache-dir accelerate==1.15.0 diffusers==0.40.0 einops==0.7.0 huggingface-hub==1.32.0 safetensors==0.8.0 \
         toml==0.10.2 tqdm==4.67.1 transformers==5.17.0 voluptuous==0.15.2 ftfy==6.3.1 easydict==1.13 sentencepiece==0.2.1 av opencv-python-headless "pillow>=11.3.0" \
    && /opt/musubi-venv/bin/python -c "import torch, transformers, musubi_tuner; assert torch.version.cuda.startswith('13.'), torch.version.cuda; print('musubi ok, torch', torch.__version__, 'transformers', transformers.__version__)" \
    && cd /opt/musubi-tuner && /opt/musubi-venv/bin/python src/musubi_tuner/krea2_train_network.py --help > /dev/null

# Your workflows (.json in ./workflows) show up in ComfyUI's Workflows sidebar
COPY workflows/ $COMFY_DIR/user/default/workflows/

# Default ComfyUI settings for every new instance (edit settings/comfy.settings.json).
# MinFontSizeForLOD=0 keeps node text visible when zoomed out.
COPY settings/comfy.settings.json $COMFY_DIR/user/default/comfy.settings.json

# cloudflared: optional secure https link for the Studio (microphone needs https)
RUN curl -fsSL -o /usr/local/bin/cloudflared https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 \
    && chmod +x /usr/local/bin/cloudflared && cloudflared --version

COPY models.txt /opt/h3/models.txt
COPY scripts/start.sh scripts/watchdog.py scripts/Caddyfile scripts/studio_server.py scripts/downloader.py scripts/h3-grok.user.js scripts/self_update.sh /opt/h3/
COPY scripts/boot.html /opt/h3/boot/boot.html
COPY prompts/ /opt/h3/prompts/
COPY scripts/claude/CLAUDE.md /opt/h3/CLAUDE.md
COPY scripts/claude/dot-claude/ /opt/h3/.claude/
COPY scripts/claude/h3-claude scripts/claude/h3-report scripts/claude/h3-terminal /usr/local/bin/
RUN chmod +x /usr/local/bin/h3-claude /usr/local/bin/h3-report /usr/local/bin/h3-terminal \
 && date -u +"%Y-%m-%d %H:%M UTC" > /opt/h3/BUILT
COPY --from=studio /src/dist/ /opt/h3/studio/
# the startup screen uses the Studio's own fonts
RUN cp /opt/h3/studio/assets/archivo-latin-wdth-normal-*.woff2 /opt/h3/boot/archivo.woff2 \
 && cp /opt/h3/studio/assets/ibm-plex-mono-latin-400-normal-*.woff2 /opt/h3/boot/plex-400.woff2 \
 && cp /opt/h3/studio/assets/ibm-plex-mono-latin-500-normal-*.woff2 /opt/h3/boot/plex-500.woff2
RUN chmod +x /opt/h3/start.sh
# which image this is (scripts/image_rev.sh) and which code it came with: rentals then take newer code from the
# "code-latest" release by themselves (scripts/self_update.sh) when it was made for this same image
ARG IMAGE_REV=dev
ARG CODE_REV=dev
RUN echo "$IMAGE_REV" > /opt/h3/IMAGE_REV && echo "$CODE_REV" > /opt/h3/CODE_REV

EXPOSE 8188
WORKDIR /opt/ComfyUI
# Used when the image runs outside Vast's ssh mode; on Vast, start.sh runs via the on-start command.
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["bash", "-c", "/opt/h3/start.sh && sleep infinity"]
