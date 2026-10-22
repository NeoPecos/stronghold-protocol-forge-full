import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFriendsService } from '../server/friends.js';
import { validateC2S } from '../shared/protocol.js';

test('a lobby chat friend request must match the server-stamped sender id', () => {
  const accounts = new Map([
    ['alice', { name: 'Alice', playerId: 'a' }],
    ['bob', { name: 'Bob', playerId: 'b' }],
  ]);
  let requested = 0;
  const service = createFriendsService({
    accounts: { get: (name) => accounts.get(String(name).toLowerCase()) },
    store: {
      touch() {},
      request() { requested++; return { ok: true }; },
      snapshot() { return { friends: [], incoming: [], outgoing: [] }; },
    },
    registry: { byId: () => null },
    lobby: { roomOf: () => null },
  });
  const session = { name: 'Alice', playerId: 'a' };
  assert.equal(validateC2S({ t: 'friend.request', name: 'Bob' }), null);
  assert.equal(validateC2S({ t: 'friend.request', name: 'Bob', playerId: 'b' }), null);
  assert.equal(validateC2S({ t: 'friend.request', name: 'Bob', playerId: '' }), 'bad field playerId');
  assert.deepEqual(service.handle(session, { t: 'friend.request', name: 'Bob', playerId: 'other' }), { error: 'FRIEND_UNKNOWN' });
  assert.equal(requested, 0);
  assert.deepEqual(service.handle(session, { t: 'friend.request', name: 'Bob', playerId: 'b' }), { ok: true });
  assert.equal(requested, 1);
});
