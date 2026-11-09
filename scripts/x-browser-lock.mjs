#!/usr/bin/env node
// Shared "x-browser" mutex: every job that drives the X browser (OpenClaw profile "openclaw", CDP 18800) holds it for
// its whole browser use. Identical copies live in clawfeed scripts/ and wukong .clawdbot/lib/; keep them identical.
//
// Lock: atomic mkdir of X_BROWSER_LOCK_PATH (default ~/.openclaw/state/locks/x-browser.lock) with owner.json
// {pid, owner, token, acquiredAt}. A waiter polls every X_BROWSER_LOCK_POLL_SEC (5) for up to X_BROWSER_LOCK_WAIT_SEC
// (5400), then fails with "x-browser lock busy (held by <owner>)". It breaks the lock when the holder pid is dead, or the
// lock is older than X_BROWSER_LOCK_MAX_HOLD_SEC (10800), or owner.json is still missing 60 s after the mkdir.
// Re-entrant: a second acquire in the same process only counts; a child whose X_BROWSER_LOCK_HELD=<path>:<token>
// matches the live lock (set by `run`) skips acquiring. Released on exit, SIGINT and SIGTERM.
//
// CLI: node x-browser-lock.mjs run [--owner NAME] -- CMD ARGS...   hold the lock while CMD runs (exit 75 when busy)
//      node x-browser-lock.mjs status                              print the holder JSON or "free"
import { mkdirSync, readFileSync, writeFileSync, renameSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir, hostname } from 'node:os';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const BUSY_EXIT = 75;
const num = (v, d) => (v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Number(v) : d);
export function lockPath() { return process.env.X_BROWSER_LOCK_PATH || join(homedir(), '.openclaw/state/locks/x-browser.lock'); }
function sleepSync(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }
function alive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}
export function readHolder(path = lockPath()) {
  try { return JSON.parse(readFileSync(join(path, 'owner.json'), 'utf8')); } catch { return null; }
}
function describe(h) { return h ? `${h.owner || '?'} pid ${h.pid} since ${h.acquiredAt}` : 'unknown owner'; }

// Why the lock at path may be broken, or '' while its holder is valid.
function staleReason(path, h) {
  const maxHoldMs = num(process.env.X_BROWSER_LOCK_MAX_HOLD_SEC, 10800) * 1000;
  let mtime;
  try { mtime = statSync(path).mtimeMs; } catch { return ''; }
  if (!h) return Date.now() - mtime > 60000 ? 'no owner file after 60s' : '';
  if (h.host && h.host !== hostname()) return '';
  if (!alive(h.pid)) return `holder pid ${h.pid} is dead`;
  const since = Date.parse(h.acquiredAt) || mtime;
  if (Date.now() - since > maxHoldMs) return `held longer than ${maxHoldMs / 1000}s`;
  return '';
}

// Break a stale lock without removing a lock someone else took in between: move it aside, then check it is the one we
// judged stale; if not, put it back.
function breakStale(path, h, reason, log) {
  const aside = `${path}.stale.${process.pid}.${randomBytes(3).toString('hex')}`;
  try { renameSync(path, aside); } catch { return; }
  const moved = readHolder(aside);
  if ((moved?.token || null) !== (h?.token || null)) {
    try { renameSync(aside, path); } catch {}
    return;
  }
  rmSync(aside, { recursive: true, force: true });
  log(`[x-browser-lock] broke stale lock (${reason}; was ${describe(h)})`);
}

let held = null; // { path, token, count }
let forwardingToChild = false; // `run`: on a signal, wait for the child to exit before releasing

function inheritedHold(path) {
  const env = process.env.X_BROWSER_LOCK_HELD || '';
  const i = env.lastIndexOf(':');
  if (i <= 0 || env.slice(0, i) !== path) return false;
  const h = readHolder(path);
  return Boolean(h && h.token === env.slice(i + 1) && alive(h.pid));
}

