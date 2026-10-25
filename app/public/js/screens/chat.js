// public/js/screens/chat.js — 房内聊天（引擎特性；docs/META.md 的聊天那一节）。
//
// 两样东西：**打字聊天**与**快捷短语**。都是引擎自己的一等能力，不是包能力（包要用自己的消息走
// `client.panels[].messages` + `pack.msg`，docs/WORKSHOP.md §1.9.6）。
//
// 三条边界，与服务端逐字对应（`server/lobby.js` 的 `chat` / `quickMsg` / `sayInRoom`）：
//
//   * **限制在服务端**。客户端的输入框只是照着 `room.state.chatMode` 摆样子（`'open'` 打字+短语、`'quick'` 只
//     短语、`'off'` 都禁）；能不能说由服务端再判一次。这里不做「本地说不行就不发」，因为那会让客户端的
//     判断成为真源 —— 而这个仓库到处在消灭「第二份真相」。
//   * **旁观者也说得了**（owner 要求）：面板对观战者照样给输入框与快捷短语，服务端同样放行，
//     只是他们发出的 `chat.msg` 没有座位号（`seat: null`）。
//   * **文本是数据，不是标记**。消息一律经 Preact 的文本节点渲染（`${text}`），从不 `innerHTML`：一条消息
//     不该有能力改页面结构。
//
// 历史：重连时服务端补发 `chat.history`（只给这一个会话，`server/lobby.js runResync`），面板把它并到最前面。
// 环形缓冲在服务端内存里，房间没了它也就没了 —— 聊天永不落盘。
//
// 业主 2026-10-25：快捷短语点了**先填进发送栏**（不再直接发送，而且按钮上要看得见是哪一句）；
// 聊天窗口整块可拖拽移动、右下角可拖拽放大；窗口里的消息按局内战斗的弹幕样式同时飘一遍，并给开关。

import { useEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { html, Panel } from '../ui/components.js';
import { net } from '../net.js';
import { store, useStore, shallowEqual, loadPref, savePref } from '../store.js';
import { createRoomDanmaku } from '../ui/roomDanmaku.js';
import { t } from '../../../shared/i18n.js';

/**
 * 快捷短语：id（与服务端 `DEFAULT_QUICK_PHRASES` 一致）→ **msgid**。
 *
 * 这里存的是**中文 msgid**（`t()` 的键），不是已翻译的文案 —— 渲染时才 `t()`。把中文写死在这里当作显示文案会
 * 绕过 i18n（`tools/i18n.mjs` 会把它们报成「未包裹的中文字面量」，而且换语言也不会跟着变）。
 */
export const QUICK_PHRASES = Object.freeze([
  { id: 'niceOne', msgid: '打得漂亮' },        // i18n-ignore: msgid key, translated at render via t()
  { id: 'myBad', msgid: '我的失误' },          // i18n-ignore: msgid key
  { id: 'wellPlayed', msgid: '辛苦了' },       // i18n-ignore: msgid key
  { id: 'thanks', msgid: '收到，谢谢' },        // i18n-ignore: msgid key
  { id: 'wait', msgid: '稳住，别急' },         // i18n-ignore: msgid key
  { id: 'ready', msgid: '我准备好了' },        // i18n-ignore: msgid key
  { id: 'help', msgid: '请求支援' },           // i18n-ignore: msgid key
  { id: 'focus', msgid: '集中火力' },          // i18n-ignore: msgid key
  { id: 'goodLuck', msgid: '祝好运' },         // i18n-ignore: msgid key
]);

/** 一条消息在界面上的样子：`chat.msg` 直接来自服务端，不做二次加工（短语的文案在这里才翻译）。 */
const line = (m) => ({
  from: m.from,
  name: m.name,
  seat: m.seat,
  at: m.at,
  // 快捷短语优先（它是 id + 可选短参），否则就是一段文本
  text: Array.isArray(m.quick)
    ? m.quick.map((id) => {
      const q = QUICK_PHRASES.find((x) => x.id === id);
      // 不认识的 id 原样显示（服务端已经用白名单挡过了；这里只是别把它变成空白）
      return (q ? t(q.msgid) : id) + (m.arg ? ` ${m.arg}` : '');
    }).join(' · ')
    : String(m.text ?? ''),
});

// 聊天窗口几何（相对房间屏的 px；`w`/`h` 缺省时随内容自适应）。
const GEOM_KEY = 'sp.chat.room.geom.v1';
const MIN_W = 180;
const MIN_H = 150;
const MIN_DRAG = 4;
// 和局内战斗聊天的弹幕（public/js/ui/roomDanmaku.js）共用一个开关：房间里开过，进战斗还是开着的。
const DANMAKU_KEY = 'sp.chat.danmaku.enabled';

const clampNumber = (value, min, max) => Math.max(min, Math.min(max, value));

function readDanmakuPref() {
  try { return localStorage.getItem(DANMAKU_KEY) === '1'; } catch { return false; }
}

/**
 * 房内聊天面板。挂在房间屏里；`room` 来自 store（`room.state` 的那一份）。
 */
export function ChatPanel() {
  const room = useStore((s) => s.room, shallowEqual);
  const me = useStore((s) => s.me, shallowEqual);
  const [lines, setLines] = useState([]);
  const [draft, setDraft] = useState('');
  // 收起偏好存在本机（`sp.pref.chat.folded`）：房间屏是每局都要看的，收起过一次就别每次再收一遍
  const [folded, setFolded] = useState(() => loadPref('chat.folded', false) === true);
  const [unread, setUnread] = useState(0);
  const [danmakuOn, setDanmakuOn] = useState(readDanmakuPref);
  const alive = useRef(true);
  const listRef = useRef(null);
  const inputRef = useRef(null);
  const dockRef = useRef(null);
  const danmakuRef = useRef(null);
  // 快捷短语填进来的那一拍：等 Preact 把值刷进输入框后再聚焦（手机端点一下就该直接弹键盘）
  const focusDraftRef = useRef(false);
  // `chat.msg` 的监听器注册一次（deps 空），闭包里读不到最新的 folded，用 ref 转一手
  const foldedRef = useRef(folded);

  useEffect(() => { foldedRef.current = folded; }, [folded]);

  useEffect(() => () => { alive.current = false; }, []);

  // 弹幕层：和局内战斗聊天同款（fixed 全屏、pointer-events:none，消息从右往左飘）
  useEffect(() => {
    const danmaku = createRoomDanmaku();
    danmakuRef.current = danmaku;
    setDanmakuOn(danmaku.enabled);
    return () => { danmakuRef.current = null; danmaku.dispose(); };
  }, []);

  useEffect(() => {
    const offMsg = net.on('chat.msg', (m) => {
      if (!alive.current || !m) return;
      const entry = line(m);
      setLines((prev) => [...prev, entry].slice(-200));
      // 弹幕与聊天记录同源：重连补发的历史不算「新消息」，不飘
      danmakuRef.current?.show({ name: String(m.name || t('博士')), text: entry.text }, m.from === store.get()?.me?.playerId);
      // 收起时只数别人的话：自己发出去的不该给自己加未读
      const myId = store.get()?.me?.playerId;
      if (foldedRef.current && m.from !== myId) setUnread((n) => Math.min(n + 1, 99));
    });
    // 重连补发：`chat.history` 只发给这一个会话，整体替换（服务端那份才是真源，不是「追加」）
    const offHist = net.on('chat.history', (m) => {
      if (!alive.current || !m || !Array.isArray(m.messages)) return;
      setLines(m.messages.map(line).slice(-200));
    });
    // 离开房间就把记录清掉：换一个房间不该看见上一个房间说的话
    const offState = net.on('room.state', (m) => {
      if (!alive.current) return;
      if (!m || !m.code) setLines([]);
    });
    return () => { offMsg(); offHist(); offState(); };
  }, []);

  // 新消息到达时滚到底（列表本身就是滚动容器）
  useEffect(() => {
    const el = listRef.current;
    if (el && typeof el.scrollTop === 'number') el.scrollTop = el.scrollHeight;
  }, [lines.length]);

  // 展开后再补一次：收起期间 `.panel__body` 是 display:none，列表量不出高度，滚动位置得在展开后重设
  useEffect(() => {
    if (folded) return;
    const el = listRef.current;
    if (el && typeof el.scrollTop === 'number') el.scrollTop = el.scrollHeight;
  }, [folded]);

  // 快捷短语填进发送栏后聚焦输入框（光标放末尾，方便接着补字）
  useEffect(() => {
    if (!focusDraftRef.current) return;
    focusDraftRef.current = false;
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    if (typeof el.setSelectionRange === 'function') {
      const end = el.value.length;
      el.setSelectionRange(end, end);
    }
  }, [draft]);

  // 聊天窗口的拖动/缩放：直接操作 DOM（不经过 Preact state），松手后才把几何写回本机。
  // 收起时整条标题行本身就是可拖动的「聊天按钮」，放大只在展开时给右下角手柄。
  useEffect(() => {
    const dock = dockRef.current;
    const parent = dock?.parentElement;
    if (!dock || !parent) return undefined;
    const cleanups = [];
    let geom = null;
    try {
      const saved = JSON.parse(localStorage.getItem(GEOM_KEY));
      if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) geom = saved;
    } catch {}

    const parentRect = () => parent.getBoundingClientRect();
    const isFolded = () => dock.classList.contains('is-folded');
    const applyGeom = () => {
      if (!geom) return;
      const r = parentRect();
      const x = clampNumber(geom.x, 8, Math.max(8, r.width - 32));
      const y = clampNumber(geom.y, 8, Math.max(8, r.height - 32));
      dock.style.left = `${x}px`;
      dock.style.top = `${y}px`;
      dock.style.bottom = 'auto';
      if (Number.isFinite(geom.w)) dock.style.setProperty('--chatp-w', `${clampNumber(geom.w, MIN_W, Math.max(MIN_W, r.width - 16))}px`);
      if (Number.isFinite(geom.h)) {
        dock.classList.add('is-sized');
        dock.style.setProperty('--chatp-h', `${clampNumber(geom.h, MIN_H, Math.max(MIN_H, r.height - 16))}px`);
      }
      geom = { x, y, w: geom.w, h: geom.h };
    };
    const saveGeom = () => { try { localStorage.setItem(GEOM_KEY, JSON.stringify(geom)); } catch {} };
    const persistFromRect = () => {
      const r = parentRect();
      const d = dock.getBoundingClientRect();
      geom = {
        x: Math.round(d.left - r.left),
        y: Math.round(d.top - r.top),
        // 收起时窗口只剩标题行，别把缩略后的尺寸写回去（展开后要回到原来的大小）
        w: isFolded() ? geom?.w : Math.round(d.width),
        h: isFolded() ? geom?.h : Math.round(d.height),
      };
      saveGeom();
    };
    const onResize = () => applyGeom();
    window.addEventListener('resize', onResize);
    cleanups.push(() => window.removeEventListener('resize', onResize));
    applyGeom();

    let drag = null;
    let blockClick = false;
    let blockTimer = 0;
    const onPointerDown = (event) => {
      if (!event.isPrimary || event.button !== 0) return;
      const onResizeHandle = !!event.target.closest?.('.chatp__resize');
      const onHead = !!event.target.closest?.('.panel__head');
      if (!onResizeHandle && !onHead) return;
      // 标题行上的按钮（收起/弹幕/宿主插槽）保持原样：不拖窗口
      if (!onResizeHandle && event.target.closest('button, input, a, .mod-host')) return;
      const r = parentRect();
      const d = dock.getBoundingClientRect();
      if (!isFolded()) {
        dock.style.setProperty('--chatp-w', `${Math.round(d.width)}px`);
        dock.style.setProperty('--chatp-h', `${Math.round(d.height)}px`);
        dock.classList.add('is-sized');
      }
      drag = {
        id: event.pointerId,
        mode: onResizeHandle ? 'resize' : 'move',
        sx: event.clientX,
        sy: event.clientY,
        x: d.left - r.left,
        y: d.top - r.top,
        w: d.width,
        h: d.height,
        moved: false,
      };
      dock.classList.add('is-dragging');
      try { dock.setPointerCapture(event.pointerId); } catch {}
    };
    const onPointerMove = (event) => {
      if (!drag || drag.id !== event.pointerId) return;
      const dx = event.clientX - drag.sx;
      const dy = event.clientY - drag.sy;
      if (!drag.moved && Math.hypot(dx, dy) < MIN_DRAG) return;
      drag.moved = true;
      event.preventDefault();
      const r = parentRect();
      if (drag.mode === 'resize') {
        const w = clampNumber(drag.w + dx, MIN_W, Math.max(MIN_W, r.width - drag.x - 8));
        const h = clampNumber(drag.h + dy, MIN_H, Math.max(MIN_H, r.height - drag.y - 8));
        dock.style.setProperty('--chatp-w', `${Math.round(w)}px`);
        dock.style.setProperty('--chatp-h', `${Math.round(h)}px`);
        return;
      }
      const x = clampNumber(drag.x + dx, 8, Math.max(8, r.width - drag.w - 8));
      const y = clampNumber(drag.y + dy, 8, Math.max(8, r.height - drag.h - 8));
      dock.style.left = `${Math.round(x)}px`;
      dock.style.top = `${Math.round(y)}px`;
      dock.style.bottom = 'auto';
    };
    const onPointerUp = (event) => {
      if (!drag || drag.id !== event.pointerId) return;
      const moved = drag.moved;
      drag = null;
      dock.classList.remove('is-dragging');
      if (dock.hasPointerCapture?.(event.pointerId)) dock.releasePointerCapture(event.pointerId);
      if (!moved) return;
      // 拖完松手后的那次 click 不该顺手把聊天收起/展开
      blockClick = true;
      clearTimeout(blockTimer);
      blockTimer = setTimeout(() => { blockClick = false; }, 400);
      persistFromRect();
    };
    const onClickCapture = (event) => {
      if (!blockClick) return;
      blockClick = false;
      clearTimeout(blockTimer);
      event.stopPropagation();
      event.preventDefault();
    };
    for (const [type, fn] of [['pointerdown', onPointerDown], ['pointermove', onPointerMove], ['pointerup', onPointerUp], ['pointercancel', onPointerUp], ['lostpointercapture', onPointerUp]]) {
      dock.addEventListener(type, fn);
      cleanups.push(() => dock.removeEventListener(type, fn));
    }
    dock.addEventListener('click', onClickCapture, true);
    cleanups.push(() => dock.removeEventListener('click', onClickCapture, true));
    return () => { clearTimeout(blockTimer); for (const dispose of cleanups) dispose(); };
  }, [!!room]);

  if (!room) return null;
  const mode = room.chatMode || 'open';
  const canType = mode === 'open';
  const canQuick = mode !== 'off';

  const send = () => {
    const text = draft.trim();
    if (!text) return;
    // 乐观清空输入框：失败时服务端会回一条错误（面板不去猜），比卡住一个字更不容易让人连点
    setDraft('');
    net.request('room.chat', { text }).catch(() => {});
  };
  // 快捷短语：点一下先把**具体那一句**填进发送栏（业主：原来点了直接发、还看不见是哪句）；
  // 只有「只允许快捷短语」（房间关掉打字）时才退回直接发送 —— 那种模式根本没有输入框。
  const quick = (q) => {
    const text = t(q.msgid);
    if (canType) {
      focusDraftRef.current = true;
      setDraft(text);
      return;
    }
    net.request('room.quickMsg', { ids: q.id }).catch(() => {});
  };
  const toggleDanmaku = () => {
    const danmaku = danmakuRef.current;
    if (!danmaku) return;
    setDanmakuOn(danmaku.toggle());
  };
  // 收起/展开：偏好写本机（`savePref` 静默失败，隐私模式下只是记不住，不影响这一次的会话）
  const toggleFold = () => {
    const next = !folded;
    setFolded(next);
    if (!next) setUnread(0);
    savePref('chat.folded', next);
  };

  // 房内聊天面板**标题行**上的宿主（`screen.room.chat`，docs/WORKSHOP.md §1.9.3）：容器由**组件自己**渲染
  // （`[data-mod-slot]`），落在 `Panel` 的 `actions` 里 —— 也就是「房内聊天」这个标题旁边那一格，**不在**
  // `extensions.js MOD_PANEL_CREATED` 的浮层里；注册点对这一格只查不造（`test/modClientHosts.test.js` 逐槽位
  // 钉住「枚举里每一个组件渲染的宿主都必须真的有人渲染它」）。`.mod-host` 是 `display: contents`：引擎只给地址、
  // 不给样子（与 `screens/room.js` 的 `screen.room.aside` 同一种写法）。
  return html`
    <div class=${`chatp-dock${folded ? ' is-folded' : ''}`} ref=${dockRef}>
      <${Panel} title=${t('房内聊天')} class=${folded ? 'chatp is-collapsed' : 'chatp'}
        micro=${t(mode === 'open' ? '允许打字与快捷短语' : mode === 'quick' ? '只允许快捷短语' : '关闭聊天')}
        actions=${html`
          <div class="mod-host" data-mod-slot="screen.room.chat"></div>
          <button type="button" class=${`chatp__danmaku${danmakuOn ? ' is-on' : ''}`}
            title=${t('房间聊天弹幕开关')} aria-label=${t('房间聊天弹幕开关')} aria-pressed=${danmakuOn ? 'true' : 'false'}
            onClick=${toggleDanmaku}
          >${danmakuOn ? t('弹幕开') : t('弹幕关')}</button>
          <button type="button" class=${folded && unread > 0 ? 'chatp__fold is-unread' : 'chatp__fold'}
            title=${t('展开或折叠聊天')} aria-label=${t('展开或折叠聊天')} aria-expanded=${!folded}
            onClick=${toggleFold}
          >${folded ? (unread > 0 ? (unread > 9 ? '9+' : unread) : '+') : '−'}</button>`}>
        <div class="chatp__list" ref=${listRef}>
          ${lines.length === 0
            ? html`<div class="chatp__empty">${t('说点什么…')}</div>`
            : lines.map((m, i) => html`
              <div class="chatp__row" key=${`${m.from}:${m.at}:${i}`}>
                <span class="chatp__name">${m.name || t('博士')}</span>
                <span class="chatp__text">${m.text}</span>
              </div>`)}
        </div>
        ${canQuick ? html`
          <div class="chatp__quick">
            ${QUICK_PHRASES.map((q) => html`
              <button type="button" class="chatp__q" key=${q.id} title=${t(q.msgid)} onClick=${() => quick(q)}>${t(q.msgid)}</button>`)}
          </div>` : null}
        ${canType
          ? html`
              <div class="chatp__send">
                <input class="chatp__input" ref=${inputRef} value=${draft} maxlength="120" placeholder=${t('说点什么…')}
                  onInput=${(e) => setDraft(e.currentTarget.value)}
                  onKeyDown=${(e) => { if (e.key === 'Enter') send(); }} />
                <button type="button" class="chatp__go" disabled=${!draft.trim()} onClick=${send}>${t('发送')}</button>
              </div>`
          : html`<div class="chatp__note">${t('该房间已关闭打字聊天')}</div>`}
      <//>
      <span class="chatp__resize" aria-hidden="true" title=${t('拖拽调整聊天窗口大小')}></span>
    </div>`;
}
