/**
 * @file test/tools.test.js
 * @module test/tools
 * @purpose The tests of the agent tools: the file operations, the backups, the limits of the
 *          working directory and the bridges.
 * @depends node:test, node:http, agent/tools, agent/quality, agent/pace, config
 * @ai.tags test, tools
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

import { createToolset, htmlToText, BLOCKING_COMMANDS } from '../src/agent/tools.js';
import { runBridge } from '../src/agent/bridges.js';
import { TOOL_SPECS } from '../src/agent/tool-specs.js';
import { normalizeVerdict, verdictFromScores } from '../src/agent/quality.js';
import { resolvePace, effortFor } from '../src/agent/pace.js';
import { defaults } from '../src/config.js';

/**
 * A working directory with one file in it.
 * @returns {Promise<{ root: string, config: object, tools: object }>}
 */
async function workspace() {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-tools-'));
    await mkdir(path.join(root, 'src'), { recursive: true });
    const config = structuredClone(defaults);
    return { root, config, tools: createToolset({ root, config }) };
}

test('the toolset writes, reads and replaces a file', async () => {
    const { root, tools } = await workspace();
    await tools.execute('write_file', { path: 'src/index.html', content: '<h1>hi</h1>' });
    const read = await tools.execute('read_file', { path: 'src/index.html' });
    assert.match(read, /<h1>hi<\/h1>/);
    const replaced = await tools.execute('replace_text', {
        path: 'src/index.html',
        search: 'hi',
        replacement: 'hello',
    });
    assert.match(replaced, /Заменено/);
    const body = await readFile(path.join(root, 'src/index.html'), 'utf8');
    assert.equal(body, '<h1>hello</h1>');
});

test('read_file attaches an image as a visual input instead of rejecting it as binary', async () => {
    const { root, tools } = await workspace();
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jYuoAAAAASUVORK5CYII=', 'base64');
    await writeFile(path.join(root, 'src', 'reference.png'), png);

    const result = await tools.execute('read_file', { path: 'src/reference.png' });

    assert.match(result, /Изображение src\/reference\.png приложено к запросу/);
    assert.doesNotMatch(result, /Бинарный файл/);
});

test('the search shows the lines around a hit and drops the excluded files', async () => {
    const { root, tools } = await workspace();
    await writeFile(path.join(root, 'src', 'a.js'), 'one\ntwo\ntarget\nfour\nfive\n', 'utf8');
    await writeFile(path.join(root, 'src', 'b.js'), 'target\n', 'utf8');
    await writeFile(path.join(root, 'src', 'b.min.js'), 'target\n', 'utf8');

    const around = await tools.execute('search_files', { query: 'target', context: 1 });
    assert.match(around, /src\/a\.js:3: target/);
    // The lines around the hit are marked with a dash: they are the context, not the hit.
    assert.match(around, /src\/a\.js:2- two/);
    assert.match(around, /src\/a\.js:4- four/);

    const dropped = await tools.execute('search_files', { query: 'target', exclude: ['*.min.js'] });
    assert.doesNotMatch(dropped, /b\.min\.js/);
    assert.match(dropped, /b\.js/);
});

test('the search respects the case when it is asked to', async () => {
    const { root, tools } = await workspace();
    await writeFile(path.join(root, 'src', 'a.js'), 'Target\n', 'utf8');

    const loose = await tools.execute('search_files', { query: 'target' });
    assert.match(loose, /a\.js/);
    const strict = await tools.execute('search_files', { query: 'target', caseSensitive: true });
    assert.match(strict, /Совпадений не найдено/);
});

test('a name of the house that is a tool is answered with a pointer, not a refusal', async () => {
    const { root, tools } = await workspace();
    // `ai-image` is a sibling CLI and a tool (`call_ai_image`), not a skill pack.
    const answer = await tools.execute('read_skill', { name: 'ai-image' });
    assert.match(answer, /не скилл, а инструмент/);
    assert.match(answer, /call_ai_image/);

    // The same for the other CLIs of the house.
    const memory = await tools.execute('read_skill', { name: 'ai-memory' });
    assert.match(memory, /call_ai_memory/);

    // A name that is neither a pack nor a tool gets the list of the packs.
    const other = await tools.execute('read_skill', { name: 'demo' });
    assert.match(other, /Скилл не найден: demo/);
    assert.match(other, /Установленные пакеты/);
});

