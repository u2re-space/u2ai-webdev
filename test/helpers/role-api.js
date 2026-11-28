/**
 * @file test/helpers/role-api.js
 * @module test/helpers/role-api
 * @purpose The mock of the API of the house: the answers the roles read.
 * @depends node:http
 * @exports mockApi, toolAnswer, schemaAnswer, textAnswer, codeData
 * @ai.tags test, api, mock
 */

import http from 'node:http';

/**
 * A mock of the API: it answers the list of answers, one per request.
 *
 * @param {object[]} answers the answers of the API, in order
 * @returns {Promise<{ url: string, requests: object[], close: Function }>}
 */
export async function mockApi(answers) {
    const requests = [];
    let index = 0;
    const server = http.createServer((req, res) => {
        let body = '';
        req.on('data', (chunk) => { body += chunk; });
        req.on('end', () => {
            const parsed = JSON.parse(body || '{}');
            requests.push(parsed);
            const answer = answers[Math.min(index, answers.length - 1)];
            index += 1;
            // Отказ хоста: ответ не приходит вовсе — так ведёт себя хост, у которого
            // закрыт доступ.
            if (answer?.status && answer.status >= 400) {
                res.writeHead(answer.status, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(answer.body ?? { error: { message: 'refused' } }));
                return;
            }
            if (parsed.stream === true) {
                res.writeHead(200, { 'Content-Type': 'text/event-stream' });
                res.write(`data: ${JSON.stringify({ type: 'response.created', response: { id: answer.id ?? 'resp_1', status: 'in_progress' } })}\n\n`);
                res.write(`data: ${JSON.stringify({ type: 'response.completed', response: answer })}\n\n`);
                res.end();
                return;
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(answer));
        });
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    return {
        url: `http://127.0.0.1:${port}/v1/`,
        requests,
        close: () => server.close(),
    };
}

/**
 * A response with one tool call.
 * @param {string} name
 * @param {object} args
 * @returns {object}
 */
export function toolAnswer(name, args) {
    return {
        id: 'resp_1',
        status: 'completed',
        model: 'test-model',
        output: [{
            type: 'function_call',
            call_id: `call_${name}`,
            name,
            arguments: JSON.stringify(args),
        }],
        usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
    };
}

/**
 * A response with a text answer.
 * @param {string} text
 * @returns {object}
 */
export function textAnswer(text) {
    return {
        id: 'resp_2',
        status: 'completed',
        model: 'test-model',
        output: [{ type: 'message', content: [{ type: 'output_text', text }] }],
        usage: { input_tokens: 12, output_tokens: 6, total_tokens: 18 },
    };
}

/**
 * A response with the call of the schema of a role: the answer of the role.
 * @param {string} name the name of the schema
 * @param {object} args the data of the answer
 * @returns {object}
 */
export function schemaAnswer(name, args) {
    return {
        id: 'resp_3',
        status: 'completed',
        model: 'test-model',
        output: [{
            type: 'function_call',
            call_id: `call_${name}`,
            name,
            arguments: JSON.stringify(args),
        }],
        usage: { input_tokens: 12, output_tokens: 6, total_tokens: 18 },
    };
}

/**
 * The data of the answer of the coder.
 * @returns {object}
 */
export function codeData() {
    return {
        summary: 'The page is written.',
        files: [{ path: 'index.html', content: '<h1>Привет</h1>', language: 'html' }],
        commands: [],
        notes: 'Nothing else.',
    };
}
