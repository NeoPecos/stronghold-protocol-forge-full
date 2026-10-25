import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);
const KEY_LENGTH = 32;
const PARAMS = { N: 16384, r: 8, p: 1, maxmem: 32 * 1024 * 1024 };
/** 记住登录的有效期（30 天，维护者 2026-10-13 确认；每次用令牌登录都会顺延）。 */
export const REMEMBER_MS = 30 * 24 * 60 * 60 * 1000;
/** 令牌是 256 位随机串，用确定性哈希存库即可（它不是口令，无需 scrypt；也避免每次连接都跑一遍昂贵派生）。 */
const rememberHash = (token) => createHash('sha256').update(token).digest('hex');
/** 账号画像里持久保存的局外选择（与 server/net.js 的 session 字段同名；avatar = 玩家头像 TASK-004）。 */
export const PROFILE_KEYS = Object.freeze(['loadout', 'ops', 'skins', 'notOwned', 'diy', 'avatar', 'dlc', 'contracts']);
/**
 * 管理员角色（TASK-065；维护者 2026-10-17 只给「草莓」一个账号）。
 *
 * 只认账号库里的 `role` 字段，不在代码里写死账号名，也不动 `salt`/`hash` 与登录语义：`AccountStore` 的构造函数
 * 只校验必填字段、其余原样保留，`authenticate`/`changePassword`/`issueRemember` 又都是展开后写盘，因此给某条记录
 * 加 `role: 'admin'` 不会被拒，也不会被下一次登录、改密码或换令牌抹掉。
 */
export const ADMIN_ROLE = 'admin';
/** 该账号是否是管理员（`role === ADMIN_ROLE`）；null/undefined 一律 false。 */
export const isAdmin = (account) => !!account && account.role === ADMIN_ROLE;

export const accountKey = (name) => name.normalize('NFC').toLowerCase();
export const validPassword = (password) => typeof password === 'string'
  && password.length >= 8 && password.length <= 128 && !/[\u0000-\u001f\u007f]/.test(password);

export class AccountStore {
  constructor(file) {
    this.file = file;
    this.byName = new Map();
    let rows;
    try { rows = JSON.parse(readFileSync(file, 'utf8')); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      rows = { version: 1, accounts: [] };
    }
    if (rows.version !== 1 || !Array.isArray(rows.accounts)) throw new Error('invalid account database');
    for (const row of rows.accounts) {
      if (!row || typeof row.name !== 'string' || typeof row.playerId !== 'string'
        || typeof row.salt !== 'string' || typeof row.hash !== 'string'
        || !/^[0-9a-f]{32}$/.test(row.salt) || !/^[0-9a-f]{64}$/.test(row.hash)
        || this.byName.has(accountKey(row.name))) throw new Error('invalid account database entry');
      this.byName.set(accountKey(row.name), row);
    }
  }

  get(name) { return this.byName.get(accountKey(name)) || null; }

  async authenticate(name, password, mode) {
    if (!validPassword(password)) return { error: 'WEAK_PASSWORD' };
    const key = accountKey(name);
    const existing = this.byName.get(key);
    if (mode === 'login') {
      if (!existing) return { error: 'BAD_CREDENTIALS' };
      const derived = await scrypt(password, Buffer.from(existing.salt, 'hex'), KEY_LENGTH, PARAMS);
      if (!timingSafeEqual(derived, Buffer.from(existing.hash, 'hex'))) return { error: 'BAD_CREDENTIALS' };
      // 管理员账号管理（TASK-070）：密码对也拒绝，封禁原因只回给登录提示，不发往任何公开列表。
      if (existing.banned) return { error: 'BANNED', banReason: typeof existing.banReason === 'string' ? existing.banReason : null };
      return { account: existing };
    }
    if (mode !== 'register') return { error: 'AUTH_REQUIRED' };
    if (existing) return { error: 'NAME_TAKEN' };
    const salt = randomBytes(16);
    const hash = await scrypt(password, salt, KEY_LENGTH, PARAMS);
    if (this.byName.has(key)) return { error: 'NAME_TAKEN' };
    const account = { name, playerId: 'p_' + randomBytes(10).toString('hex'), salt: salt.toString('hex'), hash: hash.toString('hex') };
    this.byName.set(key, account);
    try { this.save(); }
    catch (error) { this.byName.delete(key); throw error; }
    return { account };
  }

