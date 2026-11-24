/**
 * @file test/helpers/fake-api.js
 * @module test/helpers/fake-api
 * @purpose The fake API of the house: it answers like the model, and it remembers what it
 *          was asked.
 *
 *   The tests that start a sub-agent need an API to talk to: the thread of the sub-agent
 *   asks it over the network, exactly as it asks the real one. This server answers with
 *   the turns the test wrote down, one after another, and it keeps the requests so the
 *   test can see what the thread asked for.
 *
 * @depends node:http
 * @usedBy test/subagent
 * @exports startFakeApi
 * @ai.tags test, api, helper
 * @ai.hint io
 */

import { createServer } from 'node:http';

/**
 * Start the fake API of the house.
 *
 * @param {Array<{ type?: string, name?: string, arguments?: object, text?: string }>} turns
 *   the turns the server answers with, one per request
 * @returns {Promise<{ url: string, requests: object[], stop: Function }>}
 * @exports
 * @ai.hint io
 */
export async function startFakeApi(turns = []) {
    const requests = [];
    const server = createServer((request, response) => {
        let body = '';
        request.on('data', (chunk) => { body += chunk; });
        request.on('end', () => {
            let parsed = {};
            try {
                parsed = body ? JSON.parse(body) : {};
            } catch {
                parsed = {};
            }
            requests.push(parsed);
            const turn = turns[Math.min(requests.length - 1, Math.max(0, turns.length - 1))] ?? { text: 'done' };
            const answer = turn.type === 'function_call'
                ? {
                    status: 'completed',
                    output: [{
                        type: 'function_call',
                        id: `fc-${requests.length}`,
                        call_id: `c-${requests.length}`,
                        name: turn.name,
                        arguments: JSON.stringify(turn.arguments ?? {}),
                    }],
                }
                : { status: 'completed', output_text: turn.text ?? '' };
            response.writeHead(200, { 'content-type': 'application/json' });
            response.end(JSON.stringify(answer));
        });
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${server.address()?.port ?? 0}/v1`;
    return {
        url,
        requests,
        stop() {
            server.close();
        },
    };
}
