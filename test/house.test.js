/**
 * @file test/house.test.js
 * @purpose Тесты закона дома: где живёт состояние прогона, как система подписывает контракт
 *          проекта и как другая система находит её работу.
 *
 * Дом проекта — `.ai/`: состояние прогона в `.ai/tmp/<id>/`, ассеты в `.ai/assets/`, логи в
 * `.ai/logs/`, контракт в `.ai/manifest.json`. Поставка остаётся на месте: сайт в корне,
 * измерения в `measurements/`.
 *
 * @depends node:test, shared/house, stages/workspace, stages/publish, inputs/candidates
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';

import {
    HOUSE_ASSETS,
    HOUSE_DIR,
    HOUSE_SYSTEMS,
    HOUSE_WORK,
    assetsDir,
    findGenerated,
    houseDir,
    logsDir,
    manifestPath,
    publish,
    readManifest,
    runStateDir,
    toProjectPath,
    workDir,
    workRel,
    writeFileAtomic,
    writeManifest,
} from '../src/shared/house.js';
import { runDirectory, runFile, workRoot } from '../src/stages/workspace.js';
import { publishRun } from '../src/stages/publish.js';
import { findContractInput } from '../src/inputs/candidates.js';

/**
 * Пустой проект во временном каталоге.
 * @returns {Promise<{ root: string, cleanup: () => Promise<void> }>}
 */
async function project() {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-house-'));
    return { root, cleanup: () => rm(root, { recursive: true, force: true }) };
}

// --- закон дома --------------------------------------------------------------

test('состояние прогона живёт в доме проекта', async () => {
    const { root, cleanup } = await project();
    try {
        assert.equal(HOUSE_DIR, '.ai');
        assert.equal(HOUSE_WORK, '.ai/tmp');
        assert.equal(workRel({}), '.ai/tmp');
        assert.equal(workRel({ output: { work: './.ai/tmp' } }), '.ai/tmp');
        assert.equal(workRel({ output: { work: './build' } }), 'build');
        assert.equal(workDir(root), path.join(root, '.ai', 'tmp'));
        assert.equal(runStateDir(root, 'run-1'), path.join(root, '.ai', 'tmp', 'run-1'));
        assert.equal(workRoot(root), path.join(root, '.ai', 'tmp'));
        assert.equal(runDirectory(root, {}, 'run-1'), path.join(root, '.ai', 'tmp', 'run-1'));
        assert.equal(runFile(root, {}, 'run-1', 'plan.json'), path.join(root, '.ai', 'tmp', 'run-1', 'plan.json'));
    } finally {
        await cleanup();
    }
});

test('конфигурация может увести состояние прогона из дома', async () => {
    const { root, cleanup } = await project();
    try {
        const config = { output: { work: './build/runs' } };
        assert.equal(workRel(config), 'build/runs');
        assert.equal(runDirectory(root, config, 'run-1'), path.join(root, 'build', 'runs', 'run-1'));
    } finally {
        await cleanup();
    }
});

test('ассеты и логи дома лежат в своих каталогах', async () => {
    const { root, cleanup } = await project();
    try {
        assert.equal(assetsDir(root), path.join(root, '.ai', 'assets'));
        assert.equal(logsDir(root), path.join(root, '.ai', 'logs'));
        assert.equal(HOUSE_ASSETS, 'assets');
        assert.equal(manifestPath(root), path.join(root, '.ai', 'manifest.json'));
    } finally {
        await cleanup();
    }
});

test('путь файла проекта — относительный, чужой — абсолютный', async () => {
    const { root, cleanup } = await project();
    try {
        assert.equal(toProjectPath(root, path.join(root, '.ai', 'manifest.json')), '.ai/manifest.json');
        assert.equal(toProjectPath(root, path.join(root, 'measurements', 'sheet.json')), 'measurements/sheet.json');
        assert.equal(toProjectPath(root, path.resolve(root, '..', 'outside.json')), path.resolve(root, '..', 'outside.json'));
    } finally {
        await cleanup();
    }
});

// --- контракт проекта --------------------------------------------------------

test('контракт проекта пишется и читается', async () => {
    const { root, cleanup } = await project();
    try {
        await writeManifest(root, { systems: { measurer: { delivery: 'measurements' } } });
        const manifest = await readManifest(root);
        assert.equal(manifest.manifestVersion, 1);
        assert.equal(manifest.systems.measurer.delivery, 'measurements');
        assert.ok(manifest.updatedAt);
    } finally {
        await cleanup();
    }
});

test('сломанный контракт читается как пустой, а не как ошибка', async () => {
    const { root, cleanup } = await project();
    try {
        await mkdir(path.join(root, '.ai'), { recursive: true });
        await writeFile(manifestPath(root), '{ this is not json', 'utf8');
        const manifest = await readManifest(root);
        assert.deepEqual(manifest.systems, {});
        assert.equal(manifest.manifestVersion, 1);
    } finally {
        await cleanup();
    }
});

