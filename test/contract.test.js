/**
 * @file test/contract.test.js
 * @module test/contract
 * @purpose The tests of the contract of a phase: the rule that a role works against the
 *          contract and does not wait for the work of another role.
 * @depends node:test, stages/contract
 * @ai.tags test, stages, contract, deadlock
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';

import { CONTRACTS, contractOf, contractNote, isWaiting, WAITING_WORDS } from '../src/stages/contract.js';
import { runRole, wordsOfAnswer } from '../src/roles/index.js';
import { defaults } from '../src/config/defaults.js';

test('the coder and the styler have a contract with each other', () => {
    // Кодер берёт контракт стилей, стилест — контракт кода. Обе стороны знают их
    // заранее, и обе пишутся по ним.
    assert.deepEqual(contractOf('coder'), ['styles']);
    assert.deepEqual(contractOf('styler'), ['code']);
    assert.deepEqual(contractOf('markup'), []);
});

test('a role that waits for the work of another role is seen', () => {
    // Явное ожидание — это тупик: роль должна сделать своё по контракту.
    assert.equal(isWaiting('Waiting for the code to appear.'), true);
    assert.equal(isWaiting('The styles are not written yet, I will wait for them.'), true);
    assert.equal(isWaiting('Стилей ещё нет, подожду их.'), true);
    assert.equal(isWaiting('Код появится позже.'), true);
    assert.equal(isWaiting('Код не готов.'), true);
    assert.equal(isWaiting('Файлы стилей не написаны.'), true);
});

test('a role that does its work is not seen as waiting', () => {
    // «missing» и «later» сами по себе ничего не значат: файл может отсутствовать по
    // своей причине, а «после» — обычное слово о порядке.
    assert.equal(isWaiting('The token is missing from the stylesheet.'), false);
    assert.equal(isWaiting('The files are missing on the disk.'), false);
    assert.equal(isWaiting('Write the styles after the markup.'), false);
    assert.equal(isWaiting('Готово. Написал токены и каркас.'), false);
    assert.equal(isWaiting('Created the state store with the session model.'), false);
    assert.equal(isWaiting(''), false);
    assert.equal(isWaiting(null), false);
});

test('the code of a role is not an expectation of the work of another role', () => {
    // `await` — ключевое слово JavaScript, а не ожидание роли. Без границы слева
    // детектор ловил его в каждом модуле и объявлял роль «ждущей чужую работу».
    assert.equal(isWaiting('const response = await fetch(url);'), false);
    assert.equal(isWaiting('await loadHome();'), false);
    assert.equal(isWaiting('The adapter awaits the response.'), false);
    assert.equal(isWaiting('const data = await readFile(path);'), false);
});

test('a fact about the project is not an expectation of the work of another role', () => {
    // «Проектных тестов пока нет» — это факт о проекте, а не ожидание соседней роли.
    // Роль, честно сказавшая о нём, не должна быть отправлена переписывать своё.
    assert.equal(isWaiting('Проектных тестов пока нет.'), false);
    assert.equal(isWaiting('Снимки и измерения должны иметь ревизии; проектных тестов пока нет.'), false);
    assert.equal(isWaiting('Настоящий поставщик создаётся на следующих этапах.'), false);
    // А ожидание соседней роли — это ожидание.
    assert.equal(isWaiting('Стилей пока нет.'), true);
    assert.equal(isWaiting('Файлы пока нет.'), true);
    assert.equal(isWaiting('Файлы стилей не написаны.'), true);
});

test('the words of an answer do not include the text of the files', () => {
    // Текст файлов — это работа роли, а не её слова о работе. Роль, которая написала
    // честный код с `await`, не должна быть объявлена «ждущей».
    const words = wordsOfAnswer({
        text: '',
        data: {
            summary: 'Готово.',
            notes: '',
            files: [{ path: 'src/main.js', content: 'const r = await fetch(url);\n' }],
        },
    });
    assert.equal(words.includes('await'), false);
    assert.match(words, /Готово\./);
});

test('the rule of the contract tells the role that there is nothing to wait for', () => {
    const note = contractNote('coder', { hasStyles: false });
    assert.match(note, /Nothing to wait for/i);
    assert.match(note, /Do not wait for the work of another role/i);
    assert.match(note, /contract/i);
    // Без контракта на диске роль берёт имена из брифа и разметки.
    assert.match(note, /brief/i);
    assert.match(note, /markup/i);
});

test('the rule of the contract points at the contract on the disk', () => {
    const note = contractNote('coder', { hasStyles: true });
    assert.match(note, /on the disk/i);
    assert.match(note, /read it/i);
    // Стилест берёт контракт кода.
    const styler = contractNote('styler', { hasCode: true });
    assert.match(styler, /contract of the code/i);
    assert.match(styler, /Nothing to wait for/i);
});

test('a role without a contract has no rule', () => {
    assert.equal(contractNote('markup', {}), '');
    assert.equal(contractNote('', {}), '');
});

test('the contracts of the house are known', () => {
    assert.ok(CONTRACTS.coder.includes('styles'));
    assert.ok(CONTRACTS.styler.includes('code'));
    // Слова ожидания объявлены один раз, и их использует детектор.
    assert.ok(WAITING_WORDS instanceof RegExp);
});

/**
 * An answer with the schema of the role.
 * @param {object} args
 * @returns {object}
 * @ai.hint pure
 */
