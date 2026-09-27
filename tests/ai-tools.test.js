import { describe, it, expect } from 'vitest';
import { ToolExecutor } from '../src/ai/tools.js';
import { scopePermissions } from '../src/ai/session.js';

const executor = (source) => new ToolExecutor({ source, permissions: scopePermissions('content') });

describe('apply_patch', () => {
  it('writes the model’s text exactly, dollar signs included', async () => {
    // String.replace would read `$$` in the replacement as a single `$`, and
    // `$&`, `$'` and `` $` `` as parts of the match — silently rewriting math.
    const tools = executor('Before\n\nOLD\n\nAfter\n');
    const replacement = "$$\nX = \\frac{\\partial}{\\partial x}\n$$\n\nliteral $& and $' and $` stay";

    const result = await tools.run('apply_patch', { old_text: 'OLD', new_text: replacement });

    expect(result.ok).toBe(true);
    expect(tools.source).toBe(`Before\n\n${replacement}\n\nAfter\n`);
  });

  it('still refuses an ambiguous match', async () => {
    const source = '$$\na\n$$\n\n$$\nb\n$$\n';
    const tools = executor(source);
    const result = await tools.run('apply_patch', { old_text: '$$', new_text: '$$$' });
    expect(result.error).toMatch(/Include more surrounding context/);
    expect(tools.source).toBe(source);
  });
});
