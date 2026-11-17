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
    sniffType,
} from '../src/shared/data-urls.js';
import { buildResponsesBody } from '../src/openai/responses.js';

/** A small PNG as a data URL. */
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

/** A PDF as a data URL: the bytes of a real (tiny) PDF, encoded. */
const PDF = `data:application/pdf;base64,${Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n%%EOF\n', 'latin1').toString('base64')}`;

/** A text as a data URL. */
const TEXT = 'data:text/plain,%D0%BF%D1%80%D0%B8%D0%B2%D0%B5%D1%82';

/** The bytes of the small PNG. */
const PNG_BYTES = Buffer.from(PNG.split(',')[1], 'base64');

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

test('the name of the caller is a claim, the bytes are the fact', () => {
    // A picture that came as a blob is a picture.
    const blob = `data:application/octet-stream;base64,${PNG_BYTES.toString('base64')}`;
    const { text, assets } = scrubDataUrls(blob);
    assert.equal(assets[0].kind, 'image');
    assert.equal(assets[0].mime, 'image/png');
    assert.equal(assets[0].claimed, 'application/octet-stream');
    // The note names both: the model knows what the file really is.
    assert.match(text, /\[picture attached: application\/octet-stream → image\/png,/);
    assert.equal(assetPart(assets[0]).type, 'input_image');

    // A binary that came as a text is a file.
    const lied = `data:text/plain;base64,${Buffer.from([0x00, 0x01, 0x02, 0x03, 0xff]).toString('base64')}`;
    const binary = scrubDataUrls(lied);
    assert.equal(binary.assets[0].kind, 'file');
    assert.equal(binary.assets[0].text, null);
    assert.equal(assetPart(binary.assets[0]).type, 'input_file');
});

test('the type of the payload is known by its bytes', () => {
    assert.deepEqual(sniffType(PNG_BYTES), { mime: 'image/png', kind: 'image', text: null });
    assert.deepEqual(sniffType(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00])), { mime: 'image/jpeg', kind: 'image', text: null });
    assert.equal(sniffType(Buffer.from('GIF89a....')).mime, 'image/gif');
    assert.equal(sniffType(Buffer.from('%PDF-1.7')).mime, 'application/pdf');
    assert.equal(sniffType(Buffer.from('PK\x03\x04rest')).mime, 'application/zip');
    assert.equal(sniffType(Buffer.from('RIFF____WEBPVP8 ')).mime, 'image/webp');
    assert.equal(sniffType(Buffer.from('RIFF____WAVEfmt ')).mime, 'audio/wav');
    assert.equal(sniffType(Buffer.from('hello, world')).kind, 'text');
    assert.equal(sniffType(Buffer.from('{"a":1}')).mime, 'application/json');
    assert.equal(sniffType(Buffer.from('<!doctype html><html>')).kind, 'text');
    assert.equal(sniffType(Buffer.from('<svg xmlns="x"></svg>')).mime, 'image/svg+xml');
    // The bytes that are not text are not text.
    assert.equal(sniffType(Buffer.from([0x00, 0x01, 0x02, 0x03])).kind, 'file');
});

test('a json that came as a blob is a text', () => {
    const blob = `data:application/octet-stream;base64,${Buffer.from('{"name":"Hubfolio"}').toString('base64')}`;
    const { assets } = scrubDataUrls(blob);
    assert.equal(assets[0].kind, 'text');
    assert.equal(assets[0].mime, 'application/json');
    assert.equal(assetPart(assets[0]).text, '{"name":"Hubfolio"}');
});

test('a payload that pretends to be base64 is read as the text it is', () => {
    const fake = 'data:image/png;base64,this%20is%20not%20base64%20at%20all';
    const { assets } = scrubDataUrls(fake);
    assert.equal(assets[0].kind, 'text');
    assert.match(assets[0].text, /not base64/);
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
