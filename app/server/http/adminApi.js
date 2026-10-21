// server/http/adminApi.js — the experiment server's admin panel API (ported from the main server's admin features).
// i18n-ignore-file: the panel is an operator tool (Chinese UI), like the main server's public/admin.html.
//
//   * Every /api/admin/* call needs `x-sp-admin-token: <SP_ADMIN_TOKEN>`; without the env the API answers 503.
//   * GET  /api/admin/whoami      → { ok, name: 'admin', role: 'admin' }
//   * GET  /api/admin/status      → { ok, health, maintenance, rooms: [...] }
//   * GET  /api/admin/servers     → { ok, servers: [{ name, ok, status, body }] } — this box and the asset mirrors
//   * POST /api/admin/room/kick   { playerId }        — remove a player from its room, before the match
//   * POST /api/admin/room/dissolve { code }          — close a room (its match, if any, ends with it)
//   * POST /api/admin/match/end   { code }            — finish the room's running match (the room stays)
//   * POST /api/admin/maintenance { on }              — refuse NEW WebSocket handshakes (established players stay)
//   * Stubs for the main server's features this build has no data for (announcements / accounts / room chat): they answer
//     ok:true with empty lists, so the same panel page renders instead of failing.
//
// A route that throws is logged and answers 500, like routes.js.

import fs from 'node:fs';
import { sendJson, sendError } from './common.js';

const TOKEN_HEADER = 'x-sp-admin-token';
const MAX_BODY = 8192;
const MIRROR_DEFAULT = 'a1.bs.leio.fun,a2.bs.leio.fun,a3.bs.leio.fun';

/** maintenance: NEW WebSocket handshakes are refused while on (http/websocket.js). */
let maintenance = false;
export function maintenanceOn() { return maintenance; }

/** CPU seconds + idle of /proc/stat (the module keeps the previous sample to report a percentage). */
let lastCpu = null;
function cpuPercent() {
  try {
    const line = fs.readFileSync('/proc/stat', 'utf8').split('\n')[0];
    const n = line.trim().split(/\s+/).slice(1).map(Number);
    const idle = (n[3] || 0) + (n[4] || 0);
    const total = n.reduce((a, b) => a + b, 0);
    const prev = lastCpu;
    lastCpu = { idle, total };
    if (!prev) return null;
    const dTotal = total - prev.total;
    const dIdle = idle - prev.idle;
    if (dTotal <= 0) return null;
    return Math.round((1 - dIdle / dTotal) * 1000) / 10;
  } catch { return null; }
}

/** Load, memory, disk and the eth0 rates (the module keeps the previous eth0 sample). */
let lastNet = null;
function hostMetrics() {
  const out = { load: null, cpuPct: null, memTotal: 0, memUsed: 0, memPct: null, diskTotal: 0, diskUsed: 0, diskPct: null, netRxMbps: null, netTxMbps: null, uptimeSec: 0 };
  try { out.load = fs.readFileSync('/proc/loadavg', 'utf8').trim().split(/\s+/).slice(0, 3).map(Number); } catch { /* optional */ }
  out.cpuPct = cpuPercent();
  try {
    const m = Object.fromEntries(fs.readFileSync('/proc/meminfo', 'utf8').split('\n').filter(Boolean).map((l) => { const [k, v] = l.split(':'); return [k, Number(String(v).trim().split(/\s+/)[0]) * 1024]; }));
    out.memTotal = m.MemTotal || 0;
    out.memUsed = (m.MemTotal || 0) - (m.MemAvailable || 0);
    if (out.memTotal) out.memPct = Math.round((out.memUsed / out.memTotal) * 1000) / 10;
  } catch { /* optional */ }
  try {
    const st = fs.statfsSync('/');
    out.diskTotal = st.blocks * st.bsize;
    out.diskUsed = (st.blocks - st.bfree) * st.bsize;
    if (out.diskTotal) out.diskPct = Math.round((out.diskUsed / out.diskTotal) * 1000) / 10;
  } catch { /* optional */ }
  try {
    const line = fs.readFileSync('/proc/net/dev', 'utf8').split('\n').find((l) => /^\s*eth0:/.test(l));
    if (line) {
      const n = line.split(':')[1].trim().split(/\s+/).map(Number);
      const now = Date.now();
      const sample = { rx: n[0], tx: n[8], at: now };
      const prev = lastNet;
      lastNet = sample;
      if (prev && now > prev.at) {
        const sec = (now - prev.at) / 1000;
        out.netRxMbps = Math.round((((sample.rx - prev.rx) * 8) / sec / 1e6) * 100) / 100;
        out.netTxMbps = Math.round((((sample.tx - prev.tx) * 8) / sec / 1e6) * 100) / 100;
      }
    }
  } catch { /* optional */ }
  try { out.uptimeSec = Math.round(Number(fs.readFileSync('/proc/uptime', 'utf8').split(/\s+/)[0]) || 0); } catch { /* optional */ }
  return out;
}

