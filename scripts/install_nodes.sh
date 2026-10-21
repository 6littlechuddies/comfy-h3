#!/usr/bin/env bash
# Installs every custom node listed in custom_nodes.txt (runs at image build time).
set -euo pipefail
LIST="$1"
cd "$COMFY_DIR/custom_nodes"

grep -vE '^\s*(#|$)' "$LIST" | while read -r line; do
  repo="${line%@*}"; ref=""
  [[ "$line" == *@* ]] && ref="${line##*@}"
  name="$(basename "$repo" .git)"
  echo "==> $name ${ref:+(@$ref)}"
  git clone --depth 1 "$repo" "$name"
  if [[ -n "$ref" ]]; then (cd "$name" && git fetch --depth 1 origin "$ref" && git checkout FETCH_HEAD); fi
  if [[ -f "$name/requirements.txt" ]]; then pip install -r "$name/requirements.txt"; fi
  if [[ -f "$name/install.py" ]]; then (cd "$name" && python install.py) || echo "   (install.py failed, continuing)"; fi
done

# Some node requirements drag in a different torch; make sure the CUDA 13 build is still in place.
python -c "import torch; assert torch.version.cuda and torch.version.cuda.startswith('13.'), torch.version.cuda; print('torch', torch.__version__, 'cuda', torch.version.cuda)"
