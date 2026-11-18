/**
 * @file test/context.test.js
 * @purpose Тесты контекста прогона и карты прогона: журнал, состояние, кэш, сводка,
 *          указатель на файлы и инструменты, которые читают через них.
 *
 * Контекст живёт в `<work>/<id>/context/`, карта — в `<work>/<id>/map.json`: и то и другое
 * принадлежит прогону и умирает вместе с ним. Новый прогон начинается с чистой головы.
 *
 * @depends node:test, agent/context, agent/run-map, agent/tools
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';

import { openContext, contextDirectory, contextRel, cacheKeyFor } from '../src/agent/context.js';
import {
    buildRunMap,
    loadRunMap,
    mapFiles,
    openRunMap,
    runMapFile,
    runMapRel,
    searchRunMap,
} from '../src/agent/run-map.js';
import { createToolset } from '../src/agent/tools.js';

/**
 * Рабочий каталог с парой файлов.
 * @returns {Promise<{ root: string, config: object, cleanup: () => Promise<void> }>}
 */
async function workspace() {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-context-'));
    await writeFile(path.join(root, 'notes.md'), 'быстрая коричневая лиса\nпрыгает через ленивую собаку\n', 'utf-8');
    await mkdir(path.join(root, 'src'), { recursive: true });
    await writeFile(path.join(root, 'src', 'app.js'), 'export function greet() {\n    return "привет";\n}\n', 'utf-8');
    return {
        root,
        config: { output: { work: './.tmp' } },
        cleanup: () => rm(root, { recursive: true, force: true }),
    };
}

// --- контекст прогона -------------------------------------------------------

test('контекст прогона хранит журнал, состояние и заметки', async () => {
    const { root, config, cleanup } = await workspace();
    try {
        const context = await openContext({ root, config, runId: 'run-1' });
        await context.references([{ rel: 'landing.png', kind: 'original' }]);
        await context.decision('Картинка — экран 1024×768.');
        await context.stage('plan', 'done', 'План из 3 шагов.');
        await context.file('src/app.js');

        const journal = await context.journal();
        assert.equal(journal.length, 2);
        assert.equal(journal[0].kind, 'decision');
        assert.equal(journal[1].kind, 'stage');

        const state = JSON.parse(await readFile(path.join(contextDirectory(root, config, 'run-1'), 'state.json'), 'utf-8'));
        assert.equal(state.references[0].rel, 'landing.png');
        assert.equal(state.stages.plan.status, 'done');
        assert.ok(state.files.includes('src/app.js'));

        const notes = await context.digest();
        assert.ok(notes.endsWith('notes.md'));
        const text = await readFile(notes, 'utf-8');
        assert.match(text, /landing\.png/);
        assert.match(text, /План из 3 шагов/);
    } finally {
        await cleanup();
    }
});

test('сводка контекста называет точные пути картинок', async () => {
    const { root, config, cleanup } = await workspace();
    try {
        const context = await openContext({ root, config, runId: 'run-2' });
        await context.references([{ rel: 'landing.png', kind: 'original' }]);
        await context.stage('markup', 'done', 'Разметка готова.');
        const brief = context.brief();
        assert.match(brief, /landing\.png/);
        assert.match(brief, /these paths are exact/i);
        assert.match(brief, /markup/);
    } finally {
        await cleanup();
    }
});

test('кэш контекста отвечает на вопрос, который уже задавали', async () => {
    const { root, config, cleanup } = await workspace();
    try {
        const context = await openContext({ root, config, runId: 'run-3' });
        assert.equal(await context.cached('a-question'), null);
        await context.put('a-question', { answer: '42' });
        const hit = await context.cached('a-question');
        assert.equal(hit.answer, '42');
        assert.equal(cacheKeyFor('a-question'), cacheKeyFor('a-question'));
    } finally {
        await cleanup();
    }
});

