/**
 * @file test/syntax.test.js
 * @module test/syntax
 * @purpose The tests of the syntax check: the scripts of the node and the stylesheets of sass.
 * @depends node:test, node:path, node:fs/promises, agent/syntax
 * @ai.tags test, tools, syntax
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { chmod, mkdir, mkdtemp, writeFile } from 'node:fs/promises';

import { checkFile, checkFiles, checkableFile, findSass, styleImportCandidates, missingStyleReferences, missingPartials, partialName } from '../src/agent/syntax.js';

/**
 * A compiler of the stylesheets that always refuses the file: the test does not need sass.
 * @param {string} root
 * @returns {Promise<string>} the directory with the compiler
 */
async function fakeSass(root) {
    const dir = path.join(root, 'bin');
    await mkdir(dir, { recursive: true });
    if (process.platform === 'win32') {
        await writeFile(
            path.join(dir, 'sass.cmd'),
            '@echo off\r\necho Error: expected end of rule. 1>&2\r\nexit /b 65\r\n',
            'utf8',
        );
    } else {
        const file = path.join(dir, 'sass');
        await writeFile(file, '#!/bin/sh\necho "Error: expected end of rule." >&2\nexit 65\n', 'utf8');
        await chmod(file, 0o755);
    }
    return dir;
}

test('only the files of a known kind are checked', () => {
    assert.equal(checkableFile('src/main.js'), true);
    assert.equal(checkableFile('scss/main.scss'), true);
    assert.equal(checkableFile('index.html'), false);
    assert.equal(checkableFile('notes.md'), false);
});

test('a script with a lost quote does not pass', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-syntax-'));
    await mkdir(path.join(root, 'src'), { recursive: true });
    await writeFile(path.join(root, 'src', 'main.js'), "const s = 'abc\nconst t = 1;\n", 'utf8');

    const result = await checkFile(root, 'src/main.js');

    assert.equal(result.ok, false);
    assert.equal(result.errors.length, 1);
    assert.match(result.errors[0], /SyntaxError/);
});

test('a script of a module passes', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-syntax-'));
    await mkdir(path.join(root, 'src'), { recursive: true });
    await writeFile(path.join(root, 'src', 'main.js'), 'export const x = 1;\n', 'utf8');

    const result = await checkFile(root, 'src/main.js');

    assert.equal(result.ok, true);
    assert.deepEqual(result.errors, []);
});

test('a stylesheet that does not compile does not pass', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-syntax-'));
    await mkdir(path.join(root, 'scss'), { recursive: true });
    await writeFile(path.join(root, 'scss', 'main.scss'), '.a { color: red;\n', 'utf8');
    const dir = await fakeSass(root);
    const env = { ...process.env, PATH: `${dir}${path.delimiter}${process.env.PATH ?? ''}` };

    const result = await checkFile(root, 'scss/main.scss', { env });

    assert.equal(result.ok, false);
    assert.match(result.errors.join(' '), /expected end of rule/);
});

test('without a compiler the styles are not checked, and it is said', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-syntax-'));
    await mkdir(path.join(root, 'scss'), { recursive: true });
    await writeFile(path.join(root, 'scss', 'main.scss'), '.a { color: red;\n', 'utf8');
    const empty = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-empty-'));

    const found = await findSass(root, { PATH: empty });
    const result = await checkFile(root, 'scss/main.scss', { env: { PATH: empty } });

    assert.equal(found, null);
    assert.equal(result.ok, true);
    assert.match(result.note, /sass не найден/);
});

test('the check of the files of a step names the file and the error', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-syntax-'));
    await mkdir(path.join(root, 'src'), { recursive: true });
    await writeFile(path.join(root, 'src', 'main.js'), 'const x = ;\n', 'utf8');
    await writeFile(path.join(root, 'src', 'other.js'), 'export const y = 2;\n', 'utf8');

    const result = await checkFiles(root, ['src/main.js', 'src/other.js', 'index.html']);

    assert.deepEqual(result.checked, ['src/main.js', 'src/other.js']);
    assert.equal(result.errors.length, 1);
    assert.equal(result.errors[0].file, 'src/main.js');
});