  /**
   * 改密码：必须提供**旧密码**验证身份（`Authenticate` 的 login 分支），再以同一套 scrypt 参数写入新盐与新哈希。
   *
   * 为什么必须有旧密码：这个入口是给「群里/私聊的机器人代改」用的，若只凭账号名就能改，任何知道昵称的人都能
   * 顶掉别人的账号。旧密码是这里唯一的持有证明（同 DESIGN 的登录语义）；忘记密码只能由维护者直接改库。
   *
   * 失败一律返回 `{ error }`，不改动任何状态；`save()` 失败时把内存里的旧值放回去，避免内存与磁盘不一致。
   * @param {string} name
   * @param {string} oldPassword
   * @param {string} newPassword
   * @returns {Promise<{ account?: object, error?: 'BAD_CREDENTIALS'|'WEAK_PASSWORD'|'SAME_PASSWORD'>}
   */
  async changePassword(name, oldPassword, newPassword) {
    if (!validPassword(newPassword)) return { error: 'WEAK_PASSWORD' };
    if (oldPassword === newPassword) return { error: 'SAME_PASSWORD' };
    const key = accountKey(name);
    const existing = this.byName.get(key);
    if (!existing) return { error: 'BAD_CREDENTIALS' };
    if (!validPassword(oldPassword)) return { error: 'BAD_CREDENTIALS' };
    const derivedOld = await scrypt(oldPassword, Buffer.from(existing.salt, 'hex'), KEY_LENGTH, PARAMS);
    if (!timingSafeEqual(derivedOld, Buffer.from(existing.hash, 'hex'))) return { error: 'BAD_CREDENTIALS' };
    const salt = randomBytes(16);
    const hash = await scrypt(newPassword, salt, KEY_LENGTH, PARAMS);
    const updated = { ...existing, salt: salt.toString('hex'), hash: hash.toString('hex') };
    // 改密码 = 撤销所有「记住登录」令牌：旧设备必须重新输一次新密码（安全语义，也是维护者要的效果）。
    delete updated.remember;
    this.byName.set(key, updated);
    try { this.save(); }
    catch (error) { this.byName.set(key, existing); throw error; }
    return { account: updated };
  }

  /**
   * 管理员重置密码（TASK-070，维护者 2026-10-17 要求）：不校验旧密码，写入新盐与新哈希，并置 `mustChangePassword`
   * 供登录页提示改密；同时撤销「记住登录」令牌，旧设备必须重新登录。
   * @param {string} name @param {string} newPassword
   * @returns {Promise<{ account?: object, error?: 'WEAK_PASSWORD'|'NOT_FOUND' }>}
   */
  async resetPassword(name, newPassword) {
    if (!validPassword(newPassword)) return { error: 'WEAK_PASSWORD' };
    const key = accountKey(name);
    const existing = this.byName.get(key);
    if (!existing) return { error: 'NOT_FOUND' };
    const salt = randomBytes(16);
    const hash = await scrypt(newPassword, salt, KEY_LENGTH, PARAMS);
    const updated = { ...existing, salt: salt.toString('hex'), hash: hash.toString('hex'), mustChangePassword: true };
    delete updated.remember;
    this.byName.set(key, updated);
    try { this.save(); }
    catch (error) { this.byName.set(key, existing); throw error; }
    return { account: updated };
  }

