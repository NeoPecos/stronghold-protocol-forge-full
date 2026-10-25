import WebSocket from 'ws';

const base = 'http://127.0.0.1:3301';
const rand = Math.random().toString(36).slice(2, 7);
const password = `Test-${rand}-031!`;
const nameA = `f31a${rand}`;
const nameB = `f31b${rand}`;

async function register(name) {
  const res = await fetch(`${base}/api/account/register`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, password }),
  });
  const body = await res.json();
  if (!res.ok || !body.ok || !body.ticket) throw new Error(`register ${name}: ${JSON.stringify(body)}`);
  return body;
}

async function connect(name, ticket) {
  const ws = new WebSocket('ws://127.0.0.1:3301/ws');
  const messages = [];
  const waiters = [];
  let rid = 0;
  ws.on('message', (raw) => {
    const frame = JSON.parse(String(raw));
    messages.push(frame);
    for (const w of [...waiters]) if (w.check(frame)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(frame); }
  });
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  const wait = (check, ms = 7000) => new Promise((resolve, reject) => {
    const previous = messages.find(check);
    if (previous) return resolve(previous);
    const w = { check, resolve };
    waiters.push(w);
    setTimeout(() => { const i = waiters.indexOf(w); if (i >= 0) { waiters.splice(i, 1); reject(new Error('frame timeout')); } }, ms).unref();
  });
  const request = async (t, fields = {}) => {
    const id = ++rid;
    ws.send(JSON.stringify({ t, rid: id, ...fields }));
    const reply = await wait((f) => f.rid === id);
    if (reply.t === 'error') throw new Error(`${t}: ${reply.code} ${reply.msg || ''}`);
    return reply;
  };
  const welcome = await request('hello', { name, auth: ticket });
  if (welcome.t !== 'welcome') throw new Error('no welcome');
  return { ws, request, wait, messages, welcome };
}

const a = await register(nameA);
const b = await register(nameB);
const A = await connect(nameA, a.ticket);
const B = await connect(nameB, b.ticket);
try {
  await A.request('friend.request', { name: nameB });
  await B.request('friend.accept', { name: nameA });
  await A.request('friend.list');
  const friends = A.messages.filter((m) => m.t === 'friend.state').at(-1);
  if (!friends?.friends?.some((f) => f.name === nameB)) throw new Error('friend relationship missing');

  await A.request('room.create', { mode: 'coop', difficulty: 'NORMAL', mods: A.welcome.mods?.digest });
  const state = A.messages.filter((m) => m.t === 'room.state').at(-1);
  if (!state || state.seats?.length !== 20) throw new Error(`expected 20 seats, got ${state?.seats?.length}`);
  await A.request('room.setSeatCap', { code: state.code, seatCap: 8 });
  const state8 = A.messages.filter((m) => m.t === 'room.state').at(-1);
  if (state8.seats?.length !== 8) throw new Error('room resize failed');
  await A.request('room.setExtendedUnite', { on: true });
  await A.request('room.setUniteRotation', { on: true });
  await A.request('room.setUniteHumanFirst', { on: true });
  await A.request('room.addBot');
  await A.request('room.addBot');
  await A.request('room.addBot');
  await A.request('room.addBot');
  await A.request('room.addBot');
  await A.request('room.addBot');
  await A.request('room.addBot');
  await A.request('room.setUniteHelpers', { n: 4 });
  const room5 = A.messages.filter((m) => m.t === 'room.state').at(-1);
  if (room5.seats.filter(Boolean).length !== 8) throw new Error('eight-player room failed');
  const locked = await (async () => {
    const id = 9001;
    A.ws.send(JSON.stringify({ t: 'room.mods', rid: id, modIds: [] }));
    return A.wait((m) => m.rid === id);
  })();
  if (locked.code !== 'MOD_SET_LOCKED') throw new Error(`mod lock: ${locked.code}`);
  const start = await A.request('room.start');
  console.log(JSON.stringify({ app: '0.3.1', friends: friends.friends.length, seats: state.seats.length,
    resized: state8.seats.length, participants: room5.seats.filter(Boolean).length,
    modLock: locked.code, start: start.t }));
} finally {
  A.ws.close(); B.ws.close();
}
