# herdr-box v0.1 implementation plan

## Scope

Agent-in-box only: opt-in `box open` ensures a Namespace Devbox, ensures pi, then opens/attaches a zoomed herdr SSH pane. `box shell` skips pi. Leave remote boxes running on exit; explicit kill only. No worktree creation/removal hooks, snapshots, local tool remoting, dashboard, or runtime dependency on pi-over-the-wire.

## Delivery

1. Validate herdr manifest/environment and reference plugin behavior.
2. Implement Node ESM data plane: config, atomic state, Namespace get-or-create, pi availability, status/list/kill.
3. Implement Bash control plane: Node >=22 selection, pane routing without recursion, interactive SSH exec, installer, manifest and README.
4. Integrate exclusive component handoffs; run mock-based tests and local install/link/action-list checks. Do not create/destroy real Namespace resources in tests.
5. Integration checked: regression suite, installer, Herdr linking/action discovery, and a bounded live non-PTY smoke. Interactive forced-TTY use still requires manual verification.

## Multi-seam ownership board

Base: `7e158c8` (main). Components are independently testable via a JSON process boundary.

| Lane        | Worktree                                  | Exclusive ownership                                                | Gate                                                     | Handoff                         |
| ----------- | ----------------------------------------- | ------------------------------------------------------------------ | -------------------------------------------------------- | ------------------------------- |
| Data        | `/tmp/herdr-box-data`, `build/data`       | `src/`, `package.json`, lockfile, `test/data*`                     | Node unit tests, config/state/lifecycle with fake client | commit + managed report         |
| Control     | `/tmp/herdr-box-control`, `build/control` | `bin/`, `install.sh`, manifest, `config/`, README, `test/control*` | Bash syntax + mocked Node/devbox/herdr routing           | commit + managed report         |
| Integration | main checkout, parent after both finish   | apply component commits; boundary fixes only                       | combined tests, install/link/action list                 | final diff + validation summary |

Each component has one writer (`openai-codex/gpt-6-luna`), cannot edit the other component or sibling repo, push, deploy resources, or spawn agents. Parent retains integration and acceptance authority. Stop/ask on incompatible external APIs or scope changes.

## Frozen process contract

- Bash calls resolved Node >=22 with `<plugin-root>/dist/src/cli.js <verb>`. Source and regression tests are TypeScript; TypeScript compiles to `dist/`.
- Verbs: `config`, `ensure`, `ensure-pi`, `status`, `list`, `kill`.
- All successful commands write one JSON value to stdout; progress/errors go to stderr; failure exits nonzero. No shell `eval` of JSON.
- `config` returns `{devbox:{name,blueprint,path},pi:{command,on_missing}}`. Defaults `db-default`, `bp-default`, `/workspaces`, `pi`, `install`. Reads `config.toml` under `HERDR_PLUGIN_CONFIG_DIR`; absent config uses defaults.
- `ensure` returns `{devboxName,remotePath,...record}`; creates/reuses box and validates configured remote directory. `ensure-pi` checks/installs on existing configured box; no provisioning. Empty pi command skips check.
- `status` returns last-known record plus bounded live lookup/error, without provisioning. `list` returns stored records. `kill` explicitly deletes configured named box and updates state (no confirmation in Node; Bash can require confirmation/--yes).
- State under `HERDR_PLUGIN_STATE_DIR`; fallback config/state directories use XDG roots with `herdr/plugins/herdr-box`. One atomic JSON record per box; worktreePath derived from herdr context or original cwd.
- Control plane decides pane versus attach using `HERDR_PLUGIN_ENTRYPOINT_ID`; action invocation opens pane, pane invocation attaches directly. Separate shell entrypoint is acceptable to avoid passing undocumented pane arguments.
- `devbox` is a separate CLI; `nsc devbox` is not an SSH fallback. `devbox ssh [name] [-- command...]` accepts `--force_pty` and `--disable_pty`; one-shot non-PTY SSH was smoke-tested.
- Live non-PTY smoke once created `herdr-box-integration-smoke` (SDK ID `ho0t657ks4bcc`), installed pi, and verified `pi --help` plus quoting; later standalone `devbox list` did not show it and configured status returned live null. Do not assume it remains available.

