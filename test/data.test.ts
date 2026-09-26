import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadConfig } from "../src/config.js";
import { ensureBox, ensurePi, killBox, listBoxes, statusBox } from "../src/namespace.js";
import { readRecord } from "../src/store.js";

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "herdr-box-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const env = {
    HERDR_PLUGIN_CONFIG_DIR: path.join(root, "config"),
    HERDR_PLUGIN_STATE_DIR: path.join(root, "state"),
    HERDR_WORKTREE_PATH: "/local/worktree",
  };
  await mkdir(env.HERDR_PLUGIN_CONFIG_DIR);
  return { root, env };
}
function fakeClient({ boxes = [], blueprints = [], onCreate, onDelete } = {}) {
  let closed = false;
  const boxApi = boxes;
  const bpApi = blueprints;
  const api = (items) => ({
    async *iterate() {
      yield* items;
    },
  });
  return {
    client: {
      devboxes: {
        ...api(boxApi),
        async create(input) {
          onCreate?.("box", input);
          const box = makeBox(input.name, input.blueprint);
          boxApi.push(box);
          return box;
        },
        async get(name) {
          const b = boxApi.find((item) => item.name === name);
          if (!b) throw Error("missing");
          return b;
        },
      },
      blueprints: {
        ...api(bpApi),
        async create(name, definition) {
          onCreate?.("blueprint", { name, ...definition });
          const bp = { name, definition };
          bpApi.push(bp);
          return bp;
        },
      },
      close() {
        closed = true;
      },
    },
    wasClosed: () => closed,
  };
}
function makeBox(name, blueprint = "bp-default") {
  return {
    id: `id-${name}`,
    name,
    info: { id: `id-${name}`, name, state: "running" },
    async shell(script) {
      if (script.startsWith("cd --"))
        return script.includes("missing")
          ? { exitCode: 1, stderr: "No such file" }
          : { exitCode: 0, stdout: "/workspaces\n" };
      if (script === "pwd") return { exitCode: 0, stdout: "/home/user\n" };
      if (script.startsWith("command -v"))
        return {
          exitCode: script.includes("pi") && this.piMissing ? 1 : 0,
          stdout: "/usr/bin/pi\n",
        };
      if (script.startsWith("npm install")) {
        this.piMissing = false;
        this.installedScript = script;
        return { exitCode: 0, stdout: "installed" };
      }
      return { exitCode: 0, stdout: "" };
    },
    async refresh() {
      return this;
    },
    async delete() {
      this.deleted = true;
    },
  };
}

test("CLI dispatch writes one JSON value on success and nonzero errors to stderr", async (t) => {
  const { env } = await fixture(t);
  const result = spawnSync(process.execPath, ["dist/src/cli.js", "config"], {
    cwd: process.cwd(),
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.deepEqual(JSON.parse(result.stdout), {
    devbox: {
      name: "db-default",
      blueprint: "bp-default",
      path: "/workspaces",
    },
    pi: { command: "pi", on_missing: "install" },
  });
  const bad = spawnSync(process.execPath, ["dist/src/cli.js", "unknown"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  assert.equal(bad.status, 1);
  assert.equal(bad.stdout, "");
  assert.match(bad.stderr, /Usage:/);
});

test("configuration defaults and validates the frozen public TOML schema", async (t) => {
  const { env } = await fixture(t);
  assert.deepEqual(await loadConfig(env), {
    devbox: {
      name: "db-default",
      blueprint: "bp-default",
      path: "/workspaces",
    },
    pi: { command: "pi", on_missing: "install" },
  });
  await writeFile(
    path.join(env.HERDR_PLUGIN_CONFIG_DIR, "config.toml"),
    '[devbox]\nname="custom"\npath=""\n[pi]\ncommand=""\non_missing="skip"\n',
  );
  await assert.rejects(loadConfig(env), /pi.on_missing must be install or fail/);
  await writeFile(
    path.join(env.HERDR_PLUGIN_CONFIG_DIR, "config.toml"),
    '[devbox]\nname="custom"\npath=""\n[pi]\ncommand=""\non_missing="fail"\n',
  );
  assert.deepEqual(await loadConfig(env), {
    devbox: { name: "custom", blueprint: "bp-default", path: "" },
    pi: { command: "", on_missing: "fail" },
  });
  await writeFile(
    path.join(env.HERDR_PLUGIN_CONFIG_DIR, "config.toml"),
    '[devbox]\nimage="custom"\n',
  );
  await assert.rejects(loadConfig(env), /Unknown config key devbox.image/);
});

test("ensure creates/reuses blueprint and box, resolves configured workspace, and persists record", async (t) => {
  const { env } = await fixture(t);
  const creations = [];
  const fake = fakeClient({ onCreate: (...args) => creations.push(args) });
  const output = await ensureBox({ env, clientFactory: () => fake.client });
  assert.deepEqual(
    creations.map(([kind]) => kind),
    ["blueprint", "box"],
  );
  assert.equal(creations[0][1].image, "node:26-slim");
  assert.equal(output.remotePath, "/workspaces");
  assert.equal(output.worktreePath, "/local/worktree");
  assert.equal((await readRecord("db-default", env)).devboxId, "id-db-default");
  assert.equal(fake.wasClosed(), true);
  const existing = fakeClient({ boxes: [makeBox("db-default")] });
  await ensureBox({ env, clientFactory: () => existing.client });
  assert.equal(
    (
      await readFile(
        path.join(
          env.HERDR_PLUGIN_STATE_DIR,
          "boxes",
          `${Buffer.from("db-default").toString("base64url")}.json`,
        ),
        "utf8",
      )
    ).includes("ready"),
    true,
  );
});

test("workspace and pi errors surface, pi installs only using official npm command", async (t) => {
  const { env } = await fixture(t);
  const config = {
    devbox: { name: "db", blueprint: "bp", path: "/missing" },
    pi: { command: "pi", on_missing: "install" },
  };
  const fake = fakeClient({ boxes: [makeBox("db")] });
  await assert.rejects(
    ensureBox({ config, env, clientFactory: () => fake.client }),
    /Create\/checkout that directory remotely/,
  );
  const piBox = makeBox("db");
  piBox.piMissing = true;
  const withPi = fakeClient({ boxes: [piBox] });
  assert.equal((await ensurePi({ config, clientFactory: () => withPi.client })).installed, true);
  assert.equal(
    piBox.installedScript,
    "npm install --global --ignore-scripts @earendil-works/pi-coding-agent",
  );
  assert.equal(withPi.wasClosed(), true);
});

test("status never provisions; list and explicit kill operate on records", async (t) => {
  const { env } = await fixture(t);
  const config = {
    devbox: { name: "db", blueprint: "bp", path: "/workspaces" },
    pi: { command: "pi", on_missing: "install" },
  };
  const fake = fakeClient({ boxes: [makeBox("db")] });
  await ensureBox({ config, env, clientFactory: () => fake.client });
  const statusClient = fakeClient({ boxes: [makeBox("db")] });
  assert.equal(
    (await statusBox({ config, env, clientFactory: () => statusClient.client })).live.state,
    "running",
  );
  assert.equal((await listBoxes({ env })).length, 1);
  const killBoxHandle = makeBox("db");
  const killClient = fakeClient({ boxes: [killBoxHandle] });
  assert.deepEqual(await killBox({ config, env, clientFactory: () => killClient.client }), {
    devboxName: "db",
    deleted: true,
  });
  assert.equal(killBoxHandle.deleted, true);
  assert.equal((await readRecord("db", env)).status, "deleted");
  assert.equal(killClient.wasClosed(), true);
});