  /**
   * 封禁 / 解封账号（TASK-070）。封禁同时撤销「记住登录」令牌；原因只用于登录提示与管理面展示。
   * @param {string} name @param {boolean} banned @param {string|null} [reason]
   * @returns {{ account?: object, error?: 'NOT_FOUND'|'BAD_REQUEST' }}
   */
  setBanned(name, banned, reason = null) {
    if (typeof banned !== 'boolean') return { error: 'BAD_REQUEST' };
    const key = accountKey(name);
    const existing = this.byName.get(key);
    if (!existing) return { error: 'NOT_FOUND' };
    const updated = { ...existing };
    if (banned) {
      updated.banned = true;
      updated.bannedAt = Date.now();
      const text = typeof reason === 'string' ? reason.trim().slice(0, 200) : '';
      if (text) updated.banReason = text; else delete updated.banReason;
      delete updated.remember;
    } else {
      delete updated.banned; delete updated.bannedAt; delete updated.banReason;
    }
    this.byName.set(key, updated);
    try { this.save(); }
    catch (error) { this.byName.set(key, existing); throw error; }
    return { account: updated };
  }

  /**
   * 禁言 / 解除禁言（TASK-070）：`until` 是毫秒时间戳，null 或非正数表示解除。账号字段随登录带进会话，
   * 在线账号由路由层同时更新会话（server/http/routes.js）。
   * @param {string} name @param {number|null} until
   * @returns {{ account?: object, error?: 'NOT_FOUND'|'BAD_REQUEST' }}
   */
  setMuted(name, until) {
    if (until != null && !Number.isSafeInteger(until)) return { error: 'BAD_REQUEST' };
    const key = accountKey(name);
    const existing = this.byName.get(key);
    if (!existing) return { error: 'NOT_FOUND' };
    const updated = { ...existing };
    if (until != null && until > 0) updated.mutedUntil = until; else delete updated.mutedUntil;
    this.byName.set(key, updated);
    try { this.save(); }
    catch (error) { this.byName.set(key, existing); throw error; }
    return { account: updated };
  }

  /** 管理面账号列表（TASK-070）：只给身份与状态，绝不下发 salt / hash / remember。 */
  list() {
    return [...this.byName.values()].map((row) => ({
      name: row.name, playerId: row.playerId, role: row.role ?? null,
      banned: !!row.banned, bannedAt: row.bannedAt ?? null, banReason: row.banReason ?? null,
      mutedUntil: row.mutedUntil ?? null, mustChangePassword: !!row.mustChangePassword,
    }));
  }

  /**
   * 发放「记住登录」令牌（维护者 2026-10-13：方案 A）。
   *
   * 语义：登录/注册成功后服务器生成一个 256 位随机串，**只在这一次 welcome 里明文下发**（WSS/本机），库里只存它的
   * sha256 与过期时间。客户端下次连接把它放进 `hello.remember`，校验通过就直接认这个账号，不必再输密码。
   * 每次重新输密码登录都会换发新令牌（旧的自然作废）；改密码会清空（见 changePassword）。
   * @param {string} name
   * @returns {string | null} 明文令牌（64 位十六进制），账号不存在时 null
   */
  issueRemember(name) {
    const account = this.byName.get(accountKey(name));
    if (!account) return null;
    const token = randomBytes(32).toString('hex');
    const updated = { ...account, remember: { hash: rememberHash(token), expiresAt: Date.now() + REMEMBER_MS } };
    this.byName.set(accountKey(name), updated);
    this.save();
    return token;
  }

