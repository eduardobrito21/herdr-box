import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, copyFile, mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const script = path.join(root, 'bin/box');
async function fixture() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'herdr-box-control-'));
  await mkdir(path.join(dir, 'src'), { recursive: true });
  await mkdir(path.join(dir, 'bin'), { recursive: true });
  await copyFile(script, path.join(dir, 'bin/box'));
  await chmod(path.join(dir, 'bin/box'), 0o755);
  const cliLog = path.join(dir, 'cli.log');
  await writeFile(path.join(dir, 'src/cli.js'), `
const fs = require('node:fs');
const verb = process.argv[2];
fs.appendFileSync(process.env.CLI_LOG, verb + '\\n');
const values = {
 config: { devbox: { name: 'db-test', blueprint: 'bp', path: "/work space's" }, pi: { command: 'pi', on_missing: 'install' } },
 ensure: { devboxName: 'db-test', remotePath: "/work space's" },
 'ensure-pi': { piCommand: 'pi' },
 status: { devboxName: 'db-test', remotePath: '/workspaces', status: 'ready' },
 list: [], kill: { killed: true }
};
console.log(JSON.stringify(values[verb]));
`);
  const bindir = path.join(dir, 'mockbin');
  await mkdir(bindir);
  const herdrLog = path.join(dir, 'herdr.log');
  await writeFile(path.join(bindir, 'herdr'), '#!/bin/sh\nprintf "%s\\n" "$*" >> "$HERDR_LOG"\n');
  await writeFile(path.join(bindir, 'devbox'), '#!/bin/sh\nprintf "%s\\n" "$*" >> "$DEVBOX_LOG"\n');
  for (const name of ['herdr', 'devbox']) await chmod(path.join(bindir, name), 0o755);
  const env = { ...process.env, PATH: `${bindir}:${process.env.PATH}`, CLI_LOG: cliLog, HERDR_LOG: herdrLog, DEVBOX_LOG: path.join(dir, 'devbox.log'), HERDR_PLUGIN_ID: 'herdr.box', HERDR_PLUGIN_CONFIG_DIR: dir, HERDR_PLUGIN_STATE_DIR: dir, HERDR_BIN_PATH: path.join(bindir, 'herdr'), BOX_SCRIPT: path.join(dir, 'bin/box') };
  return { dir, env, cliLog, herdrLog, devboxLog: env.DEVBOX_LOG };
}
function run(args, env) { return spawnSync('bash', [env.BOX_SCRIPT ?? script, ...args], { encoding: 'utf8', env }); }

test('open action ensures a box then opens a zoomed pane without recursion', async () => {
  const f = await fixture();
  const result = run(['open'], f.env);
  assert.equal(result.status, 0, result.stderr);
  assert.match(await readFile(f.cliLog, 'utf8'), /^ensure\n$/);
  assert.match(await readFile(f.herdrLog, 'utf8'), /plugin pane open --plugin herdr\.box --entrypoint open --placement zoomed/);
});

test('pane open routes to devbox ssh with forced TTY, safely quoted cwd, and pi', async () => {
  const f = await fixture();
  const env = { ...f.env, HERDR_PLUGIN_ENTRYPOINT_ID: 'open' };
  const result = run(['pane-open'], env);
  assert.equal(result.status, 0, result.stderr);
  assert.match(await readFile(f.cliLog, 'utf8'), /ensure/);
  assert.match(await readFile(f.devboxLog, 'utf8'), /--force_pty db-test -- bash -lc/);
  assert.match(await readFile(f.devboxLog, 'utf8'), /work space/);
  assert.match(await readFile(f.devboxLog, 'utf8'), /exec 'pi'/);
});

test('shell action uses a distinct pane and does not ensure or install pi', async () => {
  const f = await fixture();
  const action = run(['shell'], f.env);
  assert.equal(action.status, 0, action.stderr);
  assert.match(await readFile(f.herdrLog, 'utf8'), /entrypoint shell/);
  const env = { ...f.env, HERDR_PLUGIN_ENTRYPOINT_ID: 'shell' };
  const pane = run(['pane-shell'], env);
  assert.equal(pane.status, 0, pane.stderr);
  const calls = await readFile(f.cliLog, 'utf8');
  assert.match(calls, /status/);
  assert.doesNotMatch(calls, /ensure/);
  assert.doesNotMatch(await readFile(f.devboxLog, 'utf8'), /exec 'pi'/);
});

test('kill requires explicit confirmation when noninteractive', async () => {
  const f = await fixture();
  const result = run(['kill'], f.env);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /requires --yes/);
  assert.equal(run(['kill', '--yes'], f.env).status, 0);
});

test('existing pane invocation attaches directly without re-opening a pane', async () => {
  const f = await fixture();
  const result = run(['pane-shell'], { ...f.env, HERDR_PLUGIN_ENTRYPOINT_ID: 'shell' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(await readFile(f.herdrLog, 'utf8').catch(() => ''), '');
  assert.match(await readFile(f.devboxLog, 'utf8'), /--force_pty db-test/);
});
