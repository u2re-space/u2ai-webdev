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
    missingReferences,
    verifyStyles,
    isViteProject,
    importPath,
    scriptImports,
    ensureStyleImport,
    insertImport,
    removeStyleLink,
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

test('the project of Vite is known by its config and by its manifest', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-vite-'));
    assert.equal(await isViteProject(root), false);

    await writeFile(path.join(root, 'vite.config.js'), 'export default {};\n', 'utf8');
    assert.equal(await isViteProject(root), true);

    const other = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-vite-'));
    await writeFile(path.join(other, 'package.json'), JSON.stringify({
        name: 'demo',
        devDependencies: { vite: '^7.0.0' },
    }, null, 2), 'utf8');
    assert.equal(await isViteProject(other), true);
});

test('the import of the styles is named as the script names it', () => {
    assert.equal(importPath('src/main.js', 'styles/main.scss'), '../styles/main.scss');
    assert.equal(importPath('main.js', 'styles/main.scss'), './styles/main.scss');
    assert.equal(importPath('src/main.js', 'src/styles/main.scss'), './styles/main.scss');
});

test('the import of the styles goes into the script of the project', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-vite-'));
    await mkdir(path.join(root, 'src'), { recursive: true });
    await writeFile(path.join(root, 'src', 'main.js'), "import './app.js';\n", 'utf8');

    const result = await ensureStyleImport(root, 'src/main.js', 'styles/main.scss');

    assert.equal(result.changed, true);
    assert.equal(result.specifier, '../styles/main.scss');
    const text = await readFile(path.join(root, 'src', 'main.js'), 'utf8');
    assert.match(text, /import '\.\.\/styles\/main\.scss';/);
});

test('the import of the styles is not doubled', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-vite-'));
    await mkdir(path.join(root, 'src'), { recursive: true });
    await writeFile(path.join(root, 'src', 'main.js'), "import '../styles/main.scss';\n", 'utf8');

    const result = await ensureStyleImport(root, 'src/main.js', 'styles/main.scss');

    assert.equal(result.already, true);
    assert.equal(result.changed, false);
    const text = await readFile(path.join(root, 'src', 'main.js'), 'utf8');
    assert.equal((text.match(/main\.scss/g) ?? []).length, 1);
});

test('the file with the same name in another folder is not the import of the styles', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-vite-'));
    await mkdir(path.join(root, 'src'), { recursive: true });
    await writeFile(path.join(root, 'src', 'main.js'), "import './domain/main.js';\n", 'utf8');

    const result = await ensureStyleImport(root, 'src/main.js', 'styles/main.scss');

    assert.equal(result.changed, true);
    const text = await readFile(path.join(root, 'src', 'main.js'), 'utf8');
    assert.match(text, /import '\.\.\/styles\/main\.scss';/);
});

test('the imports of a script are found', () => {
    const content = "import './a.js';\nimport { b } from './b.js';\nimport 'sass';\n";

    assert.deepEqual(scriptImports(content), ['./a.js', './b.js', 'sass']);
});

test('the import goes after the imports that are already there', () => {
    const content = "// The entry of the project.\nimport './app.js';\n\nconst x = 1;\n";

    const updated = insertImport(content, './styles/main.scss');

    const lines = updated.split('\n');
    assert.equal(lines[1], "import './app.js';");
    assert.equal(lines[2], "import './styles/main.scss';");
});

test('the link of the markup to the built CSS is removed', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-vite-'));
    await writeFile(path.join(root, 'index.html'),
        '<!doctype html><html><head><link rel="stylesheet" href="./styles/main.css"></head>'
        + '<body><script type="module" src="/src/main.js"></script></body></html>', 'utf8');

    const result = await removeStyleLink(root, 'index.html', 'styles/main.css');

    assert.equal(result.removed, true);
    assert.equal(result.changed, true);
    const text = await readFile(path.join(root, 'index.html'), 'utf8');
    assert.doesNotMatch(text, /main\.css/);
    assert.match(text, /<script type="module" src="\/src\/main\.js"><\/script>/);
});

