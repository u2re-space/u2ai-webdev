/**
 * @file test/pictures.test.js
 * @module test/pictures
 * @purpose The tests of the pictures: the crops of the reference, the names of the prepared
 *          pictures and the stage that prepares them with `ai-image`.
 * @depends node:test, node:path, node:fs/promises, inputs/crops, stages/pictures
 * @ai.tags test, pictures, crops
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';

import { cropName, cropCandidates, cropRelative, resolveCropFile } from '../src/inputs/crops.js';
import { pictureName, pictureCrops, picturesStage, pictureKinds } from '../src/stages/pictures.js';

/**
 * A sheet of measurements with three crops.
 * @returns {object}
 * @ai.hint pure
 */
function sheet() {
    return {
        present: true,
        elements: [
            { name: 'black chess bishop', kind: 'image', crop: 'crops/08-region-bishop-artwork.png', use: 'The piece of the reference.' },
            { name: 'menu icon', kind: 'icon', crop: 'crops/21-element-menu-icon.png', use: 'An icon.' },
        ],
        regions: [
            { name: 'bishop artwork', kind: 'image', crop: 'crops/08-region-bishop-artwork.png', use: 'The same crop again.' },
            { name: 'wooden board artwork', kind: 'image', crop: 'crops/09-region-wooden-board-artwork.png', use: 'The board.' },
            { name: 'award badge disk', kind: 'ornament', crop: 'crops/02-region-award-badge-complete.png', use: 'The badge.' },
        ],
    };
}

/**
 * The config of a run with the bridge of the images on.
 * @returns {object}
 * @ai.hint pure
 */
function config() {
    return {
        inputs: { measurements: 'measurements/measurements.json' },
        output: { work: '.tmp', dir: '.ai' },
        pictures: {
            enabled: true,
            kinds: ['image', 'ornament'],
            command: 'background',
            commands: {},
            prompts: {},
            alphaMode: 'auto',
            dir: 'assets/import',
            max: 6,
        },
        bridges: { image: { enabled: true, command: 'ai-image', timeoutMs: 60_000 } },
    };
}

test('the name of a crop is its name without the extension', () => {
    assert.equal(cropName('crops/08-region-bishop-artwork.png'), '08-region-bishop-artwork');
    assert.equal(cropName(''), '');
});

test('the name of a picture drops the number and the kind of the cut', () => {
    assert.equal(pictureName('crops/08-region-bishop-artwork.png'), 'bishop-artwork');
    assert.equal(pictureName('crops/09-region-wooden-board-artwork.png'), 'wooden-board-artwork');
    assert.equal(pictureName('crops/02-region-award-badge-complete.png'), 'award-badge-complete');
    assert.equal(pictureName(''), 'picture');
});

test('the crops of the pictures are the ones of the kinds of the config', () => {
    const found = pictureCrops(sheet(), ['image', 'ornament']);
    const names = found.map((item) => item.name);
    assert.deepEqual(names, [
        'black chess bishop',
        'wooden board artwork',
        'award badge disk',
    ]);
    // The same crop named twice is one picture.
    assert.equal(found.length, 3);
    assert.ok(!names.includes('menu icon'));

    const all = pictureCrops(sheet(), []);
    assert.equal(all.length, 4);
    assert.ok(pictureKinds.includes('image'));
});

