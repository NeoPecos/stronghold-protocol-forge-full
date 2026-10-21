// 好友系统（TASK-071，维护者 2026-10-17 要求）：
//  - 双向好友、加好友必须对方同意，上限 FRIEND_LIMIT（100）；
//  - 好友面板显示 在线 / 离线 / 对局中（第几回合）；
//  - 对局中的房间「加入」不可用，「观战」可用；「仅邀请」房不能直接被加入，但可以发送/接受邀请；
//  - 上线不弹提示（面板亮灯即可），好友数据落盘 var/friends.json（SP_FRIENDS_FILE 可覆盖）。
//
// 关系只服务已注册账号（有稳定 playerId）；游客不落库、不能加好友。
// 服务对象 createFriendsService 由 server/http/websocket.js 组装：需要 FriendStore、账号表、会话表和 lobby ——
// 在线/房间/回合状态全部现算，不做缓存，因此断线重连、换房、开新局都不会读到过期状态。
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ERR, FRIEND_LIMIT } from '../shared/constants.js';
import { sendSession } from './net.js';

const OK = { ok: true };
const MAX_PENDING = 50;

/** @typedef {{ playerId: string, name: string, at: number }} FriendRequest */

function emptyRecord(playerId) {
  return { playerId, name: '', friends: [], incoming: [], outgoing: [] };
}

/**
 * 好友关系存储：一个 JSON 文件（原子写，0600），按 playerId 分记录，缓存对方代号，离线也能显示名字。
 * @param {{ file: string, log?: { info?: Function, warn?: Function, debug?: Function } }} opts
 */
export function createFriendStore({ file, log = {} }) {
  mkdirSync(path.dirname(file), { recursive: true });
  /** @type {Map<string, { playerId: string, name: string, friends: FriendRequest[], incoming: FriendRequest[], outgoing: FriendRequest[] }>} */
  const players = new Map();
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8'));
    if (raw && raw.version === 1 && raw.players && typeof raw.players === 'object') {
      for (const [pid, row] of Object.entries(raw.players)) {
        if (!row || typeof row !== 'object' || typeof row.playerId !== 'string') continue;
        players.set(pid, {
          playerId: pid,
          name: typeof row.name === 'string' ? row.name : '',
          friends: Array.isArray(row.friends) ? row.friends.filter((r) => r && typeof r.playerId === 'string') : [],
          incoming: Array.isArray(row.incoming) ? row.incoming.filter((r) => r && typeof r.playerId === 'string') : [],
          outgoing: Array.isArray(row.outgoing) ? row.outgoing.filter((r) => r && typeof r.playerId === 'string') : [],
        });
      }
    }
  } catch (error) {
    if (error.code !== 'ENOENT') log.warn?.(`[friends] 读取 ${file} 失败，按空表处理: ${error.message}`);
    else log.debug?.(`[friends] ${file} 不存在，按空表处理`);
  }

  let dirty = false;
  const save = () => {
    if (!dirty) return;
    const temporary = `${file}.${process.pid}.tmp`;
    const out = { version: 1, players: Object.fromEntries(players) };
    writeFileSync(temporary, `${JSON.stringify(out)}\n`, { mode: 0o600 });
    renameSync(temporary, file);
    dirty = false;
  };

  const record = (playerId) => {
    let row = players.get(playerId);
    if (!row) {
      row = emptyRecord(playerId);
      players.set(playerId, row);
    }
    return row;
  };
  const noteName = (row, name) => {
    if (typeof name === 'string' && name && row.name !== name) {
      row.name = name;
      dirty = true;
    }
  };
  const dropRequest = (list, playerId) => {
    const i = list.findIndex((r) => r.playerId === playerId);
    if (i >= 0) list.splice(i, 1);
  };
  const link = (a, b) => {
    if (!a.friends.some((r) => r.playerId === b.playerId)) a.friends.push({ playerId: b.playerId, name: b.name, at: Date.now() });
    if (!b.friends.some((r) => r.playerId === a.playerId)) b.friends.push({ playerId: a.playerId, name: a.name, at: Date.now() });
  };
  const unlink = (a, b) => {
    const i = a.friends.findIndex((r) => r.playerId === b.playerId);
    if (i >= 0) a.friends.splice(i, 1);
    const j = b.friends.findIndex((r) => r.playerId === a.playerId);
    if (j >= 0) b.friends.splice(j, 1);
  };

  return {
    file,
    /** 列表快照（含缓存代号），供服务端拼 friend.state；调用方自己补在线状态。 */
    snapshot(playerId) {
      const row = record(playerId);
      return {
        playerId: row.playerId,
        name: row.name,
        friends: row.friends.map((r) => ({ ...r })),
        incoming: row.incoming.map((r) => ({ ...r })),
        outgoing: row.outgoing.map((r) => ({ ...r })),
      };
    },
    areFriends(aId, bId) {
      return record(aId).friends.some((r) => r.playerId === bId);
    },
    touch(playerId, name) {
      const row = record(playerId);
      noteName(row, name);
      save();
    },
    /**
     * 发送好友申请；若对方已经申请过自己，则直接成为好友（双向同意）。
     * @returns {{ error?: string, mutual?: boolean }}
     */
    request(from, to) {
      const a = record(from.playerId);
      const b = record(to.playerId);
      noteName(a, from.name);
      noteName(b, to.name);
      if (a.friends.some((r) => r.playerId === b.playerId)) return { error: 'ALREADY' };
      if (a.outgoing.some((r) => r.playerId === b.playerId)) return { error: 'FRIENDS_PENDING' };
      // 对方已经申请过：两边都表过态，直接成为好友
      const incoming = a.incoming.find((r) => r.playerId === b.playerId);
      if (incoming) {
        link(a, b);
        dropRequest(a.incoming, b.playerId);
        dropRequest(b.outgoing, a.playerId);
        dirty = true;
        save();
        return { mutual: true };
      }
      if (a.friends.length >= FRIEND_LIMIT) return { error: 'FRIENDS_FULL' };
      if (b.friends.length >= FRIEND_LIMIT) return { error: 'FRIENDS_FULL', detail: 'target-full' };
      if (a.outgoing.length >= MAX_PENDING || b.incoming.length >= MAX_PENDING) return { error: 'FRIENDS_PENDING', detail: 'too-many' };
      const at = Date.now();
      a.outgoing.push({ playerId: b.playerId, name: b.name, at });
      b.incoming.push({ playerId: a.playerId, name: a.name, at });
      dirty = true;
      save();
      return {};
    },
    accept(playerId, otherId) {
      const a = record(playerId);
      const b = record(otherId);
      if (!a.incoming.some((r) => r.playerId === b.playerId)) return { error: 'NOT_FRIEND', detail: 'no-request' };
      if (a.friends.length >= FRIEND_LIMIT || b.friends.length >= FRIEND_LIMIT) return { error: 'FRIENDS_FULL' };
      link(a, b);
      dropRequest(a.incoming, b.playerId);
      dropRequest(b.outgoing, a.playerId);
      dirty = true;
      save();
      return {};
    },
    decline(playerId, otherId) {
      const a = record(playerId);
      const b = record(otherId);
      dropRequest(a.incoming, b.playerId);
      dropRequest(b.outgoing, a.playerId);
      dirty = true;
      save();
      return {};
    },
    remove(playerId, otherId) {
      const a = record(playerId);
      const b = record(otherId);
      unlink(a, b);
      dropRequest(a.incoming, b.playerId);
      dropRequest(a.outgoing, b.playerId);
      dropRequest(b.incoming, a.playerId);
      dropRequest(b.outgoing, a.playerId);
      dirty = true;
      save();
      return {};
    },
  };
}

