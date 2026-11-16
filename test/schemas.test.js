/**
 * @file test/schemas.test.js
 * @module test/schemas
 * @purpose The tests of the schemas of the roles: every one of them is strict.
 * @depends node:test, agent/schemas
 * @ai.tags test, schemas
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { SCHEMAS, SCHEMA_NAMES, schemaFor, schemaNameFor, assertStrictSchema, schemaProblems } from '../src/agent/schemas.js';

test('every schema of the plan exists', () => {
    for (const name of ['plan', 'architecture', 'code', 'style', 'markup', 'icon', 'setup', 'review']) {
        assert.ok(SCHEMAS[name], `the schema ${name} is missing`);
        assert.equal(schemaFor(name), SCHEMAS[name]);
        assert.equal(schemaNameFor(name), name);
    }
    assert.equal(schemaFor('nothing'), null);
    assert.equal(schemaNameFor('nothing'), null);
});

test('every schema is strict', () => {
    for (const name of SCHEMA_NAMES) {
        const problems = assertStrictSchema(SCHEMAS[name], name);
        assert.deepEqual(problems, [], `${name}: ${problems.join('; ')}`);
    }
});

test('the checker sees a loose schema', () => {
    const loose = {
        type: 'object',
        properties: {
            a: { type: 'string' },
            b: { type: 'object', properties: { c: { type: 'string' } }, additionalProperties: false },
        },
        required: ['a'],
        additionalProperties: true,
    };
    const problems = assertStrictSchema(loose, 'loose');
    assert.ok(problems.some((line) => line.includes('поле "b" не обязательно')));
    assert.ok(problems.some((line) => line.includes('additionalProperties')));
});

test('the checker of the answers sees a missing field, a wrong type and an extra field', () => {
    const schema = {
        type: 'object',
        properties: {
            summary: { type: 'string' },
            files: { type: 'array', items: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false } },
        },
        required: ['summary', 'files'],
        additionalProperties: false,
    };

    assert.deepEqual(schemaProblems({ summary: 'ok', files: [{ path: 'index.html' }] }, schema), []);

    const missing = schemaProblems({ files: [] }, schema);
    assert.ok(missing.some((line) => line.includes('$.summary')));

    const wrong = schemaProblems({ summary: 42, files: [] }, schema);
    assert.ok(wrong.some((line) => line.includes('ожидался string')));

    const extra = schemaProblems({ summary: 'ok', files: [], extra: 1 }, schema);
    assert.ok(extra.some((line) => line.includes('лишнее поле')));

    const nested = schemaProblems({ summary: 'ok', files: [{ path: 1 }] }, schema);
    assert.ok(nested.some((line) => line.includes('$.files[0].path')));
});