test('a picture is not written as text', async () => {
    const { root, tools } = await workspace();
    // Текст в файле картинки — картинка, которую браузер не покажет: запись отказана, и
    // роль сказано, как сделать настоящую картинку.
    const refused = await tools.execute('write_file', {
        path: 'src/hero.webp',
        content: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>',
    });
    assert.match(refused, /не записан/);
    assert.match(refused, /magick/);
    // Файла на диске нет: текст в файл картинки не попал.
    assert.equal(existsSync(path.join(root, 'src', 'hero.webp')), false);

    // Настоящая картинка (base64) пишется: это байты картинки, а не текст.
    const written = await tools.execute('write_file', {
        path: 'src/hero.webp',
        content: 'UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAwA0JaQAA3AA/vuUAAA=',
    });
    assert.match(written, /Записан/);
});

test('the memory of the project is asked through the program', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-memory-'));
    const config = structuredClone(defaults);
    // The program of the memory is not on every machine: the tool says so and does not throw.
    config.memory.program.command = 'ai-memory-not-installed';
    const tools = createToolset({ root, config });

    const answer = await tools.execute('call_ai_memory', {
        tool: 'memory_query',
        args: JSON.stringify({ query: 'the stages', limit: 3 }),
    });
    assert.match(answer, /Программа памяти не ответила/);

    // The tool is in the catalogue and it is switched on by default.
    assert.ok(TOOL_SPECS.call_ai_memory);
    assert.equal(TOOL_SPECS.call_ai_memory.configKey, 'external_memory');
    assert.equal(defaults.tools.external_memory, true);
    // The name of the tool is required: without it there is nothing to call.
    const empty = await tools.execute('call_ai_memory', { tool: '' });
    assert.match(empty, /not named/);
});

test('the tool of ImageMagick runs the program and keeps the paths inside the project', async () => {
    const { root, tools } = await workspace();
    // The program is not installed on every machine: the tool says so and does nothing.
    const answer = await tools.execute('magick', { args: ['identify', 'src/index.html'] });
    assert.match(answer, /ImageMagick|not found|не найден|не закончил/i);

    // A path outside of the project is refused before the program starts.
    const escaped = await tools.execute('magick', { args: ['convert', '../escape.png', 'out.png'] });
    assert.match(escaped, /ImageMagick/);
    assert.doesNotMatch(escaped, /finished the work/i);

    // Without arguments there is nothing to run.
    const empty = await tools.execute('magick', { args: [] });
    assert.match(empty, /no arguments/i);
});

test('ask_user waits for the operator only when an interactive callback is provided', async () => {
    const { root, config } = await workspace();
    let asked = '';
    const tools = createToolset({
        root,
        config,
        askUser: async (question) => { asked = question; return 'Use the blue option.'; },
    });
    const answer = await tools.execute('ask_user', { question: 'Which color should the accent use?' });
    assert.equal(asked, 'Which color should the accent use?');
    assert.equal(answer, 'Use the blue option.');

    const nonInteractive = createToolset({ root, config });
    assert.match(await nonInteractive.execute('ask_user', { question: 'Choose?' }), /No interactive operator/);
});

test('the search greps the content, the names and the glob', async () => {
    const { root, tools } = await workspace();
    await tools.execute('write_file', { path: 'src/index.html', content: '<h1>hi</h1>\n' });
    await tools.execute('write_file', { path: 'src/styles/main.scss', content: '.card { color: red; }\n' });

    // The content: the grep.
    const grep = await tools.execute('search_files', { query: 'color' });
    assert.match(grep, /src\/styles\/main\.scss:1/);

    // The names: the files themselves.
    const names = await tools.execute('search_files', { query: 'main', inContent: false });
    assert.match(names, /src\/styles\/main\.scss/);
    assert.doesNotMatch(names, /src\/index\.html/);

    // The glob cuts the files before they are read.
    const scss = await tools.execute('search_files', { query: '.', regex: true, glob: '*.scss' });
    assert.match(scss, /src\/styles\/main\.scss/);
    assert.doesNotMatch(scss, /src\/index\.html/);

    // The regex finds the content of the scripts and the styles.
    const regex = await tools.execute('search_files', { query: '\\.(scss|html)$', regex: true, inContent: false });
    assert.match(regex, /src\/index\.html/);
    assert.match(regex, /src\/styles\/main\.scss/);
    assert.ok(root);
});

test('a file that was read once is not read twice', async () => {
    const { tools } = await workspace();
    await tools.execute('write_file', { path: 'src/index.html', content: '<h1>hi</h1>' });
    const first = await tools.execute('read_file', { path: 'src/index.html' });
    assert.match(first, /<h1>hi<\/h1>/);

    // The content of the file is in the conversation above: the second read brings nothing
    // new and costs the context of the run.
    const second = await tools.execute('read_file', { path: 'src/index.html' });
    assert.match(second, /уже прочитан/);
    assert.doesNotMatch(second, /<h1>hi<\/h1>/);

    // A file that changed on the disk is read again.
    await tools.execute('write_file', { path: 'src/index.html', content: '<h1>bye</h1>' });
    const third = await tools.execute('read_file', { path: 'src/index.html' });
    assert.match(third, /<h1>bye<\/h1>/);
});

