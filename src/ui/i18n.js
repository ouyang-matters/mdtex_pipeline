import { MESSAGES } from './locales/index.js';

/**
 * Interface language.
 *
 * Every string the interface shows comes from here, by key, so a language is a
 * complete set of those keys rather than a scattering of translated literals.
 * The locale files are checked by tests/i18n.test.js: every language has every
 * key, with the same placeholders, so a missing or mistyped translation fails
 * the build instead of showing up as English in the middle of a French page.
 *
 * The chosen language is a preference stored by the backend. It is mirrored in
 * localStorage only so that the loading screen, which runs before preferences
 * arrive, can already speak the right language.
 */

export const LANGUAGES = [
  { value: 'en', label: 'English', htmlLang: 'en' },
  { value: 'zh', label: '中文（简体）', htmlLang: 'zh-CN' },
  { value: 'fr', label: 'Français', htmlLang: 'fr' },
];

const SUPPORTED = new Set(LANGUAGES.map(l => l.value));
const STORAGE_KEY = 'mdtex.language';

/**
 * The language a preference means on this machine. `auto` (or nothing) follows
 * the browser's own language list, and falls back to English.
 */
export function resolveLanguage(preference, browserLanguages = navigatorLanguages()) {
  if (SUPPORTED.has(preference)) return preference;
  for (const tag of browserLanguages) {
    const base = String(tag).toLowerCase().split('-')[0];
    if (SUPPORTED.has(base)) return base;
  }
  return 'en';
}

function navigatorLanguages() {
  if (typeof navigator === 'undefined') return [];
  return navigator.languages?.length ? navigator.languages : [navigator.language].filter(Boolean);
}

function storedPreference() {
  try { return localStorage.getItem(STORAGE_KEY); } catch { return null; }
}

let current = resolveLanguage(storedPreference());

export function getLanguage() {
  return current;
}

/**
 * Adopt the language for a preference value ('auto', 'en', 'zh', 'fr').
 * Returns true when the language actually changed.
 */
export function setLanguagePreference(preference) {
  try { localStorage.setItem(STORAGE_KEY, preference || 'auto'); } catch { /* private mode */ }
  const next = resolveLanguage(preference);
  const changed = next !== current;
  current = next;
  if (typeof document !== 'undefined') {
    document.documentElement.lang = LANGUAGES.find(l => l.value === current)?.htmlLang || 'en';
  }
  return changed;
}

/**
 * Look a string up by key and fill its {placeholders}.
 *
 * A message may also be a function of the variables, for plurals and other
 * grammar a template cannot express. A key missing from the current language
 * falls back to English, then to the key itself, so a gap is visible rather
 * than blank.
 */
export function t(key, vars = {}) {
  const message = MESSAGES[current]?.[key] ?? MESSAGES.en[key] ?? key;
  const text = typeof message === 'function' ? message(vars) : message;
  return String(text).replace(/\{(\w+)\}/g, (whole, name) => (name in vars ? String(vars[name]) : whole));
}

/**
 * Translate the static markup in index.html.
 *
 *   data-i18n               → textContent
 *   data-i18n-title         → title
 *   data-i18n-placeholder   → placeholder
 *   data-i18n-aria-label    → aria-label
 *
 * each holding a key, e.g. data-i18n=app.compile.
 */
export function translateDom(root = document) {
  for (const node of root.querySelectorAll('[data-i18n]')) node.textContent = t(node.dataset.i18n);
  for (const node of root.querySelectorAll('[data-i18n-title]')) node.title = t(node.dataset.i18nTitle);
  for (const node of root.querySelectorAll('[data-i18n-placeholder]')) node.placeholder = t(node.dataset.i18nPlaceholder);
  for (const node of root.querySelectorAll('[data-i18n-aria-label]')) {
    node.setAttribute('aria-label', t(node.dataset.i18nAriaLabel));
  }
}
