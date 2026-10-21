// server/http/accountsApi.js — 账号 API（把主服 0.3.0 的账号密码体系移植到 0.3.1 实验服）。
//
// 0.3.1 上游只发「代号」，没有任何账号/密码设施：一个名字就是一个 session（server/net.js:registry.create）。
// 维护者 2026-10-19 要求把主服的账号库、好友库搬过来，并把登录入口放到标题页：
//
//   POST /api/account/register { name, password }            注册并直接登录
//   POST /api/account/login    { name, password, remember }  登录；remember=true 发放「保持登录」令牌
//   POST /api/account/ticket   { remember }                  「保持登录」令牌换一张新票据（下次打开网页免密码）
//   POST /api/account/logout   { name }                      撤销「保持登录」令牌
//   GET  /api/account/exists?name=…                          账号是否存在（注册页提示用）
//
// 票据（ticket）= HMAC-SHA256 签名的 { playerId, name, role, exp }，客户端把它放进 `hello.auth`；
// server/net.js 校验后把会话绑定到账号的 playerId —— 与主服一致：同一个账号在任何设备/标签页都是同一个玩家。
// 「保持登录」令牌沿用主服语义：库文件里只存 sha256，30 天滑动过期，改密码/封禁即撤销。
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { NAME_MAX_LEN } from '../../shared/constants.js';

const MAX_BODY = 4096;
const TICKET_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 30;
const TICKET_PREFIX = 'v1';

const STATUS = {
  WEAK_PASSWORD: 400, BAD_CREDENTIALS: 401, NAME_TAKEN: 409, BANNED: 403,
  BAD_REQUEST: 400, TOO_LARGE: 413, AUTH_REQUIRED: 401, NOT_FOUND: 404, RATE_LIMITED: 429,
};

function sendJson(res, status, body) {
  const data = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.setHeader('content-length', Buffer.byteLength(data));
  res.end(data);
}

function fail(res, error, extra) {
  sendJson(res, STATUS[error] || 400, { ok: false, error, ...(extra || null) });
}

/** 4096 B 的 JSON 体；超限/坏 JSON 抛带 code 的错误。 */
function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('body too large'), { code: 'TOO_LARGE' }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve(text ? JSON.parse(text) : {});
      } catch {
        reject(Object.assign(new Error('bad json'), { code: 'BAD_REQUEST' }));
      }
    });
    req.on('error', reject);
  });
}

/** 与 net.js sanitizeName 的容忍度一致：去首尾空白、限长、无控制字符。 */
function normalizeName(value) {
  if (typeof value !== 'string') return '';
  const name = value.trim();
  if (!name || name.length > NAME_MAX_LEN || /[\u0000-\u001f\u007f]/.test(name)) return '';
  return name;
}

/**
 * @param {{
 *   store: import('../accounts.js').AccountStore,
 *   secretFile: string,                       // 票据签名密钥（首次启动自动生成，0600）
 *   log?: { info: Function, warn: Function, error: Function },
 * }} opts
 */
