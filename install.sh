#!/usr/bin/env bash
set -euo pipefail

PLUGIN_ROOT=$(cd -P "$(dirname "${BASH_SOURCE[0]}")" && pwd)
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