test('система подписывает только свою часть контракта', async () => {
    const { root, cleanup } = await project();
    try {
        await publish(root, HOUSE_SYSTEMS.measurer, { delivery: 'measurements', artifacts: { measurements: 'measurements/sheet.json' } });
        await publish(root, HOUSE_SYSTEMS.webdev, { delivery: '.', artifacts: { site: '.' } });
        const manifest = await readManifest(root);
        assert.equal(manifest.systems.measurer.delivery, 'measurements');
        assert.equal(manifest.systems.webdev.delivery, '.');
        assert.equal(manifest.systems.measurer.artifacts.measurements, 'measurements/sheet.json');
    } finally {
        await cleanup();
    }
});

test('работа другой системы находится через контракту', async () => {
    const { root, cleanup } = await project();
    try {
        const { mkdir } = await import('node:fs/promises');
        await mkdir(path.join(root, 'measurements'), { recursive: true });
        await writeFile(path.join(root, 'measurements', 'sheet.json'), '{}\n', 'utf8');
        await publish(root, HOUSE_SYSTEMS.measurer, { artifacts: { measurements: 'measurements/sheet.json' } });
        const found = await findGenerated(root, 'measurements', ['nowhere/sheet.json']);
        assert.equal(found, 'measurements/sheet.json');
    } finally {
        await cleanup();
    }
});

test('контракт важнее старых путей', async () => {
    const { root, cleanup } = await project();
    try {
        const { mkdir } = await import('node:fs/promises');
        await mkdir(path.join(root, 'measurements'), { recursive: true });
        await writeFile(path.join(root, 'measurements', 'sheet.json'), '{}\n', 'utf8');
        await writeFile(path.join(root, 'old-sheet.json'), '{}\n', 'utf8');
        await publish(root, HOUSE_SYSTEMS.measurer, { artifacts: { measurements: 'measurements/sheet.json' } });
        const found = await findGenerated(root, 'measurements', ['old-sheet.json']);
        assert.equal(found, 'measurements/sheet.json');
    } finally {
        await cleanup();
    }
});

test('вход читается по контракту, а не по угадыванию пути', async () => {
    const { root, cleanup } = await project();
    try {
        const { mkdir } = await import('node:fs/promises');
        await mkdir(path.join(root, 'measurements'), { recursive: true });
        await writeFile(path.join(root, 'measurements', 'sheet.json'), '{"elements":[]}\n', 'utf8');
        await publish(root, HOUSE_SYSTEMS.measurer, { artifacts: { measurements: 'measurements/sheet.json' } });
        const found = await findContractInput(root, 'measurements', ['nowhere/sheet.json']);
        assert.equal(found?.path, 'measurements/sheet.json');
    } finally {
        await cleanup();
    }
});

// --- атомарная запись --------------------------------------------------------

test('файл пишется целиком: временного файла не остаётся', async () => {
    const { root, cleanup } = await project();
    try {
        const file = path.join(root, '.ai', 'tmp', 'run-1', 'plan.json');
        await writeFileAtomic(file, '{"a":1}\n');
        assert.equal(await readFile(file, 'utf8'), '{"a":1}\n');
        const left = await readdir(path.dirname(file));
        assert.deepEqual(left, ['plan.json']);
    } finally {
        await cleanup();
    }
});

test('старое содержимое переживает упавшую запись', async () => {
    const { root, cleanup } = await project();
    try {
        const file = path.join(root, 'state.json');
        await writeFileAtomic(file, 'old\n');
        // Запись в каталог падает: временный файл не заменяет цель.
        const target = path.join(root, 'locked');
        await mkdir(target, { recursive: true });
        await assert.rejects(async () => writeFileAtomic(target, 'new\n'));
        assert.equal(await readFile(file, 'utf8'), 'old\n');
        const left = await readdir(root);
        assert.ok(!left.some((name) => name.includes('.tmp-')), 'временный файл не остался');
    } finally {
        await cleanup();
    }
});

test('json-файл пишется целиком: старый json переживает упавшую запись', async () => {
    const { root, cleanup } = await project();
    try {
        const file = path.join(root, 'package.json');
        await writeFileAtomic(file, '{"name":"old"}\n');
        // Цель — каталог: переименование временного файла на неё падает.
        const target = path.join(root, 'locked');
        await mkdir(target, { recursive: true });
        await assert.rejects(async () => writeFileAtomic(target, '{"name":"new"}\n'));
        // Старый json цел и читается.
        assert.equal(JSON.parse(await readFile(file, 'utf8')).name, 'old');
        const left = await readdir(root);
        assert.ok(!left.some((name) => name.includes('.tmp-')), 'временный файл не остался');
    } finally {
        await cleanup();
    }
});

// --- подпись прогона ---------------------------------------------------------

test('прогон подписывает контракт проекта', async () => {
    const { root, cleanup } = await project();
    try {
        await publishRun(root, { output: { assets: './.ai/assets' }, pictures: { dir: 'assets/import' } }, {
            id: 'run-1',
            status: 'completed',
            files: [{ path: 'index.html' }],
        });
        const manifest = await readManifest(root);
        assert.equal(manifest.systems.webdev.delivery, '.');
        assert.equal(manifest.systems.webdev.artifacts.site, '.');
        assert.equal(manifest.systems.webdev.artifacts.assets, '.ai/assets');
        assert.equal(manifest.systems.webdev.artifacts.pictures, 'assets/import');
        assert.deepEqual(manifest.systems.webdev.files, ['index.html']);
    } finally {
        await cleanup();
    }
});