/**
 * 好友协议服务：friend.list / request / accept / decline / remove / invite。
 * 返回 `{ ok: true }` 或 `{ error, detail? }`（net.js 统一转成 error 帧并带上 rid）。
 * @param {{ store: ReturnType<typeof createFriendStore>, accounts: any, registry: any, lobby: any, log?: object }} deps
 */
export function createFriendsService({ store, accounts, registry, lobby, log = {} }) {
  /** @type {Map<string, { fromId: string, fromName: string, code: string, mode: string, at: number }[]>} */
  const invites = new Map();
  const findSession = (playerId) => registry.byId(playerId) || null;

  /** 在线 / 房间 / 对局状态 —— 每次现算，绝不缓存。 */
  const statusOf = (playerId) => {
    const session = findSession(playerId);
    if (!session?.connected) return { online: false };
    const room = lobby.roomOf(session) || null;
    if (!room) return { online: true, inRoom: false };
    const match = room.match || null;
    return {
      online: true,
      inRoom: true,
      code: room.code,
      mode: room.mode,
      inviteOnly: !!room.inviteOnly,
      matchRunning: !!match,
      round: match && typeof match.round === 'number' ? match.round : null,
      // 「加入」只在房间里、且不是仅邀请（或已被邀请）时可点；对局中的房间只能观战
      joinable: !match && room.mode === 'coop' && room.freeSeat() >= 0 && (!room.inviteOnly || room.invited?.has(playerId)),
      spectatable: !!match && room.mode === 'coop' && !!room.allowSpectators,
    };
  };

  const inviteList = (playerId) => {
    const list = invites.get(playerId);
    if (!list) return [];
    const alive = list.filter((entry) => {
      const room = lobby.rooms?.get(entry.code);
      return !!room;
    });
    if (alive.length !== list.length) invites.set(playerId, alive);
    return alive;
  };

  const stateFrame = (session) => {
    const snap = store.snapshot(session.playerId);
    const friends = snap.friends.map((row) => ({ ...row, ...statusOf(row.playerId) }));
    // 在线的名字以当前会话为准（代号可用于改名后的显示）
    for (const row of friends) {
      const s = findSession(row.playerId);
      if (s && s.name) row.name = s.name;
    }
    return {
      t: 'friend.state',
      limit: FRIEND_LIMIT,
      friends,
      incoming: snap.incoming.map((row) => {
        const s = findSession(row.playerId);
        return { ...row, name: s?.name || row.name };
      }),
      outgoing: snap.outgoing,
      invites: inviteList(session.playerId),
    };
  };

  const pushState = (session) => {
    if (!session) return;
    try {
      sendSession(session, stateFrame(session));
    } catch (error) {
      log.warn?.(`[friends] push state failed: ${error.message}`);
    }
  };

  const resolve = (name) => {
    const row = accounts?.get?.(name);
    return row && typeof row.playerId === 'string' ? row : null;
  };

  const handle = (session, msg) => {
    const self = accounts?.get?.(session.name);
    if (!self) return { error: ERR.AUTH_REQUIRED };
    store.touch(self.playerId, self.name);

    if (msg.t === 'friend.list') {
      pushState(session);
      return OK;
    }

    if (msg.t === 'friend.request') {
      const target = resolve(msg.name);
      if (!target) return { error: 'FRIEND_UNKNOWN' };
      if (target.playerId === self.playerId) return { error: 'FRIEND_SELF' };
      const result = store.request({ playerId: self.playerId, name: self.name }, { playerId: target.playerId, name: target.name });
      if (result.error) return result;
      const peer = findSession(target.playerId);
      if (peer) pushState(peer);
      pushState(session);
      return OK;
    }

    if (msg.t === 'friend.accept' || msg.t === 'friend.decline' || msg.t === 'friend.remove') {
      const target = resolve(msg.name);
      // 接受/拒绝/删除既可以按代号，也可以对缓存的 playerId 之外的名字生效；找不到账号时退回用缓存名匹配
      const otherId = target?.playerId || store.snapshot(self.playerId)[
        msg.t === 'friend.remove' ? 'friends' : msg.t === 'friend.accept' ? 'incoming' : 'incoming'
      ].find((r) => r.name.toLowerCase() === String(msg.name).trim().toLowerCase())?.playerId;
      if (!otherId) return { error: 'FRIEND_UNKNOWN' };
      if (msg.t === 'friend.accept') {
        // 如果是邀请列表里的条目（不是好友申请），加入房间由客户端直接发 room.join / room.spectate
        const result = store.accept(self.playerId, otherId);
        if (result.error) return result;
      } else if (msg.t === 'friend.decline') {
        store.decline(self.playerId, otherId);
      } else {
        store.remove(self.playerId, otherId);
        for (const list of invites.values()) {
          const filtered = list.filter((entry) => entry.fromId !== otherId);
          if (filtered.length !== list.length) list.splice(0, list.length, ...filtered);
        }
      }
      const peer = findSession(otherId);
      if (peer) pushState(peer);
      pushState(session);
      return OK;
    }

    if (msg.t === 'friend.invite') {
      const target = resolve(msg.name);
      if (!target) return { error: 'FRIEND_UNKNOWN' };
      if (self.playerId === target.playerId) return { error: 'FRIEND_SELF' };
      if (!store.areFriends(self.playerId, target.playerId)) return { error: 'NOT_FRIEND' };
      const room = lobby.roomOf(session);
      if (!room) return { error: ERR.NOT_IN_ROOM };
      const peer = findSession(target.playerId);
      if (!peer) return { error: 'FRIEND_OFFLINE' };
      if (room.mode !== 'coop') return { error: 'FRIEND_INVITE_UNAVAILABLE', detail: 'solo' };
      // 「仅邀请」房：把对方记进房间邀请表，join/spectate 才放行（见 server/lobby.js）
      if (room.invited && !room.invited.has(target.playerId)) room.invited.add(target.playerId);
      const list = inviteList(target.playerId);
      if (!list.some((entry) => entry.code === room.code)) {
        list.push({ fromId: self.playerId, fromName: self.name, code: room.code, mode: room.mode, at: Date.now() });
      }
      invites.set(target.playerId, list);
      try {
        sendSession(peer, {
          t: 'room.invite',
          fromId: self.playerId,
          fromName: self.name,
          code: room.code,
          mode: room.mode,
          inviteOnly: !!room.inviteOnly,
          matchRunning: !!room.match,
          at: Date.now(),
        });
      } catch (error) {
        log.warn?.(`[friends] invite push failed: ${error.message}`);
      }
      pushState(peer);
      pushState(session);
      return OK;
    }

    return { error: ERR.BAD_MSG };
  };

  return { handle, statusOf, inviteList, stateFrame, pushState };
}