test('the toolset refuses to write outside the working directory', async () => {
    const { tools } = await workspace();
    await assert.rejects(
        () => tools.execute('write_file', { path: '../escape.txt', content: 'x' }),
        /вне рабочего каталога/,
    );
});

test('delegated toolsets can write only the expected files', async () => {
    const { root, config } = await workspace();
    const tools = createToolset({ root, config, writeFiles: ['main.js'] });

    assert.match(await tools.execute('write_file', { path: 'main.js', content: 'export {};\n' }), /Записан main\.js/);
    await assert.rejects(
        () => tools.execute('write_file', { path: 'styles.scss', content: 'body {}\n' }),
        /вне списка файлов делегированной задачи/,
    );
    assert.deepEqual(tools.writePaths(), ['main.js']);
});

test('a snapshot restores the file of the step before', async () => {
    const { root, tools } = await workspace();
    await tools.execute('write_file', { path: 'src/index.html', content: 'first' });
    await tools.execute('write_file', { path: 'src/index.html', content: 'second' });
    const backups = await tools.execute('list_backups', { path: 'src/index.html' });
    const id = backups.split(/\s+/)[0];
    await tools.execute('restore_backup', { id });
    const body = await readFile(path.join(root, 'src/index.html'), 'utf8');
    assert.equal(body, 'first');
});

test('a bridge that is off is skipped, not failed', async () => {
    const { config } = await workspace();
    config.bridges.decompose.enabled = false;
    const result = await runBridge({ name: 'ai-decompose', args: [], config });
    assert.equal(result.skipped, true);
    assert.equal(result.ok, false);
});

test('a bridge that is missing does not throw', async () => {
    const { config } = await workspace();
    config.bridges.measure.enabled = true;
    config.bridges.measure.command = 'ai-measure-does-not-exist';
    const result = await runBridge({
        name: 'ai-measure',
        args: [],
        config,
        root: path.join(os.tmpdir(), 'ai-webdev-no-cli'),
        env: { PATH: '' },
    });
    assert.equal(result.skipped, false);
    assert.equal(result.ok, false);
    assert.ok(result.reason);
});

test('the measurer is not run again when the sheet is on the disk', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-measured-'));
    await mkdir(path.join(root, 'measurements'), { recursive: true });
    await writeFile(path.join(root, 'landing.png'), 'png');
    await writeFile(path.join(root, 'measurements', 'measurements.json'), JSON.stringify({
        source: 'landing.png',
        unit: 'px',
        elements: [{ name: 'hero', kind: 'box', box: { x: 0, y: 0, width: 100, height: 50 } }],
        regions: [{ name: 'hero', kind: 'section' }],
    }, null, 2));

    const config = structuredClone(defaults);
    // The measurer is not there: if the tool called it, the answer would be about the bridge.
    config.bridges.measure.command = 'ai-measure-does-not-exist';
    const facts = new Map();
    const context = { set: async (key, value) => { facts.set(key, value); } };
    const tools = createToolset({ root, config, context });

    const answer = await tools.execute('call_ai_measure', { args: '["measure", "landing.png"]' });

    assert.match(answer, /уже измерена/);
    assert.match(answer, /measurements\/measurements\.json/);
    // The run knows it: the roles after this one do not measure the picture again.
    assert.equal(facts.get('measurements').file, 'measurements/measurements.json');
});

test('a picture without a sheet is measured', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-unmeasured-'));
    await writeFile(path.join(root, 'landing.png'), 'png');

    const config = structuredClone(defaults);
    config.bridges.measure.enabled = false;
    const tools = createToolset({ root, config });

    const answer = await tools.execute('call_ai_measure', { args: '["measure", "landing.png"]' });

    assert.match(answer, /Мост ai-measure выключен/);
});

test('the direction of the design is not measured', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-design-'));
    await mkdir(path.join(root, 'measurements'), { recursive: true });
    await writeFile(path.join(root, 'landing.png'), 'png');
    await writeFile(path.join(root, 'measurements', 'measurements.json'), JSON.stringify({
        source: 'landing.png',
        unit: 'px',
        elements: [],
        regions: [],
    }, null, 2));

    const config = structuredClone(defaults);
    // The measurer is not there: if the tool called it, the answer would be about the bridge.
    config.bridges.measure.command = 'ai-measure-does-not-exist';
    const tools = createToolset({ root, config });

    const answer = await tools.execute('call_ai_measure', { args: '["design", "landing.png"]' });

    // The measurer writes the direction into its own working directory, where nobody reads it.
    assert.match(answer, /не пишет/);
    assert.match(answer, /measurements\/DESIGN\.md/);
    assert.doesNotMatch(answer, /Мост ai-measure/);
});

