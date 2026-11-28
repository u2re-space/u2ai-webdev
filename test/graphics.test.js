/**
 * @file test/graphics.test.js
 * @module test/graphics
 * @purpose Tests of the stage of the graphics: the placement of the pictures is a step.
 *
 *   The cut-outs of the reference lie in the import directory and wait for their places —
 *   the paths the markup links. The stage has to give the artist that step: without it the
 *   pictures lie in `import/` and nobody moves them, and the stage says «ассеты не
 *   перемещены».
 *
 * @depends node:test, stages/graphics, stages/assets
 * @ai.tags test, stages, graphics, assets
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { placementStep } from '../src/stages/graphics.js';

test('the placement of the pictures is a step of the artist', () => {
    const pictures = [
        { name: 'chess-piece', file: 'assets/import/chess-piece.png', kind: 'image' },
        { name: 'award-badge', file: 'assets/import/award-badge.png', kind: 'ornament' },
    ];
    const step = placementStep(pictures, [], 'assets');
    assert.ok(step, 'the stage gives the artist a step to place the pictures');
    assert.equal(step.role, 'artist');
    assert.equal(step.id, 'assets');
    assert.deepEqual(step.files, [
        'assets/import/chess-piece.png',
        'assets/import/award-badge.png',
    ]);
    assert.ok(step.criteria.length > 0);
});

test('there is no step of the placement when there is nothing to place', () => {
    assert.equal(placementStep([], [], 'assets'), null);
});

test('the step of the placement asks for the vector too', () => {
    // Вектор — тоже объект графики, и он должен лежать на своём месте.
    const step = placementStep([], ['assets/logo.svg'], 'assets');
    assert.ok(step);
    assert.equal(step.role, 'artist');
    // The criterion names the vector: the shape is a vector, not a raster.
    assert.ok(step.criteria.some((item) => /vector/i.test(item)), step.criteria.join(' | '));
    assert.ok(step.criteria.some((item) => /vectorize/i.test(item)), step.criteria.join(' | '));
});
