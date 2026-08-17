#!/usr/bin/env node

/**
 * Self-test: compile the fixture article for both platforms and verify content counts.
 * Used by install.sh, `publisher doctor`, and `publisher update`.
 */

import { readFileSync, existsSync } from 'fs';
import { resolve, join } from 'path';

const appRoot = resolve(import.meta.dirname, '..');
const fixturePath = join(appRoot, 'tests', 'fixtures', 'math_article.md');

async function runSelftest() {
  const results = [];
  let allPassed = true;

  function check(label, condition) {
    if (condition) {
      results.push({ label, passed: true });
    } else {
      results.push({ label, passed: false });
      allPassed = false;
    }
  }

  // 1. Check fixture exists
  check('Fixture article exists', existsSync(fixturePath));
  if (!existsSync(fixturePath)) {
    return { passed: false, results };
  }

  const source = readFileSync(fixturePath, 'utf-8');

  // 2. Markdown parser
  try {
    const { renderMarkdown } = await import('../src/core/parser/index.js');
    const html = renderMarkdown('# Test\n\nHello $x^2$.');
    check('Markdown parser', html.includes('<h1>') && html.includes('Test'));
  } catch (e) {
    check('Markdown parser', false);
  }

  // 3. KaTeX renderer
  try {
    const { renderLatex } = await import('../src/core/math/index.js');
    const node = renderLatex('E = mc^2', false);
    check('KaTeX renderer', node.error === null && node.renderedHtml.includes('katex'));
  } catch (e) {
    check('KaTeX renderer', false);
  }

  // 4. CSS inliner
  try {
    const { inlineCss } = await import('../src/core/compiler/css-inliner.js');
    const result = inlineCss('<div id="nice"><p>Test</p></div>', '#nice p { color: red; }');
    check('CSS inliner (juice)', result.includes('color: red') || result.includes('color:red'));
  } catch (e) {
    check('CSS inliner (juice)', false);
  }

  // 5. Syntax highlighter
  try {
    const { highlightCode } = await import('../src/core/code/index.js');
    const { html } = highlightCode('print("hi")', 'python');
    check('Syntax highlighter', html.includes('print'));
  } catch (e) {
    check('Syntax highlighter', false);
  }

  // 6. Compile fixture for WeChat
  try {
    const { Compiler } = await import('../src/core/compiler/index.js');
    const compiler = new Compiler();
    const result = await compiler.compile(source, {
      theme: 'default',
      platform: 'wechat',
      baseDir: join(appRoot, 'tests', 'fixtures'),
    });

    check('WeChat adapter', !!result.html);
    check('WeChat: headings preserved', result.validation.stats.headings > 0);
    check('WeChat: paragraphs preserved', result.validation.stats.paragraphs > 0);
    check('WeChat: math preserved', result.validation.stats.mathTotal > 0);
    check('WeChat: code blocks preserved', result.validation.stats.codeBlocks > 0);
    check('WeChat: tables preserved', result.validation.stats.tables > 0);
    check('WeChat: CSS inlined', !result.html.includes('<style>'));
    check('WeChat: no empty output', result.html.length > 500);
    check('WeChat: formulas as images', /data-latex=/.test(result.html));
    check('WeChat: no KaTeX HTML', !/<eq>/.test(result.html) && !/<eqn>/.test(result.html));
    check('WeChat: no KaTeX CSS dependency', !/<annotation/.test(result.html));
    check('WeChat: formula rendering errors', result.mathResult.errors === 0);
  } catch (e) {
    check('WeChat adapter', false);
  }

  // 7. Compile fixture for Zhihu
  try {
    const { Compiler } = await import('../src/core/compiler/index.js');
    const compiler = new Compiler();
    const result = await compiler.compile(source, {
      theme: 'default',
      platform: 'zhihu',
      baseDir: join(appRoot, 'tests', 'fixtures'),
    });

    check('Zhihu adapter', !!result.html);
    check('Zhihu: headings preserved', result.validation.stats.headings > 0);
    check('Zhihu: paragraphs preserved', result.validation.stats.paragraphs > 0);
    check('Zhihu: no empty output', result.html.length > 500);
  } catch (e) {
    check('Zhihu adapter', false);
  }

  return { passed: allPassed, results };
}

// If run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const { passed, results } = await runSelftest();
  for (const r of results) {
    console.log(`  ${r.passed ? '✓' : '✗'} ${r.label}`);
  }
  process.exit(passed ? 0 : 1);
}

export { runSelftest };
