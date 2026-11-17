/**
 * @file test/image-compare.test.js
 * @module test/image-compare
 * @purpose The tests of the comparison of a page with the reference: the candidates of the PPI,
 *          the choice of the scale, the numbers of the difference and the picture of it.
 * @depends node:test, node:zlib, node:fs/promises, agent/image-compare, agent/image-magick,
 *          stages/vision
 * @ai.tags test, images, compare, reference
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';

import {
    DEFAULT_DPR_CANDIDATES,
    MAX_DESIGN_WIDTH,
    MIN_DESIGN_WIDTH,
    pickScale,
    scaleCandidates,
    similarityOf,
    compareWithReference,
} from '../src/agent/image-compare.js';
import { parseMetric, findMagick } from '../src/agent/image-magick.js';
import { comparisonNote, designWidth } from '../src/stages/vision.js';

/** The table of the CRC, for the chunks of a PNG. */
const CRC_TABLE = (() => {
    const table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        table[n] = c;
    }
    return table;
})();

/**
 * The CRC of a chunk of a PNG.
 * @param {Buffer} bytes
 * @returns {number}
 */
function crc32(bytes) {
    let crc = -1;
    for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    return (crc ^ -1) >>> 0;
}

/**
 * A chunk of a PNG: the length, the name, the data and the CRC.
 * @param {string} name
 * @param {Buffer} data
 * @returns {Buffer}
 */
function chunk(name, data) {
    const head = Buffer.alloc(4);
    head.writeUInt32BE(data.length, 0);
    const body = Buffer.concat([Buffer.from(name, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body), 0);
    return Buffer.concat([head, body, crc]);
}

/**
 * A picture of a solid colour with a stripe of another colour.
 *
 * The pictures of the test are made here: the test does not need a file of the project and
 * does not need a network.
 * @param {number} width
 * @param {number} height
 * @param {[number, number, number]} base
 * @param {[number, number, number]} stripe
 * @returns {Buffer} the PNG
 */
function picture(width, height, base, stripe) {
    const raw = Buffer.alloc((width * 3 + 1) * height);
    let offset = 0;
    for (let y = 0; y < height; y++) {
        raw[offset] = 0;
        offset += 1;
        for (let x = 0; x < width; x++) {
            const colour = x > width / 2 ? stripe : base;
            raw[offset] = colour[0];
            raw[offset + 1] = colour[1];
            raw[offset + 2] = colour[2];
            offset += 3;
        }
    }
    const head = Buffer.alloc(13);
    head.writeUInt32BE(width, 0);
    head.writeUInt32BE(height, 4);
    head[8] = 8;
    head[9] = 2;
    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk('IHDR', head),
        chunk('IDAT', deflateSync(raw)),
        chunk('IEND', Buffer.alloc(0)),
    ]);
}

/**
 * A project with a reference and a picture of a page.
 * @returns {Promise<{ root: string, cleanup: () => Promise<void> }>}
 */
async function project() {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-compare-'));
    await writeFile(path.join(root, 'landing.png'), picture(128, 96, [220, 30, 40], [30, 30, 220]));
    await writeFile(path.join(root, 'page.png'), picture(200, 150, [220, 30, 40], [30, 30, 220]));
    return {
        root,
        cleanup: async () => {
            const { rm } = await import('node:fs/promises');
            await rm(root, { recursive: true, force: true });
        },
    };
}

test('the PPI of the reference is a list of candidates', () => {
    const candidates = scaleCandidates({ referenceWidth: 2880, referenceHeight: 1800 });
    assert.equal(candidates.length, DEFAULT_DPR_CANDIDATES.length);
    assert.deepEqual(candidates.map((item) => item.dpr), [...DEFAULT_DPR_CANDIDATES]);
    // 2880 pixels at 2x is a page of 1440 pixels.
    const two = candidates.find((item) => item.dpr === 2);
    assert.equal(two.width, 1440);
    assert.equal(two.height, 900);
    assert.equal(two.sane, true);
});

test('a page of a silly width is not a candidate', () => {
    // A picture of 200 pixels is not a page of a desktop: at 1x it is too narrow.
    const narrow = scaleCandidates({ referenceWidth: 200, referenceHeight: 300 });
    assert.equal(narrow.find((item) => item.dpr === 1).sane, false);
    // A picture of 5000 pixels is not a page either: at 1x it is too wide.
    const wide = scaleCandidates({ referenceWidth: 5000, referenceHeight: 3000 });
    assert.equal(wide.find((item) => item.dpr === 1).sane, false);
    assert.equal(wide.find((item) => item.dpr === 2).width, 2500);
    assert.equal(wide.find((item) => item.dpr === 2).sane, true);
    assert.ok(MIN_DESIGN_WIDTH < MAX_DESIGN_WIDTH);
});

