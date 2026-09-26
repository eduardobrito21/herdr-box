# herdr-box

Herdr plugin that opens a persistent Namespace Devbox and runs `pi` in a zoomed terminal pane. Exiting the pane leaves the Devbox running; it is never implicitly deleted.

## Prerequisites

- Herdr 0.9.1+ and a workspace.
- Node.js 22+ (`HERDR_BOX_NODE` may point to it if it is not on Herdr's `PATH`).
- Namespace's **standalone `devbox` CLI** installed and authenticated. Install it using Namespace's current [Devbox CLI instructions](https://namespace.so/docs/devbox/cli); `nsc devbox` is not a substitute. `devbox ssh` needs the CLI's Namespace credentials and a local OpenSSH client.
- The data component's Node dependencies and `src/cli.js` in the plugin root.

The CLI documentation confirms remote command support: `devbox ssh [name] [-- command...]`, with `-t/--force_pty`; herdr-box uses `devbox ssh --force_pty NAME -- bash -lc COMMAND` to run the configured command with a TTY. The connection has not been exercised against a live Namespace Devbox here.

## Install and configure

Link this checkout during development with `herdr plugin link /path/to/herdr-box` (link does not run build commands). For a standalone `box` command, run `./install.sh`; it creates `~/.local/bin/box` and refuses to overwrite a different existing file or symlink. Run it again safely to confirm an existing installation. The plugin's Herdr manifest uses explicit `bash bin/box ...` argv commands and does not depend on login-shell `PATH`.

Copy `config/config.example.toml` to the directory printed by `herdr plugin config-dir herdr.box`, then edit the Devbox name, blueprint, remote path, and optional pi command. Herdr supplies `HERDR_PLUGIN_CONFIG_DIR` and `HERDR_PLUGIN_STATE_DIR`; the Node CLI resolves config/state there and otherwise uses its documented XDG defaults. Namespace authentication is managed by the standalone `devbox` CLI.

## Use

`herdr plugin action list --plugin herdr.box` lists actions. Invoke **Open Namespace Devbox** (or bind the included `prefix+b` key) to ensure a Devbox, ensure pi, and open its zoomed pane. **Shell in Namespace Devbox** attaches to the configured existing box without provisioning or starting pi. Pane entrypoints have distinct IDs, so invocation from an action opens a pane once and invocation inside that pane attaches directly without recursively opening panes.

Mode 1 runs only `box shell`; mode 2 runs `box open` and starts pi. The pane uses a forced TTY, safely quotes the configured remote path, and starts in that directory. Exit the shell/pi to return to Herdr; the box stays running.

From a terminal, `box open` and `box shell` use the same pane route when called as Herdr actions, and attach when running in the pane. `box status`, `box list`, `box logs`, and `box kill` are also available. `box kill` prompts on a terminal; noninteractive use requires `box kill --yes`.

```sh
box status
box list
box logs
box kill --yes
```

Namespace state/status and lifecycle behavior are supplied by the companion `src/cli.js` component; this control plane does not use the Namespace SDK in Bash. Live SSH, remote pi installation, and actual provisioning should be verified during integration.
