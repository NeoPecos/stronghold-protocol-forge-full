// The main server's movable in-match chat, adapted to Forge's chat.msg protocol.
import { createRoomDanmaku } from './roomDanmaku.js';
import { QUICK_PHRASES } from '../screens/chat.js';
import { t } from '../../../shared/i18n.js';
import { net } from '../net.js';
import { store } from '../store.js';

const make = (tag, cls, value = '') => {
  const el = document.createElement(tag);
  el.className = cls;
  el.textContent = value;
  return el;
};

const phraseText = (msg) => Array.isArray(msg.quick)
  ? msg.quick.map((id) => {
    const item = QUICK_PHRASES.find((entry) => entry.id === id);
    return `${item ? t(item.msgid) : id}${msg.arg ? ` ${msg.arg}` : ''}`;
  }).join(' · ')
  : String(msg.text ?? '');

export function mountMatchChat() {
  const danmaku = createRoomDanmaku();
  const root = make('div', 'spchat');
  root.hidden = true;
  const panel = make('section', 'spchat__panel');
  panel.hidden = true;
  panel.setAttribute('aria-label', t('同盟聊天'));
  const header = make('header', 'spchat__header');
  const title = make('span', 'spchat__title', t('同盟通讯'));
  const danmakuButton = make('button', 'spchat__danmaku');
  danmakuButton.type = 'button';
  const fold = make('button', 'spchat__fold', '−');
  fold.type = 'button';
  fold.setAttribute('aria-label', t('折叠聊天'));
  header.append(title, danmakuButton, fold);
  const log = make('div', 'spchat__log');
  log.setAttribute('role', 'log');
  log.setAttribute('aria-live', 'polite');
  const hint = make('div', 'spchat__hint');
  const form = make('form', 'spchat__form');
  const input = make('input', 'spchat__input');
  input.type = 'text';
  input.maxLength = 120;
  input.placeholder = t('输入消息…');
  input.autocomplete = 'off';
  input.setAttribute('aria-label', t('聊天消息'));
  const send = make('button', 'spchat__send', t('发送'));
  send.type = 'submit';
  form.append(input, send);
  panel.append(header, log, hint, form);
  const toggle = make('button', 'spchat__toggle', t('聊'));
  toggle.type = 'button';
  toggle.setAttribute('aria-label', t('展开或折叠聊天'));
  const badge = make('span', 'spchat__badge');
  badge.hidden = true;
  toggle.append(badge);
  root.append(panel, toggle);
  document.body.append(root);

  let roomCode = null;
  let playerId = null;
  let spectator = false;
  let mode = 'open';
  let expanded = false;
  let unread = 0;
  let sending = false;
  let buttonRatio = null;
  let buttonPosition = null;
  let panelPosition = null;
  let panelDesired = null;
  let buttonDrag = null;
  let panelDrag = null;
  let blockClickUntil = 0;
  const messages = [];
  const cleanup = [];

  try {
    const saved = JSON.parse(localStorage.getItem('sp.chat.toggle.position.v1'));
    if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y) &&
      saved.x >= 0 && saved.x <= 1 && saved.y >= 0 && saved.y <= 1) buttonRatio = saved;
  } catch {}

  function listen(target, event, fn, options) {
    target.addEventListener(event, fn, options);
    cleanup.push(() => target.removeEventListener(event, fn, options));
  }
  function viewport() {
    const v = window.visualViewport;
    return { x: v?.offsetLeft || 0, y: v?.offsetTop || 0, w: v?.width || innerWidth, h: v?.height || innerHeight };
  }
  function clamp(point, v, w, h) {
    return {
      x: Math.max(v.x + 8, Math.min(point.x, Math.max(v.x + 8, v.x + v.w - w - 8))),
      y: Math.max(v.y + 8, Math.min(point.y, Math.max(v.y + 8, v.y + v.h - h - 8))),
    };
  }
  function layout() {
    if (!roomCode) return;
    const v = viewport();
    const w = Math.max(1, Math.min(230, v.w - 16));
    const h = Math.max(1, Math.min(220, v.h - 16));
    buttonPosition = clamp(buttonRatio
      ? { x: v.x + 8 + buttonRatio.x * Math.max(1, v.w - 52), y: v.y + 8 + buttonRatio.y * Math.max(1, v.h - 52) }
      : { x: v.x + 16, y: v.y + v.h - 104 }, v, 36, 36);
    Object.assign(toggle.style, { left: `${buttonPosition.x}px`, top: `${buttonPosition.y}px` });
    let initial = { x: buttonPosition.x + 44, y: buttonPosition.y - h + 36 };
    if (initial.x + w > v.x + v.w - 8) initial.x = buttonPosition.x - w - 8;
    panelPosition = clamp(panelDesired || initial, v, w, h);
    Object.assign(panel.style, { left: `${panelPosition.x}px`, top: `${panelPosition.y}px`, width: `${w}px`, height: `${h}px` });
  }
  function controls() {
    const canType = !!roomCode && !spectator && mode === 'open' && net.status === 'online';
    input.disabled = !canType;
    send.disabled = !canType || sending;
    hint.textContent = spectator ? t('观战中无法发言') : mode === 'off' ? t('该房间已关闭打字聊天')
      : mode === 'quick' ? t('只允许快捷短语') : net.status === 'online' ? t('同盟通讯已连接') : t('等待连接恢复…');
  }
  function open(value) {
    expanded = value;
    panel.hidden = !value;
    toggle.setAttribute('aria-expanded', String(value));
    if (value) { unread = 0; badge.hidden = true; log.scrollTop = log.scrollHeight; }
    else input.blur();
    layout();
  }
  function renderMessages() {
    log.replaceChildren();
    for (const msg of messages) {
      const mine = msg.from === playerId;
      const row = make('div', `spchat__row${mine ? ' spchat__row--mine' : ''}`);
      const stamp = Number.isFinite(msg.at) ? new Date(msg.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
      row.append(make('div', 'spchat__name', `${msg.name || t('博士')} · ${stamp}`), make('div', 'spchat__bubble', phraseText(msg)));
      log.append(row);
    }
    log.scrollTop = log.scrollHeight;
  }
  function receive(msg, historical = false) {
    if (!roomCode || !msg || (typeof msg.text !== 'string' && !Array.isArray(msg.quick))) return;
    messages.push(msg);
    if (messages.length > 80) messages.shift();
    renderMessages();
    const mine = msg.from === playerId;
    if (!historical) danmaku.show({ name: String(msg.name || t('博士')), text: phraseText(msg) }, mine);
    if (!historical && !expanded && !mine) {
      unread++;
      badge.textContent = unread > 9 ? '9+' : String(unread);
      badge.hidden = false;
    }
  }
  function sync() {
    const state = store.get();
    const room = state.room;
    const me = state.me?.playerId;
    const active = state.session?.entered && state.match?.public && room?.mode === 'coop' && me;
    const nextCode = active ? room.code : null;
    if (roomCode !== nextCode) {
      roomCode = nextCode;
      messages.length = 0;
      log.replaceChildren();
      danmaku.clear();
      panelDesired = null;
      root.hidden = !roomCode;
      title.textContent = roomCode ? `${t('同盟通讯')} · ${roomCode}` : t('同盟通讯');
      open(false);
    }
    playerId = me;
    spectator = !!room?.spectators?.some((s) => s.playerId === me);
    mode = room?.chatMode || 'open';
    root.dataset.chatMode = mode;
    controls();
  }

  listen(form, 'submit', async (event) => {
    event.preventDefault();
    const value = input.value.trim();
    if (!value || input.disabled || sending) return;
    sending = true; controls();
    try {
      await net.request('room.chat', { text: value });
      if (input.value.trim() === value) input.value = '';
    } catch (error) { hint.textContent = error.message || t('发送失败，请重试'); }
    finally { sending = false; controls(); }
  });
  listen(toggle, 'click', (event) => {
    if ((event.detail > 0 || event.pointerType) && performance.now() < blockClickUntil) {
      event.preventDefault(); blockClickUntil = 0; return;
    }
    open(!expanded);
  });
  listen(toggle, 'pointerdown', (event) => {
    if (!event.isPrimary || event.button !== 0 || !buttonPosition) return;
    buttonDrag = { id: event.pointerId, x: event.clientX, y: event.clientY, start: { ...buttonPosition }, moved: false };
    toggle.setPointerCapture(event.pointerId);
  });
  listen(toggle, 'pointermove', (event) => {
    if (buttonDrag?.id !== event.pointerId) return;
    const dx = event.clientX - buttonDrag.x, dy = event.clientY - buttonDrag.y;
    if (!buttonDrag.moved && Math.hypot(dx, dy) < 6) return;
    buttonDrag.moved = true;
    event.preventDefault();
    const v = viewport();
    const p = clamp({ x: buttonDrag.start.x + dx, y: buttonDrag.start.y + dy }, v, 36, 36);
    buttonRatio = { x: (p.x - v.x - 8) / Math.max(1, v.w - 52), y: (p.y - v.y - 8) / Math.max(1, v.h - 52) };
    panelDesired = null;
    layout();
  });
  function finishButtonDrag(event) {
    if (buttonDrag?.id !== event.pointerId) return;
    if (buttonDrag.moved) {
      blockClickUntil = performance.now() + 400;
      try { localStorage.setItem('sp.chat.toggle.position.v1', JSON.stringify(buttonRatio)); } catch {}
    }
    buttonDrag = null;
    if (toggle.hasPointerCapture(event.pointerId)) toggle.releasePointerCapture(event.pointerId);
  }
  for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) listen(toggle, event, finishButtonDrag);
  listen(header, 'pointerdown', (event) => {
    if (event.target === fold || event.target === danmakuButton || !event.isPrimary || event.button !== 0 || !panelPosition) return;
    event.preventDefault();
    panelDrag = { id: event.pointerId, x: event.clientX, y: event.clientY, start: { ...panelPosition } };
    header.setPointerCapture(event.pointerId);
  });
  listen(header, 'pointermove', (event) => {
    if (panelDrag?.id !== event.pointerId) return;
    panelDesired = { x: panelDrag.start.x + event.clientX - panelDrag.x, y: panelDrag.start.y + event.clientY - panelDrag.y };
    layout();
  });
  function finishPanelDrag(event) {
    if (panelDrag?.id !== event.pointerId) return;
    panelDrag = null;
    panelDesired = { ...panelPosition };
    if (header.hasPointerCapture(event.pointerId)) header.releasePointerCapture(event.pointerId);
  }
  for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) listen(header, event, finishPanelDrag);
  listen(danmakuButton, 'click', () => {
    danmaku.toggle();
    danmakuButton.textContent = danmaku.enabled ? t('弹幕开') : t('弹幕关');
    danmakuButton.setAttribute('aria-pressed', String(danmaku.enabled));
  });
  danmakuButton.textContent = danmaku.enabled ? t('弹幕开') : t('弹幕关');
  danmakuButton.setAttribute('aria-pressed', String(danmaku.enabled));
  listen(fold, 'click', () => open(false));
  listen(input, 'keydown', (event) => { if (event.key === 'Escape') open(false); });
  for (const event of ['keydown', 'keyup', 'keypress', 'pointerdown', 'pointermove', 'pointerup', 'touchstart', 'touchmove', 'touchend', 'click', 'wheel'])
    listen(root, event, (e) => e.stopPropagation());
  listen(window, 'resize', layout);
  if (window.visualViewport) { listen(window.visualViewport, 'resize', layout); listen(window.visualViewport, 'scroll', layout); }
  cleanup.push(net.on('chat.msg', (msg) => receive(msg)), net.on('chat.history', (msg) => {
    if (!roomCode || !Array.isArray(msg?.messages)) return;
    messages.length = 0;
    for (const item of msg.messages.slice(-80)) receive(item, true);
  }), net.on('status', controls), store.subscribe(sync));
  sync();
  return () => { for (const dispose of cleanup) dispose(); danmaku.dispose(); root.remove(); };
}
