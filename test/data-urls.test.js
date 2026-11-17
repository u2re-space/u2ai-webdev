/**
 * @file test/data-urls.test.js
 * @module test/data-urls
 * @purpose The tests of the data URLs: they are cut out of the text of a message and put
 *          into the request as what they are — a picture, a file, a text.
 * @depends node:test, shared/data-urls, openai/responses
 * @ai.tags test, data-urls, images, requests
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
    assetNote,
    assetPart,
    dataUrlExtension,
    scrubDataUrls,
    scrubItems,
} from '../src/shared/data-urls.js';
import { buildResponsesBody } from '../src/openai/responses.js';

/** A small PNG as a data URL. */
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

/** A PDF as a data URL. */
const PDF = 'data:application/pdf;base64,JVBERi0xLjQKJcOkw7zDtsOfCjIgMCBvYmoKPDwvTGVuZ3RoIDMgMCBSL0ZpbHRlci9GbGF0ZURlY29kZT4+CnN0cmVhbQp4nDPQM1Qo5ypUMABCA==';

/** A text as a data URL. */
const TEXT = 'data:text/plain,%D0%BF%D1%80%D0%B8%D0%B2%D0%B5%D1%82';

test('a data URL is cut out of the text and replaced with a note', () => {
    const { text, assets } = scrubDataUrls(`Here is the picture: ${PNG} — and the rest.`);
    assert.ok(!text.includes('base64'));
    assert.match(text, /\[picture attached: image\/png, \d+ B\]/);
    assert.match(text, /and the rest/);
    assert.equal(assets.length, 1);
    assert.equal(assets[0].kind, 'image');
    assert.equal(assets[0].mime, 'image/png');
    assert.ok(assets[0].bytes > 0);
});

test('a picture goes into the request as a picture', () => {
    const { assets } = scrubDataUrls(PNG);
    const part = assetPart(assets[0]);
    assert.equal(part.type, 'input_image');
    assert.match(part.image_url, /^data:image\/png;base64,/);
});

test('a file goes into the request as a file', () => {
    const { text, assets } = scrubDataUrls(`The document: ${PDF}`);
    assert.match(text, /\[file attached: application\/pdf,/);
    const part = assetPart(assets[0]);
    assert.equal(part.type, 'input_file');
    assert.equal(part.filename, 'data-1.pdf');
    assert.ok(part.file_data.length > 0);
});

test('a text goes into the request as a text', () => {
    const { text, assets } = scrubDataUrls(`Say it: ${TEXT}`);
    assert.match(text, /\[text attached: text\/plain,/);
    const part = assetPart(assets[0]);
    assert.equal(part.type, 'input_text');
    assert.equal(part.text, 'привет');
});

test('the words of a message without a data URL are not touched', () => {
    const body = 'The field data: the schema says nothing about it.';
    const { text, assets } = scrubDataUrls(body);
    assert.equal(text, body);
    assert.equal(assets.length, 0);
});

test('every data URL of a message is cut out', () => {
    const { text, assets } = scrubDataUrls(`${PNG} and ${PDF} and ${TEXT}`);
    assert.equal(assets.length, 3);
    assert.ok(!text.includes('base64'));
    assert.equal(assets.filter((asset) => asset.kind === 'image').length, 1);
    assert.equal(assets.filter((asset) => asset.kind === 'file').length, 1);
    assert.equal(assets.filter((asset) => asset.kind === 'text').length, 1);
});

test('the conversation of a role is cut out as well', () => {
    const { items, assets } = scrubItems([
        { role: 'user', content: [{ type: 'input_text', text: `look: ${PNG}` }] },
        { type: 'function_call_output', call_id: 'c1', output: `the file: ${PDF}` },
    ]);
    assert.equal(assets.length, 2);
    assert.ok(!JSON.stringify(items).includes('base64'));
    assert.match(items[0].content[0].text, /\[picture attached/);
    assert.match(items[1].output, /\[file attached/);
});

test('the request carries the picture as a part and not as text', () => {
    const body = buildResponsesBody({
        model: 'test',
        input: `The picture of the reference: ${PNG}`,
    });
    const content = body.input[0].content;
    const text = content.filter((part) => part.type === 'input_text').map((part) => part.text).join('');
    assert.ok(!text.includes('base64'));
    assert.match(text, /\[picture attached: image\/png,/);
    const image = content.find((part) => part.type === 'input_image');
    assert.ok(image);
    assert.match(image.image_url, /^data:image\/png;base64,/);
});

test('the request of a conversation carries the assets at the end', () => {
    const body = buildResponsesBody({
        model: 'test',
        input: [
            { role: 'user', content: [{ type: 'input_text', text: `look: ${PNG}` }] },
        ],
    });
    const last = body.input[body.input.length - 1];
    assert.equal(last.role, 'user');
    assert.ok(last.content.some((part) => part.type === 'input_image'));
    assert.ok(!JSON.stringify(body.input[0]).includes('base64'));
});

test('the names of the files are known by their type', () => {
    assert.equal(dataUrlExtension('image/png'), 'png');
    assert.equal(dataUrlExtension('image/jpeg'), 'jpg');
    assert.equal(dataUrlExtension('application/pdf'), 'pdf');
    assert.equal(dataUrlExtension('application/x-whatever'), 'whatever');
    assert.match(assetNote({ kind: 'image', mime: 'image/png', bytes: 2048 }), /2\.0 KB/);
});
