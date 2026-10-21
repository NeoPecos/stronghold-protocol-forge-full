// 名片干员: the portrait a doctor shows on the room's seat card (screens/room.js) and on the strategy draft's name-card rows
// (screens/bandDraft.js) — the operator the player picked (room.card; room.state seats[].card), else one of the 5★/6★
// operators chosen by the player id, the same on every client.
import { chessPortraitUrl } from './assetUrls.js';

/** FNV-1a of a string (the portrait pick: the same operator for a player on every client). */
function hash32(s) {
  let h = 0x811c9dc5;
  for (const ch of String(s)) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}

/** 名片干员: the player's own pick (localStorage; sent as room.card where the server knows it). */
export const CARD_PREF = 'room.card';

/**
 * The operators a seat card can show: one record per charId (the elite form for its E2 art), 6★ first.
 * @param {any[]} chessList chess.json records
 * @returns {any[]}
 */
export function cardOperators(chessList) {
  const by = new Map();
  for (const c of Array.isArray(chessList) ? chessList : []) {
    if (!c || c.isDiy || c.visible === false || typeof c.charId !== 'string') continue;
    const prev = by.get(c.charId);
    if (!prev || (c.isGolden && !prev.isGolden)) by.set(c.charId, c);
  }
  return [...by.values()].sort((a, b) => ((b.rarity ?? 0) - (a.rarity ?? 0)) || String(a.name).localeCompare(String(b.name), 'zh'));
}

/**
 * The seat card's portrait: the operator the player picked (room.state seats[].card, or one's own pick), else one of
 * the 5★/6★ operators chosen by the player id — the same on every client (null before the data loads).
 * @param {any} seat room.state seat @param {{ pool: any[], byChar: Map<string, any>, m: any, myId: any, myCard: string }} ctx
 */

/** 头像 id（session.avatar：charId / e2:charId / skin:id）→ 同一干员的立绘 URL（找不到返回 null，回退旧规则）。 */
function avatarPortrait(m, avatarId) {
  const chars = m && typeof m === 'object' ? m.chars : null;
  const raw = typeof avatarId === 'string' ? avatarId : '';
  if (!chars || !raw) return null;
  // 自定义上传头像 / 外部 URL 无法映射到干员，保持旧规则
  if (/^(?:data:|https?:|\/)/i.test(raw)) return null;
  let id = raw;
  let wantE2 = false;
  if (id.startsWith('skin:')) {
    const parts = id.split(':');
    id = parts[1] || '';
    wantE2 = true;
  } else if (id.startsWith('e2:')) {
    id = id.slice(3);
    wantE2 = true;
  } else if (id.endsWith('_2')) {
    id = id.slice(0, -2);
    wantE2 = true;
  } else if (id.endsWith('_1')) {
    id = id.slice(0, -2);
  }
  const entry = chars[id];
  if (!entry) return null;
  return (wantE2 ? entry.portraitE2 || entry.portrait : entry.portrait) || null;
}

export function seatPortrait(seat, { pool, byChar, m, myId, myCard }) {
  if (!seat || seat.playerId == null) return null;
  // 头像与卡片立绘保持一致：优先用该座位头像选用的同一干员出立绘（只影响取哪张图，不改尺寸/布局）
  const viaAvatar = avatarPortrait(m, seat.avatar);
  if (viaAvatar) return viaAvatar;
  const pick = (seat.playerId === myId && myCard) || seat.card;
  const rec = pick && byChar ? byChar.get(pick) : null;
  if (rec) return chessPortraitUrl(m, rec);
  if (!Array.isArray(pool) || !pool.length) return null;
  return chessPortraitUrl(m, pool[hash32(seat.playerId) % pool.length]);
}
