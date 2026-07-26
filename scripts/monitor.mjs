// IntroMate PM2 monitor — port-truth supervisor over the PM2 programmatic API.
//
// PM2's own autorestart is not enough here: intromate-server runs under `tsx watch` and
// intromate-client under Vite, so the pid PM2 supervises is the watcher. The child that owns the
// port can die while the watcher lives on — PM2 keeps reporting `online` and never restarts.
// Health is therefore decided by the port answering HTTP, and only then by PM2 status.
//
// Scope is deliberately IntroMate-only. The StudioMate stack has its own watchdog (:4013); two
// supervisors acting on the same processes would race each other's backoff and holds.
//
// Runs as the PM2 process `intromate-monitor`. Plain .mjs, launched by node directly, so the pid
// PM2 supervises is this process — the same indirection bug it exists to cover.

import pm2 from 'pm2';
import http from 'node:http';

const PORT = Number(process.env.INTROMATE_MONITOR_PORT) || 4041;
const INTERVAL_MS = 15_000;
const PROBE_TIMEOUT_MS = 4_000;

// Grace after a restart before the port is expected to answer again. Vite and tsx both take a few
// seconds to rebind; probing inside that window would restart a process that is coming up fine.
const SETTLE_MS = 20_000;

// A service that fails this often in a rolling window is broken in a way restarting won't fix
// (port taken, syntax error, bad import). Stop hammering it and surface it in /health instead.
const STORM_LIMIT = 3;
const STORM_WINDOW_MS = 10 * 60_000;

const SERVICES = [
  { name: 'intromate-server', url: 'http://localhost:4040/api/intro/health' },
  { name: 'intromate-client', url: 'http://localhost:5200/flash.html' },
];

const state = new Map(
  SERVICES.map((s) => [
    s.name,
    { name: s.name, url: s.url, healthy: null, reason: 'not yet checked', pm2Status: null,
      restarts: [], lastRestart: null, settleUntil: 0, storm: false, checkedAt: null },
  ]),
);

const log = (msg) => console.log(`[${new Date().toISOString()}] ${msg}`);

function probe(url) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: PROBE_TIMEOUT_MS }, (res) => {
      res.resume();
      resolve(res.statusCode >= 200 && res.statusCode < 400
        ? { ok: true }
        : { ok: false, reason: `HTTP ${res.statusCode}` });
    });
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, reason: `no response in ${PROBE_TIMEOUT_MS}ms` }); });
    req.on('error', (err) => resolve({ ok: false, reason: err.code || err.message }));
  });
}

const pm2List = () => new Promise((resolve, reject) =>
  pm2.list((err, list) => (err ? reject(err) : resolve(list))));

const pm2Restart = (name) => new Promise((resolve, reject) =>
  pm2.restart(name, (err) => (err ? reject(err) : resolve())));

function stormed(s) {
  const cutoff = Date.now() - STORM_WINDOW_MS;
  s.restarts = s.restarts.filter((t) => t > cutoff);
  return s.restarts.length >= STORM_LIMIT;
}

async function restart(s, reason) {
  if (stormed(s)) {
    if (!s.storm) log(`${s.name}: ${STORM_LIMIT} restarts in ${STORM_WINDOW_MS / 60_000}min — giving up, needs a human (${reason})`);
    s.storm = true;
    s.reason = `${reason} — restart storm, not retrying`;
    return false;
  }
  log(`${s.name}: ${reason} — restarting`);
  try {
    await pm2Restart(s.name);
  } catch (err) {
    s.reason = `${reason} — pm2 restart failed: ${err.message}`;
    log(`${s.name}: pm2 restart failed: ${err.message}`);
    return false;
  }
  const now = Date.now();
  s.restarts.push(now);
  s.lastRestart = new Date(now).toISOString();
  s.settleUntil = now + SETTLE_MS;
  s.reason = `restarted: ${reason}`;
  s.healthy = null;
  return true;
}

async function tick() {
  let list;
  try {
    list = await pm2List();
  } catch (err) {
    log(`pm2 list failed: ${err.message}`);
    return [];
  }

  const restarted = [];
  for (const s of state.values()) {
    s.checkedAt = new Date().toISOString();
    const proc = list.find((p) => p.name === s.name);

    // Absent from PM2 entirely — never registered, or deleted. There is nothing to restart by
    // name and no ecosystem file here to start from, so say so rather than fail silently.
    if (!proc) {
      s.healthy = false;
      s.pm2Status = 'missing';
      s.reason = 'not registered with PM2 — run npm run pm2:setup';
      continue;
    }

    s.pm2Status = proc.pm2_env.status;
    if (proc.pm2_env.status !== 'online') {
      s.healthy = false;
      if (await restart(s, `PM2 status ${proc.pm2_env.status}`)) restarted.push(s.name);
      continue;
    }

    if (Date.now() < s.settleUntil) {
      s.reason = 'restarted, settling';
      continue;
    }

    const result = await probe(s.url);
    if (result.ok) {
      s.healthy = true;
      s.storm = false;
      s.restarts = [];
      s.reason = 'serving';
      continue;
    }
    s.healthy = false;
    if (await restart(s, `online but ${s.url} → ${result.reason}`)) restarted.push(s.name);
  }
  return restarted;
}

function snapshot() {
  return {
    monitor: { port: PORT, intervalMs: INTERVAL_MS, uptimeSec: Math.round(process.uptime()) },
    services: [...state.values()].map(({ restarts, settleUntil, ...rest }) => ({
      ...rest,
      restartsInWindow: restarts.length,
    })),
  };
}

let running = null;
const runTick = () => (running ??= tick().finally(() => { running = null; }));

http
  .createServer(async (req, res) => {
    const send = (code, body) => {
      res.writeHead(code, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (req.method === 'POST' && req.url === '/api/monitor/check') {
      const restarted = await runTick();
      return send(200, { restarted, ...snapshot() });
    }
    if (req.method === 'GET' && req.url === '/api/monitor/health') {
      const unhealthy = [...state.values()].filter((s) => s.healthy === false);
      return send(unhealthy.length ? 503 : 200, { ok: !unhealthy.length, ...snapshot() });
    }
    send(404, { error: 'not found' });
  })
  .listen(PORT, () => log(`monitor listening on :${PORT}, watching ${SERVICES.map((s) => s.name).join(', ')}`));

pm2.connect((err) => {
  if (err) {
    log(`cannot connect to PM2 daemon: ${err.message}`);
    process.exit(1);
  }
  runTick();
  setInterval(runTick, INTERVAL_MS);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { pm2.disconnect(); process.exit(0); });
}