/** The room list for the rooms card: code, mode, who sits where, and whether a match runs. */
function roomRows(lobby) {
  const rows = [];
  let iter;
  try { iter = [...lobby.rooms.values()]; } catch { return rows; }
  for (const room of iter) {
    if (!room || room.disposed) continue;
    const seats = [];
    let seatIndex = 0;
    for (const seat of room.seats || []) {
      if (seat) {
        seats.push({
          seat: seatIndex, playerId: seat.playerId, name: seat.name, isBot: !!seat.isBot,
          connected: seat.connected !== false, ready: !!seat.ready, left: !!seat.left,
        });
      }
      seatIndex += 1;
    }
    rows.push({
      code: room.code, mode: room.mode, difficulty: room.difficulty || null,
      hostId: room.hostId, host: (seats.find((s) => s.playerId === room.hostId) || {}).name || null,
      players: seats, spectators: (room.spectators || []).length,
      inMatch: !!room.match, matchCount: room.matchCount || 0,
      round: room.match?.round ?? room.match?.state?.round ?? null,
      createdAt: room.createdAt || null,
    });
  }
  rows.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return rows;
}

/** Members of /api/admin/* the panel also reads from the main server; empty answers keep the same panel working. */
function stub(pathname) {
  if (pathname === '/api/announcements') return { ok: true, items: [], list: [], total: 0 };
  if (pathname === '/api/admin/accounts') return { ok: true, total: 0, accounts: [], rows: [] };
  if (pathname === '/api/admin/chat') return { ok: true, rooms: [], messages: [], total: 0 };
  return null;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) { reject(Object.assign(new Error('body too large'), { code: 'TOO_LARGE' })); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8').trim();
      if (!text) { resolve({}); return; }
      try { resolve(JSON.parse(text)); } catch { reject(Object.assign(new Error('bad json'), { code: 'BAD_REQUEST' })); }
    });
    req.on('error', reject);
  });
}

function fail(code) { return { ok: false, error: code }; }

/** POST room/kick: remove one player from its room (the host's own kick when the host is here, else directly). */
function kickPlayer(lobby, registry, playerId) {
  const target = registry.byId(String(playerId || ''));
  if (!target) return fail('BAD_TARGET');
  const room = target.roomCode ? lobby.getRoom(target.roomCode) : null;
  if (!room) return fail('NOT_IN_ROOM');
  if (room.match) return fail('ROOM_STARTED');
  const seat = (room.seats || []).findIndex((s) => s && s.playerId === target.playerId);
  if (seat < 0) return fail('NOT_IN_ROOM');
  const host = room.hostId ? registry.byId(room.hostId) : null;
  if (!host) return fail('HOST_OFFLINE');
  const result = lobby.kick(host, { seat, playerId: target.playerId });
  if (result && result.ok === false) return fail(result.code || 'BAD_TARGET');
  return { ok: true };
}

/** POST room/dissolve: close the room (a running match ends with it). */
function dissolveRoom(lobby, code) {
  const room = lobby.getRoom(String(code || '').toUpperCase());
  if (!room) return fail('ROOM_NOT_FOUND');
  lobby.disposeRoom(room, 'closed');
  return { ok: true };
}

/** POST match/end: finish the room's running match; the room itself stays. */
function endMatch(lobby, code) {
  const room = lobby.getRoom(String(code || '').toUpperCase());
  if (!room) return fail('ROOM_NOT_FOUND');
  const match = room.match;
  if (!match) return fail('NO_MATCH');
  const finish = typeof match.finish === 'function' ? match.finish.bind(match) : null;
  if (!finish) {
    lobby.disposeRoom(room, 'closed');
    return { ok: true, dissolved: true };
  }
  try { finish({ victory: false, reason: 'abandoned' }); } catch { return fail('FAILED'); }
  return { ok: true };
}

