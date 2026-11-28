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
 * The answers may be given **by the schema of the role**: `{ advice: [...], code: [...] }`.
 * A request of the schema `advice` takes the next answer of that list, and the others take
 * theirs. It matters because a run asks **several** roles: the adviser of a step answers
 * with the schema `advice`, and the role of the step answers with its own. A single list
 * would shift: the adviser would eat the first answer of the worker.
 *
 * The adviser is the exception: when the test does not say what the adviser says, the
 * mock answers for it — a canned advice. The tests of the work of a role are not tests of
 * the adviser, and a shift of the queue would make them lie.
 *
 * @param {object[]|Record<string, object[]>} answers the answers of the API, in order, or
 *   the answers of each schema
 * @returns {Promise<{ url: string, requests: object[], close: Function }>}
 */
export async function mockApi(answers) {
    const requests = [];
    const bySchema = answers && !Array.isArray(answers) ? answers : null;
    const list = bySchema ? null : answers;
    const index = new Map();

    /**
     * The schema of a request: the name of the tool that carries the answer of the role.
     *
     * The schema travels as a tool among the others, and it is the **last** one: the tools
     * of the role come first. So the schema is found by its name, and not by the first
     * tool of the list — иначе запрос сетки был бы принят за запрос советника.
     *
     * @param {object} body the body of the request
     * @returns {string|null}
     */
    const schemaOf = (body) => {
        const named = body?.schema_name ?? body?.schemaName;
        if (named) return String(named);
        const tools = Array.isArray(body?.tools) ? body.tools : [];
        const schema = body?.text?.format?.name;
        if (schema) return String(schema);
        // The tool of the schema is the one whose description says it submits the answer.
        const found = tools.find((tool) => tool?.type === 'function'
            && typeof tool?.description === 'string'
            && tool.description.includes('Submit the final'));
        if (found) return String(found.name);
        return null;
    };

    /**
     * The next answer for one kind of request.
     *
     * The counter is **per kind** only when the answers are given by kind. A flat list is
     * one queue for everybody: the tests that give a flat list expect the requests in
     * order, and a counter per kind would hand the first answer of the list to every
     * kind at once.
     *
     * A request **without** a schema is a request of a role that is still working: the
     * schema of the role is not on the table yet. Such a request belongs to the kind of
     * the role — and the mock has to guess it, because the body does not name it.
     *
     * @param {string} key the kind of the request
     * @param {object} body the body of the request
     * @returns {object|null}
     */
    const next = (key, body = null) => {
        // A request without a schema: the role of the request is the only kind that has
        // an answer for it. The adviser is the exception: it always answers with its
        // schema, so a request without a schema is never the adviser.
        const kind = key ?? guessKind(body);
        const source = bySchema ? (bySchema[kind] ?? bySchema.default ?? []) : list;
        const at = bySchema ? (index.get(kind) ?? 0) : (index.get('flat') ?? 0);
        index.set(bySchema ? kind : 'flat', at + 1);
        if (!Array.isArray(source) || !source.length) return null;
        return source[Math.min(at, source.length - 1)];
    };

    /**
     * The kind of a request that names no schema: the only kind that has answers.
     *
     * @param {object} body the body of the request
     * @returns {string}
     */
    const guessKind = (body) => {
        if (!bySchema) return 'default';
        const kinds = Object.keys(bySchema).filter((key) => key !== 'advice');
        return kinds.length === 1 ? kinds[0] : 'default';
    };

    const server = http.createServer((req, res) => {
        let body = '';
        req.on('data', (chunk) => { body += chunk; });
        req.on('end', () => {
            const parsed = JSON.parse(body || '{}');
            requests.push(parsed);
            const schema = schemaOf(parsed);
            // The adviser of a step: the mock answers for it, when the test did not say
            // what the adviser says.
            const answer = schema === 'advice' && !(bySchema?.advice ?? list?.advice)
                ? defaultAdvice()
                : next(schema, parsed);
            if (!answer) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: { message: 'the mock has no answer for this request' } }));
                return;
            }
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
 * The answer of the adviser that the mock gives when the test does not say one.
 * @returns {object}
 */
function defaultAdvice() {
    return {
        id: 'resp_advice',
        status: 'completed',
        model: 'test-model',
        output: [{
            type: 'function_call',
            call_id: 'call_advice',
            name: 'advice',
            arguments: JSON.stringify({
                summary: 'The step is clear.',
                points: [],
                risks: [],
                order: [],
                notes: '',
            }),
        }],
        usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
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
