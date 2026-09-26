import {
  createDevboxClient,
  type Blueprint,
  type BlueprintDefinition,
  type Devbox,
  type DevboxClient,
} from "@namespacelabs/sdk/devbox";
import { loadConfig, type BoxConfig } from "./config.js";
import { listRecords, readRecord, writeRecord, type BoxRecord } from "./store.js";

const blueprintDefinition = {
  image: "node:26-slim",
  size: "m",
  volumeSizeGB: 128,
  ephemeral: true,
} satisfies BlueprintDefinition;
const timeoutMs = 60_000;

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

type WorkContext = {
  worktree?: { path?: string };
  workspace?: { cwd?: string };
};

function isPathRecord(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    (!("path" in value) || typeof value["path"] === "string") &&
    (!("cwd" in value) || typeof value["cwd"] === "string")
  );
}

function isWorkContext(value: unknown): value is WorkContext {
  return (
    value !== null &&
    typeof value === "object" &&
    (!("worktree" in value) || isPathRecord(value["worktree"])) &&
    (!("workspace" in value) || isPathRecord(value["workspace"]))
  );
}

function parseWorkContext(json: string | undefined): WorkContext {
  if (!json) return {};
  try {
    const value: unknown = JSON.parse(json);
    return isWorkContext(value) ? value : {};
  } catch {
    return {};
  }
}
const quote = (s: string): string => `'${s.replaceAll("'", `'\\''`)}'`;

async function ensureBlueprint(client: DevboxClient, name: string): Promise<Blueprint> {
  for await (const blueprint of client.blueprints.iterate({ timeoutMs })) {
    if (blueprint.name === name) return blueprint;
  }
  return client.blueprints.create(name, blueprintDefinition, { timeoutMs });
}
async function namedBox(client: DevboxClient, name: string): Promise<Devbox | null> {
  for await (const box of client.devboxes.iterate({ timeoutMs })) {
    if (box.name === name) return box;
  }
  return null;
}
export async function resolveBox(
  client: DevboxClient,
  config: BoxConfig,
  create = false,
): Promise<Devbox | null> {
  const found = await namedBox(client, config.devbox.name);
  if (found || !create) return found;
  const blueprint = await ensureBlueprint(client, config.devbox.blueprint);
  return client.devboxes.create(
    { name: config.devbox.name, blueprint: blueprint.name },
    { timeoutMs },
  );
}
async function checkedShell(box: Devbox, script: string, label: string): Promise<string> {
  const result = await box.shell(script, { timeoutMs });
  if (result.exitCode !== 0) {
    const detail = [result.stderr.trim(), result.error].find(Boolean);
    throw new Error(`${label}: ${detail ?? `remote command exited ${result.exitCode}`}`);
  }
  return result.stdout.trim();
}
export function worktreePath(env: NodeJS.ProcessEnv): string {
  if (env["HERDR_WORKTREE_PATH"]) return env["HERDR_WORKTREE_PATH"];
  const context = parseWorkContext(env["HERDR_PLUGIN_CONTEXT_JSON"]);
  return (
    context.worktree?.path ?? context.workspace?.cwd ?? env["HERDR_BOX_LOCAL_CWD"] ?? process.cwd()
  );
}

function cdScript(directory: string): string {
  if (directory === "~") return 'cd -- "$HOME" && pwd';
  if (directory.startsWith("~/")) return `cd -- "$HOME"/${quote(directory.slice(2))} && pwd`;
  return directory ? `cd -- ${quote(directory)} && pwd` : "pwd";
}

export async function ensureBox({
  config,
  env = process.env,
  clientFactory = createDevboxClient,
}: {
  config?: BoxConfig;
  env?: NodeJS.ProcessEnv;
  clientFactory?: () => DevboxClient;
} = {}): Promise<{ devboxName: string; remotePath: string; [key: string]: unknown }> {
  config ??= await loadConfig(env);
  const client = clientFactory();
  try {
    const box = await resolveBox(client, config, true);
    if (!box) throw new Error(`Failed to create configured Devbox ${config.devbox.name}`);
    let remotePath;
    try {
      remotePath = await checkedShell(
        box,
        cdScript(config.devbox.path),
        `Remote workspace ${config.devbox.path ?? "(home/default cwd)"} is unavailable`,
      );
    } catch (error: unknown) {
      if (config.devbox.path)
        throw new Error(
          `${errorText(error)}. Create/checkout that directory remotely or change devbox.path; herdr-box does not upload or create workspace files.`,
          { cause: error },
        );
      throw error;
    }
    if (!remotePath.startsWith("/"))
      throw new Error("Devbox did not return an absolute workspace path");
    const previous = await readRecord(config.devbox.name, env);
    const record = await writeRecord(
      config.devbox.name,
      {
        blueprint: config.devbox.blueprint,
        remotePath,
        worktreePath: worktreePath(env),
        status: "ready",
        devboxId: box.id,
        ...(previous?.["createdAt"] ? {} : { createdAt: new Date().toISOString() }),
      },
      env,
    );
    return { ...record, devboxName: config.devbox.name, remotePath };
  } finally {
    client.close();
  }
}
export async function ensurePi({
  config,
  env = process.env,
  clientFactory = createDevboxClient,
}: {
  config?: BoxConfig;
  env?: NodeJS.ProcessEnv;
  clientFactory?: () => DevboxClient;
} = {}): Promise<
  | { checked: false; reason: string }
  | { devboxName: string; command: string; installed: boolean; checked: true }
> {
  config ??= await loadConfig(env);
  if (!config.pi.command) return { checked: false, reason: "pi command is empty" };
  const client = clientFactory();
  try {
    const box = await resolveBox(client, config, false);
    if (!box)
      throw new Error(`Configured Devbox ${config.devbox.name} does not exist; run ensure first`);
    const command = "pi";
    const test = await box.shell(`command -v ${command}`, { timeoutMs });
    if (test.exitCode === 0)
      return {
        devboxName: box.name,
        command: config.pi.command,
        installed: false,
        checked: true,
      };
    if (config.pi.on_missing === "fail")
      throw new Error(
        `pi is missing in Devbox ${box.name}. Install it remotely with npm install --global --ignore-scripts @earendil-works/pi-coding-agent, or set pi.on_missing = "install".`,
      );
    const installation = await box.shell(
      "npm install --global --ignore-scripts @earendil-works/pi-coding-agent",
      { timeoutMs },
    );
    if (installation.exitCode !== 0) {
      const detail = [installation.stderr.trim(), installation.error].find(Boolean);
      throw new Error(
        `Pi installation failed: ${detail ?? `remote command exited ${installation.exitCode}`}`,
      );
    }
    const verify = await box.shell(`command -v ${command}`, { timeoutMs });
    if (verify.exitCode !== 0)
      throw new Error(`Pi installation succeeded but pi is still unavailable on PATH`);
    return {
      devboxName: box.name,
      command: config.pi.command,
      checked: true,
      installed: true,
    };
  } finally {
    client.close();
  }
}
export async function statusBox({
  config,
  env = process.env,
  clientFactory = createDevboxClient,
}: {
  config?: BoxConfig;
  env?: NodeJS.ProcessEnv;
  clientFactory?: () => DevboxClient;
} = {}): Promise<Record<string, unknown>> {
  config ??= await loadConfig(env);
  const record = await readRecord(config.devbox.name, env);
  let client: DevboxClient | undefined;
  try {
    let box;
    try {
      client = clientFactory();
    } catch (error: unknown) {
      return {
        ...(record ?? { devboxName: config.devbox.name }),
        liveLookupError: errorText(error),
      };
    }
    try {
      box = await resolveBox(client, config, false);
    } catch (error: unknown) {
      return {
        ...(record ?? { devboxName: config.devbox.name }),
        liveLookupError: errorText(error),
      };
    }
    if (!box) return { ...(record ?? { devboxName: config.devbox.name }), live: null };
    try {
      await box.refresh({ timeoutMs });
      return {
        ...(record ?? { devboxName: config.devbox.name }),
        live: box.info,
      };
    } catch (error: unknown) {
      return {
        ...(record ?? { devboxName: config.devbox.name }),
        liveLookupError: errorText(error),
      };
    }
  } finally {
    client?.close();
  }
}
export async function listBoxes({ env = process.env }: { env?: NodeJS.ProcessEnv } = {}): Promise<
  BoxRecord[]
> {
  return listRecords(env);
}
export async function killBox({
  config,
  env = process.env,
  clientFactory = createDevboxClient,
}: {
  config?: BoxConfig;
  env?: NodeJS.ProcessEnv;
  clientFactory?: () => DevboxClient;
} = {}): Promise<{ devboxName: string; deleted: boolean }> {
  config ??= await loadConfig(env);
  const client = clientFactory();
  try {
    const box = await resolveBox(client, config, false);
    if (box) await box.delete({ timeoutMs });
    await writeRecord(
      config.devbox.name,
      { status: "deleted", deletedAt: new Date().toISOString() },
      env,
    );
    return { devboxName: config.devbox.name, deleted: Boolean(box) };
  } finally {
    client.close();
  }
}