export function createAccountsApi({ store, secretFile, log = console }) {
  let secret;
  try {
    secret = Buffer.from(readFileSync(secretFile, 'utf8').trim(), 'hex');
    if (secret.length < 32) throw new Error('short secret');
  } catch {
    secret = randomBytes(32);
    mkdirSync(path.dirname(secretFile), { recursive: true });
    writeFileSync(secretFile, secret.toString('hex'), { mode: 0o600 });
    log.info?.('[accounts] created ticket secret', secretFile);
  }

  const hmac = (payload) => createHmac('sha256', secret).update(payload).digest('base64url');

  function issueTicket(account) {
    const payload = Buffer.from(JSON.stringify({
      v: 1, p: account.playerId, n: account.name, r: account.role ?? null, exp: Date.now() + TICKET_TTL_MS,
    })).toString('base64url');
    return `${TICKET_PREFIX}.${payload}.${hmac(payload)}`;
  }

  /** @param {unknown} ticket @returns {{ playerId: string, name: string, role: string|null } | null} */
  function verifyTicket(ticket) {
    if (typeof ticket !== 'string' || ticket.length > 4096) return null;
    const parts = ticket.split('.');
    if (parts.length !== 3 || parts[0] !== TICKET_PREFIX) return null;
    const [, payload, signature] = parts;
    const expected = hmac(payload);
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    let data;
    try {
      data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    } catch {
      return null;
    }
    if (!data || data.v !== 1 || typeof data.p !== 'string' || typeof data.n !== 'string') return null;
    if (!Number.isFinite(data.exp) || data.exp <= Date.now()) return null;
    return { playerId: data.p, name: data.n, role: typeof data.r === 'string' ? data.r : null };
  }

  /** 登录/注册的简单防爆破：同一来源 60 秒 30 次。 */
  const attempts = new Map();
  function limited(ip) {
    const now = Date.now();
    const row = attempts.get(ip);
    if (!row || now - row.since > RATE_WINDOW_MS) {
      attempts.set(ip, { count: 1, since: now });
      if (attempts.size > 4096) attempts.clear();
      return false;
    }
    row.count += 1;
    return row.count > RATE_MAX;
  }

  const okPayload = (account, rememberToken) => ({
    ok: true,
    name: account.name,
    playerId: account.playerId,
    role: account.role ?? null,
    mustChangePassword: !!account.mustChangePassword,
    ticket: issueTicket(account),
    rememberToken: rememberToken || null,
  });

  async function handlePost(req, res, pathname) {
    const ip = req.socket?.remoteAddress || '?';
    if (limited(ip)) return fail(res, 'RATE_LIMITED');
    let body;
    try {
      body = await readJson(req);
    } catch (e) {
      return fail(res, e.code === 'TOO_LARGE' ? 'TOO_LARGE' : 'BAD_REQUEST');
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return fail(res, 'BAD_REQUEST');

    if (pathname === '/api/account/login') {
      const name = normalizeName(body.name);
      if (!name || typeof body.password !== 'string') return fail(res, 'BAD_REQUEST');
      const result = await store.authenticate(name, body.password, 'login');
      if (result.error) {
        log.warn?.('[accounts] login failed', name, result.error);
        return fail(res, result.error, result.error === 'BANNED' ? { banReason: result.banReason ?? null } : null);
      }
      const account = result.account;
      let rememberToken = null;
      if (body.remember === true) rememberToken = store.issueRemember(account.name);
      else if (account.remember) store.forgetRemember(account.name);
      log.info?.('[accounts] login ok', account.name);
      return sendJson(res, 200, okPayload(account, rememberToken));
    }

    if (pathname === '/api/account/register') {
      const name = normalizeName(body.name);
      if (!name || typeof body.password !== 'string') return fail(res, 'BAD_REQUEST');
      const result = await store.authenticate(name, body.password, 'register');
      if (result.error) return fail(res, result.error);
      log.info?.('[accounts] registered', result.account.name);
      return sendJson(res, 200, okPayload(result.account, null));
    }

    if (pathname === '/api/account/ticket') {
      const account = store.verifyRemember(body.remember);
      if (!account) return fail(res, 'AUTH_REQUIRED');
      if (account.banned) return fail(res, 'BANNED', { banReason: account.banReason ?? null });
      return sendJson(res, 200, okPayload(account, null));
    }

    if (pathname === '/api/account/logout') {
      const name = normalizeName(body.name);
      if (name) store.forgetRemember(name);
      return sendJson(res, 200, { ok: true });
    }

    return fail(res, 'NOT_FOUND');
  }

  async function handle(req, res) {
    const url = new URL(req.url || '/', 'http://localhost');
    const pathname = url.pathname;
    if (req.method === 'GET' && pathname === '/api/account/state') {
      return sendJson(res, 200, { ok: true, enabled: true });
    }
    if (req.method === 'GET' && pathname === '/api/account/exists') {
      const name = normalizeName(url.searchParams.get('name'));
      return sendJson(res, 200, { ok: true, exists: !!(name && store.get(name)) });
    }
    if (req.method !== 'POST') {
      res.setHeader('allow', 'GET, POST');
      return fail(res, 'BAD_REQUEST');
    }
    try {
      await handlePost(req, res, pathname);
    } catch (e) {
      log.error?.('[accounts] request failed', e);
      if (!res.headersSent) fail(res, 'BAD_REQUEST');
    }
  }

  return {
    /** 账号系统总是启用（维护者要求 0.3.1 实验服必须有账号）；保留这个字段方便以后开关。 */
    enabled: true,
    /** @param {string} pathname */
    handles: (pathname) => pathname === '/api/account/exists' || pathname.startsWith('/api/account/'),
    handle,
    verifyTicket,
    issueTicket,
  };
}
