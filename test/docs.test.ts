import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolveModel } from '../src/models.js';
import { catalog } from './models.test.js';

// docs/models.md links each mapping to its defining lines as [`symbol`](../file#Lx-Ly).
// Keep those links and the examples table honest as the code moves.
const doc = await readFile('docs/models.md', 'utf8');

test('every code link in docs/models.md points at the symbol it names', async () => {
  const links = [...doc.matchAll(/\[`((?:[^`\\]|\\.)+)`\]\(\.\.\/([^)#\s]+)#L(\d+)(?:-L(\d+))?\)/g)];
  assert.ok(links.length >= 25, `only ${links.length} code links found`);
  for (const [, text, file, from, to] of links) {
    if (text === file) continue;
    const lines = (await readFile(file!, 'utf8')).split('\n').slice(Number(from) - 1, Number(to ?? from)).join('\n');
    assert.ok(lines.includes(text!.replace(/\\\|/g, '|')), `${file}#L${from}${to ? `-L${to}` : ''} no longer contains \`${text}\``);
  }
});

test('every example in docs/models.md resolves as documented', () => {
  const section = doc.split('\n## Examples\n')[1]!.split('\n## ')[0]!;
  const errors: Record<string, RegExp> = { ambiguous: /ambiguous across vendors/, 'no match': /matches no Kimi, GLM or DeepSeek/, 'invalid selector': /is not valid/ };
  let checked = 0;
  for (const row of section.split('\n').filter(l => l.startsWith('| `'))) {
    const [selectors, result] = row.slice(2, -2).split(' | ') as [string, string];
    const id = result.match(/^`([^`]+)`$/)?.[1];
    for (const [, selector] of selectors.matchAll(/`([^`]+)`/g)) {
      const resolved = resolveModel(selector!, catalog);
      if (id) assert.deepEqual(resolved, { id }, selector);
      else {
        const kind = result.match(/^Error: (ambiguous|no match|invalid selector)\./)?.[1];
        assert.ok(kind && 'error' in resolved && errors[kind]!.test(resolved.error), `${selector}: ${JSON.stringify(resolved)}`);
      }
      checked++;
    }
  }
  assert.equal(checked, 38);
});
