/**
 * @file test/build.test.js
 * @module test/build
 * @purpose The tests of the stage of the build: the styles are connected and the project works.
 * @depends node:test, node:path, node:fs/promises, stages/build
 * @ai.tags test, stages, build, styles
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { chmod, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';

import {
    partitionStyles,
    primaryEntry,
    insertUses,
    ensureUses,
    htmlRefs,
    ensureHtmlWiring,
    compileStyles,
    buildStage,
} from '../src/stages/build.js';

/**
 * A compiler of the stylesheets that writes the output file: the test does not need sass.
 * @param {string} root
 * @returns {Promise<string>} the directory with the compiler
 */
async function fakeSass(root) {
    const dir = path.join(root, 'node_modules', '.bin');
    await mkdir(dir, { recursive: true });
    if (process.platform === 'win32') {
        await writeFile(
            path.join(dir, 'sass.cmd'),
            '@echo off\r\necho /* compiled */ > %3\r\n',
            'utf8',
        );
    } else {
        const file = path.join(dir, 'sass');
        await writeFile(file, '#!/bin/sh\necho "/* compiled */" > "$3"\n', 'utf8');
        await chmod(file, 0o755);
    }
    return dir;
}

test('the entry point is the stylesheet that nobody uses', () => {
    const files = ['styles/main.scss', 'styles/_tokens.scss', 'styles/_layout.scss'];
    const contents = new Map([
        ['styles/main.scss', "@use './tokens';\n@use './layout';\n"],
        ['styles/_tokens.scss', ':root { --a: 1; }\n'],
        ['styles/_layout.scss', '.a { color: red; }\n'],
    ]);

    const styles = partitionStyles(files, contents);

    assert.deepEqual(styles.entries, ['styles/main.scss']);
    assert.deepEqual(styles.partials, ['styles/_tokens.scss', 'styles/_layout.scss']);
    assert.deepEqual(styles.orphans, []);
});

test('a partial that nobody uses is an orphan', () => {
    const files = ['styles/main.scss', 'styles/_tokens.scss', 'styles/_buttons.scss'];
    const contents = new Map([
        ['styles/main.scss', "@use './tokens';\n"],
        ['styles/_tokens.scss', ':root { --a: 1; }\n'],
        ['styles/_buttons.scss', '.b { color: red; }\n'],
    ]);

    const styles = partitionStyles(files, contents);

    assert.deepEqual(styles.orphans, ['styles/_buttons.scss']);
});

test('the entry point of the styles is the one with the main name', () => {
    assert.equal(primaryEntry(['styles/theme.scss', 'styles/main.scss']), 'styles/main.scss');
    assert.equal(primaryEntry([]), null);
});

test('the missing use goes after the last use of the file', () => {
    const content = "// The styles of the page.\n@use './tokens';\n\n.a { color: red; }\n";

    const updated = insertUses(content, ['./buttons']);

    const lines = updated.split('\n');
    assert.equal(lines[0], "// The styles of the page.");
    assert.equal(lines[1], "@use './tokens';");
    assert.equal(lines[2], "@use './buttons';");
    assert.match(updated, /\.a \{ color: red; \}/);
});

test('the orphan partial is connected to the entry point', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-build-'));
    await mkdir(path.join(root, 'styles'), { recursive: true });
    await writeFile(path.join(root, 'styles', 'main.scss'), "@use './tokens';\n", 'utf8');
    await writeFile(path.join(root, 'styles', '_tokens.scss'), ':root { --a: 1; }\n', 'utf8');
    await writeFile(path.join(root, 'styles', '_buttons.scss'), '.b { color: red; }\n', 'utf8');

    const result = await ensureUses(root, { entries: ['styles/main.scss'], orphans: ['styles/_buttons.scss'] });

    assert.equal(result.added.length, 1);
    const text = await readFile(path.join(root, 'styles', 'main.scss'), 'utf8');
    assert.match(text, /@use '\.\/buttons';/);
});

test('the links of the markup are found', () => {
    const html = '<html><head><link rel="stylesheet" href="./styles/main.css"></head>'
        + '<body><script type="module" src="./scripts/main.js"></script></body></html>';

    const refs = htmlRefs(html);

    assert.deepEqual(refs.styles, ['./styles/main.css']);
    assert.deepEqual(refs.scripts, ['./scripts/main.js']);
});

test('the missing link of the styles is added', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-build-'));
    await writeFile(path.join(root, 'index.html'), '<html><head></head><body></body></html>', 'utf8');

    const result = await ensureHtmlWiring(root, 'index.html', {
        styles: ['styles/main.css'],
        script: 'scripts/main.js',
    });

    assert.equal(result.changed, true);
    const text = await readFile(path.join(root, 'index.html'), 'utf8');
    assert.match(text, /<link rel="stylesheet" href="\.\/styles\/main\.css" \/>/);
    assert.match(text, /<script type="module" src="\.\/scripts\/main\.js"><\/script>/);
});

