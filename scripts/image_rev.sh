#!/usr/bin/env bash
# Fingerprint of everything that needs a real image rebuild (system packages, ComfyUI nodes, …). The image and the code
# bundle both carry it: a rental only takes the newer code bundle when its image has the same fingerprint.
cd "$(dirname "$0")/.." || exit 1
{ cat Dockerfile custom_nodes.txt scripts/install_nodes.sh scripts/patch_llm_text_processor.py scripts/self_update.sh scripts/image_rev.sh
  find workflows settings scripts/claude -type f ! -name CLAUDE.md | LC_ALL=C sort | xargs cat; } | sha256sum | cut -c1-16
