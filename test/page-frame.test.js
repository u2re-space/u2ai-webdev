/**
 * @file test/page-frame.test.js
 * @module test/page-frame
 * @purpose The tests of the frame of the page: the canvas inside the body, the width of the
 *          design and the scale that fits the canvas into the window.
 * @depends node:test, node:path, node:os, node:fs/promises, roles/index, roles/page-frame,
 *          roles/reference, inputs/references, inputs/assets, stages/step
 * @ai.tags test, roles, styles, layout
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, writeFile } from 'node:fs/promises';

import { ROLES } from '../src/roles/index.js';
import {
    PAGE_CLASS,
    PAGE_FRAME_CONTRACT,
    PAGE_WIDTH_TOKEN,
    ZOOM_TOKEN,
    DEFAULT_PAGE_WIDTH,
    pageFrameRules,
    pageScaleRules,
    pageWidthNote,
} from '../src/roles/page-frame.js';
import { referenceNote } from '../src/roles/reference.js';
import { readReferences } from '../src/inputs/references.js';
import { imageSize } from '../src/inputs/assets.js';
import { referenceList } from '../src/stages/step.js';

/** A PNG header with the size of a picture of 2000×1500 pixels. */
const PNG = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0, 0, 0x07, 0xd0, 0, 0, 0x05, 0xdc, 0, 0, 0, 0x01, 0, 0, 0, 0,
]);

/**
 * The text of a prompt in one line: the rules are wrapped for the eye, not for the machine.
 * @param {string} text
 * @returns {string}
 */
function flat(text) {
    return String(text ?? '').replace(/\s+/g, ' ');
}

test('the markup writes the canvas inside the body', () => {
    const text = flat(ROLES.markup.instructions({}));

    assert.match(text, /The frame of the page/);
    assert.ok(text.includes(`class \`${PAGE_CLASS}\``), 'the canvas has no class');
    assert.match(text, /The body holds one canvas element/);
    // The markup does not repeat the properties of the canvas.
    assert.match(text, /does not repeat these properties/);
});

test('the styles give the canvas the width of the design and the scale', () => {
    const text = flat(ROLES.styler.instructions({}));

    assert.match(text, /The canvas of the page and the scale/);
    // The body is the container of the width, not a scroller of its own.
    assert.match(text, /container-type: inline-size;/);
    assert.ok(text.includes(`inline-size: var(${PAGE_WIDTH_TOKEN}, ${DEFAULT_PAGE_WIDTH});`), 'no width');
    // The scale takes the width the body has without the scrollbar of the window: the canvas
    // has to fit the window, or the page is wider than the window it is shown in.
    assert.ok(
        text.includes(`${ZOOM_TOKEN}: calc(100cqi / var(${PAGE_WIDTH_TOKEN}, ${DEFAULT_PAGE_WIDTH}));`),
        'no scale',
    );
    assert.ok(text.includes(`zoom: var(${ZOOM_TOKEN}, 1);`), 'no zoom');
    // The body is at least as tall as the viewport.
    assert.match(text, /min-block-size: 100dvh;/);
    assert.match(text, /The background of the page belongs to the canvas/);
    assert.ok(text.includes('scrollbar-width: thin;'), 'scrollbar width is not explicit');
    assert.ok(
        text.includes('scrollbar-color: contrast-color(var(--background-color)) var(--background-color);'),
        'scrollbar thumb and track colors are missing or reversed',
    );
    assert.ok(text.includes('@supports not (scrollbar-color: auto)'), 'scrollbar fallback is missing');
    // The page has one scrollbar: the document scrolls, the body does not.
    assert.match(text, /The page has one scrollbar/);
    assert.match(text, /Never put/);
    // The CSS of the frame does not make the page a scroller of its own.
    const css = pageFrameRules().split('```css')[1]?.split('```')[0] ?? '';
    assert.doesNotMatch(css, /overflow[^:]*:\s*(auto|scroll|hidden)/, 'the frame gives the body a scroller of its own');
    // The narrow screen is not scaled.
    assert.match(text, /inline-size: 100%; zoom: 1;/);
});

