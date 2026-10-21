// Compat module (stronghold-ui package) — install ONLY when the target has no public/js/ui/accounts.js.
// The original deployment has player accounts kept by its own accounts service (login, avatar, #tag, name cards, the
// same records on every device). This module is the LOCAL stand-in: one "本机账号" per browser, everything in
// localStorage — the profile (avatar, #tag) under `sp.pref.localAccount`, the match records in the game's own
// `sp.pref.stats` (ui/stats.js). The chosen avatar is broadcast to this room through room.appearance;
// its preference, the local tag, and local stats stay in this browser. To connect a real account profile later, replace this file with a module that has the same
// exports (AGENTS.md §3.2 lists them and what each must return).
import { html, AvatarFrame, MicroLabel, Icon, Modal, Button } from './components.js';
import { useEffect, useState } from '../../vendor/hooks.module.js';
import { render } from '../../vendor/preact.module.js';
import { store } from '../store.js';
import { net } from '../net.js';
import { avatarChoices, avatarUrl, loadAvatarCatalog } from './avatarCatalog.js';

/** This module keeps the account in the browser (other modules may check it to word their notes). */
export const LOCAL_ACCOUNT = true;

const KEY = 'sp.pref.localAccount';
const AVATAR_MAX = 128 * 1024; // room.appearance protocol limit
const listeners = new Set();
const read = () => { try { const v = JSON.parse(localStorage.getItem(KEY) || 'null'); return v && typeof v === 'object' ? v : null; } catch { return null; } };
const write = (v) => { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* private mode / quota: kept for this page only */ } };

let profile = null;
function load() {
  if (profile) return profile;
  profile = read() || {};
  if (!/^\d{4}$/.test(profile.tag || '')) { profile.tag = String(1000 + Math.floor(Math.random() * 9000)); write(profile); }
  return profile;
}
function emit() { for (const fn of listeners) { try { fn(); } catch { /* a listener's own problem */ } } }
// (guarded: the module is also imported by Node tests, where there is no window)
globalThis.addEventListener?.('storage', (e) => { if (e.key === KEY) { profile = null; emit(); } });

/** The local account: { id, name, tag, avatar (data: URL or official asset URL), card: null, local: true }. */
export function currentAccount() {
  const p = load();
  const name = store.get().me?.name || p.name || '博士';
  return { id: `local-${p.tag}`, name, tag: p.tag, avatar: avatarUrl(p.avatarId) || (typeof p.avatar === 'string' ? p.avatar : null), card: null, local: true };
}
export function onAccountChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export async function refreshAccount() { return currentAccount(); }
export async function logoutAccount() { /* a local account cannot log out */ }
/** A fetch timeout signal (some modules import it from here). */
export function timeoutSignal(ms) { const c = new AbortController(); setTimeout(() => c.abort(), ms); return c.signal; }

/** Preact: { me, loaded } — always loaded, `me` is the local account. */
export function useCurrentAccount() {
  const [me, setMe] = useState(currentAccount);
  useEffect(() => {
    const update = () => setMe(currentAccount());
    listeners.add(update);
    const off = store.subscribe ? store.subscribe(update) : null;
    return () => { listeners.delete(update); if (typeof off === 'function') off(); };
  }, []);
  return { me, loaded: true };
}

const isMe = (playerId) => !!playerId && playerId === store.get().me?.playerId;
/** A player's account — other players expose only the official avatar chosen on the server. */
export function accountOf(playerId) {
  if (isMe(playerId)) return currentAccount();
  const state = store.get();
  const seat = state.room?.seats?.find((entry) => entry?.playerId === playerId)
    || state.match?.public?.players?.find((entry) => entry?.playerId === playerId);
  return seat?.avatar ? { avatar: avatarUrl(seat.avatar) || null } : null;
}
/** 头像 id（charId / e2:charId / skin:id）：自己取本机账号所选，别人取服务端下发的座位头像。 */
export function avatarIdOf(playerId) {
  if (isMe(playerId)) return load().avatarId || '';
  const seat = store.get().room?.seats?.find((entry) => entry?.playerId === playerId);
  return (seat && typeof seat.avatar === 'string' && seat.avatar) || '';
}
export function useAccount(playerId) {
  useCurrentAccount();
  return accountOf(playerId);
}
/** The small "#1234" after a name when that player has an account. */
export function AccountTag({ playerId }) {
  const info = useAccount(playerId);
  return info?.tag ? html`<span class="acct-tag" title=${`本机账号 ${info.name}#${info.tag}`}>#${info.tag}</span>` : null;
}
/** Plain DOM (chats): the #tag after this browser's own name. */
export function decorateChatName(element, playerId) {
  const info = accountOf(playerId);
  if (element && info?.tag && !element.querySelector('.acct-tag')) {
    const tag = document.createElement('span'); tag.className = 'acct-tag'; tag.textContent = `#${info.tag}`; element.append(tag);
  }
  return element;
}

