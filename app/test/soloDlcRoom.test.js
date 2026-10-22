import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { hostStartAlignBlocked, roomAlignBlocked, roomFacts } from '../public/js/screens/room.js';
import { startServer } from '../server/index.js';
import { TestClient } from './helpers/wsClient.js';

const missingLocalPacks = { ok: false, needed: true, missing: 7 };

test('server-managed DLC rooms use checked room content instead of a hidden local-pack gate', () => {
  const room = { mode: 'solo', hostId: 'host', dlc: { available: ['dongShip'], enabled: [] },
    seats: [{ seat: 0, playerId: 'host', isBot: false, connected: true, content: 'ready' }],
    content: { vanilla: false, cs: 'a'.repeat(64) } };
  assert.equal(roomAlignBlocked(room, missingLocalPacks), false);
  assert.equal(hostStartAlignBlocked({ solo: true, room, align: missingLocalPacks }), false);
  assert.equal(roomFacts(room, 'host').canStart, true);
  assert.equal(roomFacts({ ...room, seats: [{ ...room.seats[0], content: 'loading' }] }, 'host').canStart, false);
  assert.equal(roomAlignBlocked({ mode: 'coop' }, missingLocalPacks), true, 'legacy room still checks local packs');
  assert.equal(hostStartAlignBlocked({ solo: true, align: missingLocalPacks }), true, 'legacy solo still checks local packs');
});

test('one-person server-managed DLC room starts through the real room protocol', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-solo-dlc-'));
  const workshopDir = path.join(tmp, 'workshop');
  const base = path.join(workshopDir, 'server-ext');
  const dlc = path.join(workshopDir, 'dongShip');
  fs.mkdirSync(base, { recursive: true });
  fs.mkdirSync(dlc, { recursive: true });
  for (const [dir, id] of [[base, 'server-ext'], [dlc, 'dongShip']]) {
    fs.writeFileSync(path.join(dir, 'pack.json'), JSON.stringify({ id, name: id, version: '1.0.0', content: ['chess'], overrides: [] }));
    const chessId = `chess_${id}`;
    fs.writeFileSync(path.join(dir, 'chess.json'), JSON.stringify({ [chessId]: {
      chessId, baseId: chessId, goldenId: null, isGolden: false, visible: true, tier: 5,
      profession: 'WARRIOR', position: 'MELEE', rangeGrid: [[0, 0]],
      stats: { maxHp: 2000, atk: 500, def: 200, res: 0, cost: 18, blockCnt: 2, bat: 1.2 }, talents: [], bonds: [],
    } }));
  }
  let server;
  let host;
  try {
    server = await startServer({ port: 0, host: '127.0.0.1', quiet: true, workshopDir });
    host = await TestClient.connect(`ws://127.0.0.1:${server.port}/ws`);
    const welcome = await host.hello('SoloDlcHost');
    assert.equal((await host.request({ t: 'room.create', mode: 'solo', difficulty: 'NORMAL', mods: welcome.mods.digest })).t, 'ok');
    const room = host.stateOf('room.state');
    assert.ok(room.dlc);
    assert.equal(roomFacts(room, room.hostId).canStart, true);
    assert.equal((await host.request({ t: 'room.start' })).t, 'ok');
    assert.equal((await host.waitFor('room.state', (state) => state.inMatch === true)).inMatch, true);
  } finally {
    await host?.close();
    await server?.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
