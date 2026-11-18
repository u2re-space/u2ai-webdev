/**
 * @file test/pictures.test.js
 * @module test/pictures
 * @purpose The tests of the pictures: the crops of the reference, the names of the prepared
 *          pictures and the stage that prepares them with `ai-image`.
 * @depends node:test, node:path, node:fs/promises, inputs/crops, stages/pictures, pipeline
 * @ai.tags test, pictures, crops
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';

import { cropName, cropCandidates, cropRelative, resolveCropFile } from '../src/inputs/crops.js';
import {
    pictureName,
    pictureCrops,
    picturesStage,
    pictureSubject,
    pictureKinds,
    pictureModels,
    pictureQuality,
    pickPicture,
    modelTag,
    writePictures,
    readPictures,
} from '../src/stages/pictures.js';
import { pipelineFiles } from '../src/pipeline.js';

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
            subject: '{name}',
            subjects: {},
            alphaMode: 'auto',
            dir: 'assets/import',
            max: 6,
        },
        bridges: { image: { enabled: true, command: 'ai-image', timeoutMs: 60_000 } },
    };
}

/**
 * The stand-in for `ai-image`: it writes the file the stage asked for, answers the question
 * of `info` and remembers every call.
 *
 * The file that is written holds the name of the model that made it, and the sunburst cuts
 * the edge tighter than the seedream: the stage has to keep the sunburst.
 * @param {string} root the project directory
 * @returns {Promise<{ bin: string, calls: string }>} the path of the fake and of its log
 */
async function fakeImage(root) {
    const calls = path.join(root, 'calls.ndjson');
    const bin = path.join(root, 'fake-ai-image.js');
    await writeFile(bin, [
        "import { readFile, writeFile, appendFile } from 'node:fs/promises';",
        'const args = process.argv.slice(2);',
        `await appendFile(${JSON.stringify(calls)}, JSON.stringify(args) + '\\n');`,
        "if (args[0] === 'info') {",
        "    const body = await readFile(args[1], 'utf8');",
        "    const soft = body.includes('sunburst') ? 0.01 : 0.04;",
        "    process.stdout.write(JSON.stringify({ type: 'result', status: 'ok', alpha: { opaque: false, cleared: 0.25, soft, real: true } }));",
        '    process.exit(0);',
        '}',
        "const out = args[args.indexOf('--out') + 1];",
        "const model = args[args.indexOf('--image-model') + 1] ?? 'default';",
        "await writeFile(out, model);",
        "process.stdout.write('ok');",
    ].join('\n'));
    return { bin, calls };
}

/**
 * The calls the fake has seen.
 * @param {string} file the log of the calls
 * @returns {Promise<string[][]>}
 */
