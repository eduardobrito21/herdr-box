import TOML from "@iarna/toml";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export type BoxConfig = {
  devbox: { name: string; blueprint: string; path: string };
  pi: { command: string; on_missing: "install" | "fail" };
};

type ConfigTable = Record<string, unknown>;

const defaults: BoxConfig = {
  devbox: { name: "db-default", blueprint: "bp-default", path: "/workspaces" },
  pi: { command: "pi", on_missing: "install" },
};

function nonEmpty(value: unknown, key: string): string {
  if (typeof value !== "string" || value.trim() === "")
    throw new Error(`${key} must be a non-empty string`);
  return value.trim();
}

function isConfigTable(value: unknown): value is ConfigTable {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function configTable(value: unknown, name: string): ConfigTable {
  if (!isConfigTable(value)) throw new Error(`[${name}] must be a TOML table`);
  return value;
}

function readString(value: unknown, fallback: string, key: string): string {
  return value === undefined
    ? fallback
    : typeof value === "string"
      ? value.trim()
      : (() => {
          throw new Error(`${key} must be a string`);
        })();
}

export function configDir(env: NodeJS.ProcessEnv = process.env): string {
  return (
    env["HERDR_PLUGIN_CONFIG_DIR"] ??
    path.join(
      env["XDG_CONFIG_HOME"] ?? path.join(os.homedir(), ".config"),
      "herdr/plugins/herdr-box",
    )
  );
}

export async function loadConfig(env: NodeJS.ProcessEnv = process.env): Promise<BoxConfig> {
  const file = path.join(configDir(env), "config.toml");
  let source: string;
  try {
    source = await readFile(file, "utf8");
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return structuredClone(defaults);
    throw new Error(
      `Cannot read ${file}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  let parsed: ConfigTable;
  try {
    parsed = configTable(TOML.parse(source), "root");
  } catch (error: unknown) {
    throw new Error(
      `Invalid TOML in ${file}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  const knownFields: Record<string, readonly string[]> = {
    devbox: ["name", "blueprint", "path"],
    pi: ["command", "on_missing"],
  };
  for (const section of Object.keys(parsed)) {
    if (!Object.hasOwn(knownFields, section))
      throw new Error(`Unknown config section [${section}] in ${file}`);
  }
  const sections: Record<string, ConfigTable> = {};
  for (const section of Object.keys(parsed)) {
    const fields = configTable(parsed[section], section);
    sections[section] = fields;
    for (const key of Object.keys(fields)) {
      if (!knownFields[section]?.includes(key))
        throw new Error(`Unknown config key ${section}.${key} in ${file}`);
    }
  }
  const devbox = sections["devbox"] ?? {};
  const pi = sections["pi"] ?? {};
  const onMissing = nonEmpty(pi["on_missing"] ?? defaults.pi.on_missing, "pi.on_missing");
  if (onMissing !== "install" && onMissing !== "fail")
    throw new Error("pi.on_missing must be install or fail");
  return {
    devbox: {
      name:
        devbox["name"] === undefined
          ? defaults.devbox.name
          : nonEmpty(devbox["name"], "devbox.name"),
      blueprint:
        devbox["blueprint"] === undefined
          ? defaults.devbox.blueprint
          : nonEmpty(devbox["blueprint"], "devbox.blueprint"),
      path: readString(devbox["path"], defaults.devbox.path, "devbox.path"),
    },
    pi: {
      command: readString(pi["command"], defaults.pi.command, "pi.command"),
      on_missing: onMissing,
    },
  };
}
