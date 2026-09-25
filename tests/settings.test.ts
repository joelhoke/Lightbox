import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_SETTINGS, lightColor, normalizeHex, temperatureToHex, updateSettings } from '../src/settings.ts';

test('switching light modes preserves both colors and keeps brightness independent', () => {
  const custom = updateSettings({ ...DEFAULT_SETTINGS }, {
    lightMode: 'custom', customLightColor: '#68f', temperature: 3500, brightness: 32,
  });
  assert.equal(lightColor(custom), '#6688ff');
  const warm = updateSettings(custom, { lightMode: 'temperature' });
  assert.equal(lightColor(warm), temperatureToHex(3500));
  assert.equal(warm.customLightColor, '#6688ff');
  assert.equal(warm.brightness, 32);
  assert.equal(lightColor(updateSettings(warm, { lightMode: 'custom' })), '#6688ff');
});

test('valid hex inputs normalize and invalid input does not replace the applied color', () => {
  assert.equal(normalizeHex(' F0A '), '#ff00aa');
  assert.equal(normalizeHex('#AAbbCC'), '#aabbcc');
  for (const value of ['', '#', '#12', '#12345g', 'red', '#1234567']) assert.equal(normalizeHex(value), null);
  const state = updateSettings({ ...DEFAULT_SETTINGS }, { wallColor: '#eee', customLightColor: '#00f' });
  const invalid = updateSettings(state, { wallColor: '#oops', customLightColor: '' });
  assert.equal(invalid.wallColor, '#eeeeee');
  assert.equal(invalid.customLightColor, '#0000ff');
  assert.notEqual(invalid, state);
});

test('API guards endpoints and rejects non-finite values', () => {
  const low = updateSettings({ ...DEFAULT_SETTINGS }, { brightness: -5, temperature: 0, wallDistance: -1 });
  assert.equal(low.brightness, 0);
  assert.equal(low.temperature, 1800);
  assert.equal(low.wallDistance, 0.15);
  const high = updateSettings(low, { brightness: 250, temperature: 5000, wallDistance: 5 });
  assert.equal(high.brightness, 200);
  assert.equal(high.temperature, 4000);
  assert.equal(high.wallDistance, 1);
  assert.deepEqual(updateSettings(high, { brightness: NaN, wallDistance: Infinity }), high);
});

test('temperature defaults match custom color and endpoints move toward white', () => {
  assert.equal(DEFAULT_SETTINGS.customLightColor, temperatureToHex(DEFAULT_SETTINGS.temperature));
  assert.match(temperatureToHex(1800), /^#ff[\da-f]{4}$/);
  const warm = parseInt(temperatureToHex(1800).slice(3), 16);
  const cool = parseInt(temperatureToHex(4000).slice(3), 16);
  assert.ok(cool > warm);
  updateSettings({ ...DEFAULT_SETTINGS }, { brightness: 0, wallColor: '#fff' });
  assert.equal(DEFAULT_SETTINGS.brightness, 100);
  assert.equal(DEFAULT_SETTINGS.wallColor, '#303030');
});
