import assert from 'node:assert/strict';
import test from 'node:test';
import { artworkRegion, queueGeometry, queueDuration, marqueeMetrics, DISC_PERIOD_MS, TITLE_DWELL_MS, TITLE_GAP } from '../src/features/library/playerMotionMath.ts';

test('overflow title cycle preserves its dwell, reading speed and seamless copy distance', () => {
  for (const textWidth of [273, 420, 1830.5]) {
    const m = marqueeMetrics(textWidth, 272);
    assert.equal(m.overflow, textWidth > 273);
    assert.equal(m.distance - textWidth, TITLE_GAP);
    assert.ok(Math.abs(m.duration * m.dwellFraction - 1200) < 0.001);
    assert.ok(Math.abs(m.distance / ((m.duration - TITLE_DWELL_MS) / 1000) - 30) < 0.001);
  }
  assert.equal(marqueeMetrics(120, 272).overflow, false);
  assert.equal(marqueeMetrics(420, 0).overflow, false, 'wait for viewport measurement');
  assert.equal(DISC_PERIOD_MS, 8000);
});

test('translated controller and queue stay contiguous and inside the endpoint viewport', () => {
  for (const height of [380, 480, 650, 1000]) for (const controls of [300, 370]) {
    const g = queueGeometry(height, controls, 360);
    assert.equal(g.open + controls + g.queueHeight, height);
    assert.equal(g.open + g.travel + controls, height);
    for (const progress of [0, .2, .5, .8, 1]) {
      const controlBottom = g.open + g.travel * (1 - progress) + controls;
      const queueTop = height - g.queueHeight + g.travel * (1 - progress);
      assert.ok(Math.abs(queueTop - controlBottom) < 1e-9);
    }
    assert.ok(g.openScale <= g.closedScale && g.closedScale <= 1);
  }
  assert.equal(queueDuration(0, 1), 220);
  assert.equal(queueDuration(.75, 1), 55);
  assert.equal(queueDuration(.25, 0), 55);
});

test('artwork yields space to controls and at least 120dp of queue before retaining its size', () => {
  for (const free of [-100, 0, 64, 120, 160, 216, 400, 800]) {
    const closed = artworkRegion(free, false), open = artworkRegion(free, true);
    assert.ok(open >= 0 && open <= 96 && open <= closed);
    assert.ok(closed <= Math.max(0, free), 'never consume control space');
    if (free >= 120) assert.ok(free - open >= 120, 'reserve a useful scrolling list');
    else assert.equal(open, 0, 'remove artwork first on severely constrained windows');
  }
});