test('both roles receive the binding page-frame contract even when the step does not name it', async () => {
    const contract = flat(PAGE_FRAME_CONTRACT);
    const markup = flat(ROLES.markup.instructions({}));
    const styler = flat(ROLES.styler.instructions({}));
    for (const text of [contract, markup, styler]) {
        assert.match(text, /--real-page-width/);
        assert.match(text, /--zoom/);
        assert.match(text, /inline-size: var/);
        assert.match(text, /narrow widths/);
    }
    assert.match(contract, /applies across partial steps/);
});

test('the architect decides the width of the design', () => {
    const text = flat(ROLES.architect.instructions({}));

    assert.ok(text.includes(`\`${PAGE_WIDTH_TOKEN}\` says how wide the page really is`), 'no token');
    assert.match(text, /reference image's pixel dimensions as a useful estimate/);
    assert.match(text, /infer a practical canvas width/);
});

test('the roles that do not write the frontend get no canvas', () => {
    for (const name of ['planner', 'installer', 'learner']) {
        const text = flat(ROLES[name].instructions({}));
        assert.doesNotMatch(text, /The frame of the page/, `the role ${name} has a frame`);
        assert.doesNotMatch(text, /The canvas of the page and the scale/, `the role ${name} has a canvas`);
    }
});

test('the rules of the frame are the same text for every run', () => {
    assert.equal(pageFrameRules(), pageFrameRules());
    assert.match(pageFrameRules(), /## The frame of the page/);
    assert.match(pageScaleRules(), /## The canvas of the page and the scale/);
});

test('the note about the width is silent without a reference', () => {
    assert.equal(pageWidthNote({}), '');
    assert.equal(pageWidthNote({ referenceSizes: [] }), '');
    assert.equal(pageWidthNote({ referenceSizes: [{ path: 'a.png', width: null, height: null }] }), '');
});

test('the note about the width treats image pixels as a hint, not a required measurement', () => {
    const text = flat(pageWidthNote({ referenceSizes: [{ path: 'landing.jpg', width: 2000, height: 1500 }] }));

    assert.match(text, /The width of the design is not the width of the picture/);
    assert.ok(text.includes(`\`${PAGE_WIDTH_TOKEN}\``), 'no token');
    assert.match(text, /infer a practical width from visible typography and layout/);
    assert.match(text, /not as a required measurement/);
});

test('the note about the reference names the size of the picture', () => {
    const text = referenceNote({
        reference: ['landing.jpg'],
        referenceSizes: [{ path: 'landing.jpg', width: 2000, height: 1500 }],
    });

    assert.match(text, /landing\.jpg \(2000×1500 pixels\)/);
});

test('the note about the reference without sizes says nothing about them', () => {
    const text = referenceNote({ reference: ['landing.jpg'] });

    assert.match(text, /landing\.jpg/);
    assert.doesNotMatch(text, /pixels/);
});

test('the size of the picture is read from its header', () => {
    assert.deepEqual(imageSize(PNG, 'image/png'), { width: 2000, height: 1500 });
    assert.deepEqual(imageSize(Buffer.alloc(4), 'image/png'), { width: null, height: null });
});

test('the reference comes with its size in pixels', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-frame-'));
    await writeFile(path.join(root, 'landing.png'), PNG);

    const read = await readReferences(root, [{ path: 'landing.png', mime: 'image/png' }]);

    assert.deepEqual(read.names, ['landing.png']);
    assert.deepEqual(read.sizes, [{ path: 'landing.png', width: 2000, height: 1500 }]);
});

test('the list of the references carries the size', () => {
    const list = referenceList({
        names: ['landing.jpg', 'logo.png'],
        sizes: [{ path: 'landing.jpg', width: 2000, height: 1500 }],
    });

    assert.equal(list, 'landing.jpg (2000×1500 pixels), logo.png');
});
