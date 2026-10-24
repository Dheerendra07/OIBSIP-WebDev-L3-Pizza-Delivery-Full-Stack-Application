export const THEME_STORAGE_KEY = 'pizza-house-theme';

export function normalizeTheme(value) {
  return value === 'dark' ? 'dark' : 'light';
}

export function readThemePreference(storage) {
  try {
    return normalizeTheme(storage?.getItem(THEME_STORAGE_KEY));
  } catch {
    return 'light';
  }
}

export function nextTheme(current) {
  return normalizeTheme(current) === 'dark' ? 'light' : 'dark';
}