test('the scale of the reference follows the width of the page', () => {
    // A picture of 2880 pixels for a page of 1440 pixels is a 2x picture.
    const retina = pickScale({ referenceWidth: 2880, referenceHeight: 1800, targetWidth: 1440 });
    assert.equal(retina.dpr, 2);
    assert.equal(retina.width, 1440);

    // A picture of 1024 pixels for the same page is a narrow design: it is 1x.
    const narrow = pickScale({ referenceWidth: 1024, referenceHeight: 768, targetWidth: 1440 });
    assert.equal(narrow.dpr, 1);
    assert.equal(narrow.width, 1024);
    assert.match(narrow.reason, /1x/);
});

test('the similarity is a percent', () => {
    assert.equal(similarityOf({ rmse: 0 }), 100);
    assert.equal(similarityOf({ rmse: 1 }), 0);
    assert.equal(similarityOf({ rmse: 0.25 }), 75);
    assert.equal(similarityOf({}), null);
    // The structural similarity is the second hand.
    assert.equal(similarityOf({ ssim: 0.8 }), 80);
});

test('the number of a metric is read out of the answer of ImageMagick', () => {
    const parsed = parseMetric('41443 (0.63238)');
    assert.equal(parsed.value, 41443);
    assert.equal(parsed.normalized, 0.63238);
    assert.equal(parseMetric('0 (0)').normalized, 0);
    assert.equal(parseMetric('nothing here'), null);
});

test('the width of the design is known by the reference', () => {
    const design = designWidth({ reference: { width: 2880, height: 1800 }, targetWidth: 1440 });
    assert.equal(design.dpr, 2);
    assert.equal(design.width, 1440);
    assert.equal(designWidth({ reference: null, targetWidth: 1440 }), null);
});

test('the comparison is measured at one size and the report says which', async () => {
    const { root, cleanup } = await project();
    try {
        const calls = [];
        const backend = {
            name: 'fake',
            version: '0',
            compare: async (request) => {
                calls.push(request);
                return { rmse: 0.25, ssim: 0.8, ncc: 0.7, psnr: 10, diffPath: null, warnings: [] };
            },
        };
        const report = await compareWithReference({
            root,
            reference: 'landing.png',
            result: 'page.png',
            targetWidth: 128,
            backend,
        });
        assert.equal(report.ok, true);
        assert.equal(report.reference.width, 128);
        assert.equal(report.result.width, 200);
        // Every PPI is tried, and every candidate is measured at one size.
        assert.equal(calls.length, DEFAULT_DPR_CANDIDATES.length);
        for (const call of calls) {
            assert.ok(call.width > 0 && call.height > 0);
        }
        // The chosen scale is the one the width of the page asks for.
        assert.equal(report.design.dpr, 1);
        assert.equal(report.similarity, 75);
        assert.equal(report.candidates.length, DEFAULT_DPR_CANDIDATES.length);
    } finally {
        await cleanup();
    }
});

test('the words of the comparison tell the role what to fix', () => {
    const note = comparisonNote({
        ok: true,
        reference: { width: 2880, height: 1800 },
        result: { width: 1440, height: 900 },
        design: { dpr: 2, width: 1440 },
        metrics: { rmse: 0.25, ssim: 0.8, ncc: 0.7 },
        similarity: 75,
        difference: { rel: '.ai/shots/diff-landing.png' },
    });
    assert.match(note, /2880x1800/);
    assert.match(note, /2x/);
    assert.match(note, /1440 CSS pixels/);
    assert.match(note, /75%/);
    assert.match(note, /diff-landing\.png/);
    assert.equal(comparisonNote(null), '');
    assert.equal(comparisonNote({ ok: false }), '');
});

test('the real ImageMagick measures the difference of two pictures', async () => {
    const magick = await findMagick({});
    if (!magick) {
        // The house works without ImageMagick: the comparison is simply not done.
        return;
    }
    const { root, cleanup } = await project();
    try {
        const same = await compareWithReference({
            root,
            reference: 'landing.png',
            result: 'landing.png',
            targetWidth: 128,
        });
        assert.equal(same.ok, true);
        assert.equal(same.backend, 'native');
        // The picture is compared with itself: there is no difference.
        assert.ok(same.metrics.rmse < 0.001, `rmse=${same.metrics.rmse}`);
        assert.ok(same.similarity >= 99, `similarity=${same.similarity}`);

        const other = await compareWithReference({
            root,
            reference: 'landing.png',
            result: 'page.png',
            targetWidth: 128,
        });
        assert.equal(other.ok, true);
        // Two different pictures differ.
        assert.ok(other.metrics.rmse > 0, `rmse=${other.metrics.rmse}`);
        assert.ok(other.similarity < 100);
        // The picture of the difference is written into the project.
        assert.ok(other.difference?.rel, JSON.stringify(other.difference));
        assert.match(other.difference.rel, /\.ai\/shots\/diff-/);
    } finally {
        await cleanup();
    }
});
