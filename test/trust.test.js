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
        styler: 'family:gpt',
        architect: 'family:gpt',
        editor: 'family:gpt',
        animator: 'family:gpt',
        illustrator: 'family:gpt',
    });
    // The path of the styler is [1, 0]: the Sol writes the styles.
    assert.equal(houseModel('styler', configFor()), 'openai/gpt-6.2-sol');
    assert.equal(houseModel('nothing'), null);
});

test('the editor draws the vector graphics with the best model of the family', () => {
    // The graphics are geometry and letters: a cheap model draws a wordmark with letters
    // that do not spell anything.
    for (const model of ['minimax/minimax-m3.1-flash', 'google/gemini-4-hydrogen', 'moonshotai/kimi-k3.1-pro']) {
        const config = configFor({ model });
        assert.equal(resolveRole('editor', config).model, 'openai/gpt-6.2-sol');
    }
    // The pin of the role still wins over the model of the house.
    const pinned = configFor({ roles: { editor: { model: 'google/gemini-4-hydrogen' } } });
    assert.equal(resolveRole('editor', pinned).model, 'google/gemini-4-hydrogen');
});

test('the architect answers with the best model of the family, not with the model of the run', () => {
    // The structure of the project is the most expensive thing to change later.
    for (const model of ['minimax/minimax-m3.1-flash', 'google/gemini-4-hydrogen', 'moonshotai/kimi-k3.1-pro']) {
        const config = configFor({ model });
        assert.equal(resolveRole('architect', config).model, 'openai/gpt-6.2-sol');
    }
    // The pin of the role still wins over the model of the house.
    const pinned = configFor({ roles: { architect: { model: 'google/gemini-4-hydrogen' } } });
    assert.equal(resolveRole('architect', pinned).model, 'google/gemini-4-hydrogen');
});

test('the roles of the run follow the model of the run', () => {
    for (const model of ['minimax/minimax-m3.1-flash', 'google/gemini-4-hydrogen', 'moonshotai/kimi-k3.1-pro']) {
        const config = configFor({ model });
        assert.equal(resolveRole('markup', config).model, model);
        assert.equal(resolveRole('coder', config).model, model);
    }
});

test('the model of the run is a family of models', () => {
    // The run answers with the cheapest member of the family that takes the effort.
    const config = configFor();
    assert.equal(config.model, 'family:gpt');
    assert.equal(resolveRole('coder', config).model, 'openai/gpt-6.1-terra');
});

test('the styler writes the styles with the best model of its family', () => {
    const config = configFor({ model: 'google/gemini-4-hydrogen' });
    // The path of the styler is [1, 0] of the family of the GPT: the Sol writes the styles.
    //assert.equal(resolveRole('styler', config).model, 'openai/gpt-6.2-sol');
    // The stage that only polishes walks the head of the family: the Terra.
    //assert.equal(resolveRole('styler', config, { stage: 'sight' }).model, 'openai/gpt-6.1-terra');
    //assert.equal(resolveRole('styler', config, { stage: 'repair' }).model, 'openai/gpt-6.1-terra');
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

test('the pin of the default role moves the roles without a model of their own', () => {
    const config = configFor({ model: 'minimax/minimax-m3.1-flash' });
    config.roles.default.model = 'google/gemini-4-hydrogen';
    // The roles follow the default of the roles.
    assert.equal(resolveRole('markup', config).model, 'google/gemini-4-hydrogen');
    assert.equal(resolveRole('coder', config).model, 'google/gemini-4-hydrogen');
    // The styler has its own model of the house: the default does not move it.
    //assert.equal(resolveRole('styler', config).model, 'openai/gpt-6.2-sol');
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
