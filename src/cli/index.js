#!/usr/bin/env node

import { Command } from 'commander';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve, dirname, basename, extname } from 'path';
import { Compiler } from '../core/compiler/index.js';
import { listThemes } from '../core/themes/index.js';

const program = new Command();

program
  .name('publisher')
  .description('Markdown + LaTeX publishing pipeline for WeChat and Zhihu')
  .version('0.1.0');

program
  .command('build')
  .description('Compile a Markdown file for a target platform')
  .argument('<file>', 'Markdown file to compile')
  .option('-t, --target <platform>', 'Target platform (wechat, zhihu)', 'wechat')
  .option('--theme <theme>', 'Theme name or CSS file path', 'default')
  .option('-o, --output <file>', 'Output HTML file')
  .action((file, opts) => {
    const source = readFileSync(resolve(file), 'utf-8');
    const baseDir = dirname(resolve(file));
    const compiler = new Compiler();

    const result = compiler.compile(source, {
      theme: opts.theme,
      platform: opts.target,
      baseDir,
    });

    // Determine output path
    const outFile = opts.output || resolve('dist', `${basename(file, extname(file))}.${opts.target}.html`);
    const outDir = dirname(outFile);
    if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

    writeFileSync(outFile, result.html, 'utf-8');

    console.log(`Compiled: ${file} -> ${outFile}`);
    console.log(`Platform: ${opts.target}`);
    console.log(`Theme: ${result.theme.name}`);
    printValidation(result.validation);
  });

program
  .command('validate')
  .description('Validate a Markdown file for a target platform')
  .argument('<file>', 'Markdown file to validate')
  .option('-t, --target <platform>', 'Target platform (wechat, zhihu)', 'wechat')
  .option('--theme <theme>', 'Theme name or CSS file path', 'default')
  .action((file, opts) => {
    const source = readFileSync(resolve(file), 'utf-8');
    const baseDir = dirname(resolve(file));
    const compiler = new Compiler();

    const result = compiler.compile(source, {
      theme: opts.theme,
      platform: opts.target,
      baseDir,
    });

    printValidation(result.validation);
  });

program
  .command('preview')
  .description('Start the local preview server')
  .argument('[file]', 'Markdown file to preview')
  .option('-p, --port <port>', 'Server port', '3000')
  .action((file, opts) => {
    console.log(`To start the preview UI, run: npm run dev`);
    if (file) {
      console.log(`Then open the UI and load: ${resolve(file)}`);
    }
  });

program
  .command('themes')
  .description('List available themes')
  .action(() => {
    const themes = listThemes();
    if (themes.length === 0) {
      console.log('No themes found.');
      return;
    }
    console.log('Available themes:');
    for (const t of themes) {
      console.log(`  - ${t.name} (${t.path})`);
    }
  });

function printValidation(validation) {
  const { stats, warnings, errors } = validation;

  console.log('\nStats:');
  console.log(`  ${stats.paragraphs} paragraphs`);
  console.log(`  ${stats.headings} headings`);
  console.log(`  ${stats.mathTotal} equations (${stats.mathDisplay} display, ${stats.mathInline} inline)`);
  console.log(`  ${stats.images} images`);
  console.log(`  ${stats.codeBlocks} code blocks`);
  console.log(`  ${stats.tables} tables`);
  console.log(`  ${stats.links} links`);

  if (errors.length > 0) {
    console.log('\nERRORS:');
    for (const e of errors) console.log(`  ✗ ${e}`);
  }

  if (warnings.length > 0) {
    console.log('\nWARNINGS:');
    for (const w of warnings) console.log(`  ⚠ ${w}`);
  }

  if (errors.length === 0 && warnings.length === 0) {
    console.log('\n✓ No issues found.');
  }
}

program.parse();
