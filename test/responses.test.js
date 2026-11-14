/**
 * @file test/responses.test.js
 * @module test/responses
 * @purpose The tests of the body of a request: the tools, the schema and the JSON format of
 *          the answer.
 * @depends node:test, openai/responses, model/profiles
 * @ai.tags test, openai
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildResponsesBody } from '../src/openai/responses.js';
import { getModelProfile, MODEL_PROFILES } from '../src/model/profiles.js';

const SCHEMA = {
    type: 'object',
    properties: { summary: { type: 'string' } },
    required: ['summary'],
    additionalProperties: false,
};

const TOOL = {
    type: 'function',
    name: 'write_file',
    description: 'Write a file.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
};

test('the answer is pinned to the schema when the request carries no tool', () => {
    const body = buildResponsesBody({ model: 'm', schema: SCHEMA, schemaName: 'markup', tools: [] });
    assert.equal(body.text.format.type, 'json_schema');
    assert.equal(body.text.format.name, 'markup');
    // The schema travels as a tool as well: the model may answer with it.
    assert.ok(body.tools.some((tool) => tool.name === 'markup'));
});

test('the answer is not pinned when the request carries a tool', () => {
    const body = buildResponsesBody({ model: 'm', schema: SCHEMA, schemaName: 'markup', tools: [TOOL] });
    assert.equal(body.text, undefined);
    assert.equal(body.tools.length, 2);
});

test('the channel of the schema wins over the rule of the tools', () => {
    const forced = buildResponsesBody({ model: 'm', schema: SCHEMA, tools: [TOOL], schemaChannel: 'format' });
    assert.equal(forced.text.format.type, 'json_schema');
    const asTool = buildResponsesBody({ model: 'm', schema: SCHEMA, tools: [], schemaChannel: 'tool' });
    assert.equal(asTool.text, undefined);
    assert.ok(asTool.tools.some((tool) => tool.name === 'response'));
});

test('the profile of a model knows the channel of the schema', () => {
    assert.equal(MODEL_PROFILES['moonshotai/kimi-k3.1-pro'].schemaChannel, 'auto');
    assert.equal(MODEL_PROFILES['minimax/minimax-m3.1-flash'].schemaChannel, 'format');
    const profile = getModelProfile('moonshotai/kimi-k3.1-pro', {
        models: { 'moonshotai/kimi-k3.1-pro': { schemaChannel: 'format' } },
    });
    assert.equal(profile.schemaChannel, 'format');
});
