/**
 * @file test/trust.test.js
 * @module test/trust
 * @purpose Tests of the model of the house for the roles that have one: the markup is a Kimi
 *          job, the vector stage has no verdict yet.
 * @depends node:test, roles/index, model/trust
 * @ai.tags test, model
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveRole } from '../src/roles/index.js';
import { HOUSE_MODELS, houseModel } from '../src/model/trust.js';
import { defaults } from '../src/config.js';

const configFor = (overrides = {}) => ({
    ...structuredClone(defaults),
    ...overrides,
});

test('the markup is a Kimi job', () => {
    assert.deepEqual(HOUSE_MODELS, { markup: 'moonshotai/kimi-k3.1-pro' });
    assert.equal(houseModel('markup'), 'moonshotai/kimi-k3.1-pro');
    assert.equal(houseModel('editor'), null, 'the vector stage has no verdict yet');
    assert.equal(houseModel('nothing'), null);
});

test('the markup answers on the Kimi whatever the model of the run is', () => {
    for (const model of ['minimax/minimax-m3.1-flash', 'google/gemini-4-hydrogen', 'moonshotai/kimi-k3.1-pro']) {
        const config = configFor({ model });
        assert.equal(resolveRole('markup', config).model, 'moonshotai/kimi-k3.1-pro');
    }
});

test('the other roles keep the model of the run', () => {
    const config = configFor({ model: 'google/gemini-4-hydrogen' });
    assert.equal(resolveRole('coder', config).model, 'google/gemini-4-hydrogen');
    assert.equal(resolveRole('styler', config).model, 'google/gemini-4-hydrogen');
    // The vector stage (the role `editor`) has no model of its own yet.
    assert.equal(resolveRole('editor', config).model, 'google/gemini-4-hydrogen');
});

test('the pin of the role wins over the model of the house', () => {
    const config = configFor({ model: 'google/gemini-4-hydrogen' });
    config.roles.markup.model = 'google/gemini-4-hydrogen';
    assert.equal(resolveRole('markup', config).model, 'google/gemini-4-hydrogen');
});

test('the effort of the markup is pulled down to what the Kimi takes', () => {
    const config = configFor({ model: 'google/gemini-4-hydrogen' });
    config.reasoning.effort = 'xhigh';
    // The Kimi has no levels above `medium`: the answer of the same question costs the same
    // seconds there.
    assert.equal(resolveRole('markup', config).effort, 'medium');
    // The styles stay on the model of the run and keep the deepest reasoning.
    assert.equal(resolveRole('styler', config).effort, 'xhigh');
});

test('the pin of the default role does not move the markup', () => {
    const config = configFor({ model: 'minimax/minimax-m3.1-flash' });
    config.roles.default.model = 'google/gemini-4-hydrogen';
    // The markup has its own model of the house; the other roles follow the default.
    assert.equal(resolveRole('markup', config).model, 'moonshotai/kimi-k3.1-pro');
    assert.equal(resolveRole('coder', config).model, 'google/gemini-4-hydrogen');
});