test('the link of the markup that points at nothing is reported', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-build-'));
    await writeFile(path.join(root, 'index.html'), '<html><head><link rel="stylesheet" href="./styles/main.css"></head><body></body></html>', 'utf8');

    const result = await ensureHtmlWiring(root, 'index.html', {});

    assert.deepEqual(result.missing, ['styles/main.css']);
    assert.equal(result.changed, false);
});

test('without a compiler the styles are not built, and it is said', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-build-'));
    const empty = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-empty-'));

    const result = await compileStyles(root, [{ source: 'styles/main.scss', output: 'styles/main.css' }], {
        env: { PATH: empty },
    });

    assert.deepEqual(result.compiled, []);
    assert.match(result.note, /sass не найден/);
});

test('the styles are built with the compiler of the project', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-build-'));
    await mkdir(path.join(root, 'styles'), { recursive: true });
    await writeFile(path.join(root, 'styles', 'main.scss'), '.a { color: red; }\n', 'utf8');
    await fakeSass(root);

    const result = await compileStyles(root, [{ source: 'styles/main.scss', output: 'styles/main.css' }]);

    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.compiled, ['styles/main.css']);
    assert.match(await readFile(path.join(root, 'styles', 'main.css'), 'utf8'), /compiled/);
});

test('a stylesheet that does not compile leaves no file behind', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-build-'));
    await mkdir(path.join(root, 'styles'), { recursive: true });
    await writeFile(path.join(root, 'styles', 'main.scss'), '.a { color: red;\n', 'utf8');
    // A compiler that writes the error into the output file, the way sass does.
    const dir = path.join(root, 'node_modules', '.bin');
    await mkdir(dir, { recursive: true });
    if (process.platform === 'win32') {
        await writeFile(path.join(dir, 'sass.cmd'), '@echo off\r\necho /* Error: expected "{". */ > %3\r\nexit /b 65\r\n', 'utf8');
    } else {
        const file = path.join(dir, 'sass');
        await writeFile(file, '#!/bin/sh\necho "/* Error */" > "$3"\nexit 65\n', 'utf8');
        await chmod(file, 0o755);
    }

    const result = await compileStyles(root, [{ source: 'styles/main.scss', output: 'styles/main.css' }]);

    assert.equal(result.compiled.length, 0);
    assert.equal(result.errors.length, 1);
    // The broken stylesheet is gone: a file with an error inside is worse than no file.
    assert.equal(await readFile(path.join(root, 'styles', 'main.css'), 'utf8').catch(() => null), null);
});

test('the stage builds the styles and keeps the link of the markup', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-build-'));
    await mkdir(path.join(root, 'styles'), { recursive: true });
    await mkdir(path.join(root, 'scripts'), { recursive: true });
    await writeFile(path.join(root, 'index.html'),
        '<!doctype html><html><head><link rel="stylesheet" href="./styles/main.css"></head>'
        + '<body><script type="module" src="./scripts/main.js"></script></body></html>', 'utf8');
    await writeFile(path.join(root, 'styles', 'main.scss'), "@use './tokens';\n.a { color: red; }\n", 'utf8');
    await writeFile(path.join(root, 'styles', '_tokens.scss'), ':root { --a: 1; }\n', 'utf8');
    await writeFile(path.join(root, 'scripts', 'main.js'), 'export const x = 1;\n', 'utf8');
    await fakeSass(root);

    const result = await buildStage({
        root,
        config: { output: { work: './.tmp' } },
        runId: 'run-build',
    });

    assert.equal(result.ok, true);
    assert.deepEqual(result.build.compiled, ['styles/main.css']);
    assert.deepEqual(result.build.added, []);
    // The link of the markup is not doubled.
    const text = await readFile(path.join(root, 'index.html'), 'utf8');
    assert.equal((text.match(/<link rel="stylesheet"/g) ?? []).length, 1);
});

test('the stage connects the styles when the markup forgot the link', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-build-'));
    await mkdir(path.join(root, 'styles'), { recursive: true });
    await writeFile(path.join(root, 'index.html'), '<!doctype html><html><head></head><body></body></html>', 'utf8');
    await writeFile(path.join(root, 'styles', 'main.scss'), '.a { color: red; }\n', 'utf8');
    await fakeSass(root);

    const result = await buildStage({
        root,
        config: { output: { work: './.tmp' } },
        runId: 'run-build2',
    });

    assert.equal(result.ok, true);
    assert.deepEqual(result.build.added, ['styles/main.css']);
    const text = await readFile(path.join(root, 'index.html'), 'utf8');
    assert.match(text, /<link rel="stylesheet" href="\.\/styles\/main\.css" \/>/);
});