test('the file of a crop is found next to the sheet and under the working directory', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-crops-'));
    await mkdir(path.join(root, 'measurements', 'crops'), { recursive: true });
    await writeFile(path.join(root, 'measurements', 'crops', '08-region-bishop-artwork.png'), 'png');
    await mkdir(path.join(root, '.tmp', 'run-1', 'crops'), { recursive: true });
    await writeFile(path.join(root, '.tmp', 'run-1', 'crops', '09-region-wooden-board-artwork.png'), 'png');

    const candidates = cropCandidates(root, 'crops/08-region-bishop-artwork.png', {
        sheetDir: 'measurements',
        workDir: '.tmp',
    });
    assert.ok(candidates.length >= 2);
    assert.ok(candidates.every((item) => path.isAbsolute(item)));

    const found = await resolveCropFile(root, 'crops/08-region-bishop-artwork.png', {
        sheetDir: 'measurements',
        workDir: '.tmp',
    });
    assert.ok(found.endsWith(path.join('measurements', 'crops', '08-region-bishop-artwork.png')));

    const deep = await resolveCropFile(root, 'crops/09-region-wooden-board-artwork.png', {
        sheetDir: 'measurements',
        workDir: '.tmp',
    });
    assert.ok(deep.endsWith(path.join('.tmp', 'run-1', 'crops', '09-region-wooden-board-artwork.png')));

    assert.equal(await resolveCropFile(root, 'crops/nothing-here.png', {}), null);
    assert.equal(cropRelative(root, path.join(root, 'a', 'b.png')), 'a/b.png');
});

test('the stage of the pictures prepares the crops with the bridge of the images', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-pictures-'));
    await mkdir(path.join(root, 'measurements', 'crops'), { recursive: true });
    await writeFile(path.join(root, 'measurements', 'crops', '08-region-bishop-artwork.png'), 'png');

    // The stand-in for `ai-image`: it writes the file the stage asked for.
    const fake = path.join(root, 'fake-ai-image.js');
    await writeFile(fake, [
        "import { writeFile } from 'node:fs/promises';",
        "const args = process.argv.slice(2);",
        "const out = args[args.indexOf('--out') + 1];",
        "await writeFile(out, 'prepared');",
        "process.stdout.write('ok');",
    ].join('\n'));

    const result = await picturesStage({
        root,
        config: config(),
        inputs: { measurements: sheet() },
        env: { ...process.env, AI_IMAGE_BIN: fake },
    });

    assert.equal(result.ok, true);
    assert.equal(result.pictures.length, 1);
    assert.equal(result.pictures[0].name, 'black chess bishop');
    assert.equal(result.pictures[0].file, 'assets/import/bishop-artwork.png');
    const written = await readFile(path.join(root, 'assets', 'import', 'bishop-artwork.png'), 'utf8');
    assert.equal(written, 'prepared');
});

test('the stage of the pictures keeps the picture that is already there', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-pictures-old-'));
    await mkdir(path.join(root, 'measurements', 'crops'), { recursive: true });
    await writeFile(path.join(root, 'measurements', 'crops', '08-region-bishop-artwork.png'), 'png');
    await mkdir(path.join(root, 'assets', 'import'), { recursive: true });
    await writeFile(path.join(root, 'assets', 'import', 'bishop-artwork.png'), 'prepared before');

    const result = await picturesStage({
        root,
        config: config(),
        inputs: { measurements: sheet() },
        env: { ...process.env, AI_IMAGE_BIN: path.join(root, 'nothing-here.js') },
    });

    assert.equal(result.pictures.length, 1);
    assert.equal(result.pictures[0].bytes, 'prepared before'.length);
    assert.deepEqual(result.warnings, ['Обрезок не найден на диске: crops/09-region-wooden-board-artwork.png',
        'Обрезок не найден на диске: crops/02-region-award-badge-complete.png']);
});

test('the stage of the pictures skips itself when the bridge is off', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-pictures-off-'));
    const off = config();
    off.bridges.image.enabled = false;

    const result = await picturesStage({
        root,
        config: off,
        inputs: { measurements: sheet() },
    });
    assert.equal(result.ok, true);
    assert.equal(result.pictures.length, 0);
    assert.match(result.warnings.join(' '), /ai-image/);
});

test('the stage of the pictures skips itself when there is no sheet', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-pictures-none-'));
    const result = await picturesStage({ root, config: config(), inputs: { measurements: { present: false } } });
    assert.equal(result.ok, true);
    assert.equal(result.pictures.length, 0);
    assert.match(result.text, /Лист измерений/);
});
