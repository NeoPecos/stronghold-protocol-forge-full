// 好友系统（移植自 0.3.0 public/js/ui/friendsPanel.js，适配 0.3.1 新 UI）。
// 服务端：server/friends.js + friend.* 协议；关系落盘 var/friends.json。
// 导出名与 stronghold-ui 的 compat shim 保持一致（others screens 直接 import 这些名字）。
import { html, Button, Icon, Modal, AvatarFrame, Spinner, Tabs, MicroLabel } from './components.js';
import { createStore, useStore } from '../store.js';
import { net } from '../net.js';
import { render } from '../../vendor/preact.module.js';
import { useEffect, useRef, useState } from '../../vendor/hooks.module.js';

export const friendsStore = createStore({ data: null, open: false, tab: 'list', seen: [], viewing: null });

export const THUMB = 'M2 10h4v11H2zm6 11V10l5-8 1.2.6c.9.5 1.3 1.5 1.1 2.5L14.6 9H20a2 2 0 0 1 2 2.3l-1.4 8A2 2 0 0 1 18.6 21z';
export const ADD_FRIEND = 'M9 4a4 4 0 1 1 0 8 4 4 0 0 1 0-8zM2 20c0-3.5 3.1-6 7-6s7 2.5 7 6v1H2zM19 7h2v3h3v2h-3v3h-2v-3h-3v-2h3z';
export const Glyph = ({ d, cls }) => html`<svg class=${['fglyph', cls].filter(Boolean).join(' ')} viewBox="0 0 24 24" aria-hidden="true"><path d=${d} /></svg>`;

let started = false;
let hostEl = null;

const pendingOf = (data) => (data ? (data.incoming?.length || 0) + (data.invites?.length || 0) : 0);

function setData(data) {
  const prev = friendsStore.get();
  const unread = pendingOf(data) > pendingOf(prev.data) && !prev.open;
  friendsStore.set({ ...prev, data, seen: unread ? [...(prev.seen || []), Date.now()] : prev.seen });
}

function statusText(row) {
  if (!row.online) return '离线';
  if (!row.inRoom) return '在线';
  if (row.matchRunning) return `对局中 · 第 ${row.round ?? '?'} 回合`;
  return `大厅 · ${row.code || ''}`;
}

async function asFriend(name) {
  return net.request('friend.request', { name }).catch((error) => {
    // 服务端返回错误码；统一转成可读文案抛回去，调用方负责提示
    throw new Error(error?.message || '好友申请失败');
  });
}

function close(tab) {
  const cur = friendsStore.get();
  friendsStore.set({ ...cur, open: false, viewing: null });
}

export function openFriends(tab = 'list', viewing = null) {
  startFriends();
  ensureHost();
  const cur = friendsStore.get();
  friendsStore.set({ ...cur, open: true, tab: typeof tab === 'string' ? tab : 'list', viewing });
  refreshFriends().catch(() => {});
}
openFriends.unavailable = false;

export const closeFriends = () => close();

export function pendingCount() {
  return pendingOf(friendsStore.get().data);
}

export async function refreshFriends() {
  return net.request('friend.list', {}).catch(() => null);
}

export function requestFriend(name) {
  return asFriend(String(name || '').trim());
}

function ensureHost() {
  if (hostEl) return;
  hostEl = document.createElement('div');
  hostEl.id = 'friends-host';
  document.body.appendChild(hostEl);
  render(html`<${FriendsHost} />`, hostEl);
}

export function startFriends() {
  if (started) return;
  started = true;
  try {
    net.on('friend.state', (msg) => setData(msg));
    net.on('room.invite', (msg) => {
      startFriends();
      const cur = friendsStore.get();
      const data = cur.data || { ok: true, limit: 100, friends: [], incoming: [], outgoing: [], invites: [] };
      const invites = Array.isArray(data.invites) ? data.invites.slice() : [];
      if (msg && msg.code && !invites.some((entry) => entry.code === msg.code && entry.fromId === msg.fromId)) {
        invites.push({ fromId: msg.fromId, fromName: msg.fromName, code: msg.code, mode: msg.mode, at: msg.at });
      }
      setData({ ...data, invites });
    });
    refreshFriends();
  } catch (error) {
    started = false;
  }
}