test('the link of the markup to the source stylesheet is removed as well', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-vite-'));
    await writeFile(path.join(root, 'index.html'),
        '<!doctype html><html><head><link rel="stylesheet" href="/scss/main.scss"></head>'
        + '<body><script type="module" src="/src/main.js"></script></body></html>', 'utf8');

    const result = await removeStyleLink(root, 'index.html', ['scss/main.css', 'scss/main.scss']);

    assert.equal(result.removed, true);
    const text = await readFile(path.join(root, 'index.html'), 'utf8');
    assert.doesNotMatch(text, /main\.scss/);
});

test('the stage gives the styles of a Vite project to the bundler', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-vite-'));
    await mkdir(path.join(root, 'src'), { recursive: true });
    await mkdir(path.join(root, 'styles'), { recursive: true });
    await writeFile(path.join(root, 'vite.config.js'), 'export default {};\n', 'utf8');
    await writeFile(path.join(root, 'index.html'),
        '<!doctype html><html><head><link rel="stylesheet" href="./styles/main.css"></head>'
        + '<body><script type="module" src="/src/main.js"></script></body></html>', 'utf8');
    await writeFile(path.join(root, 'styles', 'main.scss'), '.a { color: red; }\n', 'utf8');
    await writeFile(path.join(root, 'src', 'main.js'), "console.log('hi');\n", 'utf8');
    await fakeSass(root);

    const result = await buildStage({
        root,
        config: { output: { work: './.tmp' } },
        runId: 'run-vite',
    });

    assert.equal(result.ok, true);
    assert.equal(result.build.vite, true);
    // The bundler compiles the SCSS itself: no CSS file is built by the stage.
    assert.deepEqual(result.build.compiled, []);
    // **The script imports the stylesheet.** The bundler compiles a stylesheet only where
    // something imports it: a `<link>` to the source is dropped by the bundler without a
    // word, the build passes, and the page has no styles at all.
    const script = await readFile(path.join(root, 'src', 'main.js'), 'utf8');
    assert.match(script, /import ['"]\.\.\/styles\/main\.scss['"]/);
    // And the markup has no stylesheet link: the import is the one way to the styles.
    const html = await readFile(path.join(root, 'index.html'), 'utf8');
    assert.doesNotMatch(html, /<link rel="stylesheet"/);
    assert.doesNotMatch(html, /main\.css/);
});

test('a project with a bundler gets the styles by the source, and the artifact import goes away', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-vite-artifact-'));
    await mkdir(path.join(root, 'src'), { recursive: true });
    await writeFile(path.join(root, 'vite.config.js'), 'export default {};\n', 'utf8');
    await writeFile(path.join(root, 'index.html'),
        '<!doctype html><html><head><link rel="stylesheet" href="./src/styles.scss"></head>'
        + '<body><script type="module" src="/src/main.js"></script></body></html>', 'utf8');
    await writeFile(path.join(root, 'src', 'styles.scss'), '.a { color: red; }\n', 'utf8');
    await writeFile(path.join(root, 'src', 'styles.css'), '.a { color: red; }\n', 'utf8');
    // The script imports the artifact of the build: it is a file that goes stale.
    await writeFile(path.join(root, 'src', 'main.js'), "import './styles.css';\nconsole.log('hi');\n", 'utf8');
    await fakeSass(root);

    const result = await buildStage({
        root,
        config: { output: { work: './.tmp' } },
        runId: 'run-vite-artifact',
    });

    const script = await readFile(path.join(root, 'src', 'main.js'), 'utf8');
    assert.doesNotMatch(script, /styles\.css/);
    // The import of the source is there instead: it is the one way to the styles.
    assert.match(script, /import ['"]\.\/styles\.scss['"]/);
    // The link to the source goes away from the markup: the bundler drops it silently.
    const html = await readFile(path.join(root, 'index.html'), 'utf8');
    assert.doesNotMatch(html, /<link rel="stylesheet"/);
    assert.match(result.warnings.join(' '), /Импорт артефакта сборки удалён/);
});

test('a project without a bundler loads the compiled css and does not import the source', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-plain-'));
    await mkdir(path.join(root, 'styles'), { recursive: true });
    await mkdir(path.join(root, 'scripts'), { recursive: true });
    // The markup links the source: the browser cannot read scss.
    await writeFile(path.join(root, 'index.html'),
        '<!doctype html><html><head><link rel="stylesheet" href="./styles/main.scss"></head>'
        + '<body><script type="module" src="./scripts/main.js"></script></body></html>', 'utf8');
    await writeFile(path.join(root, 'styles', 'main.scss'), '.a { color: red; }\n', 'utf8');
    // The script imports the source: the browser cannot read it either.
    await writeFile(path.join(root, 'scripts', 'main.js'), "import '../styles/main.scss';\nconsole.log('hi');\n", 'utf8');
    await fakeSass(root);

    const result = await buildStage({
        root,
        config: { output: { work: './.tmp' } },
        runId: 'run-plain',
    });

    // The page loads the compiled css.
    const html = await readFile(path.join(root, 'index.html'), 'utf8');
    assert.doesNotMatch(html, /main\.scss/);
    assert.match(html, /<link rel="stylesheet" href="\.\/styles\/main\.css" \/>/);
    // The script does not import the styles.
    const script = await readFile(path.join(root, 'scripts', 'main.js'), 'utf8');
    assert.doesNotMatch(script, /main\.scss/);
    assert.match(result.warnings.join(' '), /Импорт исходника стилей удалён/);
});

test('the style that a stylesheet uses and that is not there is named', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-build-'));
    await mkdir(path.join(root, 'scss'), { recursive: true });
    await writeFile(path.join(root, 'scss', 'main.scss'), '@use "tokens";\n', 'utf8');

    const missing = await missingReferences(root, ['scss/main.scss'], new Map());
    const result = await buildStage({
        root,
        config: { output: { work: './.tmp' } },
        runId: 'run-missing',
    });

    assert.deepEqual(missing.map((item) => item.ref), ['tokens']);
    assert.deepEqual(missing.map((item) => item.partial), ['scss/_tokens.scss']);
    assert.equal(result.ok, false);
    assert.match(result.warnings.join(' '), /Стиль не найден: scss\/main\.scss → tokens/);
});

