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

import { buildResponsesBody, parseResponse, extractToolCalls } from '../src/openai/responses.js';
import { getModelProfile, maxOutputFor, writeBudgetFor, MODEL_PROFILES, snapEffort } from '../src/model/profiles.js';
import { fallbackChain } from '../src/openai/fallback.js';
import { defaults } from '../src/config/defaults.js';

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

test('the arguments of a tool call are read as JSON or reported as broken', () => {
    const good = extractToolCalls({
        output: [{ type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'write_file', arguments: '{"path":"index.html"}' }],
    });
    assert.deepEqual(good[0].arguments, { path: 'index.html' });
    assert.equal(good[0].parseError, null);

    const broken = extractToolCalls({
        output: [{ type: 'function_call', id: 'fc_2', call_id: 'call_2', name: 'write_file', arguments: '{ path: ' }],
    });
    assert.equal(broken[0].arguments, null);
    assert.ok(broken[0].parseError, 'the broken arguments are named');

    const notObject = extractToolCalls({
        output: [{ type: 'function_call', id: 'fc_3', call_id: 'call_3', name: 'write_file', arguments: '"just a string"' }],
    });
    assert.equal(notObject[0].arguments, null);
    assert.ok(notObject[0].parseError);
});

test('the arguments of a tool call are read as JSON5: a model writes almost-JSON', () => {
    // Одинарные кавычки, висячие запятые, комментарии — строгий разбор терял вызов целиком,
    // и ход уходил впустую.
    const almost = extractToolCalls({
        output: [{
            type: 'function_call', id: 'fc_5', call_id: 'call_5', name: 'write_file',
            arguments: "{ path: 'index.html', /* the page */ note: 'a, b', }",
        }],
    });
    assert.equal(almost[0].parseError, null);
    assert.deepEqual(almost[0].arguments, { path: 'index.html', note: 'a, b' });

    // Кавычки без кавычек (unquoted keys) — тоже обычное дело для модели.
    const unquoted = extractToolCalls({
        output: [{ type: 'function_call', id: 'fc_6', call_id: 'call_6', name: 'write_file', arguments: '{ path: "a.html", }' }],
    });
    assert.equal(unquoted[0].parseError, null);
    assert.deepEqual(unquoted[0].arguments, { path: 'a.html' });
});

test('the answer of a role is read as JSON5 as well', () => {
    const answer = parseResponse({
        id: 'resp_1',
        status: 'completed',
        output_text: "{ summary: 'готово', items: [1, 2,], }",
    });
    assert.deepEqual(answer.data, { summary: 'готово', items: [1, 2] });
});

test('the answer of a chat-bot model is read out of the prose and the fence', () => {
    // Модель отвечает как типичный чат-бот: проза вокруг JSON. Строгий разбор терял данные
    // роли целиком, и стадия говорила «архитектор не вернул структуру».
    const fenced = parseResponse({
        id: 'resp_1',
        status: 'completed',
        output_text: "Вот структура проекта:\n\n```json\n{ 'summary': 'готово', 'modules': [], }\n```\n\nЕсли нужно, могу пояснить.",
    });
    assert.deepEqual(fenced.data, { summary: 'готово', modules: [] });

    // JSON без плашки, но в прозе: самый внешний сбалансированный {…}.
    const prose = parseResponse({
        id: 'resp_2',
        status: 'completed',
        output_text: 'The architecture is ready. Here it is: {"summary": "a page", "stack": {"framework": "vanilla"}} — see the file.',
    });
    assert.deepEqual(prose.data, { summary: 'a page', stack: { framework: 'vanilla' } });

    // Скобки внутри строк не сбивают баланс.
    const braces = parseResponse({
        id: 'resp_3',
        status: 'completed',
        output_text: 'Answer: {"summary": "a } brace", "notes": "{not a span}"} and the end.',
    });
    assert.deepEqual(braces.data, { summary: 'a } brace', notes: '{not a span}' });

    // Проза без JSON вообще — данных нет, как и было.
    const plain = parseResponse({
        id: 'resp_4',
        status: 'completed',
        output_text: 'Я не понял задачу, уточните, пожалуйста.',
    });
    assert.equal(plain.data, null);
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
    assert.equal(MODEL_PROFILES['google/gemini-4-hydrogen'].schemaChannel, 'auto');
    assert.equal(MODEL_PROFILES['minimax/minimax-m3.1-flash'].schemaChannel, 'format');
    const profile = getModelProfile('moonshotai/kimi-k3.1-pro', {
        models: { 'moonshotai/kimi-k3.1-pro': { schemaChannel: 'format' } },
    });
    assert.equal(profile.schemaChannel, 'format');
});