// ── 好友入口卡片（大厅左栏） ────────────────────────────────────────────────
export function FriendsTile() {
  useEffect(() => {
    startFriends();
    const timer = setInterval(() => {
      if (!document.hidden) refreshFriends();
    }, 10000);
    return () => clearInterval(timer);
  }, []);
  const state = useStore(undefined, Object.is, friendsStore);
  const data = state.data;
  const count = pendingOf(data);
  const online = data ? (data.friends || []).filter((row) => row.online).length : 0;
  return html`<button type="button" class="hub-tile hub-tile--friends" onClick=${() => openFriends('list')}>
    <span class="hub-tile__icon"><${Icon} name="users" /></span>
    <span class="hub-tile__body">
      <span class="hub-tile__label">好友</span>
      <span class="hub-tile__en">FRIENDS</span>
    </span>
    <span class="hub-tile__meta">
      ${data ? html`<b class="num">${online}/${(data.friends || []).length}</b>` : html`<${Spinner} size="sm" />`}
      ${count > 0 ? html`<span class="hub-tile__dot">${count}</span>` : null}
    </span>
  </button>`;
}

// ── 面板 ───────────────────────────────────────────────────────────────────
export function FriendsHost() {
  const state = useStore(undefined, Object.is, friendsStore);
  const [removeTarget, setRemoveTarget] = useState(null);
  const [removing, setRemoving] = useState(false);
  const removePending = useRef(false);
  if (!state.open) return null;
  const data = state.data;
  const tab = state.tab || 'list';
  const friends = (data && data.friends) || [];
  const incoming = (data && data.incoming) || [];
  const outgoing = (data && data.outgoing) || [];
  const invites = (data && data.invites) || [];

  const items = [
    { id: 'list', label: `好友 ${friends.length}` },
    { id: 'incoming', label: `申请 ${incoming.length}` },
    { id: 'invites', label: `房间邀请 ${invites.length}` },
  ];

  const removeFriend = async () => {
    if (!removeTarget || removePending.current) return;
    removePending.current = true;
    setRemoving(true);
    try {
      await net.request('friend.remove', { name: removeTarget.name });
      await refreshFriends();
      setRemoveTarget(null);
    } catch (error) {
      alert(error?.message || '删除好友失败');
    } finally {
      removePending.current = false;
      setRemoving(false);
    }
  };

  const rowActions = (row, kind) => {
    if (kind === 'incoming') {
      return html`<span class="fr-actions">
        <${Button} size="sm" variant="primary" onClick=${() => act('friend.accept', row)}>接受<//>
        <${Button} size="sm" variant="secondary" onClick=${() => act('friend.decline', row)}>拒绝<//>
      </span>`;
    }
    if (kind === 'invites') {
      return html`<span class="fr-actions">
        <${Button} size="sm" variant="primary" onClick=${() => joinInvite(row)}>加入<//>
        <${Button} size="sm" variant="secondary" onClick=${() => dropInvite(row)}>忽略<//>
      </span>`;
    }
    const actions = [];
    if (row.joinable) actions.push(html`<${Button} key="join" size="sm" variant="primary" onClick=${() => joinRoom(row.code)}>加入<//>`);
    if (row.spectatable) actions.push(html`<${Button} key="watch" size="sm" variant="secondary" onClick=${() => spectateRoom(row.code)}>观战<//>`);
    actions.push(html`<${Button} key="invite" size="sm" variant="secondary" onClick=${() => invite(row)}>邀请<//>`);
    actions.push(html`<${Button} key="remove" size="sm" variant="ghost" onClick=${() => setRemoveTarget(row)}>删除<//>`);
    return html`<span class="fr-actions">${actions}</span>`;
  };

  const rows = tab === 'incoming' ? incoming : tab === 'invites' ? invites : friends;

  return html`<${Modal} open=${true} title="好友" micro="FRIENDS" tone="mint" width="min(92vw, 900px)" onClose=${() => closeFriends()}>
    <div class="fr-panel">
      <${Tabs} items=${items} value=${tab} onChange=${(id) => friendsStore.set({ ...friendsStore.get(), tab: id })} />
      ${state.viewing ? html`<div class="fr-hint">正在查看：${state.viewing}</div>` : null}
      <div class="fr-list">
        ${!data ? html`<div class="fr-empty"><${Spinner} size="sm" /> 读取好友列表…</div>` : null}
        ${data && rows.length === 0 ? html`<div class="fr-empty">${tab === 'list' ? '还没有好友，输入代号添加吧' : tab === 'incoming' ? '没有待处理的申请' : '没有房间邀请'}</div>` : null}
        ${rows.map((row) => html`<div class="fr-row" key=${row.playerId}>
          <${AvatarFrame} name=${row.name || ''} src=${row.avatar} size="sm" />
          <span class="fr-row__body">
            <b class="fr-row__name">${row.name || row.fromName}</b>
            <span class="fr-row__status">${tab === 'invites' ? `邀请你加入 ${row.code}` : tab === 'incoming' ? '想加你为好友' : statusText(row)}</span>
          </span>
          ${tab === 'incoming' || tab === 'invites' ? rowActions(row, tab) : rowActions(row, 'list')}
        </div>`)}
      </div>
      ${tab === 'list' ? html`<div class="fr-add">
        <input class="fr-add__input" placeholder="输入代号添加好友（最多 12 字）" maxlength="12" ref=${(el) => (addInput = el)} />
        <${Button} size="sm" variant="primary" onClick=${() => addFriend()}>添加</${Button}>
      </div>` : null}
      ${outgoing.length > 0 && tab === 'list' ? html`<div class="fr-foot">已发送申请：${outgoing.map((row) => row.name).join('、')}</div>` : null}
    </div>
  </${Modal}>
  ${removeTarget ? html`<${Modal} open=${true} title="删除好友" micro="CONFIRMATION" tone="red" onClose=${() => !removing && setRemoveTarget(null)}
    actions=${html`<${Button} variant="secondary" disabled=${removing} onClick=${() => setRemoveTarget(null)}>取消<//>
      <${Button} variant="danger" disabled=${removing} onClick=${removeFriend}>确认删除<//>`}>
    <p class="modal__text">确定删除好友「${removeTarget.name}」吗？删除后需要重新发送好友申请。</p>
  </${Modal}>` : null}`;
}

let addInput = null;

async function addFriend() {
  const name = (addInput?.value || '').trim();
  if (!name) return;
  try {
    await requestFriend(name);
    addInput.value = '';
    await refreshFriends();
  } catch (error) {
    alert(error.message || '好友申请失败');
  }
}

async function act(type, row) {
  try {
    await net.request(type, { name: row.name || row.fromName });
    await refreshFriends();
  } catch (error) {
    alert(error?.message || '操作失败');
  }
}

async function invite(row) {
  try {
    await net.request('friend.invite', { name: row.name });
  } catch (error) {
    alert(error?.message || '邀请失败');
  }
}

function joinRoom(code) { net.request('room.join', { code }).catch(() => {}); closeFriends(); }
function spectateRoom(code) { net.request('room.spectate', { code }).catch(() => {}); closeFriends(); }
async function joinInvite(row) {
  try { await net.request('room.join', { code: row.code }); closeFriends(); } catch { /* 房已满/已结束 */ }
}
function dropInvite(row) {
  const cur = friendsStore.get();
  const data = cur.data || {};
  friendsStore.set({ ...cur, data: { ...data, invites: (data.invites || []).filter((entry) => entry !== row) } });
}
