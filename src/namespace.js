import { createDevboxClient } from "@namespacelabs/sdk/devbox";
import { loadConfig } from "./config.js";
import { deleteRecord, listRecords, readRecord, writeRecord } from "./store.js";

const blueprintDefinition = { image: "node:26-slim", size: "m", volumeSizeGB: 128, ephemeral: true };
const timeoutMs = 60_000;
const quote = (s) => `'${s.replaceAll("'", `'\\''`)}'`;

async function ensureBlueprint(client, name) {
  for await (const blueprint of client.blueprints.iterate()) {
    if (blueprint.name === name) return blueprint;
  }
  return client.blueprints.create(name, blueprintDefinition);
}
async function namedBox(client, name) {
  for await (const box of client.devboxes.iterate()) {
    if (box.name === name) return box;
  }
  return null;
}
export async function resolveBox(client, config, create = false) {
  const found = await namedBox(client, config.devbox.name);
  if (found || !create) return found;
  const blueprint = await ensureBlueprint(client, config.devbox.blueprint);
  return client.devboxes.create({ name: config.devbox.name, blueprint: blueprint.name });
}
async function checkedShell(box, script, label) {
  const result = await box.shell(script, { timeoutMs });
  if (result.exitCode !== 0) throw new Error(`${label}: ${result.stderr.trim() || result.error || `remote command exited ${result.exitCode}`}`);
  return result.stdout.trim();
}
export async function ensureBox({ config, env = process.env, clientFactory = createDevboxClient } = {}) {
  config ??= await loadConfig(env);
  const client = clientFactory();
  try {
    const box = await resolveBox(client, config, true);
    let remotePath;
    try {
      remotePath = await checkedShell(box, config.devbox.path ? `cd -- ${quote(config.devbox.path)} && pwd` : "pwd", `Remote workspace ${config.devbox.path || "(home/default cwd)"} is unavailable`);
    } catch (error) {
      if (config.devbox.path) throw new Error(`${error.message}. Create/checkout that directory remotely or change devbox.path; herdr-box does not upload or create workspace files.`, { cause: error });
      throw error;
    }
    const previous = await readRecord(config.devbox.name, env);
    const record = await writeRecord(config.devbox.name, {
      blueprint: config.devbox.blueprint,
      remotePath,
      worktreePath: env.HERDR_WORKTREE_PATH || env.HERDR_WORKTREE || process.cwd(),
      status: "ready",
      devboxId: box.id,
      ...(previous?.createdAt ? {} : { createdAt: new Date().toISOString() }),
    }, env);
    return { devboxName: config.devbox.name, remotePath, ...record };
  } finally { client.close(); }
}
export async function ensurePi({ config, env = process.env, clientFactory = createDevboxClient } = {}) {
  config ??= await loadConfig(env);
  if (!config.pi.command) return { checked: false, reason: "pi command is empty" };
  const client = clientFactory();
  try {
    const box = await resolveBox(client, config, false);
    if (!box) throw new Error(`Configured Devbox ${config.devbox.name} does not exist; run ensure first`);
    const command = quote(config.pi.command);
    const test = await box.shell(`command -v ${command}`, { timeoutMs });
    if (test.exitCode === 0) return { devboxName: box.name, command: config.pi.command, installed: false, checked: true };
    if (config.pi.on_missing === "skip") return { devboxName: box.name, command: config.pi.command, checked: true, skipped: true };
    if (config.pi.on_missing === "error") throw new Error(`Pi command ${config.pi.command} is missing in Devbox ${box.name}`);
    const installation = await box.shell("npm install --global --ignore-scripts @earendil-works/pi-coding-agent", { timeoutMs });
    if (installation.exitCode !== 0) throw new Error(`Pi installation failed: ${installation.stderr.trim() || installation.error || `remote command exited ${installation.exitCode}`}`);
    const verify = await box.shell(`command -v ${command}`, { timeoutMs });
    if (verify.exitCode !== 0) throw new Error(`Pi installation succeeded but configured command ${config.pi.command} is still unavailable`);
    return { devboxName: box.name, command: config.pi.command, checked: true, installed: true };
  } finally { client.close(); }
}
export async function statusBox({ config, env = process.env, clientFactory = createDevboxClient } = {}) {
  config ??= await loadConfig(env);
  const record = await readRecord(config.devbox.name, env);
  const client = clientFactory();
  try {
    let box;
    try { box = await resolveBox(client, config, false); }
    catch (error) { return { ...(record ?? { devboxName: config.devbox.name }), liveLookupError: error.message }; }
    if (!box) return { ...(record ?? { devboxName: config.devbox.name }), live: null };
    try { await box.refresh({ timeoutMs }); return { ...(record ?? { devboxName: config.devbox.name }), live: box.info }; }
    catch (error) { return { ...(record ?? { devboxName: config.devbox.name }), liveLookupError: error.message }; }
  } finally { client.close(); }
}
export async function listBoxes({ env = process.env } = {}) { return listRecords(env); }
export async function killBox({ config, env = process.env, clientFactory = createDevboxClient } = {}) {
  config ??= await loadConfig(env);
  const client = clientFactory();
  try {
    const box = await resolveBox(client, config, false);
    if (box) await box.delete({ timeoutMs });
    await deleteRecord(config.devbox.name, env);
    return { devboxName: config.devbox.name, deleted: Boolean(box) };
  } finally { client.close(); }
}
