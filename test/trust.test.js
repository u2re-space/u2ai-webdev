/**
 * @file test/trust.test.js
 * @module test/trust
 * @purpose Tests of the model of the house for the roles that have one: the map of the house
 *          is a part of the config, and a role may be taken out of it.
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

test('the house has a model of its own for the roles that need one', () => {
    assert.deepEqual(HOUSE_MODELS, {
        director: 'openai/gpt-6.1-terra',
        planner: 'openai/gpt-6.1-terra',
        markup: 'openai/gpt-6.1-terra',
        editor: 'openai/gpt-6.1-terra',
        iconifier: 'openai/gpt-6.1-terra',
        coder: 'openai/gpt-6.1-terra'
    });
    assert.equal(houseModel('markup'), 'openai/gpt-6.1-terra');
    assert.equal(houseModel('editor'), 'openai/gpt-6.1-terra', 'the vector stage has no verdict yet');
    assert.equal(houseModel('nothing'), null);
});

test('the markup answers on the model of the house whatever the model of the run is', () => {
    for (const model of ['minimax/minimax-m3.1-flash', 'google/gemini-4-hydrogen', 'moonshotai/kimi-k3.1-pro']) {
        const config = configFor({ model });
        assert.equal(resolveRole('markup', config).model, 'openai/gpt-6.1-terra');
    }
});

test('the other roles keep the model of the run', () => {
    const config = configFor({ model: 'google/gemini-4-hydrogen' });
    assert.equal(resolveRole('coder', config).model, 'openai/gpt-6.1-terra');
    assert.equal(resolveRole('styler', config).model, 'google/gemini-4-hydrogen');
    // The vector stage (the role `editor`) has no model of its own yet.
    assert.equal(resolveRole('editor', config).model, 'openai/gpt-6.1-terra');
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
    assert.equal(resolveRole('markup', config).effort, 'xhigh');
    // The styles stay on the model of the run and keep the deepest reasoning.
    assert.equal(resolveRole('styler', config).effort, 'xhigh');
});

test('the pin of the default role does not move the markup', () => {
    const config = configFor({ model: 'minimax/minimax-m3.1-flash' });
    config.roles.default.model = 'google/gemini-4-hydrogen';
    // The markup has its own model of the house; the other roles follow the default.
    assert.equal(resolveRole('markup', config).model, 'openai/gpt-6.1-terra');
    assert.equal(resolveRole('coder', config).model, 'openai/gpt-6.1-terra');
});

test('the config decides the model of the house', () => {
    const config = configFor({ model: 'google/gemini-4-hydrogen' });
    config.house.models.markup = 'minimax/minimax-m3.1-flash';
    assert.equal(resolveRole('markup', config).model, 'minimax/minimax-m3.1-flash');
    assert.equal(houseModel('markup', config), 'minimax/minimax-m3.1-flash');
});

test('a role with an empty model of the house answers on the model of the run', () => {
    const config = configFor({ model: 'google/gemini-4-hydrogen' });
    config.house.models.markup = null;
    assert.equal(houseModel('markup', config), null);
    assert.equal(resolveRole('markup', config).model, 'google/gemini-4-hydrogen');
});
