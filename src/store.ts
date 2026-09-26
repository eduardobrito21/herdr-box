import { mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export type BoxRecord = {
  [key: string]: unknown;
  devboxName: string;
  updatedAt?: string;
};

type RecordPatch = Record<string, unknown>;
type Environment = NodeJS.ProcessEnv;

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isBoxRecord(value: unknown): value is BoxRecord {
  return (
    value !== null &&
    typeof value === "object" &&
    "devboxName" in value &&
    typeof value["devboxName"] === "string"
  );
}

function parseRecord(value: unknown): BoxRecord {
  if (!isBoxRecord(value)) throw new Error("Invalid box record format");
  return value;
}

export function stateDir(env: Environment = process.env): string {
  return (
    env["HERDR_PLUGIN_STATE_DIR"] ??
    path.join(
      env["XDG_STATE_HOME"] ?? path.join(os.homedir(), ".local/state"),
      "herdr/plugins/herdr-box",
    )
  );
}

const boxesDir = (env: Environment): string => path.join(stateDir(env), "boxes");
const recordPath = (name: string, env: Environment): string =>
  path.join(boxesDir(env), `${Buffer.from(name).toString("base64url")}.json`);

export async function readRecord(
  name: string,
  env: Environment = process.env,
): Promise<BoxRecord | null> {
  try {
    const value: unknown = JSON.parse(await readFile(recordPath(name, env), "utf8"));
    return parseRecord(value);
  } catch (error: unknown) {
    if (isMissing(error)) return null;
    throw new Error(`Cannot read box record for ${name}: ${errorText(error)}`, {
      cause: error,
    });
  }
}

export async function writeRecord(
  name: string,
  patch: RecordPatch,
  env: Environment = process.env,
): Promise<BoxRecord> {
  const directory = boxesDir(env);
  await mkdir(directory, { recursive: true });
  const previous = await readRecord(name, env);
  const next: BoxRecord = {
    ...previous,
    ...patch,
    devboxName: name,
    updatedAt: new Date().toISOString(),
  };
  const file = recordPath(name, env);
  const temporary = `${file}.tmp.${process.pid}.${crypto.randomUUID()}`;
  try {
    await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, {
      flag: "wx",
      mode: 0o600,
    });
    await rename(temporary, file);
  } catch (error: unknown) {
    await unlink(temporary).catch(() => {});
    throw error;
  }
  return next;
}

export async function deleteRecord(name: string, env: Environment = process.env): Promise<void> {
  try {
    await unlink(recordPath(name, env));
  } catch (error: unknown) {
    if (!isMissing(error)) throw error;
  }
}

export async function listRecords(env: Environment = process.env): Promise<BoxRecord[]> {
  let files: string[];
  try {
    files = await readdir(boxesDir(env));
  } catch (error: unknown) {
    if (isMissing(error)) return [];
    throw error;
  }
  const records = await Promise.all(
    files
      .filter((entry) => entry.endsWith(".json"))
      .map(async (file) => {
        const value: unknown = JSON.parse(await readFile(path.join(boxesDir(env), file), "utf8"));
        return parseRecord(value);
      }),
  );
  return records.toSorted((a, b) => a.devboxName.localeCompare(b.devboxName));
}
