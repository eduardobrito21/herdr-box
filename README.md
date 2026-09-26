# herdr-box

Herdr plugin for a persistent Namespace Devbox running pi in a terminal pane. It requests a zoomed pane; Herdr 0.9.1 rejects that target-pane request, so herdr-box falls back to a tab on that specific error. Exiting leaves the Devbox running; destruction is explicit.

## Requirements and install

- Herdr 0.7.0+ and Node.js 22+ (`HERDR_BOX_NODE` may name a Node executable; Bun is unsupported).
- Namespace standalone `devbox` CLI installed and authenticated; `nsc devbox` is not a substitute. `devbox ssh` also needs local OpenSSH.
- Run `./install.sh` for the standalone `box` CLI, dependencies (`npm ci`), and TypeScript compilation (`dist/src/cli.js`). Or link this checkout with `herdr plugin link .` for development, then run `npm ci && npm run build`. The CLI is a symlink at `~/.local/bin/box` unless `HERDR_BOX_BIN_DIR` overrides it; it will not overwrite an existing file.
- When pi is missing, herdr-box installs it in the remote Devbox with `npm install --global --ignore-scripts @earendil-works/pi-coding-agent`.

The Node data plane and tests are TypeScript. Build output is generated under ignored `dist/`; compiled Node.js code (not Bun or a sibling checkout) is the runtime. Use `npm run check` for typecheck, oxlint, and oxfmt validation; `npm test` builds and runs the TypeScript regression tests.

The registered plugin ID is `herdr-box`. Configuration is `config.toml` in `herdr plugin config-dir herdr-box` (Herdr exports `HERDR_PLUGIN_CONFIG_DIR`); absent config uses defaults. State is in Herdr's `HERDR_PLUGIN_STATE_DIR`, or `${XDG_STATE_HOME:-~/.local/state}/herdr/plugins/herdr-box`. Standalone CLI and plugin share these same discovered locations.

## Configuration

Copy `config/config.example.toml` to that config directory. Defaults are Devbox `db-default`, blueprint `bp-default`, remote path `/workspaces`, and pi command `pi` with `on_missing = "install"`. The initial blueprint is `node:26-slim`, size `m`, 128 GB volume, ephemeral. Ephemeral describes the blueprint's storage behavior; the box itself remains running until explicitly killed.

The remote path must already exist. Set `devbox.path = ""` to use the remote user's home/current directory; herdr-box does not upload, clone, or create workspace files. Set `pi.command = ""` to skip pi checking and use an interactive remote Bash shell. A nonempty custom `pi.command` is trusted shell code executed remotely. Set `pi.on_missing = "fail"` to prevent automatic installation; default `install` installs pi globally through npm.

## Use

Mode 1 is this Herdr remote-environment plugin: **Open Namespace Devbox** ensures the box and pi, while **Shell in Namespace Devbox** ensures the box but skips pi. This plugin has no runtime dependency on the sibling `pi-over-the-wire` project; that project is Mode 2, running local pi with remoted tools. To add the optional user keybinding, put this in `~/.config/herdr/config.toml`:

```toml
[[keys.command]]
key = "prefix+shift+b"
command = "herdr plugin action invoke open --plugin herdr-box"
```

Provisioning occurs in the pane, not in the noninteractive action. Pane entrypoint routing attaches directly and does not recursively open another pane. Shell pane calls `devbox ssh --force_pty NAME -- bash -lc ...`; exiting the shell or pi does not stop or delete the box.

Standalone commands include:

```sh
box open
box shell
box status
box list
box logs
box kill          # prompts on a terminal
box kill --yes    # explicit, destructive confirmation
```

Kill creates a retained local `deleted` status record; it deletes the remote Devbox and its data. Automated tests use fake Namespace clients and do not destroy cloud resources. A bounded non-PTY live smoke created `herdr-box-integration-smoke`, installed pi, and verified pi help/argument quoting. A live no-focus Herdr plugin action opened a tab pane and reached the Pi v0.87.1 TUI, which reported no models configured; login/model completion remains manual. A separate temporary-config attempt was overridden by Herdr and unintentionally provisioned `db-default` (ID `l1opv21ov4aug`); it remains running and was not destroyed. See `PLAN.md` for exact limits and pane layout behavior.
