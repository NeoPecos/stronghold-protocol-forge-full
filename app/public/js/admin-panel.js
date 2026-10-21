// public/js/admin-panel.js — the experiment server's admin panel (public/admin.html).
// i18n-ignore-file: operator tool, Chinese UI like the main server's public/js/admin.js.
//
// Talks only to this server's /api/admin/* (server/http/adminApi.js), always with the x-sp-admin-token header.
// The module list is closed on purpose: the page has no other feature and no third-party code.

const TOKEN_KEY = 'sp-admin-token';
const $ = (sel, root = document) => root.querySelector(sel);

let token = localStorage.getItem(TOKEN_KEY) || '';
let statusTimer = null;
let serversTimer = null;
let lastStatus = null;

/** One API call; a non-2xx answer throws with the code the API reported (UNAUTHORIZED, ROOM_STARTED, …). */
async function api(path, { method = 'GET', body = null } = {}) {
  const headers = { 'x-sp-admin-token': token };
  if (body !== null) headers['content-type'] = 'application/json';
  const res = await fetch(path, { method, headers, body: body === null ? undefined : JSON.stringify(body), cache: 'no-store' });
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  if (!res.ok || (data && data.ok === false)) {
    const code = (data && (data.error || (data.error && data.error.code))) || `HTTP_${res.status}`;
    throw Object.assign(new Error(String(code)), { status: res.status, data });
  }
  return data;
}

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2).toLowerCase(), v);
    else node.setAttribute(k, v);
  }
  for (const child of [].concat(children)) if (child) node.append(child);
  return node;
}

