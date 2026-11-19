/**
 * @file test/families.test.js
 * @module test/families
 * @purpose Tests of the families of models: the cheapest member of the family answers, and
 *          the rest of the list is the ladder of the budget.
 * @depends node:test, model/families, roles/index, openai/fallback
 * @ai.tags test, model
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { familyLadder, familyModels, familyName, resolveModelRef } from '../src/model/families.js';
import { fallbackChain } from '../src/openai/fallback.js';
import { resolveRole } from '../src/roles/index.js';
import { defaults } from '../src/config.js';

const configFor = (overrides = {}) => ({
    ...structuredClone(defaults),
    ...overrides,
});

test('a reference names a family only with the prefix', () => {
    assert.equal(familyName('family:gpt'), 'gpt');
    assert.equal(familyName('family: gpt '), 'gpt');
    assert.equal(familyName('openai/gpt-6.1-terra'), null);
    assert.equal(familyName('gpt'), null);
    assert.equal(familyName('family:'), null);
});

test('the family of the house is a list of models from the cheapest to the most expensive', () => {
    const config = configFor();
    assert.deepEqual(familyModels(config, 'gpt'), ['openai/gpt-6.1-terra', 'openai/gpt-6.2-sol']);
    assert.deepEqual(familyModels(config, 'nothing'), []);
});

test('a family answers with the cheapest member that takes the effort', () => {
    const config = configFor();
    assert.equal(resolveModelRef('family:gpt', config), 'openai/gpt-6.1-terra');
    // The Kimi has no levels above `high`: a family that starts with it needs a model that
    // takes `xhigh` for that effort.
    const ladder = {
        ...config,
        modelFamilies: { mixed: ['moonshotai/kimi-k3.1-pro', 'openai/gpt-6.2-sol'] },
    };
    assert.equal(resolveModelRef('family:mixed', ladder, { effort: 'high' }), 'moonshotai/kimi-k3.1-pro');
    assert.equal(resolveModelRef('family:mixed', ladder, { effort: 'xhigh' }), 'openai/gpt-6.2-sol');
});

test('a reference that names a model is that model', () => {
    const config = configFor();
    assert.equal(resolveModelRef('openai/gpt-6.1-terra', config), 'openai/gpt-6.1-terra');
    assert.equal(resolveModelRef('', config), null);
    assert.equal(resolveModelRef(null, config), null);
});

test('a family that does not exist names no model', () => {
    const config = configFor();
    assert.equal(resolveModelRef('family:nothing', config), null);
});

test('the ladder of the budget stands above the model in the family', () => {
    const config = configFor();
    assert.deepEqual(familyLadder(config, 'openai/gpt-6.1-terra'), ['openai/gpt-6.2-sol']);
    assert.deepEqual(familyLadder(config, 'openai/gpt-6.2-sol'), []);
    assert.deepEqual(familyLadder(config, 'minimax/minimax-m3.1-flash'), []);
});

test('the ladder of the family joins the chain of the fallback', () => {
    const config = configFor();
    assert.deepEqual(
        fallbackChain(config, 'openai/gpt-6.1-terra'),
        ['openai/gpt-6.1-terra', 'openai/gpt-6.2-sol', 'moonshotai/kimi-k3.1-pro'],
    );
});

test('a role may be pinned to a family of models', () => {
    const config = configFor({ model: 'google/gemini-4-hydrogen' });
    config.roles.styler.model = 'family:gpt';
    assert.equal(resolveRole('styler', config).model, 'openai/gpt-6.1-terra');
});

test('the house may name a family of models for a role', () => {
    const config = configFor({ model: 'google/gemini-4-hydrogen' });
    config.house.models.markup = 'family:gpt';
    assert.equal(resolveRole('markup', config).model, 'openai/gpt-6.1-terra');
});