test('the files that a stylesheet may point to are the files of Sass', () => {
    const candidates = styleImportCandidates('scss/main.scss', 'tokens');

    assert.ok(candidates.includes('scss/tokens.scss'));
    assert.ok(candidates.includes('scss/_tokens.scss'));
    assert.ok(candidates.includes('scss/tokens/_index.scss'));
});

test('the stylesheet that uses a file that is not there does not pass', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-syntax-'));
    await mkdir(path.join(root, 'scss'), { recursive: true });
    await writeFile(path.join(root, 'scss', 'main.scss'), '@use "tokens";\n', 'utf8');

    const missing = await missingStyleReferences(root, 'scss/main.scss');
    const result = await checkFile(root, 'scss/main.scss');

    assert.deepEqual(missing.map((item) => item.ref), ['tokens']);
    assert.equal(result.ok, false);
    assert.match(result.errors.join(' '), /Файл стилей не найден: tokens \(scss\/tokens\.scss\)/);
});

test('the stylesheet that uses a file that is there passes', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-syntax-'));
    await mkdir(path.join(root, 'scss'), { recursive: true });
    await writeFile(path.join(root, 'scss', 'main.scss'), '@use "tokens";\n', 'utf8');
    await writeFile(path.join(root, 'scss', '_tokens.scss'), ':root { --a: 1; }\n', 'utf8');
    const empty = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-empty-'));

    const result = await checkFile(root, 'scss/main.scss', { env: { PATH: empty } });

    assert.equal(result.ok, true);
    assert.deepEqual(result.errors, []);
});

test('the built-in module of Sass is not a missing file', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-syntax-'));
    await mkdir(path.join(root, 'scss'), { recursive: true });
    await writeFile(path.join(root, 'scss', 'main.scss'), '@use "sass:math";\n@import "other.css";\n', 'utf8');
    const empty = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-empty-'));

    const missing = await missingStyleReferences(root, 'scss/main.scss');
    const result = await checkFile(root, 'scss/main.scss', { env: { PATH: empty } });

    assert.deepEqual(missing, []);
    assert.equal(result.ok, true);
});

test('the styles of a package of the project are not a missing file', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-syntax-'));
    await mkdir(path.join(root, 'scss'), { recursive: true });
    await mkdir(path.join(root, 'node_modules', 'ui', 'scss'), { recursive: true });
    await writeFile(path.join(root, 'scss', 'main.scss'), '@use "ui/scss/buttons";\n', 'utf8');
    await writeFile(path.join(root, 'node_modules', 'ui', 'scss', '_buttons.scss'), '.a { color: red; }\n', 'utf8');
    const empty = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-empty-'));

    const missing = await missingStyleReferences(root, 'scss/main.scss');
    const result = await checkFile(root, 'scss/main.scss', { env: { PATH: empty } });

    assert.deepEqual(missing, []);
    assert.equal(result.ok, true);
});

test('the missing partials are named with the path they have to be written under', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-syntax-'));
    await mkdir(path.join(root, 'src'), { recursive: true });
    await writeFile(path.join(root, 'src', 'styles.scss'), "@use 'variables';\n@use 'base';\n", 'utf8');

    const missing = await missingPartials(root, ['src/styles.scss']);

    assert.deepEqual(missing.map((item) => item.ref), ['variables', 'base']);
    assert.deepEqual(missing.map((item) => item.partial), ['src/_variables.scss', 'src/_base.scss']);
    assert.equal(missing[0].file, 'src/styles.scss');
});

test('the name of a partial is the name with the underscore', () => {
    assert.equal(partialName('src/variables.scss'), 'src/_variables.scss');
    assert.equal(partialName('src/_variables.scss'), 'src/_variables.scss');
    assert.equal(partialName('variables.scss'), '_variables.scss');
    assert.equal(partialName(''), '');
});

test('the partials that are on the disk are not missing', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-syntax-'));
    await mkdir(path.join(root, 'src'), { recursive: true });
    await writeFile(path.join(root, 'src', 'styles.scss'), "@use 'variables';\n", 'utf8');
    await writeFile(path.join(root, 'src', '_variables.scss'), ':root { --a: 1; }\n', 'utf8');

    const missing = await missingPartials(root, ['src/styles.scss']);

    assert.deepEqual(missing, []);
});