// ---- avatar file → 128×128 square ------------------------------------------------------------------------------------
async function squareAvatar(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((ok, fail) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => fail(new Error('图片读取失败')); i.src = url; });
    const s = Math.min(img.naturalWidth, img.naturalHeight);
    const c = document.createElement('canvas'); c.width = c.height = 128;
    c.getContext('2d').drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, 128, 128);
    return c.toDataURL('image/jpeg', 0.86);
  } finally { URL.revokeObjectURL(url); }
}

// ---- the panel (opened from the hub's top-right chip) -------------------------------------------------------------------
function ensureStyle() {
  if (document.getElementById('local-acct-style')) return;
  const st = document.createElement('style');
  st.id = 'local-acct-style';
  st.textContent = `.acct-tag{margin-left:.06em;font-size:.8em;font-weight:600;opacity:.62;letter-spacing:.02em}
.lacct{display:flex;flex-direction:column;gap:.16rem;min-width:min(5.6rem,86vw)}
.lacct__who{display:flex;align-items:center;gap:.16rem}
.lacct__pic{width:.9rem;height:.9rem;flex:none;display:grid;place-items:center;overflow:hidden;border:2px solid var(--mint-700,#2b7);background:#101614;font-size:.4rem;font-weight:900}
.lacct__pic img{width:100%;height:100%;object-fit:cover}
.lacct__name{font-size:.3rem;font-weight:900}
.lacct__note{margin:0;font-size:.17rem;line-height:1.5;opacity:.72}
.lacct__btns{display:flex;flex-wrap:wrap;gap:.1rem}
.lacct__search{width:100%;padding:.14rem;background:#101614;color:inherit;border:1px solid #4b7569}
.lacct__grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(1.25rem,1fr));gap:.1rem;max-height:min(55vh,7rem);overflow-y:auto}
.lacct__choice{display:flex;flex-direction:column;gap:.03rem;padding:.05rem;background:#101614;color:inherit;border:1px solid #456158;cursor:pointer;text-align:center}
.lacct__choice.is-on{border-color:var(--mint-700,#2b7)}
.lacct__choice img{width:100%;aspect-ratio:1;object-fit:cover}
.lacct__choice span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:.15rem}`;
  document.head.appendChild(st);
}
let host = null;
function AccountPanel({ onStats, onClose }) {
  const { me } = useCurrentAccount();
  const [busy, setBusy] = useState(false);
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const [choices, setChoices] = useState(null);
  useEffect(() => {
    if (searching) loadAvatarCatalog().then(setChoices).catch(() => setChoices([]));
  }, [searching]);
  const pick = () => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/*';
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return;
      setBusy(true);
      try { const d = await squareAvatar(f); if (d.length <= AVATAR_MAX) { profile = { ...load(), avatar: d, avatarId: '' }; write(profile); emit(); void syncAvatar(); } }
      catch { /* not an image */ } finally { setBusy(false); }
    };
    input.click();
  };
  const clear = () => { profile = { ...load(), avatar: null, avatarId: '' }; write(profile); emit(); void syncAvatar(); };
  const choose = (choice) => {
    profile = { ...load(), avatar: choice.url, avatarId: choice.id };
    write(profile); emit(); void syncAvatar(); setSearching(false);
  };
  if (searching) {
    const needle = query.trim().toLowerCase();
    const shown = needle && choices ? choices.filter((choice) => choice.search.toLowerCase().includes(needle)) : [];
    return html`<${Modal} open=${true} title="搜索头像" micro="PLAYER AVATAR" width="min(13rem,94vw)" onClose=${() => setSearching(false)}>
      <div class="lacct"><input class="lacct__search" type="search" value=${query} placeholder="搜索干员或皮肤" onInput=${(event) => setQuery(event.currentTarget.value.slice(0, 32))} />
        ${!needle ? html`<p class="lacct__note">输入干员或皮肤名称开始搜索。</p>` : !choices ? html`<p class="lacct__note">正在载入头像目录…</p>` : shown.length
          ? html`<div class="lacct__grid">${shown.map((choice) => html`<button type="button" class=${`lacct__choice${load().avatarId === choice.id ? ' is-on' : ''}`} onClick=${() => choose(choice)} title=${`${choice.name} · ${choice.variant}`}>
              <img src=${choice.url} alt="" loading="lazy" /><span>${choice.name}</span><span>${choice.variant}</span></button>`)}</div>`
          : html`<p class="lacct__note">没有匹配的头像。</p>`}
      </div><//>`;
  }
  return html`<${Modal} open=${true} title="本机账号" micro="LOCAL ACCOUNT" onClose=${onClose}>
    <div class="lacct">
      <div class="lacct__who">
        <span class="lacct__pic">${me.avatar ? html`<img src=${me.avatar} alt="" />` : [...me.name][0]}</span>
        <span><b class="lacct__name">${me.name}<span class="acct-tag">#${me.tag}</span></b><br /><${MicroLabel}>LOCAL · 本机<//></span>
      </div>
      <p class="lacct__note">头像选择、编号和本机统计保存在此浏览器；进入房间后，同房间玩家会看到所选头像。昵称跟随登录账号。</p>
      <div class="lacct__btns">
        <${Button} size="sm" variant="secondary" icon="edit" loading=${busy} onClick=${pick}>更换头像<//>
        <${Button} size="sm" variant="secondary" icon="search" onClick=${() => setSearching(true)}>搜索头像<//>
        ${me.avatar ? html`<${Button} size="sm" variant="ghost" onClick=${clear}>移除头像<//>` : null}
        ${onStats ? html`<${Button} size="sm" variant="primary" icon="chart" onClick=${() => { onClose(); onStats(); }}>统计数据<//>` : null}
      </div>
    </div>
  <//>`;
}
/** Open the account panel ({ onStats } adds the 统计数据 button). */
export function openAccountPanel(opts = {}) {
  ensureStyle();
  if (!host) { host = document.createElement('div'); host.className = 'local-acct-host'; document.body.appendChild(host); }
  const close = () => render(null, host);
  render(html`<${AccountPanel} onStats=${opts.onStats} onClose=${close} />`, host);
}