async function readCalls(file) {
    const text = await readFile(file, 'utf8');
    return text.split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

/**
 * The crops of the measurer on the disk: the list of the fragments and the files themselves.
 * @param {string} root the project directory
 * @param {object[]} crops the crops of the measurer
 * @returns {Promise<void>}
 */
async function writeMeasuredCrops(root, crops = []) {
    await mkdir(path.join(root, 'measurements', 'stages'), { recursive: true });
    await mkdir(path.join(root, 'measurements', 'crops'), { recursive: true });
    await writeFile(
        path.join(root, 'measurements', 'stages', 'crops.json'),
        `${JSON.stringify({ crops }, null, 2)}\n`,
    );
    for (const crop of crops) {
        await writeFile(path.join(root, 'measurements', crop.crop), 'png');
    }
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

test('the subject of the cut-out names the object of the crop', () => {
    const crop = { name: 'bishop artwork', kind: 'image', use: 'Hero artwork reference.' };
    assert.equal(pictureSubject(crop, { subject: '{name}' }), 'bishop');
    assert.equal(pictureSubject(crop, { subject: '{kind}' }), 'image');
    assert.equal(pictureSubject(crop, { subject: '{use}' }), 'Hero artwork reference.');

    // The subject of a kind wins over the general one.
    assert.equal(pictureSubject(crop, { subject: '{name}', subjects: { image: 'the chess bishop' } }), 'the chess bishop');

    // Nothing to say: no subject, no flag.
    assert.equal(pictureSubject(crop, {}), '');
    assert.equal(pictureSubject(crop, { subject: '   ' }), '');
});

test('the models of the pictures are the models of the house and the ones of the config', () => {
    // The list of the house: the seedream and the sunburst of OpenAI.
    assert.deepEqual(pictureModels({}), [
        'bytedance-seed/seedream-5-5',
        'openai/gpt-image-2.6-sunburst',
    ]);
    // The model of the config goes first.
    assert.equal(pictureModels({ model: 'sourceful/riverflow-v2.6-pro' })[0], 'sourceful/riverflow-v2.6-pro');
    // The list of the config is asked too.
    assert.deepEqual(pictureModels({ models: ['a/b', 'c/d'] }).slice(0, 2), ['a/b', 'c/d']);
    // A model that is named twice is asked once.
    const list = pictureModels({ model: 'bytedance-seed/seedream-5-5', models: ['bytedance-seed/seedream-5-5'] });
    assert.equal(list.filter((item) => item === 'bytedance-seed/seedream-5-5').length, 1);
});

test('the tier of the quality of the pictures is high unless the config says otherwise', () => {
    assert.equal(pictureQuality({}), 'high');
    assert.equal(pictureQuality({ quality: 'xhigh' }), 'xhigh');
    assert.equal(pictureQuality({ quality: 'auto' }), 'high');
    assert.equal(pictureQuality({ quality: '' }), 'high');
});

test('the better cut-out is the one with the tighter edge', () => {
    const candidates = [
        { model: 'seedream', facts: { cleared: 0.25, soft: 0.04, real: true } },
        { model: 'sunburst', facts: { cleared: 0.25, soft: 0.01, real: true } },
    ];
    assert.equal(pickPicture(candidates).model, 'sunburst');

    // A cut-out that is not real loses to any real one.
    const broken = [
        { model: 'painted', facts: { cleared: 0.9, soft: 0.0, real: false } },
        { model: 'cut', facts: { cleared: 0.2, soft: 0.03, real: true } },
    ];
    assert.equal(pickPicture(broken).model, 'cut');

    // Without the facts the order of the models is the order of the trust.
    assert.equal(pickPicture([{ model: 'first' }, { model: 'second' }]).model, 'first');
    assert.equal(pickPicture([]), null);
});

test('the name of a model in a file name is safe', () => {
    assert.equal(modelTag('openai/gpt-image-2.6-sunburst'), 'openai-gpt-image-2-6-sunburst');
    assert.equal(modelTag(''), 'model');
});

test('the stage of the pictures prepares the crops with the bridge of the images', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-pictures-'));
    await mkdir(path.join(root, 'measurements', 'crops'), { recursive: true });
    await writeFile(path.join(root, 'measurements', 'crops', '08-region-bishop-artwork.png'), 'png');

    // The stand-in for `ai-image`: it writes the file the stage asked for and remembers the call.
    const { bin: fake, calls } = await fakeImage(root);

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
    // The subject goes to the bridge: the fragments of the neighbours have to go away.
    const seen = await readCalls(calls);
    const call = seen.find((args) => args[0] === 'background');
    assert.ok(call);
    assert.equal(call[call.indexOf('--subject') + 1], 'black chess bishop');
    assert.equal(call[call.indexOf('--alpha-mode') + 1], 'auto');
    assert.equal(call[call.indexOf('--attempts') + 1], '1');
    // The default model is used once, with the tier of quality.
    assert.equal(call[call.indexOf('--image-model') + 1], 'bytedance-seed/seedream-5-5');
    assert.equal(call[call.indexOf('--quality') + 1], 'high');
});

test('the stage uses one model by default and asks extra models only when configured', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-pictures-models-'));
    await mkdir(path.join(root, 'measurements', 'crops'), { recursive: true });
    await writeFile(path.join(root, 'measurements', 'crops', '08-region-bishop-artwork.png'), 'png');

    const { bin: fake, calls } = await fakeImage(root);
    const result = await picturesStage({
        root,
        config: config(),
        inputs: { measurements: sheet() },
        env: { ...process.env, AI_IMAGE_BIN: fake },
    });

    assert.equal(result.ok, true);
    const asked = (await readCalls(calls)).filter((args) => args[0] === 'background');
    assert.equal(asked.length, 1);
    assert.equal(asked[0][asked[0].indexOf('--image-model') + 1], 'bytedance-seed/seedream-5-5');
    assert.equal(result.pictures[0].model, 'bytedance-seed/seedream-5-5');
    assert.deepEqual(result.pictures[0].models, ['bytedance-seed/seedream-5-5']);
    const written = await readFile(path.join(root, 'assets', 'import', 'bishop-artwork.png'), 'utf8');
    assert.equal(written, 'bytedance-seed/seedream-5-5');
});

