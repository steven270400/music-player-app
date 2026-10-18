import assert from 'node:assert/strict';
import test from 'node:test';
import { duration, dark, light } from '../src/ui/theme.ts';

test('duration distinguishes missing metadata and displays hour-long tracks', () => {
  for (const value of [null, undefined, NaN, Infinity]) assert.equal(duration(value), '—');
  assert.equal(duration(-1000), '0:00');
  assert.equal(duration(0), '0:00');
  assert.equal(duration(61999), '1:01');
  assert.equal(duration(3599999), '59:59');
  assert.equal(duration(3600000), '1:00:00');
  assert.equal(duration(7327000), '2:02:07');
});

test('both themes provide readable text and accent contrast on their surfaces', () => {
  const luminance = color => {
    const rgb = color.slice(1).match(/../g).map(part => parseInt(part, 16) / 255)
      .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  };
  const contrast = (a, b) => { const values = [luminance(a), luminance(b)].sort((x, y) => y - x); return (values[0] + 0.05) / (values[1] + 0.05); };
  for (const theme of [light, dark]) {
    for (const foreground of [theme.text, theme.muted, theme.accent, theme.error]) {
      for (const background of [theme.bg, theme.surface, theme.raised]) assert.ok(contrast(foreground, background) >= 4.5);
    }
    assert.ok(contrast(theme.onAccent, theme.accent) >= 4.5);
  }
});
