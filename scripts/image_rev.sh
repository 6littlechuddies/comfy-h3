#!/usr/bin/env bash
# Fingerprint of everything that needs a real image rebuild (system packages, ComfyUI nodes, …). The image and the code
# bundle both carry it: a rental takes the newer code bundle when its image has the same fingerprint.
#   image_rev.sh        the full fingerprint (IMAGE_REV)
#   image_rev.sh base   the same without the node list (IMAGE_BASE): an image whose base matches can catch up on new
#                       nodes by itself at boot (self_update.sh installs them), so adding a node doesn't strand rentals
cd "$(dirname "$0")/.." || exit 1
base() { cat Dockerfile scripts/install_nodes.sh scripts/patch_llm_text_processor.py scripts/image_rev.sh
  find workflows settings scripts/claude -type f ! -name CLAUDE.md | LC_ALL=C sort | xargs cat; }
if [[ "${1:-}" == "base" ]]; then base | sha256sum | cut -c1-16
else { base; cat custom_nodes.txt; } | sha256sum | cut -c1-16; fi
