#!/usr/bin/env node
import { loadConfig } from "./config.js";
import { ensureBox, ensurePi, killBox, listBoxes, statusBox } from "./namespace.js";

async function main(): Promise<void> {
  const [verb, ...args] = process.argv.slice(2);
  if (Number(process.versions.node.split(".")[0]) < 22)
    throw new Error("herdr-box requires Node.js >=22");
  if (args.length) throw new Error(`Unexpected arguments: ${args.join(" ")}`);
  let value;
  if (verb === "config") value = await loadConfig();
  else if (verb === "ensure") value = await ensureBox();
  else if (verb === "ensure-pi") value = await ensurePi();
  else if (verb === "status") value = await statusBox();
  else if (verb === "list") value = await listBoxes();
  else if (verb === "kill") value = await killBox();
  else throw new Error("Usage: node dist/cli.js <config|ensure|ensure-pi|status|list|kill>");
  process.stdout.write(`${JSON.stringify(value)}\n`);
}
main().catch((error: unknown) => {
  process.stderr.write(`herdr-box: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
