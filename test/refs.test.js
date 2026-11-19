/**
 * @file test/refs.test.js
 * @module test/refs
 * @purpose Tests of the references to models: the families (the cheapest member answers) and
 *          the groups (the member that fits the work answers).
 * @depends node:test, model/refs, roles/index, openai/fallback
 * @ai.tags test, model
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
    familyLadder, familyModels, familyName, groupLadder, groupMembers, groupName, resolveModelRef,
} from '../src/model/refs.js';
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
    // The path of the styler decides the place of the family it answers on.
    assert.equal(resolveRole('styler', config).model, 'openai/gpt-6.2-sol');
    // A role without a path takes the cheapest member of the family that fits.
    config.roles.reviewer.model = 'family:gpt';
    assert.equal(resolveRole('reviewer', config).model, 'openai/gpt-6.1-terra');
});

test('the house may name a family of models for a role', () => {
    const config = configFor({ model: 'google/gemini-4-hydrogen' });
    config.house.models.markup = 'family:gpt';
    assert.equal(resolveRole('markup', config).model, 'openai/gpt-6.1-terra');
});

test('a reference names a group only with the prefix', () => {
    assert.equal(groupName('group:small'), 'small');
    assert.equal(groupName('group: small '), 'small');
    assert.equal(groupName('small'), null);
    assert.equal(groupName('family:small'), null);
    assert.equal(groupName('group:'), null);
});

test('the group of the house is a list of members with the limits of their context', () => {
    const config = configFor();
    const members = groupMembers(config, 'small');
    assert.deepEqual(members.map((item) => item.model), [
        'openai/gpt-6-luna',
        'anthropic/claude-haiku-5.5',
        'google/gemini-3.8-flash',
        'minimax/minimax-m3.1-flash',
        'z-ai/glm-5.3-flashx',
    ]);
    assert.equal(members[1].maxContext, 100_000);
    assert.equal(members[0].maxContext, null);
    assert.deepEqual(groupMembers(config, 'nothing'), []);
});

test('a group answers with the first member that takes the effort', () => {
    const config = configFor();
    assert.equal(resolveModelRef('group:small', config), 'openai/gpt-6-luna');
    // The Luna takes every level of the effort.
    assert.equal(resolveModelRef('group:small', config, { effort: 'xhigh' }), 'openai/gpt-6-luna');
});

test('a member with a limit of the context is not asked with a big one', () => {
    const config = configFor();
    // The Haiku is trusted with a context up to 100K tokens: the role of a big context does
    // not get it, the role of a small one does.
    const small = resolveModelRef('group:small', config, { context: 'small' });
    assert.equal(small, 'openai/gpt-6-luna', 'the Luna comes first and has no limit');
    const only = {
        ...config,
        modelGroups: { small: [{ model: 'anthropic/claude-haiku-5.5', maxContext: 100_000 }] },
    };
    assert.equal(resolveModelRef('group:small', only, { context: 'small' }), 'anthropic/claude-haiku-5.5');
    assert.equal(resolveModelRef('group:small', only, { context: 'max' }), 'anthropic/claude-haiku-5.5',
        'no member fits, so the first one answers anyway');
});

test('the peers of the group stand behind the model in the chain of the fallback', () => {
    const config = configFor();
    assert.deepEqual(
        groupLadder(config, 'openai/gpt-6-luna'),
        ['anthropic/claude-haiku-5.5', 'google/gemini-3.8-flash', 'minimax/minimax-m3.1-flash', 'z-ai/glm-5.3-flashx'],
    );
    assert.ok(fallbackChain(config, 'openai/gpt-6-luna').includes('anthropic/claude-haiku-5.5'));
});

test('a role may be pinned to a group of models', () => {
    const config = configFor({ model: 'google/gemini-4-hydrogen' });
    config.roles.iconifier.model = 'group:small';
    assert.equal(resolveRole('iconifier', config).model, 'openai/gpt-6-luna');
});