test('the profile of a text model is tuned by the live answers of the gateway', () => {
    const minimax = MODEL_PROFILES['minimax/minimax-m3.1-flash'];
    assert.equal(minimax.window, 4_194_304, '1M tokens of context');
    assert.equal(minimax.maxOutput, 524_288);
    assert.equal(minimax.ceiling, 'xhigh');
    assert.ok(!minimax.efforts.includes('none'), 'the endpoint refuses to work without reasoning');
    assert.equal(snapEffort('none', minimax), 'low', 'the request for none is raised, not refused');

    const kimi = MODEL_PROFILES['moonshotai/kimi-k3.1-pro'];
    assert.equal(kimi.window, 4_194_304, '1M tokens of context');
    assert.equal(kimi.maxOutput, 944_000);
    assert.equal(kimi.ceiling, 'high', 'the levels above it cost the same seconds');
    assert.equal(snapEffort('high', kimi), 'high');
    assert.equal(snapEffort('none', kimi), 'none', 'the reasoning may be turned off');
});

test('read-only requests use one quarter of the model output cap', () => {
    assert.equal(maxOutputFor('google/gemini-4-hydrogen', null, null, { readOnly: true }), 16_384);
    assert.equal(maxOutputFor('google/gemini-4-hydrogen', null, 32_000, { readOnly: true }), 8_000);
    assert.equal(maxOutputFor('google/gemini-4-hydrogen'), 65_536, 'write-ups keep the full cap');
    assert.equal(maxOutputFor('google/gemini-4-hydrogen', null, 48_000), 48_000);
    assert.equal(maxOutputFor('google/gemini-4-hydrogen', null, 16, { readOnly: true }), 4);
});

test('the estimate of the write sizes the budget of the write turn', () => {
    const model = 'google/gemini-4-hydrogen';
    const cap = 65_536;
    // No estimate at all: the whole cap.
    assert.equal(writeBudgetFor(model, null, null, null), cap);
    assert.equal(writeBudgetFor(model, null, null, undefined), cap);
    // An estimate inside the band is taken as it is.
    assert.equal(writeBudgetFor(model, null, null, 40_000), 40_000);
    // An estimate below the half of the cap is raised to the half.
    assert.equal(writeBudgetFor(model, null, null, 1_000), Math.ceil(cap / 2));
    assert.equal(writeBudgetFor(model, null, null, Math.ceil(cap / 2) - 1), Math.ceil(cap / 2));
    // An estimate above the cap is pulled down to the cap.
    assert.equal(writeBudgetFor(model, null, null, 10_000_000), cap);
    // A broken estimate is no estimate.
    assert.equal(writeBudgetFor(model, null, null, 'a lot'), cap);
    assert.equal(writeBudgetFor(model, null, null, Number.NaN), cap);
    assert.equal(writeBudgetFor(model, null, null, Infinity), cap);
    // A zero or a negative estimate means "I do not know", not "write nothing".
    assert.equal(writeBudgetFor(model, null, null, 0), cap);
    assert.equal(writeBudgetFor(model, null, null, -5), cap);
    // A fraction is rounded up before the clamp.
    assert.equal(writeBudgetFor(model, null, null, 40_000.5), 40_001);
    // The cap of the config wins over the cap of the model.
    assert.equal(writeBudgetFor(model, null, 32_000, 40_000), 32_000);
});

test('the Gemini is the alternative to the Kimi and the Kimi is the fallback', () => {
    const gemini = MODEL_PROFILES['google/gemini-4-hydrogen'];
    assert.equal(gemini.window, 4_194_304, '1M tokens of context');
    assert.equal(gemini.maxOutput, 655_36, 'the continuation decodes up to 1M tokens');
    assert.equal(gemini.ceiling, 'xhigh');
    assert.deepEqual(gemini.efforts, ['low', 'medium', 'high', 'xhigh']);
    assert.equal(snapEffort('none', gemini), 'low', 'the card of the vendor has no none');
    assert.equal(snapEffort('xhigh', gemini), 'xhigh');
    // The chain of the house: the Kimi answers when the Gemini refuses, and the ladder of
    // the family of the Gemini stands behind it.
    const chain = fallbackChain(defaults, 'google/gemini-4-hydrogen');
    assert.deepEqual(chain, ['google/gemini-4-hydrogen', 'moonshotai/kimi-k3.1-pro', 'google/gemini-4-neon']);
    assert.deepEqual(
        fallbackChain(defaults, 'minimax/minimax-m3.1-flash'),
        [
            'minimax/minimax-m3.1-flash',
            'openai/gpt-6-luna',
            'anthropic/claude-haiku-5.5',
            'google/gemini-3.8-flash',
            'z-ai/glm-5.3-flashx',
            'moonshotai/kimi-k3.1-pro',
        ],
        'the peers of the group of small models stand before the catch-all chain',
    );
});