test('the measurer is not asked for the direction of the design', () => {
    const spec = TOOL_SPECS.call_ai_measure;
    // The description the model reads is a part of the behaviour of the tool: it must not
    // offer the command `design` as a way to call the measurer.
    assert.doesNotMatch(spec.description, /\["design"/);
    assert.match(spec.description, /\["measure"/);
});

test('the image bridge explains precise edits, optional crops and transparency flags', () => {
    const spec = TOOL_SPECS.call_ai_image;
    assert.match(spec.description, /what changes or is removed, what must remain unchanged/);
    assert.match(spec.description, /crop.*source-pixel `--x`, `--y`, `--width`, `--height` and `--out`/);
    assert.match(spec.description, /`--background transparent`/);
    assert.match(spec.description, /`--reference <file>`/);
    assert.match(spec.description, /DESIGN\.md/);
});

test('fetch_url reads the text of a page', async () => {
    const server = http.createServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<html><head><style>a{color:red}</style><script>alert(1)</script></head><body><h1>Doc</h1></body></html>');
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
        const port = server.address().port;
        const { tools } = await workspace();
        const answer = await tools.execute('fetch_url', { url: `http://127.0.0.1:${port}/doc` });
        assert.match(answer, /HTTP 200/);
        assert.match(answer, /Doc/);
        assert.doesNotMatch(answer, /alert\(1\)/);
    } finally {
        server.close();
    }
});

test('a command that does not finish on its own is refused', async () => {
    const { tools } = await workspace();
    const answer = await tools.execute('run_command', {
        command: 'python',
        args: JSON.stringify(['-m', 'http.server', '8000']),
    });
    assert.match(answer, /не запущена/);
    assert.match(answer, /не заканчивается сама/);
});

test('the styler tool executor refuses shell commands even if a caller invokes them directly', async () => {
    const { root, config } = await workspace();
    const tools = createToolset({ root, config, role: 'styler' });
    assert.match(await tools.execute('run_command', { command: 'python', args: '[]' }), /disabled for styler|styler cannot run shell/i);
    assert.match(await tools.execute('run_script', { path: 'script.js' }), /disabled for styler|styler cannot run shell/i);
    assert.match(await tools.execute('run_skill', { name: 'anything' }), /disabled for styler|styler cannot run shell/i);
});

test('the dev server of vite is refused in every form', () => {
    assert.ok(BLOCKING_COMMANDS.test('vite'), 'the bare vite is refused');
    assert.ok(BLOCKING_COMMANDS.test('npx vite'), 'the vite of npx is refused');
    assert.ok(BLOCKING_COMMANDS.test('npx vite --port 5173'), 'the vite of npx with a port is refused');
    assert.ok(BLOCKING_COMMANDS.test('vite dev'), 'the dev of vite is refused');
    assert.equal(BLOCKING_COMMANDS.test('vite build'), false, 'the build of vite is not refused');
    assert.equal(BLOCKING_COMMANDS.test('npm run build'), false, 'the build of npm is not refused');
});

test('the html of a page becomes readable text', () => {
    const text = htmlToText('<style>a{}</style><p>Hello &amp; bye</p>');
    assert.equal(text, 'Hello & bye');
});

test('the verdicts are pass, partial and fail', () => {
    assert.equal(normalizeVerdict('accept'), 'pass');
    assert.equal(normalizeVerdict('revise'), 'partial');
    assert.equal(normalizeVerdict('nonsense'), null);
    assert.equal(verdictFromScores({ a: 0.9, b: 0.8 }).verdict, 'pass');
    assert.equal(verdictFromScores({ a: 0.5 }).verdict, 'partial');
    assert.equal(verdictFromScores({ a: 0.1 }).verdict, 'fail');
});

test('the pace leaves the effort alone until a dial moves', () => {
    const config = structuredClone(defaults);
    config.reasoning.effort = 'medium';
    assert.equal(effortFor({ config, role: 'coder' }), 'medium');
    config.pace.codeQuality = 100;
    // The dial is 50 points above the default: two bands of 25, two steps of the ladder.
    assert.equal(effortFor({ config, role: 'coder' }), 'xhigh');
    const pace = resolvePace({ config, role: 'coder' });
    assert.equal(pace.stageQuality, 100);
});
