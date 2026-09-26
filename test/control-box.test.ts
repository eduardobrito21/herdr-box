import TOML from "@iarna/toml";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, copyFile, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const script = path.join(root, "bin/box");
async function fixture() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "herdr-box-control-"));
  await mkdir(path.join(dir, "dist/src"), { recursive: true });
  await mkdir(path.join(dir, "bin/lib"), { recursive: true });
  await copyFile(path.join(root, "bin/lib/paths.sh"), path.join(dir, "bin/lib/paths.sh"));
  await copyFile(script, path.join(dir, "bin/box"));
  await chmod(path.join(dir, "bin/box"), 0o755);
  const cliLog = path.join(dir, "cli.log");
  await writeFile(
    path.join(dir, "dist/src/cli.js"),
    `
const fs = require('node:fs');
const verb = process.argv[2];
fs.appendFileSync(process.env.CLI_LOG, verb + '\\n');
const values = {
 config: { devbox: { name: 'db-test', blueprint: 'bp', path: "/work space's" }, pi: { command: process.env.PI_COMMAND ?? 'pi', on_missing: 'install' } },
 ensure: { devboxName: 'db-test', remotePath: "/work space's" },
 'ensure-pi': { piCommand: 'pi' },
 status: { devboxName: 'db-test', remotePath: '/workspaces', status: 'ready' },
 list: [], kill: { killed: true }
};
console.log(JSON.stringify(values[verb]));
`,
  );
  const bindir = path.join(dir, "mockbin");
  await mkdir(bindir);
  const herdrLog = path.join(dir, "herdr.log");
  await writeFile(
    path.join(bindir, "herdr"),
    '#!/bin/sh\nprintf "%s\\n" "$*" >> "$HERDR_LOG"\nif [ "$1 $2 $3" = "pane current --current" ]; then printf \'{"pane":{"pane_id":"wB:p1"}}\'; fi\n',
  );
  await writeFile(path.join(bindir, "devbox"), '#!/bin/sh\nprintf "%s\\n" "$*" >> "$DEVBOX_LOG"\n');
  for (const name of ["herdr", "devbox"]) await chmod(path.join(bindir, name), 0o755);
  const env = {
    ...process.env,
    PATH: `${bindir}:${process.env.PATH}`,
    CLI_LOG: cliLog,
    HERDR_LOG: herdrLog,
    DEVBOX_LOG: path.join(dir, "devbox.log"),
    HERDR_PLUGIN_ID: "herdr-box",
    HERDR_WORKSPACE_ID: "wB",
    HERDR_PLUGIN_CONFIG_DIR: dir,
    HERDR_PLUGIN_STATE_DIR: dir,
    HERDR_BIN_PATH: path.join(bindir, "herdr"),
    BOX_SCRIPT: path.join(dir, "bin/box"),
  };
  return { dir, env, cliLog, herdrLog, devboxLog: env.DEVBOX_LOG };
}
function run(args, env) {
  return spawnSync("bash", [env.BOX_SCRIPT ?? script, ...args], {
    encoding: "utf8",
    env,
  });
}

test("open action opens a pane without doing slow provisioning in the action process", async () => {
  const f = await fixture();
  const result = run(["open"], f.env);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(await readFile(f.cliLog, "utf8").catch(() => ""), "");
  assert.match(
    await readFile(f.herdrLog, "utf8"),
    /plugin pane open --plugin herdr-box --entrypoint open --placement zoomed --workspace wB --target-pane wB:p1/,
  );
});

test("open pane ensures once and quotes cwd/command across the SSH command boundary", async () => {
  const f = await fixture();
  const result = run(["open"], { ...f.env, HERDR_PLUGIN_ENTRYPOINT_ID: "box" });
  assert.equal(result.status, 0, result.stderr);
  assert.match(await readFile(f.cliLog, "utf8"), /^config\nensure\nensure-pi\n$/);
  assert.match(await readFile(f.devboxLog, "utf8"), /--force_pty db-test -- bash -lc/);
  assert.ok((await readFile(f.devboxLog, "utf8")).includes("cd -- '/work space'\\''s'"));
  assert.match(await readFile(f.devboxLog, "utf8"), /exec bash -lc 'pi'/);
});

test("shell action uses a distinct pane and ensures box but skips pi", async () => {
  const f = await fixture();
  const action = run(["shell"], f.env);
  assert.equal(action.status, 0, action.stderr);
  assert.match(await readFile(f.herdrLog, "utf8"), /entrypoint shell/);
  const pane = run(["shell"], {
    ...f.env,
    HERDR_PLUGIN_ENTRYPOINT_ID: "shell",
  });
  assert.equal(pane.status, 0, pane.stderr);
  assert.match(await readFile(f.cliLog, "utf8"), /ensure/);
  assert.doesNotMatch(await readFile(f.cliLog, "utf8"), /ensure-pi/);
  assert.doesNotMatch(await readFile(f.devboxLog, "utf8"), /exec bash -lc/);
});

