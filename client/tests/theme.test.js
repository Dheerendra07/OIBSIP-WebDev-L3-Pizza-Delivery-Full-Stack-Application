import test from 'node:test';
import assert from 'node:assert/strict';
import { THEME_STORAGE_KEY, normalizeTheme, readThemePreference, nextTheme } from '../src/theme.js';

test('light is the safe default and unknown preferences never enable night mode', () => {
  assert.equal(normalizeTheme(null), 'light');
  assert.equal(normalizeTheme('system'), 'light');
  assert.equal(normalizeTheme('LIGHT'), 'light');
  assert.equal(readThemePreference(null), 'light');
  assert.equal(readThemePreference({ getItem: () => null }), 'light');
});

test('saved night mode is restored from the dedicated preference key', () => {
  let requestedKey = '';
  const storage = { getItem(key) { requestedKey = key; return 'dark'; } };
  assert.equal(readThemePreference(storage), 'dark');
  assert.equal(requestedKey, THEME_STORAGE_KEY);
});

test('storage failures remain non-fatal and keep the light theme', () => {
  assert.equal(readThemePreference({ getItem() { throw new Error('blocked storage'); } }), 'light');
});

test('theme toggle cycles between light and dark', () => {
  assert.equal(nextTheme('light'), 'dark');
  assert.equal(nextTheme('dark'), 'light');
  assert.equal(nextTheme('unexpected'), 'dark');
});
