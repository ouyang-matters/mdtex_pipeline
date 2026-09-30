import { describe, it, expect } from 'vitest';
import { splitFigures, dataUriToBlob } from '../src/ui/zhihu-figures.js';

const PNG = 'data:image/png;base64,iVBORw0KGgo=';
const JPG = 'data:image/jpeg;base64,/9j/4AAQ';

describe('splitFigures', () => {
  it('leaves a placeholder where each embedded figure was, in order', () => {
    const html = `<p>a</p><p><img src="${PNG}" alt="单位球"></p><p>b</p><p><img src='${JPG}' alt="Young &amp; Hölder"></p>`;
    const { html: out, figures } = splitFigures(html);
    expect(out).toBe('<p>a</p><p><strong>〔图 1〕</strong></p><p>b</p><p><strong>〔图 2〕</strong></p>');
    expect(figures.map(f => [f.n, f.src, f.alt, f.placeholder])).toEqual([
      [1, PNG, '单位球', '〔图 1〕'],
      [2, JPG, 'Young & Hölder', '〔图 2〕'],
    ]);
  });

  it('never touches Zhihu formulas or images Zhihu can fetch itself', () => {
    const formula = '<img src="https://www.zhihu.com/equation?tex=x" alt="x" data-tex="x" eeimg="1">';
    const remote = '<img src="https://example.com/a.png" alt="a">';
    const html = `<p>${formula} ${remote}</p>`;
    expect(splitFigures(html)).toEqual({ html, figures: [] });
  });

  it('uses the interface language for the placeholder', () => {
    const { html } = splitFigures(`<img src="${PNG}">`, n => `〔Figure ${n}〕`);
    expect(html).toBe('<strong>〔Figure 1〕</strong>');
  });
});

describe('dataUriToBlob', () => {
  it('keeps the image type and bytes', async () => {
    const blob = dataUriToBlob('data:image/png;base64,AAEC');
    expect(blob.type).toBe('image/png');
    expect([...new Uint8Array(await blob.arrayBuffer())]).toEqual([0, 1, 2]);
  });
});