test('the stage asks extra picture models when configured', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-pictures-models-configured-'));
    await mkdir(path.join(root, 'measurements', 'crops'), { recursive: true });
    await writeFile(path.join(root, 'measurements', 'crops', '08-region-bishop-artwork.png'), 'png');

    const { bin: fake, calls } = await fakeImage(root);
    const settings = config();
    settings.pictures.models = ['openai/gpt-image-2.6-sunburst'];
    const result = await picturesStage({
        root,
        config: settings,
        inputs: { measurements: sheet() },
        env: { ...process.env, AI_IMAGE_BIN: fake },
    });

    const asked = (await readCalls(calls)).filter((args) => args[0] === 'background');
    assert.equal(asked.length, 2);
    assert.deepEqual(asked.map((args) => args[args.indexOf('--image-model') + 1]), [
        'openai/gpt-image-2.6-sunburst',
        'bytedance-seed/seedream-5-5',
    ]);
    assert.deepEqual(result.pictures[0].models, [
        'openai/gpt-image-2.6-sunburst',
        'bytedance-seed/seedream-5-5',
    ]);
});

test('the stage of the pictures works with the sheet that was found', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-pictures-found-'));
    await mkdir(path.join(root, 'measurements', 'crops'), { recursive: true });
    await writeFile(path.join(root, 'measurements', 'crops', '08-region-bishop-artwork.png'), 'png');

    const { bin: fake, calls } = await fakeImage(root);

    const settings = config();
    settings.inputs.measurements = ['measurements.json', 'measurements/measurements.json'];
    const result = await picturesStage({
        root,
        config: settings,
        inputs: { measurements: sheet(), files: { measurements: 'measurements/measurements.json' } },
        env: { ...process.env, AI_IMAGE_BIN: fake },
    });

    assert.equal(result.ok, true);
    assert.equal(result.pictures.length, 1);
    assert.equal(result.pictures[0].file, 'assets/import/bishop-artwork.png');
});

test('the model of the pictures goes to the bridge when the config names it', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-pictures-model-'));
    await mkdir(path.join(root, 'measurements', 'crops'), { recursive: true });
    await writeFile(path.join(root, 'measurements', 'crops', '08-region-bishop-artwork.png'), 'png');

    const { bin: fake, calls } = await fakeImage(root);

    const settings = config();
    settings.pictures.model = 'sourceful/riverflow-v2.6-pro';
    const result = await picturesStage({
        root,
        config: settings,
        inputs: { measurements: sheet() },
        env: { ...process.env, AI_IMAGE_BIN: fake },
    });

    assert.equal(result.ok, true);
    const seen = await readCalls(calls);
    const call = seen.find((args) => args[0] === 'background');
    assert.equal(call[call.indexOf('--image-model') + 1], 'sourceful/riverflow-v2.6-pro');
});

test('the prepared pictures are written to the run and read back', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-pictures-file-'));
    const settings = config();
    const file = await writePictures(root, settings, 'run-1', [{ name: 'bishop artwork', file: 'assets/import/bishop-artwork.png' }]);
    assert.match(file, /\.tmp[\\/]run-1[\\/]pictures\.json$/);
    const back = await readPictures(root, settings, 'run-1');
    assert.equal(back.length, 1);
    assert.equal(back[0].file, 'assets/import/bishop-artwork.png');
    // A run without the file has no pictures.
    assert.deepEqual(await readPictures(root, settings, 'run-2'), []);
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

test('the crops of the measurer are prepared when the sheet names none', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-pictures-disk-'));
    await writeMeasuredCrops(root, [
        { name: 'brand-logo', kind: 'asset', crop: 'crops/01-asset-brand-logo.png', use: 'artwork' },
        { name: 'hero-title', kind: 'detail', crop: 'crops/02-detail-hero-title.png', use: 'text block' },
    ]);
    const { bin, calls } = await fakeImage(root);

    const result = await picturesStage({
        root,
        config: config(),
        inputs: { measurements: { present: false } },
        env: { ...process.env, AI_IMAGE_BIN: bin },
    });

    assert.equal(result.ok, true);
    assert.equal(result.pictures.length, 1);
    // The asset is a picture, the detail is a piece of the screenshot.
    assert.equal(result.pictures[0].name, 'brand-logo');
    assert.equal(result.pictures[0].kind, 'image');
    assert.equal(result.pictures[0].file, 'assets/import/brand-logo.png');
    assert.equal(result.pictures[0].source, 'measurements/crops/01-asset-brand-logo.png');
    assert.equal(result.pictures[0].use, 'artwork');

    // The bridge was asked once: the detail is not a picture.
    const seen = await readCalls(calls);
    const call = seen.find((args) => args[0] === 'background');
    assert.equal(call[1], 'measurements/crops/01-asset-brand-logo.png');
    assert.match(result.text, /Обрезки взяты с диска/);
});