test("kill requires explicit confirmation when noninteractive", async () => {
  const f = await fixture();
  const result = run(["kill"], f.env);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /requires --yes/);
  assert.equal(run(["kill", "--yes"], f.env).status, 0);
});

test("empty pi command enters an interactive shell without pi checks", async () => {
  const f = await fixture();
  const result = run(["open"], {
    ...f.env,
    HERDR_PLUGIN_ENTRYPOINT_ID: "box",
    PI_COMMAND: "",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(await readFile(f.cliLog, "utf8"), /ensure-pi/);
  assert.match(await readFile(f.devboxLog, "utf8"), /exec bash -l/);
});

test("missing devbox CLI fails before provisioning and malformed arguments fail cleanly", async () => {
  const f = await fixture();
  const noDevbox = {
    ...f.env,
    PATH: f.env.PATH.split(path.delimiter)
      .filter((part) => !part.endsWith("/mockbin") && !part.endsWith("/.local/bin"))
      .join(path.delimiter),
  };
  const missing = run(["open"], noDevbox);
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /standalone Namespace devbox CLI/);
  assert.equal(await readFile(f.cliLog, "utf8").catch(() => ""), "");
  const bad = run(["open", "--bad"], f.env);
  assert.equal(bad.status, 2);
});

test("existing pane invocation attaches directly without re-opening a pane", async () => {
  const f = await fixture();
  const result = run(["shell"], {
    ...f.env,
    HERDR_PLUGIN_ENTRYPOINT_ID: "shell",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(await readFile(f.herdrLog, "utf8").catch(() => ""), "");
  assert.match(await readFile(f.devboxLog, "utf8"), /--force_pty db-test/);
});

test("manifest uses supported plugin id, pane commands, keybinding, and build sequence", async () => {
  const manifest = TOML.parse(await readFile(path.join(root, "herdr-plugin.toml"), "utf8"));
  assert.equal(manifest.id, "herdr-box");
  assert.equal(manifest.min_herdr_version, "0.7.0");
  assert.deepEqual(manifest.build, [{ command: ["bash", "install.sh"] }]);
  assert.deepEqual(
    manifest.panes.map((pane) => pane.command),
    [
      ["bash", "bin/box", "open"],
      ["bash", "bin/box", "shell"],
    ],
  );
  assert.equal(manifest.keys[0].command, "herdr-box.open");
  assert.equal(manifest.keys[0].key, "prefix+b");
  assert.match(
    manifest.actions.find((action) => action.id === "kill").title,
    /deletes remote data/,
  );
});

test("installer performs dependencies and creates only a safe idempotent CLI link", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "herdr-box-install-"));
  const bin = path.join(dir, "bin");
  const mockbin = path.join(dir, "mockbin");
  await mkdir(mockbin);
  const npmLog = path.join(dir, "npm.log");
  await writeFile(
    path.join(mockbin, "npm"),
    '#!/bin/sh\nprintf "%s\\n" "$*" >> "$INSTALL_NPM_LOG"\n',
  );
  await chmod(path.join(mockbin, "npm"), 0o755);
  const nodeShim = path.join(mockbin, "node");
  await (await import("node:fs/promises")).symlink(process.execPath, nodeShim);
  const env = {
    ...process.env,
    HERDR_BOX_BIN_DIR: bin,
    HERDR_BOX_NODE: nodeShim,
    PATH: `${mockbin}:${process.env.PATH}`,
    INSTALL_NPM_LOG: npmLog,
  };
  const installer = path.join(root, "install.sh");
  const first = spawnSync("bash", [installer], {
    cwd: root,
    env,
    encoding: "utf8",
  });
  assert.equal(first.status, 0, first.stderr);
  const { lstat, writeFile: put } = await import("node:fs/promises");
  assert.equal((await lstat(path.join(bin, "box"))).isSymbolicLink(), true);
  assert.equal(await readFile(npmLog, "utf8"), "ci\nrun build\n");
  const second = spawnSync("bash", [installer], {
    cwd: root,
    env,
    encoding: "utf8",
  });
  assert.equal(second.status, 0, second.stderr);
  assert.equal(await readFile(npmLog, "utf8"), "ci\nrun build\nci\nrun build\n");
  const occupied = path.join(dir, "occupied");
  await mkdir(occupied);
  await put(path.join(occupied, "box"), "keep me");
  const refused = spawnSync("bash", [installer], {
    cwd: root,
    env: { ...env, HERDR_BOX_BIN_DIR: occupied },
    encoding: "utf8",
  });
  assert.equal(refused.status, 1);
  assert.equal(await readFile(path.join(occupied, "box"), "utf8"), "keep me");
});
