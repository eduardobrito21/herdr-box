import { mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export function stateDir(env = process.env) {
  return env.HERDR_PLUGIN_STATE_DIR || path.join(env.XDG_STATE_HOME || path.join(os.homedir(), ".local/state"), "herdr/plugins/herdr-box");
}
const boxesDir = (env) => path.join(stateDir(env), "boxes");
const recordPath = (name, env) => path.join(boxesDir(env), `${Buffer.from(name).toString("base64url")}.json`);

export async function readRecord(name, env = process.env) {
  try { return JSON.parse(await readFile(recordPath(name, env), "utf8")); }
  catch (error) { if (error.code === "ENOENT") return null; throw new Error(`Cannot read box record for ${name}: ${error.message}`, { cause: error }); }
}
export async function writeRecord(name, patch, env = process.env) {
  const directory = boxesDir(env);
  await mkdir(directory, { recursive: true });
  const next = { ...(await readRecord(name, env) ?? {}), ...patch, devboxName: name, updatedAt: new Date().toISOString() };
  const file = recordPath(name, env);
  const temporary = `${file}.tmp.${process.pid}.${crypto.randomUUID()}`;
  try { await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, { flag: "wx", mode: 0o600 }); await rename(temporary, file); }
  catch (error) { await unlink(temporary).catch(() => {}); throw error; }
  return next;
}
export async function deleteRecord(name, env = process.env) {
  try { await unlink(recordPath(name, env)); } catch (error) { if (error.code !== "ENOENT") throw error; }
}
export async function listRecords(env = process.env) {
  let files;
  try { files = await readdir(boxesDir(env)); } catch (error) { if (error.code === "ENOENT") return []; throw error; }
  const records = [];
  for (const file of files.filter((entry) => entry.endsWith(".json"))) {
    const record = JSON.parse(await readFile(path.join(boxesDir(env), file), "utf8"));
    records.push(record);
  }
  return records.sort((a, b) => a.devboxName.localeCompare(b.devboxName));
}