function schemaAnswer(args) {
    return {
        id: 'resp_1',
        status: 'completed',
        model: 'test-model',
        output: [{
            type: 'function_call',
            id: 'fc_1',
            call_id: `c_${Math.random().toString(36).slice(2)}`,
            name: 'code',
            arguments: JSON.stringify(args),
        }],
    };
}

/**
 * A raw call of a tool.
 * @param {string} name
 * @param {object} args
 * @returns {object}
 * @ai.hint pure
 */
function toolAnswer(name, args = {}) {
    return {
        id: 'resp_1',
        status: 'completed',
        model: 'test-model',
        output: [{
            type: 'function_call',
            id: 'fc_1',
            call_id: `c_${Math.random().toString(36).slice(2)}`,
            name,
            arguments: JSON.stringify(args),
        }],
    };
}

test('a role that waits for the work of another role is told to work against the contract', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-contract-'));
    const asked = [];
    let index = 0;
    const answers = [
        // Роль отвечает, что ждёт чужих стилей, и ничего не пишет.
        schemaAnswer({ summary: 'The styles are not written yet, I will wait for them.', files: [], notes: '' }),
        toolAnswer('write_ready', {}),
        toolAnswer('write_file', { path: 'src/main.js', content: 'export const x = 1;\n' }),
        schemaAnswer({
            summary: 'The code is written against the contract.',
            files: [{ path: 'src/main.js', content: 'export const x = 1;\n', language: 'js' }],
            notes: '',
        }),
    ];
    const client = {
        responses: {
            /**
             * @param {object} body
             * @returns {Promise<object>}
             */
            async create(body) {
                asked.push(body);
                return answers[index++] ?? answers[answers.length - 1];
            },
        },
    };

    const config = structuredClone(defaults);
    config.reasoning.effort = 'low';
    const answer = await runRole({
        client,
        config,
        role: 'coder',
        input: 'Write the code.',
        requireFiles: true,
        context: {
            task: 'Write the code.',
            step: { id: 's1', title: 'Code', files: ['src/main.js'], criteria: [] },
            hasStyles: false,
        },
        root,
    });

    // Роль получила приказ работать по контракту, а не ждать. Он есть и в инструкции
    // роли, и в её ходе — приказ одинаковый в обоих местах.
    const said = JSON.stringify(asked);
    assert.match(said, /Nothing to wait for/i);
    // И работа всё-таки сделана: файл написан.
    assert.equal(answer.data?.files?.length, 1);

    await rm(root, { recursive: true, force: true });
});
