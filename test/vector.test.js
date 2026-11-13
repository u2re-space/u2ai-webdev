/**
 * @file test/vector.test.js
 * @module test/vector
 * @purpose The tests of the vector graphics as code and of the stages of the vector and the
 *          icons.
 * @depends node:test, node:path, node:fs/promises, vector/svg, stages/vector, stages/iconify
 * @ai.tags test, vector, icons
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';

import { svgFileName, parseSvg, validateSvg, optimizeSvg, svgSummary } from '../src/vector/svg.js';
import { polishSvgFiles, vectorStage } from '../src/stages/vector.js';
import { iconifyStage, iconFiles } from '../src/stages/iconify.js';

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">\n  <path d="M4 4h16v16H4z" fill="none"/>\n</svg>\n';

/**
 * A client that answers with the ready answers, one per call.
 * @param {object[]} answers
 * @returns {object}
 * @ai.hint pure
 */
function fakeClient(answers = []) {
    let index = 0;
    return {
        responses: {
            /**
             * @param {object} body
             * @returns {Promise<object>}
             */
            async create(body) {
                const answer = answers[index++];
                if (typeof answer === 'function') return await answer(body);
                return answer ?? { output: [], output_text: '' };
            },
        },
    };
}

/**
 * A raw answer of the model: the call of the schema with its arguments.
 * @param {string} name
 * @param {object} args
 * @returns {object}
 * @ai.hint pure
 */
function schemaAnswer(name, args) {
    return {
        id: 'resp-1',
        status: 'completed',
        model: 'test-model',
        output: [{
            type: 'function_call',
            id: 'fc-1',
            call_id: `c-${Math.random().toString(36).slice(2)}`,
            name,
            arguments: JSON.stringify(args),
        }],
    };
}

test('the name of a file of an icon is kebab-case', () => {
    assert.equal(svgFileName('Arrow Left'), 'arrow-left.svg');
    assert.equal(svgFileName('  '), 'graphic.svg');
});

test('the SVG is parsed: the root, the attributes and the view box', () => {
    const parsed = parseSvg(SVG);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.viewBox, '0 0 24 24');
    assert.equal(parsed.attributes.xmlns, 'http://www.w3.org/2000/svg');
    assert.equal(parsed.elements.length, 3);
});

test('a broken SVG is named', () => {
    assert.match(validateSvg('not an svg').errors[0], /<svg>/);
    assert.ok(validateSvg('<svg><path d="M0 0"/></svg>').errors.some((item) => /xmlns/.test(item)));
    assert.ok(validateSvg('<svg xmlns="http://www.w3.org/2000/svg"><script>x()</script></svg>').errors.some((item) => /script/.test(item)));
    assert.ok(validateSvg('<svg xmlns="http://www.w3.org/2000/svg"><g></svg>').errors.some((item) => /closes/.test(item)));
    assert.equal(validateSvg(SVG).ok, true);
});

test('the SVG is tidied without touching the drawing', () => {
    const dirty = `<?xml version="1.0"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
  <!-- a comment -->
  <metadata>noise</metadata>
  <g></g>
  <path d="M4 4h16v16H4z" fill="none"/>
</svg>`;
    const clean = optimizeSvg(dirty);
    assert.doesNotMatch(clean, /comment/);
    assert.doesNotMatch(clean, /metadata/);
    assert.match(clean, /<path d="M4 4h16v16H4z"/);
    assert.ok(clean.length < dirty.length);
});

test('the summary of an SVG holds the size and the view box', () => {
    const summary = svgSummary(SVG);
    assert.equal(summary.ok, true);
    assert.equal(summary.viewBox, '0 0 24 24');
    assert.ok(summary.bytes > 0);
});

test('the stage of the vector checks and tidies the SVG of the step', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-vector-'));
    const client = fakeClient([schemaAnswer('code', {
        summary: 'The logo.',
        files: [{ path: 'assets/logo.svg', content: `<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">\n  <!-- x -->\n  <path d="M4 4h16v16H4z"/>\n</svg>\n`, language: 'svg' }],
        commands: [],
        notes: '',
    })]);

    const result = await vectorStage({
        client,
        config: { output: { work: './.tmp' } },
        root,
        task: 'Make a landing.',
        plan: { steps: [{ id: 'vector-1', title: 'The logo', role: 'editor', files: ['assets/logo.svg'], criteria: ['opens'] }] },
        runId: 'run-1',
    });

    assert.equal(result.ok, true);
    assert.equal(result.svg.broken.length, 0);
    assert.equal(result.svg.polished.length, 1);
    const written = await readFile(path.join(root, 'assets', 'logo.svg'), 'utf8');
    assert.doesNotMatch(written, /<!-- x -->/);
    assert.match(written, /<path/);
});

test('a broken SVG is reported, not hidden', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-vector2-'));
    await writeFile(path.join(root, 'bad.svg'), '<svg><path/></svg>', 'utf8');
    const result = await polishSvgFiles({ root, files: ['bad.svg'] });
    assert.equal(result.polished.length, 0);
    assert.equal(result.broken.length, 1);
    assert.ok(result.broken[0].errors.length);
});

test('the stage of the icons checks that the icons are on the disk', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-icons-'));
    await mkdir(path.join(root, 'assets'));
    await writeFile(path.join(root, 'assets', 'house.svg'), SVG, 'utf8');

    const client = fakeClient([schemaAnswer('icon', {
        summary: 'The icons.',
        set: 'lucide',
        icons: [
            { name: 'house', purpose: 'The home.', size: 24, file: 'assets/house.svg' },
            { name: 'search', purpose: 'The search.', size: 24, file: 'assets/search.svg' },
        ],
        files: [],
        notes: '',
    })]);

    const result = await iconifyStage({
        client,
        config: { output: { work: './.tmp' }, stack: { iconSet: 'auto' } },
        root,
        task: 'Make a landing.',
        plan: { steps: [{ id: 'icon-1', title: 'The icons', role: 'iconifier', files: [], criteria: ['there'] }] },
        runId: 'run-1',
    });

    assert.equal(result.ok, false);
    assert.deepEqual(result.icons.present, ['assets/house.svg']);
    assert.equal(result.icons.missing.length, 1);
    assert.match(result.icons.missing[0].reason, /not in the project/);
    assert.equal(result.iconSet, 'lucide');
    assert.deepEqual(iconFiles([{ file: 'a.svg' }, { file: '' }]), ['a.svg']);
});