function release() {
  if (!held) return;
  const { path, token } = held;
  held = null;
  if (readHolder(path)?.token === token) rmSync(path, { recursive: true, force: true });
}
let hooked = false;
function hookExit() {
  if (hooked) return;
  hooked = true;
  process.on('exit', release);
  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, () => {
      if (forwardingToChild) return;
      release();
      // Keep any other handler's behaviour; with none left, die by the signal as before.
      if (process.listenerCount(sig) <= 1) { process.removeAllListeners(sig); process.kill(process.pid, sig); }
    });
  }
}

export class XBrowserLockBusy extends Error {}

// Blocks (synchronously) until the lock is ours. Returns { inherited } or throws XBrowserLockBusy.
export function acquireXBrowserLock({ owner = `${process.argv[1] || 'node'} pid ${process.pid}`, waitSec, log = (m) => console.error(m) } = {}) {
  const path = lockPath();
  if (held && held.path === path) { held.count += 1; return { inherited: false, path }; }
  if (inheritedHold(path)) return { inherited: true, path };
  const wait = num(waitSec ?? process.env.X_BROWSER_LOCK_WAIT_SEC, 5400) * 1000;
  const poll = Math.max(50, num(process.env.X_BROWSER_LOCK_POLL_SEC, 5) * 1000);
  const deadline = Date.now() + wait;
  mkdirSync(dirname(path), { recursive: true });
  let announced = false;
  for (;;) {
    try {
      mkdirSync(path);
      const token = randomBytes(8).toString('hex');
      writeFileSync(join(path, 'owner.json'), JSON.stringify({ pid: process.pid, owner, token, host: hostname(), acquiredAt: new Date().toISOString() }));
      held = { path, token, count: 1 };
      hookExit();
      if (announced) log(`[x-browser-lock] acquired by ${owner}`);
      return { inherited: false, path };
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
    }
    const h = readHolder(path);
    const reason = staleReason(path, h);
    if (reason) { breakStale(path, h, reason, log); continue; }
    if (Date.now() >= deadline) throw new XBrowserLockBusy(`x-browser lock busy (held by ${describe(h)}); waited ${wait / 1000}s at ${path}`);
    if (!announced) { log(`[x-browser-lock] waiting for ${describe(h)} (up to ${wait / 1000}s)`); announced = true; }
    sleepSync(Math.min(poll, Math.max(50, deadline - Date.now())));
  }
}

export function releaseXBrowserLock() {
  if (!held) return;
  if (--held.count <= 0) { held.count = 1; release(); }
}

export function heldToken() { return held ? `${held.path}:${held.token}` : (process.env.X_BROWSER_LOCK_HELD || ''); }

async function cli(argv) {
  const [cmd, ...rest] = argv;
  if (cmd === 'status') {
    const h = readHolder();
    console.log(h ? JSON.stringify(h) : 'free');
    return 0;
  }
  if (cmd !== 'run') { console.error('usage: x-browser-lock.mjs run [--owner NAME] -- CMD ARGS... | status'); return 2; }
  let owner = 'x-browser-lock run';
  let i = 0;
  for (; i < rest.length && rest[i] !== '--'; i += 1) if (rest[i] === '--owner') owner = rest[++i];
  const child = rest.slice(i + 1);
  if (!child.length) { console.error('x-browser-lock: no command after --'); return 2; }
  try { acquireXBrowserLock({ owner }); } catch (e) {
    if (e instanceof XBrowserLockBusy) { console.error(`[x-browser-lock] ${e.message}`); return BUSY_EXIT; }
    throw e;
  }
  forwardingToChild = true;
  return await new Promise((resolve) => {
    const p = spawn(child[0], child.slice(1), { stdio: 'inherit', env: { ...process.env, X_BROWSER_LOCK_HELD: heldToken() } });
    const fwd = (sig) => () => { try { p.kill(sig); } catch {} };
    for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.prependListener(sig, fwd(sig));
    p.on('error', (e) => { console.error(`x-browser-lock: ${e.message}`); resolve(127); });
    p.on('exit', (code, sig) => resolve(code ?? (sig ? 128 + 15 : 1)));
  });
}

// import.meta.main: an importer whose argv[1] happens to be this file (node -e ... <path>) must not run the CLI.
if (import.meta.main ?? (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1])) {
  process.exitCode = await cli(process.argv.slice(2));
}