## Evidence anchors

- https://herdr.dev/docs/plugins/ : argv commands run with plugin cwd; use `HERDR_BIN_PATH`; pane env `HERDR_PLUGIN_ENTRYPOINT_ID`; actions are noninteractive and must open a pane. `plugin link` skips build.
- https://github.com/tomasvarga/herdr-e2b ; downloaded relevant reference files in `/tmp/herdr-box-reference/`.
- `/Users/eduardobrito/Developer/projects/pi-over-the-wire/src/devbox.ts` (read/copy helper only).
- https://namespace.so/docs/devbox/remote-development and `/docs/devbox/cli`.
- Local Herdr 0.9.1 and Node 26.2.0. Standalone `devbox` 0.0.192 is at `~/.local/bin/devbox`; both `devbox auth check-login` and `nsc auth check-login` passed. `devbox list` began empty. Live smoke box `herdr-box-integration-smoke` and blueprint of the same name were created and intentionally left running; it is a billable Namespace resource. No live box was destroyed.

## Integration completion (2026-09-26)

- Manifest now uses ID `herdr-box`, min Herdr 0.7.0, supported `build = [{ command = ["bash", "install.sh"] }]`, explicit pane commands, and a destructive kill title.
- Installer resolves Node >=22, runs lockfile `npm ci`, compiles TypeScript into `dist/src/cli.js`, and creates a safe idempotent standalone symlink. `npm run check` runs strict typecheck, oxlint, and oxfmt checks; `npm test` builds and runs all TypeScript data/control tests on Node.
- Final TS checkpoint: `npm run check` passed (strict source typecheck, oxlint on `src/`, oxfmt); `npm test` passed 14/14 via build-to-`dist` then compiled Node tests. `./install.sh`, `herdr plugin link .`, and action list passed.
- No-focus plugin pane `wB:p3` reached the actual Pi v0.87.1 interactive TUI over forced-PTY SSH; Pi reported no models configured, so model/login completion remains manual. Pane was closed without focus; parent pane `wB:p1` remained focused. Current standalone state record path is `/Users/eduardobrito/.local/state/herdr/plugins/herdr-box/boxes/ZGItZGVmYXVsdA.json`.
- Pane test's attempt to inject a temporary config via Herdr pane `--env` was overridden by runtime config discovery: it launched configured default `db-default` (Devbox ID `l1opv21ov4aug`), a billable resource not authorized in the intended smoke-only test. It was not destroyed per instruction. No additional provisioning was attempted after detecting this. The separate smoke name/status was unavailable to the standalone CLI at final check.
- Pane-routing root cause (verified against Herdr 0.9.1 socket schema, CLI source, and server validation): split/zoomed plugin pane requests accept `target_pane_id` but reject `workspace_id`; the earlier caller sent both. Current routing targets `HERDR_PANE_ID` (or derives it from `pane current --current`) and omits `--workspace` for zoomed placement. The CLI's `--target-pane` is correctly serialized; no raw socket transport or Herdr change is needed.
- Live validation after the routing fix: registered `herdr plugin action invoke open` succeeded with test pane `wB:p6`; `herdr pane layout --pane wB:p1` reported `zoomed: true`, and targeted read showed the Pi v0.87.1 TUI at `/workspaces`. Registered shell action succeeded with `wB:p7`; layout likewise reported `zoomed: true` and read showed the interactive Devbox shell. Closed only p6/p7; original `wB:p1` focus and normal unzoomed layout were restored. Existing `db-default` (ID `l1opv21ov4aug`) was running and reused; no resources were created or destroyed. Model login remains user-managed.
- Temporary test config `/Users/eduardobrito/.config/herdr/plugins/config/herdr-box/config.toml` (smoke name/path empty/pi help) was created only after confirming absence, then removed. Earlier attempted `/tmp/herdr-box-pane-smoke-moDvMA/config/config.toml` and `/tmp/herdr-box-pane-smoke-moDvMA/state` env override was not honored by Herdr. No existing user config was overwritten.
- No resources were destroyed. Report both the intended smoke SDK ID and the accidental `db-default` resource accurately; verify live resource state before any cleanup.
