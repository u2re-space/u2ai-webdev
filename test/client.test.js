/**
 * @file test/client.test.js
 * @module test/client
 * @purpose Tests of the transport of the client: a host that says nothing is not asked
 *          again, and the next host answers.
 * @depends node:test, node:http, openai/client
 * @ai.tags test, client, transport
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import { createClient } from '../src/openai/client.js';
import { defaults } from '../src/config.js';

test('a host that says nothing is not asked again: the next host answers', async () => {
    let silentRequests = 0;
    const sockets = [];
    const silent = http.createServer((req) => {
        silentRequests += 1;
        req.on('data', () => {});
        // The host takes the request and never answers: the model is not thinking, the host
        // is silent.
    });
    silent.on('connection', (socket) => sockets.push(socket));
    await new Promise((resolve) => silent.listen(0, '127.0.0.1', resolve));
    const silentUrl = `http://127.0.0.1:${silent.address().port}/v1/`;

    const answered = http.createServer((req, res) => {
        let body = '';
        req.on('data', (chunk) => { body += chunk; });
        req.on('end', () => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ id: 'resp_1', status: 'completed', output: [], usage: {} }));
        });
    });
    await new Promise((resolve) => answered.listen(0, '127.0.0.1', resolve));
    const answeredUrl = `http://127.0.0.1:${answered.address().port}/v1/`;

    const config = structuredClone(defaults);
    // The host is silent for a third of a second; the retry would have asked it four times.
    config.timeoutMs = 300;
    config.limits.requestRetries = 3;
    config.backends = [
        { baseURL: silentUrl, apiKey: 'test-key' },
        { baseURL: answeredUrl, apiKey: 'test-key' },
    ];

    const client = await createClient({ config, env: {} });
    try {
        const answer = await client.responses.create({ model: 'test-model', instructions: 'x', input: 'y' });
        assert.equal(answer.id, 'resp_1');
        assert.equal(silentRequests, 1, 'the silent host was asked again');
    } finally {
        client.close?.();
        for (const socket of sockets) socket.destroy();
        await new Promise((resolve) => silent.close(resolve));
        await new Promise((resolve) => answered.close(resolve));
    }
});

test('a refused request is not asked again: the answer comes at once', async () => {
    let refusedRequests = 0;
    const sockets = [];
    const refused = http.createServer((req, res) => {
        refusedRequests += 1;
        req.on('data', () => {});
        req.on('end', () => {
            res.writeHead(403, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: { message: 'the key has no access' } }));
        });
    });
    refused.on('connection', (socket) => sockets.push(socket));
    await new Promise((resolve) => refused.listen(0, '127.0.0.1', resolve));
    const refusedUrl = `http://127.0.0.1:${refused.address().port}/v1/`;

    const answered = http.createServer((req, res) => {
        req.on('data', () => {});
        req.on('end', () => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ id: 'resp_1', status: 'completed', output: [], usage: {} }));
        });
    });
    await new Promise((resolve) => answered.listen(0, '127.0.0.1', resolve));
    const answeredUrl = `http://127.0.0.1:${answered.address().port}/v1/`;

    const config = structuredClone(defaults);
    config.limits.requestRetries = 3;
    config.backends = [
        { baseURL: refusedUrl, apiKey: 'test-key' },
        { baseURL: answeredUrl, apiKey: 'test-key' },
    ];

    const client = await createClient({ config, env: {} });
    try {
        // Отказ запроса повтором не лечится: тот же запрос останется отказом. Проверка идёт
        // один раз, и ответ приходит сразу — а не через минуты молчания.
        await assert.rejects(
            () => client.responses.create({ model: 'test-model', instructions: 'x', input: 'y' }),
            /access/,
        );
        assert.equal(refusedRequests, 1, 'the refused host was asked again');
    } finally {
        client.close?.();
        for (const socket of sockets) socket.destroy();
        await new Promise((resolve) => refused.close(resolve));
        await new Promise((resolve) => answered.close(resolve));
    }
});

test('the cancellation of a request stops the body of the answer', async () => {
    // Хост присылает заголовки и молчит: тело ответа не приходит. Отмена запроса
    // должна обрывать чтение тела сразу, а не ждать конца молчания.
    //
    // Застой шёл именно так: заголовки пришли, тело — нет, и запрос висел до своего
    // таймаута, а бюджет стадии и `/skip` не могли его остановить.
    const sockets = [];
    const server = http.createServer((req, res) => {
        req.on('data', () => {});
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.flushHeaders();
        // Тело не приходит никогда.
    });
    server.on('connection', (socket) => sockets.push(socket));
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${server.address().port}/v1/`;

    const config = structuredClone(defaults);
    config.timeoutMs = 30_000;
    config.backends = [{ baseURL: url, apiKey: 'test-key' }];

    const client = await createClient({ config, env: {} });
    const controller = new AbortController();
    try {
        const started = Date.now();
        const work = client.responses.create({
            model: 'test-model',
            instructions: 'x',
            input: 'y',
            stream: true,
            signal: controller.signal,
        });
        setTimeout(() => controller.abort(), 100);
        await assert.rejects(() => work, /abort/i);
        // Отмена сработала сразу, а не через полминуты молчания.
        assert.ok(Date.now() - started < 10_000, 'the request was cancelled at once');
    } finally {
        client.close?.();
        for (const socket of sockets) socket.destroy();
        await new Promise((resolve) => server.close(resolve));
    }
});