  /**
   * 校验「记住登录」令牌：命中且未过期时返回账号，并把有效期顺延 30 天（滑动过期）。
   *
   * 过期的令牌会被清掉（顺手写盘），令牌格式不对/找不到都返回 null —— 调用方随后走正常密码流程。
   * @param {string} token
   * @returns {object | null}
   */
  verifyRemember(token) {
    if (typeof token !== 'string' || !/^[0-9a-f]{64}$/.test(token)) return null;
    const hash = rememberHash(token);
    const now = Date.now();
    for (const [key, account] of this.byName) {
      const remember = account.remember;
      if (!remember || typeof remember.hash !== 'string' || typeof remember.expiresAt !== 'number') continue;
      const a = Buffer.from(remember.hash, 'hex');
      const b = Buffer.from(hash, 'hex');
      if (a.length !== b.length || !timingSafeEqual(a, b)) continue;
      if (remember.expiresAt <= now) {
        const cleared = { ...account };
        delete cleared.remember;
        this.byName.set(key, cleared);
        try { this.save(); } catch { /* 过期清理写盘失败不影响本次登录判定 */ }
        return null;
      }
      if (remember.expiresAt - now < REMEMBER_MS - 24 * 60 * 60 * 1000) {
        this.byName.set(key, { ...account, remember: { ...remember, expiresAt: now + REMEMBER_MS } });
        try { this.save(); } catch { /* 顺延写盘失败不影响本次登录 */ }
      }
      return account;
    }
    return null;
  }

  /** 撤销某个账号的「记住登录」令牌（客户端关掉保持登录时用；账号不存在时静默）。 */
  forgetRemember(name) {
    const key = accountKey(name);
    const account = this.byName.get(key);
    if (!account || !account.remember) return false;
    const cleared = { ...account };
    delete cleared.remember;
    this.byName.set(key, cleared);
    this.save();
    return true;
  }

  /**
   * 账号画像（局外选择）：`{ loadout, skins, notOwned, diy, updatedAt }`。
   *
   * 这四项原先只活在内存里的 session 上 —— 会话一过期、一换设备就没了（维护者 2026-10-13 报告）。现在随账号
   * 存在同一个库文件里（维护者选择），登录/恢复时回灌给 session，改一次写一次。
   * @param {string} name
   * @returns {object | null}
   */
  getProfile(name) {
    const account = this.byName.get(accountKey(name));
    const profile = account && account.profile;
    return profile && typeof profile === 'object' ? profile : null;
  }

  /**
   * 写入账号画像的一部分（只覆盖传进来的键，且**忽略空值**：客户端在空设备上连上时会推一次空状态，不能因此把
   * 已有画像抹掉）。内容不变时不写盘。
   * @param {string} name
   * @param {Record<string, any>} patch
   * @returns {boolean} 是否真的写入了
   */
  setProfile(name, patch) {
    const key = accountKey(name);
    const account = this.byName.get(key);
    if (!account || !patch || typeof patch !== 'object') return false;
    const current = account.profile && typeof account.profile === 'object' ? account.profile : {};
    const next = { ...current };
    let changed = false;
    for (const field of PROFILE_KEYS) {
      if (!Object.prototype.hasOwnProperty.call(patch, field)) continue;
      const value = patch[field];
      if (value == null) continue;
      // 空对象 = 「这台设备没有状态」的握手噪声，忽略；空**数组** = 明确清空（DLC 全关 / 合约全不选）——
      // `dlc` / `contracts` 是两个数组字段，不认它的话「上一局全关掉」永远记不住。
      if (typeof value === 'object' && Object.keys(value).length === 0 && !Array.isArray(value) && current[field] != null) continue;
      if (JSON.stringify(next[field] ?? null) === JSON.stringify(value)) continue;
      next[field] = value;
      changed = true;
    }
    if (!changed) return false;
    next.updatedAt = Date.now();
    this.byName.set(key, { ...account, profile: next });
    this.save();
    return true;
  }

  save() {
    mkdirSync(path.dirname(this.file), { recursive: true });
    const temporary = `${this.file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
    writeFileSync(temporary, JSON.stringify({ version: 1, accounts: [...this.byName.values()] }) + '\n', { mode: 0o600, flag: 'wx' });
    renameSync(temporary, this.file);
  }
}
