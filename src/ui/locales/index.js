/**
 * All interface strings, merged from one file per area of the interface.
 *
 * Each file exports `{ en: {...}, zh: {...}, fr: {...} }` with keys prefixed by
 * its area (`ai.`, `library.`, …), so files never collide and can be edited
 * independently. tests/i18n.test.js holds them to the same key set.
 */
import app from './app.js';
import ai from './ai.js';
import library from './library.js';
import settings from './settings.js';
import editor from './editor.js';

export const LOCALE_FILES = { app, ai, library, settings, editor };

export const MESSAGES = { en: {}, zh: {}, fr: {} };

for (const [area, file] of Object.entries(LOCALE_FILES)) {
  for (const lang of Object.keys(MESSAGES)) {
    for (const [key, value] of Object.entries(file[lang] || {})) {
      if (key in MESSAGES[lang]) throw new Error(`Duplicate interface string "${key}" (${area}, ${lang})`);
      MESSAGES[lang][key] = value;
    }
  }
}
