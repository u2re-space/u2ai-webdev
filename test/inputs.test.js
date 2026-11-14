/**
 * @file test/inputs.test.js
 * @module test/inputs
 * @purpose The tests of the inputs: `DESIGN.md`, `measurements.json`, `palette.json`,
 *          `tokens.css`, the pictures and the instructions of the project.
 * @depends node:test, inputs/index, inputs/design-md, inputs/measurements, inputs/palette,
 *          inputs/tokens, inputs/assets
 * @ai.tags test, inputs
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';

import { parseDesignMd, parseTokensBlock, conflictsBetween } from '../src/inputs/design-md.js';
import { parseMeasurements, pxToRem } from '../src/inputs/measurements.js';
import { parsePalette, contrastRatio, paletteTokens } from '../src/inputs/palette.js';
import { parseTokensCss, tokenValue } from '../src/inputs/tokens.js';
import { detectImageMime, listImages, readProjectInstructions } from '../src/inputs/assets.js';
import { collectInputs, inputContext, inputSummary } from '../src/inputs/index.js';
import { findReferences, readReferences } from '../src/inputs/references.js';
import { defaults } from '../src/config.js';

const DESIGN_MD = `# Design tokens

## Colours

| Token | Hex | Name |
| --- | --- | --- |
| \`--color-bg\` | \`#ffffff\` | background |
| \`--color-ink\` | \`#101828\` | text |

## Typography

- Heading: 32px / 1.2
- Body: 16px / 1.5

## Spacing

- space-1: 4px
- space-2: 8px

## Components

- Card
- Header
`;

const MEASUREMENTS = {
    source: 'ref.png',
    unit: 'px',
    confidence: 'high',
    units: { source: 'px', rootFontSize: 16, preferred: ['rem', 'px'] },
    canvas: { x: 0, y: 0, width: 1440, height: 900 },
    elements: [
        {
            name: 'card',
            kind: 'box',
            box: { x: 100, y: 200, width: 320, height: 180 },
            radius: 12,
            gap: 16,
            typography: { role: 'body', family: 'Inter', fontSize: 16, weight: 400, lineHeight: 24 },
            confidence: 'high',
        },
    ],
    regions: [
        { name: 'hero', kind: 'section', box: { x: 0, y: 0, width: 1440, height: 400 }, crop: 'crops/hero.png' },
    ],
    rules: [
        { name: 'space-2', value: 8, unit: 'px', css: '--space-2: 0.5rem' },
    ],
    assumptions: ['the root font size is 16px'],
};

const PALETTE = {
    name: 'reference',
    source: 'ref.png',
    background: '#ffffff',
    text: '#101828',
    accent: '#3355ff',
    colors: [
        { name: 'background', token: '--color-background', hex: '#ffffff', method: 'sampled', confidence: 'high' },
        { name: 'text', token: '--color-text', hex: '#101828', method: 'sampled', confidence: 'high' },
    ],
};

const TOKENS_CSS = `:root {
  --color-background: #ffffff;
  --color-text: #101828;
  --space-2: 0.5rem;
}

.button {
  color: var(--color-text);
}
`;

test('the design document is read into its parts', () => {
    const design = parseDesignMd(DESIGN_MD);
    assert.equal(design.present, true);
    assert.ok(design.colors.some((color) => color.token === '--color-bg' && color.value === '#ffffff'));
    assert.ok(design.typography.some((item) => item.name === 'Heading'));
    assert.ok(design.spacing.some((item) => item.name === 'space-2' && item.value === '8px'));
    assert.ok(design.components.includes('Card'));
    assert.ok(design.sections.some((section) => /Colours/i.test(section.title)));
});

test('an empty design document is absent, not broken', () => {
    const design = parseDesignMd('   ');
    assert.equal(design.present, false);
    assert.deepEqual(design.tokens, []);
});

test('the tokens of a text are read in every form', () => {
    const tokens = parseTokensBlock([
        '--color-bg: #fff',
        '- `--space-2`: 0.5rem',
        '| `--radius` | 8px |',
    ].join('\n'));
    assert.deepEqual(tokens.map((token) => token.name), ['--color-bg', '--space-2', '--radius']);
});

test('the same token with two values is a conflict', () => {
    const conflicts = conflictsBetween(
        [{ name: '--color-bg', value: '#fff' }],
        [{ name: '--color-bg', value: '#000' }],
    );
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0].second, '#000');
});

test('the measurement sheet is read with the sizes in rem', () => {
    const sheet = parseMeasurements(JSON.stringify(MEASUREMENTS));
    assert.equal(sheet.present, true);
    assert.equal(sheet.rootFontSize, 16);
    assert.equal(sheet.elements.length, 1);
    assert.equal(sheet.elements[0].widthRem, 20);
    assert.equal(sheet.elements[0].gapRem, 1);
    assert.equal(sheet.elements[0].typography.fontSizeRem, 1);
    assert.equal(sheet.regions[0].crop, 'crops/hero.png');
    assert.equal(sheet.spacing[0].rem, 0.5);
});

test('a broken measurement sheet is reported, not thrown', () => {
    const sheet = parseMeasurements('{not json');
    assert.equal(sheet.present, false);
    assert.ok(sheet.warnings.length);
});

test('the pixels become rem by the root font size', () => {
    assert.equal(pxToRem(24, 16), 1.5);
    assert.equal(pxToRem(24, 0), null);
});

test('the palette is read with the contrast of every colour', () => {
    const palette = parsePalette(JSON.stringify(PALETTE));
    assert.equal(palette.present, true);
    assert.equal(palette.colors.length, 2);
    assert.equal(palette.colors[0].contrast, 1);
    assert.ok(contrastRatio('#ffffff', '#101828') > 10);
    assert.ok(paletteTokens(palette).some((token) => token.name === '--color-background'));
});

test('the tokens of a stylesheet are read', () => {
    const tokens = parseTokensCss(TOKENS_CSS);
    assert.equal(tokens.present, true);
    assert.equal(tokens.tokens.length, 3);
    assert.equal(tokenValue(tokens.tokens, '--space-2'), '0.5rem');
    assert.equal(tokens.selectors.length, 1);
    assert.equal(tokens.selectors[0].selector, '.button');
});

test('the mime type of a picture is read by its name and by its bytes', () => {
    assert.equal(detectImageMime('a.png'), 'image/png');
    assert.equal(detectImageMime('a.unknown'), null);
    assert.equal(detectImageMime('a.unknown', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0, 0, 0, 0])), 'image/png');
});

test('the pictures of the project are found', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-assets-'));
    await mkdir(path.join(root, 'img'), { recursive: true });
    await writeFile(path.join(root, 'img', 'logo.png'), 'x');
    await writeFile(path.join(root, 'img', 'notes.txt'), 'x');
    const list = await listImages({ root, dir: '.' });
    assert.equal(list.length, 1);
    assert.equal(list[0].path, 'img/logo.png');
});

test('the instructions of the project are read', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-inst-'));
    await writeFile(path.join(root, 'AGENTS.md'), 'Use the design tokens.');
    const found = await readProjectInstructions({ root });
    assert.equal(found.files.length, 1);
    assert.match(found.text, /Use the design tokens/);
});

test('the inputs of a run are collected and put into one context', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-inputs-'));
    await writeFile(path.join(root, 'DESIGN.md'), DESIGN_MD);
    await writeFile(path.join(root, 'measurements.json'), JSON.stringify(MEASUREMENTS, null, 2));
    await writeFile(path.join(root, 'palette.json'), JSON.stringify(PALETTE, null, 2));
    await writeFile(path.join(root, 'tokens.css'), TOKENS_CSS);

    const config = structuredClone(defaults);
    const collected = await collectInputs({ root, config, task: 'Make the page.' });
    const summary = inputSummary(collected);
    assert.equal(summary.design, true);
    assert.equal(summary.measurements, true);
    assert.equal(summary.palette, true);
    assert.equal(summary.tokens, true);

    const text = inputContext(collected);
    assert.match(text, /Make the page/);
    assert.match(text, /--color-bg/);
    assert.match(text, /--space-2/);
    assert.match(text, /Measurements/);
});

test('a missing input is a warning, not an error', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-inputs2-'));
    const config = structuredClone(defaults);
    const collected = await collectInputs({ root, config, task: 'x' });
    const summary = inputSummary(collected);
    assert.equal(summary.design, false);
    assert.ok(summary.warnings.some((line) => line.includes('DESIGN.md')));
});

test('the reference of the design is found by its name', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-refs-'));
    // The same picture in two formats is one picture.
    await writeFile(path.join(root, 'landing.png'), 'png');
    await writeFile(path.join(root, 'landing.jpg'), 'jpg');
    await writeFile(path.join(root, 'logo.svg'), '<svg></svg>');
    const config = structuredClone(defaults);

    const found = await findReferences({ root, config, task: 'Make the landing.' });

    assert.equal(found.length, 1);
    assert.equal(found[0].path, 'landing.png');
});

test('the file that the task names is the reference', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-refs2-'));
    await writeFile(path.join(root, 'screen.png'), 'png');
    const config = structuredClone(defaults);

    const found = await findReferences({ root, config, task: 'Repeat the screen.png exactly.' });

    assert.equal(found.length, 1);
    assert.equal(found[0].path, 'screen.png');
});

test('the config names the reference outright', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-refs3-'));
    await writeFile(path.join(root, 'picture.png'), 'png');
    const config = structuredClone(defaults);
    config.inputs.reference = 'picture.png';

    const found = await findReferences({ root, config, task: 'Make the page.' });

    assert.equal(found.length, 1);
    assert.equal(found[0].path, 'picture.png');
});

test('the reference goes into the request as a picture', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-refs4-'));
    await writeFile(path.join(root, 'landing.png'), 'png');

    const read = await readReferences(root, [{ path: 'landing.png', mime: 'image/png' }]);

    assert.equal(read.parts.length, 1);
    assert.equal(read.parts[0].type, 'input_image');
    assert.match(read.parts[0].image_url, /^data:image\/png;base64,/);
    assert.deepEqual(read.names, ['landing.png']);
});

test('the collected inputs carry the reference', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-refs5-'));
    await writeFile(path.join(root, 'landing.png'), 'png');
    const config = structuredClone(defaults);

    const collected = await collectInputs({ root, config, task: 'Make the landing.' });

    assert.equal(inputSummary(collected).references, 1);
    assert.match(inputContext(collected), /The reference of the design/);
});

test('the essence of the task is read and goes into the context', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-essence-'));
    await writeFile(path.join(root, 'what-needs.md'), '# What needs\n\n- the drop menu works\n');
    const config = structuredClone(defaults);
    config.inputs.extra = ['what-needs.md'];

    const collected = await collectInputs({ root, config, task: 'Make the landing.' });

    assert.equal(inputSummary(collected).essence, 1);
    const text = inputContext(collected);
    assert.match(text, /# The essence of the task/);
    assert.match(text, /the drop menu works/);
});

test('a missing essence is a warning, not an error', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-essence2-'));
    const config = structuredClone(defaults);
    config.inputs.extra = ['what-needs.md'];

    const collected = await collectInputs({ root, config, task: 'x' });

    assert.equal(inputSummary(collected).essence, 0);
    assert.ok(collected.warnings.some((line) => line.includes('what-needs.md')));
});

test('the reference of the config is found in a nested directory', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-refs6-'));
    await mkdir(path.join(root, '.ai', 'refs'), { recursive: true });
    await writeFile(path.join(root, '.ai', 'refs', 'shot.png'), 'png');
    const config = structuredClone(defaults);
    config.inputs.reference = ['.ai/refs/shot.png'];

    const found = await findReferences({ root, config, task: 'Make the page.' });

    assert.equal(found.length, 1);
    assert.equal(found[0].path, '.ai/refs/shot.png');
});