test('выключенный контекст ничего не делает и не падает', async () => {
    const { root, config, cleanup } = await workspace();
    try {
        const context = await openContext({ root, config, runId: 'run-4', enabled: false });
        assert.equal(context.enabled, false);
        await context.decision('ничего');
        await context.references([{ rel: 'landing.png' }]);
        assert.equal(context.brief(), '');
        assert.deepEqual(await context.journal(), []);
        assert.equal(await context.digest(), null);
    } finally {
        await cleanup();
    }
});

test('контекст прогона умирает вместе с ним и не течёт в следующий', async () => {
    const { root, config, cleanup } = await workspace();
    try {
        const first = await openContext({ root, config, runId: 'run-old' });
        await first.decision('старое решение');
        await first.close();

        const second = await openContext({ root, config, runId: 'run-new' });
        assert.doesNotMatch(second.brief(), /старое решение/);
        assert.deepEqual(await second.journal(), []);
        assert.equal(contextRel(root, config, 'run-new'), '.tmp/run-new/context');
    } finally {
        await cleanup();
    }
});

// --- карта прогона ----------------------------------------------------------

test('карта прогона индексирует файлы с их строками и их символами', async () => {
    const { root, config, cleanup } = await workspace();
    try {
        const map = await buildRunMap({ root, config, runId: 'run-5' });
        assert.ok(map.files['notes.md']);
        assert.equal(map.files['notes.md'].lineCount, 3);
        assert.equal(map.files['src/app.js'].kind, 'code');
        const symbol = map.files['src/app.js'].symbols.find((item) => item.name === 'greet');
        assert.equal(symbol.kind, 'export');
        assert.equal(symbol.line, 1);

        const saved = await loadRunMap({ root, config, runId: 'run-5' });
        assert.ok(saved.files['notes.md']);
        assert.equal(runMapRel(root, config, 'run-5'), '.tmp/run-5/map.json');
        assert.equal(runMapFile(root, config, 'run-5'), path.join(root, '.tmp', 'run-5', 'map.json'));
    } finally {
        await cleanup();
    }
});

test('карта ищет по пути, по содержимому и по символу', async () => {
    const { root, config, cleanup } = await workspace();
    try {
        const map = await buildRunMap({ root, config, runId: 'run-6' });
        const byPath = searchRunMap(map, { query: 'notes', scope: 'path' });
        assert.match(byPath.text, /notes\.md/);
        const byContent = searchRunMap(map, { query: 'ленивую собаку', scope: 'content' });
        assert.match(byContent.text, /notes\.md:2/);
        const bySymbol = searchRunMap(map, { query: 'greet', scope: 'symbol' });
        assert.match(bySymbol.text, /greet/);
    } finally {
        await cleanup();
    }
});

test('файл, который не помещается в карту, помечен частичным и ищется на диске', async () => {
    const { root, config, cleanup } = await workspace();
    try {
        const long = Array.from({ length: 50 }, (_, index) => `строка ${index}`).join('\n');
        await writeFile(path.join(root, 'long.txt'), long, 'utf-8');
        const map = await buildRunMap({ root, config, runId: 'run-7', maxLines: 10 });
        assert.equal(map.files['long.txt'].partial, true);
        const found = searchRunMap(map, { query: 'строка 49', scope: 'content' });
        assert.equal(found.count, 0);
        assert.ok(found.partial.includes('long.txt'));
    } finally {
        await cleanup();
    }
});

test('карта прогона перечисляет файлы каталога', async () => {
    const { root, config, cleanup } = await workspace();
    try {
        const map = await buildRunMap({ root, config, runId: 'run-8' });
        assert.deepEqual(mapFiles(map, { dir: '.', depth: 1 }), ['notes.md']);
        assert.deepEqual(mapFiles(map, { dir: '.', depth: 2 }), ['notes.md', 'src/app.js']);
    } finally {
        await cleanup();
    }
});

