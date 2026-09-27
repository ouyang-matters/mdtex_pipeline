import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join, resolve } from 'path';
import { MESSAGES, LOCALE_FILES } from '../src/ui/locales/index.js';
import { resolveLanguage, LANGUAGES } from '../src/ui/i18n.js';

const UI_DIR = resolve(import.meta.dirname, '..', 'src', 'ui');
const LANGS = LANGUAGES.map(l => l.value);

const placeholders = (text) => [...String(text).matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort();

describe('Interface languages', () => {
  it('offers English, Chinese and French', () => {
    expect(LANGS).toEqual(['en', 'zh', 'fr']);
  });

  for (const [area, file] of Object.entries(LOCALE_FILES)) {
    describe(`${area} strings`, () => {
      const english = Object.keys(file.en);

      for (const lang of ['zh', 'fr']) {
        it(`${lang} has exactly the English keys`, () => {
          expect(Object.keys(file[lang]).sort()).toEqual([...english].sort());
        });

        it(`${lang} keeps every placeholder`, () => {
          for (const key of english) {
            const en = file.en[key];
            const other = file[lang][key];
            if (other === undefined) continue;
            expect(typeof other, key).toBe(typeof en);
            if (typeof en === 'string') expect(placeholders(other), key).toEqual(placeholders(en));
          }
        });
      }

      it('has no empty strings', () => {
        for (const lang of LANGS) {
          for (const [key, value] of Object.entries(file[lang])) {
            if (typeof value === 'string') expect(value.trim(), `${lang}.${key}`).not.toBe('');
          }
        }
      });
    });
  }

  it('defines every key the interface asks for', () => {
    // Literal keys only: t('ai.send'), data-i18n="app.compile", and so on.
    const used = new Set();
    const sources = readdirSync(UI_DIR).filter(f => f.endsWith('.js')).map(f => readFileSync(join(UI_DIR, f), 'utf8'));
    sources.push(readFileSync(resolve(UI_DIR, '..', '..', 'index.html'), 'utf8'));
    for (const text of sources) {
      for (const m of text.matchAll(/\bt\(\s*['"]([\w.-]+)['"]/g)) used.add(m[1]);
      for (const m of text.matchAll(/data-i18n(?:-[a-z-]+)?="([\w.-]+)"/g)) used.add(m[1]);
    }
    const missing = [...used].filter(key => !(key in MESSAGES.en)).sort();
    expect(missing).toEqual([]);
  });
});

describe('Choosing the language', () => {
  it('uses an explicit choice', () => {
    expect(resolveLanguage('fr', ['zh-CN'])).toBe('fr');
  });

  it('follows the browser for auto', () => {
    expect(resolveLanguage('auto', ['zh-TW', 'en'])).toBe('zh');
    expect(resolveLanguage('auto', ['fr-CA'])).toBe('fr');
    expect(resolveLanguage(null, ['de-DE', 'en-GB'])).toBe('en');
  });

  it('falls back to English', () => {
    expect(resolveLanguage('auto', ['ja-JP'])).toBe('en');
  });
});
