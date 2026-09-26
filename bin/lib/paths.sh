# Shared runtime resolution; Bash 3.2 compatible.
find_node() {
  local candidate ok='process.exit(!process.versions.bun && Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)'
  if [[ -n ${HERDR_BOX_NODE:-} ]]; then
    "$HERDR_BOX_NODE" -e "$ok" >/dev/null 2>&1 || { echo 'herdr-box: HERDR_BOX_NODE must be Node.js >=22 (not Bun)' >&2; return 1; }
    printf '%s\n' "$HERDR_BOX_NODE"; return
  fi
  for candidate in "$(command -v node || true)" "$HOME"/.nvm/versions/node/v*/bin/node /usr/local/bin/node /opt/homebrew/bin/node; do
    [[ -x $candidate ]] || continue
    if "$candidate" -e "$ok" >/dev/null 2>&1; then printf '%s\n' "$candidate"; return; fi
  done
  echo 'herdr-box: Node.js >=22 required; install it or set HERDR_BOX_NODE' >&2
  return 1
}
