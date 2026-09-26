#!/usr/bin/env bash
set -euo pipefail

PLUGIN_ROOT=$(cd -P "$(dirname "${BASH_SOURCE[0]}")" && pwd)
source "$PLUGIN_ROOT/bin/lib/paths.sh"
node_bin=$(find_node)
export PATH="$(dirname "$node_bin"):$PATH"
command -v npm >/dev/null 2>&1 || { echo 'herdr-box: npm is required to install plugin dependencies' >&2; exit 1; }
[[ -f "$PLUGIN_ROOT/package-lock.json" ]] || { echo 'herdr-box: package-lock.json is required' >&2; exit 1; }
(cd "$PLUGIN_ROOT" && npm ci && npm run build)
bin_dir=${HERDR_BOX_BIN_DIR:-${HOME}/.local/bin}
mkdir -p "$bin_dir"
target=$bin_dir/box
if [[ -e $target || -L $target ]]; then
  if [[ -L $target && $(readlink "$target") == "$PLUGIN_ROOT/bin/box" ]]; then
    echo "herdr-box: already installed at $target"
    exit 0
  fi
  echo "herdr-box: refusing to replace existing $target" >&2
  exit 1
fi
ln -s "$PLUGIN_ROOT/bin/box" "$target"
echo "herdr-box: installed $target"
echo "Ensure $bin_dir is on PATH; Herdr manifest commands use the plugin's bin/box directly."
