import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import TOML from "@iarna/toml";

const defaults = {
  devbox: { name: "db-default", blueprint: "bp-default", path: "/workspaces" },
  pi: { command: "pi", on_missing: "install" },
};

function nonEmpty(value, key) {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${key} must be a non-empty string`);
  return value.trim();
}

export function configDir(env = process.env) {
  return env.HERDR_PLUGIN_CONFIG_DIR || path.join(env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "herdr/plugins/herdr-box");
}

export async function loadConfig(env = process.env) {
  const file = path.join(configDir(env), "config.toml");
  let source;
  try { source = await readFile(file, "utf8"); }
  catch (error) {
    if (error.code === "ENOENT") return structuredClone(defaults);
    throw new Error(`Cannot read ${file}: ${error.message}`, { cause: error });
  }
  let parsed;
  try { parsed = TOML.parse(source); }
  catch (error) { throw new Error(`Invalid TOML in ${file}: ${error.message}`, { cause: error }); }
  if (!parsed || typeof parsed !== "object") throw new Error(`${file} must contain TOML tables`);
  for (const section of Object.keys(parsed)) if (!Object.hasOwn(defaults, section)) throw new Error(`Unknown config section [${section}] in ${file}`);
  for (const [section, fields] of Object.entries(parsed)) {
    if (!fields || typeof fields !== "object" || Array.isArray(fields)) throw new Error(`[${section}] must be a TOML table`);
    for (const key of Object.keys(fields)) if (!Object.hasOwn(defaults[section], key)) throw new Error(`Unknown config key ${section}.${key} in ${file}`);
  }
  const devbox = parsed.devbox ?? {};
  const pi = parsed.pi ?? {};
  const config = {
    devbox: {
      name: devbox.name === undefined ? defaults.devbox.name : nonEmpty(devbox.name, "devbox.name"),
      blueprint: devbox.blueprint === undefined ? defaults.devbox.blueprint : nonEmpty(devbox.blueprint, "devbox.blueprint"),
      path: devbox.path === undefined ? defaults.devbox.path : (typeof devbox.path === "string" ? devbox.path.trim() : (() => { throw new Error("devbox.path must be a string"); })()),
    },
    pi: {
      command: pi.command === undefined ? defaults.pi.command : (typeof pi.command === "string" ? pi.command.trim() : (() => { throw new Error("pi.command must be a string"); })()),
      on_missing: pi.on_missing === undefined ? defaults.pi.on_missing : nonEmpty(pi.on_missing, "pi.on_missing"),
    },
  };
  if (!["install", "error", "skip"].includes(config.pi.on_missing)) throw new Error("pi.on_missing must be install, error, or skip");
  return config;
}