function fmtUptime(sec) {
  if (sec === null || sec === undefined) return '—';
  const s = Number(sec);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d) return `${d}天${h}小时`;
  if (h) return `${h}小时${m}分`;
  return `${m}分${Math.floor(s % 60)}秒`;
}
const fmtBytes = (n) => {
  if (!n && n !== 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0; let x = Number(n);
  while (x >= 1024 && i < units.length - 1) { x /= 1024; i += 1; }
  return `${x.toFixed(i ? 1 : 0)} ${units[i]}`;
};
const fmtPct = (n) => (n === null || n === undefined ? '—' : `${n}%`);

function setWho(text, cls = 'muted') { const node = $('#who'); node.textContent = text; node.className = cls; }

async function refreshStatus() {
  if (!token) return;
  try {
    const data = await api('/api/admin/status');
    lastStatus = data;
    renderHealth(data.health || {});
    renderRooms(data.rooms || []);
    renderMaintenance(data.maintenance === true);
    setWho('已登录', 'ok');
  } catch (e) {
    setWho(e.message === 'UNAUTHORIZED' ? '令牌无效' : '连接失败', 'bad');
    if (e.status === 401) stopTimers();
  }
}

function renderHealth(h) {
  const box = $('#status');
  box.textContent = '';
  const rows = {
    版本: h.app ? `${h.app} · ${String(h.build || '').slice(0, 12)}` : '—',
    运行时长: fmtUptime(h.uptimeSec),
    在线连接: h.sockets ?? '—',
    会话: h.sessions ?? '—',
    房间: h.rooms ?? '—',
    对局: h.matches ?? '—',
    真人: h.humans ?? '—',
    机器人: h.bots ?? '—',
    观战: h.spectators ?? '—',
  };
  for (const [k, v] of Object.entries(rows)) box.append(el('div', {}, [el('span', { text: k }), el('span', { text: String(v) })]));
}

function renderServers(servers) {
  const box = $('#servers');
  box.textContent = '';
  const table = el('table');
  const head = el('tr');
  for (const text of ['节点', '状态', 'CPU', '内存', '磁盘', '网络', '负载']) head.append(el('th', { text }));
  table.append(el('thead', {}, [head]));
  const tbody = el('tbody');
  for (const row of servers) {
    const b = row.body || {};
    const node = row.name || b.host || '—';
    const tr = el('tr');
    tr.append(el('td', { text: node }));
    tr.append(el('td', {}, [el('span', { class: row.ok ? 'pill ok' : 'pill bad', text: row.ok ? '正常' : `不可达 ${row.status || ''}` })]));
    tr.append(el('td', { text: fmtPct(b.cpuPct) }));
    tr.append(el('td', { text: b.memPct === undefined ? '—' : `${fmtPct(b.memPct)} · ${fmtBytes(b.memUsed)}/${fmtBytes(b.memTotal)}` }));
    tr.append(el('td', { text: b.diskPct === undefined ? '—' : `${fmtPct(b.diskPct)} · ${fmtBytes(b.diskUsed)}/${fmtBytes(b.diskTotal)}` }));
    tr.append(el('td', { text: b.netTxMbps === null || b.netTxMbps === undefined ? '—' : `↑${b.netTxMbps} / ↓${b.netRxMbps} Mbps` }));
    tr.append(el('td', { text: Array.isArray(b.load) ? b.load.map((x) => Number(x).toFixed(2)).join(' / ') : '—' }));
    tbody.append(tr);
  }
  table.append(tbody);
  box.append(table);
  const note = el('p', { class: 'muted', text: 'a4 的 CPU/内存/磁盘/网络为本机 /proc 实时值；镜像行只反映 /healthz 可达性。' });
  box.append(note);
}

function renderRooms(rooms) {
  const box = $('#rooms');
  box.textContent = '';
  if (!rooms.length) { box.className = 'empty'; box.textContent = '当前没有房间'; return; }
  box.className = '';
  const table = el('table');
  const head = el('tr');
  for (const text of ['房间', '模式', '房主', '玩家', '对局', '操作']) head.append(el('th', { text }));
  table.append(el('thead', {}, [head]));
  const tbody = el('tbody');
  for (const room of rooms) {
    const tr = el('tr');
    const code = el('td', {}, [el('strong', { text: room.code || '—' }), el('div', { class: 'muted', text: room.difficulty || '' })]);
    tr.append(code);
    tr.append(el('td', { text: room.mode === 'coop' ? `同盟${room.matchCount ? ` · 第${room.matchCount}局` : ''}` : '单人' }));
    tr.append(el('td', { text: room.host || '—' }));
    const players = (room.players || []).map((p) => {
      const marks = [p.name || `#${p.seat}`];
      if (p.isBot) marks.push('机器人');
      if (!p.connected) marks.push('离线');
      if (p.ready) marks.push('已就绪');
      return `${marks.join('·')}`;
    }).join('，');
    tr.append(el('td', { text: players || '—' }));
    tr.append(el('td', { text: room.inMatch ? `进行中${room.round ? ` · 回合${room.round}` : ''}` : '未开始' }));
    const actions = el('td', { class: 'actions' });
    if (!room.inMatch && (room.players || []).length) {
      const select = el('select');
      for (const p of room.players) select.append(el('option', { value: p.playerId, text: `${p.name || p.playerId}${p.isBot ? '（机器人）' : ''}` }));
      const kick = el('button', { class: 'mini danger', text: '踢人', onclick: async () => {
        const playerId = select.value;
        if (!playerId) return;
        if (!confirm(`把 ${select.options[select.selectedIndex].text} 踢出房间 ${room.code}？`)) return;
        await act('/api/admin/room/kick', { playerId }, '踢人');
      } });
      actions.append(select, kick);
    }
    if (room.inMatch) {
      actions.append(el('button', { class: 'mini danger', text: '结束对局', onclick: async () => {
        if (!confirm(`结束房间 ${room.code} 的进行中对局？`)) return;
        await act('/api/admin/match/end', { code: room.code }, '结束对局');
      } }));
    }
    actions.append(el('button', { class: 'mini danger', text: '解散', onclick: async () => {
      if (!confirm(`解散房间 ${room.code}？${room.inMatch ? '（对局会一并结束）' : ''}`)) return;
      await act('/api/admin/room/dissolve', { code: room.code }, '解散房间');
    } }));
    tr.append(actions);
    tbody.append(tr);
  }
  table.append(tbody);
  box.append(table);
}

function renderMaintenance(on) {
  $('#maintenance').textContent = on ? '关闭维护开关' : '开启维护开关';
  $('#maintenance-state').textContent = on ? '维护中（拒绝新连接）' : '正常（接受新连接）';
  $('#maintenance-state').className = on ? 'warn' : 'ok';
}

async function act(path, body, label) {
  try {
    await api(path, { method: 'POST', body });
    setWho(`${label}成功`, 'ok');
    await refreshStatus();
  } catch (e) {
    setWho(`${label}失败：${e.message}`, 'bad');
  }
}

async function refreshServers() {
  if (!token) return;
  const box = $('#servers');
  try {
    const data = await api('/api/admin/servers');
    renderServers(data.servers || []);
  } catch (e) {
    box.textContent = '';
    box.append(el('p', { class: 'bad', text: `负载读取失败：${e.message}` }));
  }
}

function startTimers() {
  stopTimers();
  statusTimer = setInterval(refreshStatus, 5000);
  serversTimer = setInterval(refreshServers, 10000);
}
function stopTimers() {
  if (statusTimer) clearInterval(statusTimer);
  if (serversTimer) clearInterval(serversTimer);
  statusTimer = null;
  serversTimer = null;
}

async function login() {
  token = ($('#token').value || '').trim();
  if (!token) { setWho('请填令牌', 'warn'); return; }
  localStorage.setItem(TOKEN_KEY, token);
  await refreshStatus();
  if (!statusTimer && token) { await refreshServers(); startTimers(); }
}

document.addEventListener('DOMContentLoaded', () => {
  $('#token').value = token;
  $('#login').addEventListener('click', login);
  $('#token').addEventListener('keydown', (e) => { if (e.key === 'Enter') login(); });
  $('#maintenance').addEventListener('click', async () => {
    const on = !(lastStatus && lastStatus.maintenance === true);
    if (!confirm(on ? '开启维护开关？新连接会被拒绝，已在场的玩家不受影响。' : '关闭维护开关？')) return;
    try {
      await api('/api/admin/maintenance', { method: 'POST', body: { on } });
      await refreshStatus();
    } catch (e) { setWho(`维护开关失败：${e.message}`, 'bad'); }
  });
  for (const button of document.querySelectorAll('[data-refresh]')) {
    button.addEventListener('click', () => {
      if (button.dataset.refresh === 'servers') refreshServers();
      else refreshStatus();
    });
  }
  if (token) {
    refreshStatus().then(() => { refreshServers(); startTimers(); });
  }
});