test('карта прогона пишется на диск и читается обратно', async () => {
    const { root, config, cleanup } = await workspace();
    try {
        const handle = await openRunMap({ root, config, runId: 'run-9' });
        assert.equal(handle.enabled, true);
        assert.ok(handle.files().includes('notes.md'));
        assert.match(handle.summary(), /notes\.md/);
        await handle.save();
        const back = await loadRunMap({ root, config, runId: 'run-9' });
        assert.ok(back.files['notes.md']);
    } finally {
        await cleanup();
    }
});

// --- инструменты читают через карту и помнят ответы в контексте -------------

test('инструменты перечисляют, читают и ищут через карту прогона', async () => {
    const { root, config, cleanup } = await workspace();
    try {
        const context = await openContext({ root, config, runId: 'run-10' });
        const map = await openRunMap({ root, config, runId: 'run-10' });
        const toolset = createToolset({ root, config, context, map });

        const listed = await toolset.execute('list_files', { path: '.', depth: 2 });
        assert.match(listed, /notes\.md/);
        assert.match(listed, /src\/app\.js/);

        const read = await toolset.execute('read_file', { path: 'notes.md' });
        assert.match(read, /быстрая коричневая лиса/);

        const found = await toolset.execute('search_files', { query: 'ленивую собаку', scope: 'content' });
        assert.match(found, /notes\.md:2/);

        const bySymbol = await toolset.execute('search_files', { query: 'greet', scope: 'symbol' });
        assert.match(bySymbol, /greet/);
    } finally {
        await cleanup();
    }
});

test('list_files sees files added after the run map was built', async () => {
    const { root, config, cleanup } = await workspace();
    try {
        const context = await openContext({ root, config, runId: 'run-10-live-list' });
        const map = await openRunMap({ root, config, runId: 'run-10-live-list' });
        const toolset = createToolset({ root, config, context, map });
        await mkdir(path.join(root, 'assets', 'import'), { recursive: true });
        await writeFile(path.join(root, 'assets', 'import', 'award-badge.png'), Buffer.from([1, 2, 3]));

        const listed = await toolset.execute('list_files', { path: 'assets/import', depth: 2 });

        assert.match(listed, /assets\/import\/award-badge\.png/);
        assert.doesNotMatch(listed, /\(пусто\)/);
    } finally {
        await cleanup();
    }
});

test('файл, который прогон записал, сразу попадает в карту', async () => {
    const { root, config, cleanup } = await workspace();
    try {
        const context = await openContext({ root, config, runId: 'run-11' });
        const map = await openRunMap({ root, config, runId: 'run-11' });
        const toolset = createToolset({ root, config, context, map, writeDirs: [root] });
        await toolset.execute('write_file', { path: 'fresh.md', content: 'совсем новый\n' });
        assert.ok(map.files().includes('fresh.md'));
        const read = await toolset.execute('read_file', { path: 'fresh.md' });
        assert.match(read, /совсем новый/);
    } finally {
        await cleanup();
    }
});

test('ответ инструмента помнится в контексте прогона', async () => {
    const { root, config, cleanup } = await workspace();
    try {
        const context = await openContext({ root, config, runId: 'run-12' });
        const map = await openRunMap({ root, config, runId: 'run-12' });
        const toolset = createToolset({ root, config, context, map });
        await toolset.execute('read_file', { path: 'notes.md' });
        const entries = await context.journal({ kind: 'action' });
        assert.equal(entries.length, 1);
        assert.match(entries[0].text, /read_file/);
    } finally {
        await cleanup();
    }
});

test('файл, который не помещается в карту, ищется на диске', async () => {
    const { root, config, cleanup } = await workspace();
    try {
        const long = Array.from({ length: 60 }, (_, index) => `строка ${index}`).join('\n');
        await writeFile(path.join(root, 'long.txt'), long, 'utf-8');
        const context = await openContext({ root, config, runId: 'run-13' });
        const map = await openRunMap({ root, config, runId: 'run-13', maxLines: 10 });
        const toolset = createToolset({ root, config, context, map });
        const found = await toolset.execute('search_files', { query: 'строка 59', scope: 'content' });
        assert.match(found, /long\.txt/);
    } finally {
        await cleanup();
    }
});
