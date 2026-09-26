# Namespace Devbox vs AWS AgentCore Runtime

herdr-box keeps the same Herdr actions. The remote terminal stays inside the runtime. What changes is what those steps call.

pi-over-the-wire is the other shape: local pi, with tools sent to the remote environment. This plugin does not do that.

| Today (Namespace Devbox) | AWS AgentCore Runtime |
| --- | --- |
| `ensure` creates or reuses the named Devbox | Ensure a runtime is deployed and READY, and keep its ARN, region, session id, and shell id |
| `ensure-pi` runs `command -v pi` and the npm install through `box.shell()` | Same check, as a one-shot `agentcore exec "…"` (no `--it`). That API returns an exit code and does not need a terminal |
| Pane ends in `devbox ssh --force_pty NAME -- bash -lc '…'` | `agentcore exec --it --runtime <arn> --region <region> --session-id <id> --shell-id <id>` |

`ensure` picks the session id and shell id and every attach passes them through. The first connection creates that shell. The next `box open` reconnects to it, so leaving the pane does not tear the runtime down. `Ctrl+]` in the AgentCore CLI detaches and leaves the shell running.

`--it` does not take a remote command. The positional argument is one-shot mode only, so `cd` and `exec pi` cannot be appended the way they are on `devbox ssh`. The first attach sends that line into the new shell. Later attaches only reconnect, because that same shell is already sitting in pi.

Interactive attach is [`InvokeAgentRuntimeCommandShell`](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-get-started-command-shell.html): a persistent PTY over a WebSocket. One-shot commands are `InvokeAgentRuntimeCommand`.
