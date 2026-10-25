import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer } from '../server/index.js';
import { TestClient } from './helpers/wsClient.js';

function pack(root, id) {
  const dir = path.join(root, id);
  fs.mkdirSync(dir, { recursive: true });
  const chessId = `chess_dlc_${id.replace(/-/g, '_')}`;
  fs.writeFileSync(path.join(dir, 'pack.json'), JSON.stringify({ id, name: id, version: '1.0.0', content: ['chess'], overrides: [] }));
  fs.writeFileSync(path.join(dir, 'chess.json'), JSON.stringify({ [chessId]: {
    chessId, baseId: chessId, goldenId: null, isGolden: false, visible: true, tier: 5,
    profession: 'WARRIOR', position: 'MELEE', rangeGrid: [[0, 0]],
    stats: { maxHp: 2000, atk: 500, def: 200, res: 0, cost: 18, blockCnt: 2, bat: 1.2 }, talents: [], bonds: [],
  } }));
  return chessId;
}

test('room DLC controls actual content, consent, and public room labels', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-dlc-'));
  const root = path.join(tmp, 'workshop');
  fs.mkdirSync(root);
  const base = pack(root, 'server-ext');
  const ave = pack(root, 'ave-mujica');
  const dong = pack(root, 'dongShip');
  pack(root, 'dossoles');
  pack(root, 'side-story');
  let server;
  let host;
  let guest;
  try {
    server = await startServer({ port: 0, host: '127.0.0.1', quiet: true, workshopDir: root });
    const url = `ws://127.0.0.1:${server.port}/ws`;
    host = await TestClient.connect(url);
    guest = await TestClient.connect(url);
    const h = await host.hello('DLC host');
    await guest.hello('DLC guest');
    assert.equal((await host.request({ t: 'room.create', mode: 'coop', difficulty: 'NORMAL', mods: h.mods.digest })).t, 'ok');
    const state = host.stateOf('room.state');
    assert.deepEqual(state.dlc.available, ['ave-mujica', 'dongShip', 'dossoles', 'side-story']);
    assert.deepEqual(state.dlc.enabled, []);
    const room = server.lobby.rooms.get(state.code);
    let assets = server.lobby.workshop.roomAssets.forRoom(room.modSet);
    assert.ok(assets.data.chess[base]);
    assert.equal(assets.data.chess[ave], undefined);
    assert.equal(assets.data.chess[dong], undefined);
    assert.deepEqual(server.lobby.roomDirectory().rooms[0].dlcIds, []);

    assert.equal((await host.request({ t: 'room.setDlc', id: 'ave-mujica', on: true })).t, 'ok');
    assert.deepEqual(host.stateOf('room.state').dlc.enabled, ['ave-mujica']);
    assets = server.lobby.workshop.roomAssets.forRoom(room.modSet);
    assert.ok(assets.data.chess[ave]);
    assert.equal(assets.data.chess[dong], undefined);
    assert.deepEqual(server.lobby.roomDirectory().rooms[0].dlcIds, ['ave-mujica']);
    assert.equal((await guest.request({ t: 'room.join', code: state.code, mods: h.mods.digest })).code, 'MOD_CONSENT_REQUIRED');
    assert.equal((await guest.request({ t: 'room.join', code: state.code, mods: h.mods.digest, consent: true })).t, 'ok');

    assert.equal((await host.request({ t: 'room.setDlc', id: 'dongShip', on: true })).t, 'ok');
    const changed = await guest.waitFor('room.state', (s) => s.dlc?.enabled?.length === 2);
    assert.deepEqual(changed.dlc.enabled, ['ave-mujica', 'dongShip']);
    const guestSeat = changed.seats.find((s) => s?.name === 'DLC guest');
    assert.equal(guestSeat.dlcConsent, false);
    assert.equal((await guest.request({ t: 'room.join', code: state.code, mods: h.mods.digest, consent: true })).t, 'ok');
    assert.equal((await guest.waitFor('room.state', (s) => s.seats.some((x) => x?.name === 'DLC guest' && x.dlcConsent))).seats.find((s) => s?.name === 'DLC guest').dlcConsent, true);
    assets = server.lobby.workshop.roomAssets.forRoom(room.modSet);
    assert.ok(assets.data.chess[dong]);

    assert.equal((await guest.request({ t: 'room.ready', ready: true })).t, 'ok');
    assert.equal((await host.request({ t: 'room.setDlc', id: 'dongShip', on: false })).code, 'MOD_SET_LOCKED');
    assert.deepEqual(room.dlcIds, ['ave-mujica', 'dongShip']);
    assert.equal((await guest.request({ t: 'room.ready', ready: false })).t, 'ok');
    assert.equal((await host.request({ t: 'room.setDlc', id: 'dossoles', on: true })).t, 'ok');
    assert.ok(room.dlcIds.includes('side-story'));
    assert.equal((await host.request({ t: 'room.setDlc', id: 'side-story', on: false })).t, 'ok');
    assert.equal(room.dlcIds.includes('dossoles'), false);
  } finally {
    await host?.close();
    await guest?.close();
    await server?.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