test('the styles of a Vite project are checked even though the bundler builds them', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-vite-'));
    await mkdir(path.join(root, 'src'), { recursive: true });
    await mkdir(path.join(root, 'styles'), { recursive: true });
    await writeFile(path.join(root, 'vite.config.js'), 'export default {};\n', 'utf8');
    await writeFile(path.join(root, 'index.html'),
        '<!doctype html><html><head></head><body><script type="module" src="/src/main.js"></script></body></html>', 'utf8');
    await writeFile(path.join(root, 'styles', 'main.scss'), '@use "tokens";\n', 'utf8');
    await writeFile(path.join(root, 'src', 'main.js'), "console.log('hi');\n", 'utf8');
    // A compiler that refuses the file, the way sass does.
    const dir = path.join(root, 'node_modules', '.bin');
    await mkdir(dir, { recursive: true });
    if (process.platform === 'win32') {
        await writeFile(path.join(dir, 'sass.cmd'), '@echo off\r\necho Error: Can\'t find stylesheet to import. 1>&2\r\nexit /b 65\r\n', 'utf8');
    } else {
        const file = path.join(dir, 'sass');
        await writeFile(file, '#!/bin/sh\necho "Error: Can\'t find stylesheet to import." >&2\nexit 65\n', 'utf8');
        await chmod(file, 0o755);
    }

    const result = await buildStage({
        root,
        config: { output: { work: './.tmp' } },
        runId: 'run-vite-broken',
    });

    assert.equal(result.ok, false);
    assert.equal(result.build.errors.length, 1);
    assert.match(result.build.errors[0].message, /find stylesheet/);
});