/** The hub's top-right chip: avatar + name #tag; a click opens the account panel (with 统计数据). */
export function AccountMeChip({ player, onStats }) {
  const { me } = useCurrentAccount();
  useEffect(ensureStyle, []);
  const name = player?.name || me.name || '博士';
  return html`<button type="button" class="me-chip me-chip--btn stats-entry" onClick=${() => openAccountPanel({ onStats })} title="本机账号 · 统计数据" aria-label="本机账号">
    <${AvatarFrame} size="sm" name=${name} seat=${0} self=${true} src=${me.avatar || undefined} />
    <span class="me-chip__text"><span class="me-chip__name">${name}<span class="acct-tag">#${me.tag}</span></span><${MicroLabel}>LOCAL · 本机账号<//></span>
    <${Icon} name="user" class="me-chip__stats" />
  </button>`;
}

async function syncAvatar() {
  const p = load();
  const avatar = avatarUrl(p.avatarId) || (typeof p.avatar === 'string' ? p.avatar : null);
  store.set((s) => ({ me: { ...s.me, avatar } }));
  if (net.status === 'online' && store.get().room?.code) net.send('room.appearance', { avatar: { avatar } });
}

net.on('welcome', () => { void syncAvatar(); });
void loadAvatarCatalog().then(emit).catch(() => {});

export function startAccounts() {}
