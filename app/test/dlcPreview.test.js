import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDlcPreview, changedFields } from '../server/dlcPreview.js';

test('DLC comparison keeps data effects and numbers alongside their original values', () => {
  assert.deepEqual(changedFields({ stats: { atk: 10 }, trait: { desc: 'old', descRaw: 'markup' } },
    { stats: { atk: 12 }, trait: { desc: 'new', descRaw: 'markup 2' } }), [
    { path: 'stats.atk', before: 10, after: 12 },
    { path: 'trait.desc', before: 'old', after: 'new' },
  ]);
  const official = {
    chess: { c1: { chessId: 'c1', charId: 'char1', bonds: ['b1'], stats: { atk: 10 } } },
    bonds: { b1: { bondId: 'b1', name: 'Test bond', effectDesc: 'old effect' } },
  };
  const packs = [
    { id: 'dongShip', overrides: ['chess:c1'], files: { chess: { c1: { stats: { atk: 12 } } } } },
    { id: 'ave-mujica', overrides: ['bonds:b1'], files: { bonds: { b1: { effectDesc: 'new effect' } } } },
  ];
  const preview = buildDlcPreview(official, packs);
  assert.deepEqual(preview.available, ['ave-mujica', 'dongShip']);
  assert.ok(preview.byChess.c1.some((entry) => entry.pack === 'dongShip' && entry.fields.some((field) => field.path === 'stats.atk')));
  assert.ok(preview.byChess.c1.some((entry) => entry.pack === 'ave-mujica' && entry.fields.some((field) => field.bondId === 'b1' && field.path === 'effectDesc')));
});
