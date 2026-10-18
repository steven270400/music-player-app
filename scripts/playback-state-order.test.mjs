import test from 'node:test';
import assert from 'node:assert/strict';
import { playbackStateOrder } from '../src/core/platform/playbackStateOrder.ts';

const state = { sessionId: 's1', sequence: 10, queueRevision: 2 };
test('old events and delayed command receipts cannot rewind displayed playback', () => {
  for (const source of ['event', 'command', 'read']) {
    assert.equal(playbackStateOrder(state, { ...state, sequence: 9 }, source), 'ignore');
    assert.equal(playbackStateOrder(state, state, source), 'ignore');
  }
});
test('event gaps resync while full reads and confirmed command snapshots can advance', () => {
  const next = { ...state, sequence: 15 };
  assert.equal(playbackStateOrder(state, next, 'event'), 'resync');
  assert.equal(playbackStateOrder(state, next, 'read'), 'accept');
  assert.equal(playbackStateOrder(state, next, 'command'), 'accept');
});
test('replacement service is adopted through a live read only', () => {
  const next = { sessionId: 's2', sequence: 0, queueRevision: 0 };
  assert.equal(playbackStateOrder(state, next, 'event'), 'resync');
  assert.equal(playbackStateOrder(state, next, 'command'), 'resync');
  assert.equal(playbackStateOrder(state, next, 'read'), 'accept');
});
test('initial event cannot substitute for connection synchronization', () => {
  assert.equal(playbackStateOrder(null, state, 'event'), 'resync');
  assert.equal(playbackStateOrder(null, state, 'read'), 'accept');
});
test('invalid sequence numbers and reversed queue revisions are not rendered', () => {
  for (const sequence of [-1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(playbackStateOrder(state, { ...state, sequence }, 'read'), 'ignore');
  }
  assert.equal(playbackStateOrder(state, { ...state, sequence: 11, queueRevision: 1 }, 'event'), 'resync');
  assert.equal(playbackStateOrder(state, { ...state, sequence: 11 }, 'event'), 'accept');
});
