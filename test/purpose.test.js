/**
 * @file test/purpose.test.js
 * @module test/purpose
 * @purpose The tests of the purpose of a write: the model names it, and the guides of that
 *          purpose come with the write.
 * @depends node:test, roles/purpose, agent/docs
 * @ai.tags test, purpose, guides
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { PURPOSES, purposeFor, guidesForPurpose, purposeBlock, purposeOfKind } from '../src/roles/purpose.js';
import { DOCUMENTATION } from '../src/agent/docs.js';
import { kindEffortFor } from '../src/agent/pace.js';

test('the purpose of a kind of file is known', () => {
    assert.equal(purposeOfKind('style'), 'styles');
    assert.equal(purposeOfKind('markup'), 'markup');
    assert.equal(purposeOfKind('code'), 'logic');
    assert.equal(purposeOfKind('image'), 'illustration');
    assert.equal(purposeOfKind(''), '');
    assert.equal(purposeOfKind('unknown'), '');
});

test('the purpose of a step is what the model said, or what the files say', () => {
    assert.equal(purposeFor('Dialog of a device', ['src/main.js']), 'dialog of a device');
    assert.equal(purposeFor('', ['src/styles/main.scss']), 'styles');
    assert.equal(purposeFor('', ['index.html']), 'markup');
    assert.equal(purposeFor('', []), '');
});

test('the guides of a purpose are the standards that answer it', () => {
    const guides = guidesForPurpose('dialog');
    assert.match(guides, /Accessibility/);
    assert.match(guides, /CSS motion/);
    // Назначение без гайдов даёт пустой текст, а не ошибку.
    assert.equal(guidesForPurpose('something nobody knows'), '');
    assert.equal(guidesForPurpose(''), '');
});

test('every purpose of the table names the guides that exist', () => {
    for (const [purpose, sources] of Object.entries(PURPOSES)) {
        for (const source of sources) {
            assert.ok(DOCUMENTATION[source], `the purpose «${purpose}» names a guide that is not there: ${source}`);
        }
    }
});

test('the block of a purpose carries the purpose and its guides', () => {
    const block = purposeBlock({ purpose: 'dialog', guides: guidesForPurpose('dialog') });
    assert.match(block, /The purpose of this write/);
    assert.match(block, /dialog/);
    assert.match(block, /Accessibility/);
    // Гайды — правила, а не рамки: блок это говорит.
    assert.match(block, /not a limit of it/);
    assert.equal(purposeBlock({}), '');
});

test('the effort of a kind of file is known, and the config may change it', () => {
    const config = { reasoning: { effort: 'high' } };
    assert.equal(kindEffortFor({ config, kind: 'style' }), 'high');
    assert.equal(kindEffortFor({ config, kind: 'code' }), 'medium');
    assert.equal(kindEffortFor({ config, kind: 'markup' }), 'medium');
    assert.equal(kindEffortFor({ config, kind: 'image' }), 'low');
    assert.equal(kindEffortFor({ config, kind: 'nothing' }), null);

    const own = { reasoning: { effort: 'high', kindEffort: { style: 'xhigh', code: 'low' } } };
    assert.equal(kindEffortFor({ config: own, kind: 'style' }), 'xhigh');
    assert.equal(kindEffortFor({ config: own, kind: 'code' }), 'low');
    // Вид, которого нет в профиле, берёт встроенное значение.
    assert.equal(kindEffortFor({ config: own, kind: 'markup' }), 'medium');
});