/** GET servers: this box's own metrics + the mirrors' /healthz answer. */
async function serverRows(health) {
  const rows = [];
  const report = typeof health.report === 'function' ? health.report() : null;
  rows.push({
    name: '西安实验服 a4', ok: true, status: 200,
    body: { ...hostMetrics(), host: 'liuliangItiMhQ0YoUM4', node: report ? { sockets: report.sockets, sessions: report.sessions, rooms: report.rooms, matches: report.matches, humans: report.humans } : null },
  });
  const hosts = String(process.env.SP_MIRRORS || MIRROR_DEFAULT).split(',').map((s) => s.trim()).filter(Boolean);
  await Promise.all(hosts.map(async (host) => {
    try {
      const res = await fetch(`https://${host}/healthz`, { signal: AbortSignal.timeout(4000) });
      const text = await res.text();
      rows.push({ name: `镜像 ${host}`, ok: res.ok, status: res.status, body: { host, note: text.slice(0, 40) } });
    } catch {
      rows.push({ name: `镜像 ${host}`, ok: false, status: 0, body: null });
    }
  }));
  return rows;
}

/**
 * The admin API. `health.report()` returns the same object /healthz serves (routes.js), `lobby`/`registry` the live ones.
 * @param {{ lobby: any, registry: any, health: { report: () => object | null }, log: object }} deps
 */
export function createAdminApi({ lobby, registry, health, log }) {
  const token = () => String(process.env.SP_ADMIN_TOKEN || '').trim();
  const handles = (pathname) => pathname === '/api/announcements' || pathname.startsWith('/api/admin/');

  async function handle(req, res, parts) {
    const pathname = parts.rawPath;
    if (!token()) { sendJson(req, res, 503, { ok: false, error: 'ADMIN_NOT_ENABLED' }); return; }
    const given = String(req.headers[TOKEN_HEADER] || req.headers[TOKEN_HEADER.toUpperCase()] || '').trim();
    if (given !== token()) { sendJson(req, res, 401, { ok: false, error: 'UNAUTHORIZED' }); return; }

    const empty = stub(pathname);
    if (empty) { sendJson(req, res, 200, empty); return; }
    if (pathname === '/api/admin/whoami') { sendJson(req, res, 200, { ok: true, name: 'admin', role: 'admin' }); return; }
    if (pathname === '/api/admin/status') {
      const report = health.report();
      sendJson(req, res, 200, { ok: true, health: report, maintenance, rooms: roomRows(lobby) });
      return;
    }
    if (pathname === '/api/admin/servers') {
      sendJson(req, res, 200, { ok: true, servers: await serverRows(health) });
      return;
    }
    if (req.method !== 'POST') { sendJson(req, res, 405, { ok: false, error: 'METHOD_NOT_ALLOWED' }); return; }

    let body;
    try { body = await readBody(req); } catch (e) {
      sendJson(req, res, e.code === 'TOO_LARGE' ? 413 : 400, { ok: false, error: e.code || 'BAD_REQUEST' });
      return;
    }
    let result;
    try {
      switch (pathname) {
        case '/api/admin/room/kick': result = kickPlayer(lobby, registry, body.playerId); break;
        case '/api/admin/room/dissolve': result = dissolveRoom(lobby, body.code); break;
        case '/api/admin/match/end': result = endMatch(lobby, body.code); break;
        case '/api/admin/maintenance': {
          if (typeof body.on !== 'boolean') { result = fail('BAD_REQUEST'); break; }
          maintenance = body.on;
          log.info(`[admin] maintenance ${maintenance ? 'on' : 'off'} (new WebSocket handshakes ${maintenance ? 'refused' : 'accepted'})`);
          result = { ok: true, maintenance };
          break;
        }
        case '/api/admin/announcements/publish':
        case '/api/admin/announcements/delete':
        case '/api/admin/announcements/pin':
        case '/api/admin/notice': result = { ok: true, disabled: true }; break;
        default: result = fail('NOT_FOUND'); break;
      }
    } catch (e) {
      log.error('[admin] action failed', e);
      sendJson(req, res, 500, { ok: false, error: 'INTERNAL' });
      return;
    }
    const status = result.ok ? 200 : (result.error === 'NOT_FOUND' ? 404 : 400);
    log.info(`[admin] ${pathname} ${result.ok ? 'ok' : `FAILED ${result.error}`}`);
    sendJson(req, res, status, result);
  }

  return { handles, handle };
}

/** GET /api/admin/status: used by tests and the hello banner. */
export { roomRows, hostMetrics };