test('the crops are found by their files when the measurer left no list', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-pictures-files-'));
    await mkdir(path.join(root, 'measurements', 'crops'), { recursive: true });
    await writeFile(path.join(root, 'measurements', 'crops', '01-asset-brand-logo.png'), 'png');
    await writeFile(path.join(root, 'measurements', 'crops', '05-detail-hero-title.png'), 'png');
    const { bin } = await fakeImage(root);

    const result = await picturesStage({
        root,
        config: config(),
        inputs: { measurements: { present: false } },
        env: { ...process.env, AI_IMAGE_BIN: bin },
    });

    assert.equal(result.pictures.length, 1);
    assert.equal(result.pictures[0].file, 'assets/import/brand-logo.png');
});

test('the sheet wins over the crops of the disk', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-pictures-sheet-'));
    await writeMeasuredCrops(root, [
        { name: 'brand-logo', kind: 'asset', crop: 'crops/01-asset-brand-logo.png' },
    ]);
    // The crop of the sheet is on the disk too: the sheet is the source of the crops.
    await writeFile(path.join(root, 'measurements', 'crops', '08-region-bishop-artwork.png'), 'png');
    const { bin } = await fakeImage(root);

    const result = await picturesStage({
        root,
        config: config(),
        inputs: { measurements: sheet(), files: { measurements: 'measurements/measurements.json' } },
        env: { ...process.env, AI_IMAGE_BIN: bin },
    });

    assert.equal(result.pictures.length, 1);
    assert.equal(result.pictures[0].name, 'black chess bishop');
    assert.equal(result.pictures[0].file, 'assets/import/bishop-artwork.png');
});

test('the sheet that appeared after the collection is read again', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-pictures-fresh-'));
    await mkdir(path.join(root, 'measurements', 'crops'), { recursive: true });
    await writeFile(path.join(root, 'measurements', 'crops', '08-region-bishop-artwork.png'), 'png');
    await writeFile(path.join(root, 'measurements', 'measurements.json'), JSON.stringify({
        source: 'landing.png',
        unit: 'px',
        elements: [
            { name: 'black chess bishop', kind: 'image', crop: 'crops/08-region-bishop-artwork.png' },
        ],
        regions: [],
    }));
    const { bin } = await fakeImage(root);

    const result = await picturesStage({
        root,
        config: config(),
        inputs: { measurements: { present: false } },
        env: { ...process.env, AI_IMAGE_BIN: bin },
    });

    assert.equal(result.pictures.length, 1);
    assert.equal(result.pictures[0].file, 'assets/import/bishop-artwork.png');
    // The stages after this one get the sheet that is really on the disk.
    assert.equal(result.measurements.present, true);
    assert.equal(result.measurements.source, 'landing.png');
    assert.equal(result.sheetFile, 'measurements/measurements.json');
});

test('the result of the stage keeps the list of the files a list', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-pictures-files-'));
    const result = await picturesStage({
        root,
        config: config(),
        inputs: { measurements: { present: false } },
    });

    // In the result of a stage `files` is the list of the written paths: an object there
    // kills the run of the pipeline. The sheet of the measurements has its own field.
    assert.deepEqual(result.files, undefined);
    assert.equal(result.sheetFile, null);
    assert.deepEqual(pipelineFiles(result), []);
});

test('the crop of the disk that is already prepared is not prepared again', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-pictures-disk-old-'));
    await writeMeasuredCrops(root, [
        { name: 'brand-logo', kind: 'asset', crop: 'crops/01-asset-brand-logo.png' },
    ]);
    await mkdir(path.join(root, 'assets', 'import'), { recursive: true });
    await writeFile(path.join(root, 'assets', 'import', 'brand-logo.png'), 'prepared before');

    const result = await picturesStage({
        root,
        config: config(),
        inputs: { measurements: { present: false } },
        env: { ...process.env, AI_IMAGE_BIN: path.join(root, 'nothing-here.js') },
    });

    assert.equal(result.pictures.length, 1);
    assert.equal(result.pictures[0].bytes, 'prepared before'.length);
});
