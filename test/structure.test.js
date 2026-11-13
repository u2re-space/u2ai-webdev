/**
 * @file test/structure.test.js
 * @module test/structure
 * @purpose The tests of the preparation of the code: the sort of the imports, the structural
 *          tasks of a file and of a range, and the tasks of a stylesheet.
 * @depends node:test, node:path, node:fs/promises, structure/imports, structure/structure,
 *          structure/style
 * @ai.tags test, structure
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, writeFile } from 'node:fs/promises';

import { sortImports } from '../src/structure/imports.js';
import { structureText, structureCode, normalizeStructureTasks, languageOf, STRUCTURE_TASKS } from '../src/structure/structure.js';
import { parseStyle, printStyle, styleTasks } from '../src/structure/style.js';

test('the import block is sorted by the groups', () => {
    const source = [
        "import { z } from './z.js';",
        "import { b, a } from 'node:fs';",
        "import './side-effect.js';",
        "export { helper } from './helper.js';",
        '',
        'const x = 1;',
    ].join('\n');
    const sorted = sortImports(source);
    const lines = sorted.split('\n').filter((line) => line.trim());
    assert.match(lines[0], /side-effect/);
    assert.match(lines[1], /node:fs/);
    assert.match(lines[1], /a, b/);
    assert.match(lines[2], /'\.\/z\.js'/);
    assert.match(lines[3], /export \{ helper \}/);
    assert.match(sorted, /const x = 1;/);
});

test('a file without imports is not changed', () => {
    const source = 'const x = 1;\nconst y = 2;\n';
    assert.equal(sortImports(source), source);
});

test('the directives stay above the imports', () => {
    const source = "'use client';\nimport { a } from 'node:fs';\n";
    const sorted = sortImports(source);
    const lines = sorted.split('\n').filter((line) => line.trim());
    assert.match(lines[0], /'use client'/);
    assert.match(lines[1], /node:fs/);
});

test('the tasks of a language are known and the unknown ones are reported', () => {
    const known = normalizeStructureTasks('sort-imports,clean', 'js');
    assert.deepEqual(known.known, ['sort-imports', 'clean']);
    assert.deepEqual(known.unknown, []);

    const unknown = normalizeStructureTasks('sort-imports,rewrite-everything', 'js');
    assert.deepEqual(unknown.unknown, ['rewrite-everything']);

    const css = normalizeStructureTasks(null, 'scss');
    assert.ok(css.known.includes('group-properties'));
    assert.ok(STRUCTURE_TASKS.includes('layers'));
});

test('the language comes from the request, the path or the text', () => {
    assert.equal(languageOf({ language: '.scss' }, ''), 'scss');
    assert.equal(languageOf({ path: 'src/main.ts' }, ''), 'ts');
    assert.equal(languageOf({}, 'import x from "y";'), 'ts');
    assert.equal(languageOf({}, 'a { color: red; }'), 'scss');
    assert.equal(languageOf({}, 'just words'), 'text');
});

test('a selection limits the edit to the range', () => {
    const source = ['// a', 'const b = 2;', '// c', 'const d = 4;'].join('\n');
    const result = structureText(source, {
        tasks: ['sort-lines'],
        selection: { start: { line: 1, character: 0 }, end: { line: 2, character: 11 } },
    });
    assert.match(result.text, /\/\/ a/);
    assert.match(result.text, /const d = 4;/);
    assert.match(result.slice, /const b = 2;/);
});

test('the text is cleaned of the trailing spaces and the empty runs', () => {
    const result = structureText('const a = 1;   \n\n\n\nconst b = 2;   \n', { tasks: ['clean'], language: 'js' });
    assert.equal(result.text, 'const a = 1;\n\nconst b = 2;\n');
});

test('a style task on a script is refused', () => {
    assert.throws(() => structureText('const a = 1;', { tasks: ['dedupe'], language: 'js' }), /CSS или SCSS/);
});

test('the stylesheet is parsed and printed back', () => {
    const css = '.a { color: red; }\n.b { color: blue; }\n';
    const tree = parseStyle(css);
    assert.equal(tree.length, 2);
    assert.equal(tree[0].type, 'rule');
    assert.equal(tree[0].selector, '.a');
    assert.match(printStyle(tree), /\.a \{\n {2}color: red;/);
});

test('the duplicate declarations are dropped and the last one wins', () => {
    const css = '.a { color: red; color: blue; margin: 0; }';
    const tree = styleTasks.dedupe(parseStyle(css));
    const printed = printStyle(tree);
    assert.match(printed, /color: blue;/);
    assert.doesNotMatch(printed, /color: red;/);
});

test('the rules with the same selector are merged', () => {
    const css = '.a { color: red; }\n.a { margin: 0; }';
    const printed = printStyle(styleTasks.merge(parseStyle(css)));
    assert.match(printed, /\.a \{/);
    assert.match(printed, /color: red;/);
    assert.match(printed, /margin: 0;/);
    assert.equal(printed.match(/\.a \{/g).length, 1);
});

test('the rules with the same declarations are grouped into one selector', () => {
    const css = '.a { color: red; }\n.b { color: red; }';
    const printed = printStyle(styleTasks['group-selectors'](parseStyle(css)));
    assert.match(printed, /\.a, \.b \{/);
});

test('the properties are grouped by their kind', () => {
    const css = '.a { color: red; display: flex; position: absolute; }';
    const printed = printStyle(styleTasks['group-properties'](parseStyle(css)));
    const order = printed.match(/position|color|display/g);
    assert.deepEqual(order, ['position', 'display', 'color']);
});

test('the rules are wrapped into the layers', () => {
    const css = 'body { margin: 0; }\n.card { color: red; }\n';
    const printed = printStyle(styleTasks.layers(parseStyle(css), {}));
    assert.match(printed, /@layer base, components, utilities;/);
    assert.match(printed, /@layer base \{/);
    assert.match(printed, /@layer components \{/);
});

test('the structure of a file is written back', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-structure-'));
    await writeFile(path.join(root, 'main.js'), "import { b, a } from 'node:fs';\n", 'utf8');
    const result = await structureCode({
        request: { path: 'main.js', tasks: ['sort-imports'], write: true },
        cwd: root,
    });
    assert.equal(result.changed, true);
    assert.equal(result.path, 'main.js');
    assert.match(result.text, /\{ a, b \}/);
});

test('a path outside the project is refused', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-structure2-'));
    await assert.rejects(() => structureCode({
        request: { path: '../outside.js', tasks: ['clean'] },
        cwd: root,
    }), /вне рабочего каталога/);
});
