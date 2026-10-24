import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PHASE } from '../../shared/constants.js';
import { CONTRACTS, contractPoints, contractsValidFor } from '../../shared/contracts.js';
import { contractEffects } from '../../shared/contractEffects.js';
import { makeMatch } from './harness.js';
import { Lobby } from '../../server/lobby.js';
import { StubMatch } from '../../server/match/StubMatch.js';
import { validateC2S } from '../../shared/protocol.js';
import { shareLeakLosses } from '../../server/match/match/settle.js';

test('reference catalogue has 56 selectable terms and rejects unmet prerequisites', () => {
  assert.equal(CONTRACTS.length, 56);
  assert.equal(new Set(CONTRACTS.map((c) => c.id)).size, 56);
  assert.equal(contractsValidFor(['aidPriceRise'], { players: 8, difficulty: 'HARD' }).ok, false);
  assert.equal(contractsValidFor(['aidFundCut', 'aidPriceRise'], { players: 8, difficulty: 'HARD' }).ok, true);
  assert.ok(contractPoints(['aidFundCut', 'aidPriceRise'], 'HARD') > 0);
  assert.equal(contractEffects(['liaiLostTrust']).bondLayerCap, 50);
});

test('compensation protocols require risk terms, reduce score, and keep a real drawback', () => {
  assert.equal(contractsValidFor(['boonTacticalRotation'], { players: 8, difficulty: 'HARD' }).ok, false);
  const ids = ['doomCompact', 'doomIsolated', 'boonTacticalRotation'];
  assert.equal(contractsValidFor(ids, { players: 8, difficulty: 'HARD' }).ok, true);
  assert.equal(contractPoints(ids, 'HARD'), 3, '5 risk points minus 2 compensation points');
  assert.equal(contractEffects(ids).deployCapAdd, -1, 'the boon softens but does not erase the drawback');

  const elite = contractEffects(['anniElite', 'anniSwift']);
  assert.ok(elite.eliteMul.speed > 1, 'swift elites move faster');
  assert.ok(elite.eliteMul.hp < contractEffects(['anniElite']).eliteMul.hp, 'the tradeoff also makes them easier to kill');
});

test('rebalanced difficulty curve removes the old stat cliffs', () => {
  const crippled = contractEffects(['doomCrippled']);
  assert.equal(crippled.opStatMul.atk, 0.7);
  assert.equal(crippled.opStatMul.def, 0.7);
  assert.equal(crippled.opStatMul.hp, 0.7);
  const front = contractEffects(['pactNewFront']).pact;
  assert.equal(front.lateHpStep, 0.05);
  assert.equal(front.bossRounds.find((b) => b.round === 19).atkAdd, 0.35);
});

test('host selection is validated on the wire and follows room difficulty', () => {
  const lobby = new Lobby({ registry: { byId: () => null }, MatchClass: StubMatch,
    getData: () => ({}), now: () => 1_000,
    log: { info() {}, warn() {}, error() {}, debug() {} }, options: { maxSeats: 8 } });
  const host = { playerId: 'host', name: 'Host', connected: true, roomCode: null, ws: null };
  const guest = { playerId: 'guest', name: 'Guest', connected: true, roomCode: null, ws: null };
  lobby.create(host, { mode: 'coop', difficulty: 'HARD', seatCap: 8 });
  const room = lobby.roomOf(host);
  lobby.join(guest, { code: room.code });
  assert.equal(validateC2S({ t: 'room.setContracts', contracts: ['mechLimitedStock'] }), null);
  assert.ok(validateC2S({ t: 'room.setContracts', contracts: ['bad id'] }));
  assert.equal(lobby.setContracts(guest, { contracts: ['mechLimitedStock'] }).error, 'NOT_HOST');
  assert.equal(lobby.setContracts(host, { contracts: ['anniBreakthrough'] }).error, 'BAD_MSG');
  assert.equal(lobby.setContracts(host, { contracts: ['mechLimitedStock'] }).ok, true);
  assert.deepEqual(room.toState().contracts, ['mechLimitedStock']);
  assert.ok(room.toState().contractPoints > 0);
  lobby.setDifficulty(host, { difficulty: 'NORMAL' });
  assert.equal(room.contracts.length, 0);
  assert.equal(Object.hasOwn(room.toState(), 'contracts'), false);
});

test('five-player leak sharing preserves the total and assigns odd points to leakers first', () => {
  const alive = Array.from({ length: 5 }, (_, seat) => ({ seat, playerId: `p${seat}` }));
  const plan = { leakers: [alive[2], alive[0]], helpers: [alive[3], alive[1]] };
  const own = new Map([['p0', 7], ['p1', 0], ['p2', 2], ['p3', 1], ['p4', 4]]);
  const shared = shareLeakLosses(alive, plan, own);
  assert.deepEqual([...shared.values()], [3, 2, 3, 2, 4]);
  assert.deepEqual([...own.values()], [7, 0, 2, 1, 4], 'isolation keeps individual charges');
});

test('extension contract runs the early boss, continues, and reaches its shifted hidden core', () => {
  const h = makeMatch({ mode: 'coop', difficulty: 'HARD', humans: 2, contracts: ['pactExtension'], fake: true,
    script: (battle) => ['boss', 'hidden'].includes(battle.kind) ? { bossDps: 1e9 } : {} }).start();
  try {
    assert.equal(h.m.gd.lastRound, 16);
    assert.equal(h.m.gd.hiddenRound, 17);
    h.drive(() => h.m.phase === PHASE.PREP && h.m.round === 10);
    assert.ok(h.m.bossWaves?.some((wave) => wave.wave.spawns.length), 'early boss has a wave');
    h.drive(() => h.m.phase === PHASE.FINAL_ASSAULT && h.m.round === 10);
    h.drive(() => h.m.phase === PHASE.PREP && h.m.round === 11);
    h.drive(() => h.m.phase === PHASE.PREP && h.m.round === 16);
    for (const p of h.m.order) { p.bondCountBonus.yanShip = 3; p.layers.yanShip = 500; p.recompute(); }
    h.drive(() => h.m.phase === PHASE.HIDDEN_CORE && h.m.round === 17);
    assert.equal(h.m.ended, false);
  } finally { h.m.dispose(); }
});

for (const [id, first, final, hidden] of [
  ['pactFirewall', 8, 18, 19],
  ['pactNewFront', 8, 19, 20],
]) test(`${id} reaches every planned boss and its hidden core`, () => {
  const h = makeMatch({ mode: 'coop', difficulty: 'HARD', humans: 2, contracts: [id], fake: true,
    script: (battle) => ['boss', 'hidden'].includes(battle.kind) ? { bossDps: 1e9 } : {} }).start();
  try {
    assert.equal(h.m.gd.bossRound, final);
    assert.equal(h.m.gd.hiddenRound, hidden);
    h.drive(() => h.m.phase === PHASE.FINAL_ASSAULT && h.m.round === first);
    h.drive(() => h.m.phase === PHASE.PREP && h.m.round === first + 1);
    for (const round of h.m.contractFx.pact.bossRounds.map((b) => b.round).slice(1)) {
      h.drive(() => h.m.phase === PHASE.FINAL_ASSAULT && h.m.round === round);
      if (round < final) h.drive(() => h.m.phase === PHASE.PREP && h.m.round === round + 1);
    }
    h.drive(() => h.m.phase === PHASE.HIDDEN_CORE && h.m.round === hidden);
  } finally { h.m.dispose(); }
});
