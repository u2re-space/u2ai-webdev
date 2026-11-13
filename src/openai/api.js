/**
 * @file src/openai/api.js
 * @module openai/api
 * @purpose The wire primitives of the API: the error type, the SSE parser and the stream reducer.
 * @depends node:buffer
 * @usedBy openai/client, openai/http, openai/responses, openai/chat
 * @exports ApiError, isAbortError, parseSSE, createStreamReducer, outputText, refusalText, normalizeUsage
 * @ai.tags api, errors, sse, stream
 * @ai.hint legacy-0.2
 */

// --- errors ---------------------------------------------------------------
/** Error raised for any failure while talking to the API. */
export class ApiError extends Error {
    /**
     * Copy status, request ids and retry metadata onto the error. The response body
     * is kept only when it is passed in.
     * @param {string} message
     * @param {object} [options]
     * @returns {void}
     * @ai.hint pure
     */
    constructor(message, {
        code = 'API_ERROR', status = null, requestId = null, clientRequestId = null, responseId = null,
        retryAfter = null, apiCode = null, apiType = null, param = null, retryable = false, cause, details = null,
    } = {}) {
        super(message, cause === undefined ? undefined : { cause });
        this.name = 'ApiError';
        Object.assign(this, {
            code, status, requestId, clientRequestId, responseId, retryAfter,
            apiCode, apiType, param, retryable, details,
        });
    }

    /** Response bodies and prompts are deliberately excluded from the log representation. */
    toJSON() {
        return {
            name: this.name, code: this.code, message: this.message, status: this.status,
            requestId: this.requestId, clientRequestId: this.clientRequestId, responseId: this.responseId,
            retryAfter: this.retryAfter, apiCode: this.apiCode, apiType: this.apiType, param: this.param,
            retryable: this.retryable,
        };
    }
}

/**
 * True for an AbortError, ABORT_ERR, or a cancelled request.
 * @param {*} error
 * @returns {boolean}
 * @exports
 * @ai.hint pure
 */
export const isAbortError = (error) =>
    error?.name === 'AbortError' || error?.code === 'ABORT_ERR';

// --- server-sent events -------------------------------------------------
const byteLength = (text) => Buffer.byteLength(text, 'utf8');
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * Bounded Server-Sent Events parser over an async iterable of byte chunks.
 * Handles split UTF-8 sequences, CR / LF / CRLF line endings, comments, multiple `data:` lines
 * and a final event without a trailing blank line. Yields parsed JSON events; the literal
 * `[DONE]` sentinel is yielded as `{ type: '__done' }`.
 *
 * `requireType` is true for the Responses API, where every event names itself. Chat Completions
 * chunks carry no `type`, so that transport parses with `requireType: false` and takes the type
 * from the SSE `event:` field when one is present.
 * @param {AsyncIterable<Buffer>} source
 * @param {{ maxEventBytes?: number, maxStreamBytes?: number, maxEvents?: number, requireType?: boolean }} [options]
 * @returns {AsyncGenerator<object>}
 * @ai.hint pure
 */
export async function* parseSSE(source, {
    maxEventBytes = 16 * 1024 * 1024, maxStreamBytes = 512 * 1024 * 1024, maxEvents = 1_000_000,
    requireType = true,
} = {}) {
    const decoder = new TextDecoder('utf-8', { fatal: false });
    let streamBytes = 0, events = 0, eventBytes = 0;
    let line = '', lineBytes = 0, skipLF = false;
    let dataLines = [], eventName = '';

    const fail = (message, code = 'INVALID_SSE') => { throw new ApiError(message, { code }); };

    /**
     * Add text to the current line and reject an event that exceeds maxEventBytes.
     * @param {string} fragment
     * @returns {void}
     * @ai.hint pure
     */
    function append(fragment) {
        lineBytes += byteLength(fragment);
        if (lineBytes + eventBytes > maxEventBytes) fail('SSE event exceeds the size limit.', 'EVENT_LIMIT');
        line += fragment;
    }
    /**
     * Finish one event. `[DONE]` becomes `{ type: '__done' }`. Returns null when there is no data.
     * @returns {object|null}
     * @ai.hint pure
     */
    function dispatch() {
        const data = dataLines.length ? dataLines.join('\n') : null;
        const name = eventName;
        dataLines = []; eventName = ''; eventBytes = 0;
        if (data === null) return null;
        if (++events > maxEvents) fail('Too many SSE events.', 'EVENT_COUNT_LIMIT');
        if (data.trim() === '[DONE]') return { type: '__done' };
        let event;
        try { event = JSON.parse(data); } catch { fail('SSE data is not valid JSON.'); }
        if (!isRecord(event)) fail('An SSE event must be a JSON object.');
        if (typeof event.type !== 'string' || !event.type) {
            if (requireType) fail('SSE event without a type field.');
            // A chat.completion.chunk names itself only through the SSE `event:` field, if at all.
            if (name) event.type = name;
        }
        if (name && name !== 'message' && event.type && name !== event.type) {
            fail('The SSE event name does not match the JSON type.');
        }
        return event;
    }
    /**
     * Close the current line: blank dispatches, `:` is a comment, `data` and `event` are stored.
     * @returns {object|null}
     * @ai.hint pure
     */
    function endLine() {
        const current = line;
        eventBytes += lineBytes + 1;
        line = ''; lineBytes = 0;
        if (eventBytes > maxEventBytes) fail('SSE event exceeds the size limit.', 'EVENT_LIMIT');
        if (current === '') return dispatch();
        if (current.startsWith(':')) return null;
        const colon = current.indexOf(':');
        const field = colon < 0 ? current : current.slice(0, colon);
        let value = colon < 0 ? '' : current.slice(colon + 1);
        if (value.startsWith(' ')) value = value.slice(1);
        if (field === 'data') dataLines.push(value);
        else if (field === 'event') eventName = value;
        return null;
    }
    /**
     * Split one decoded chunk on CR, LF, and CRLF and yield each finished event.
     * @param {string} text
     * @returns {Generator<object>}
     * @ai.hint pure
     */
    function* consume(text) {
        let start = 0;
        if (skipLF && text.length) { if (text[0] === '\n') start = 1; skipLF = false; }
        const separators = /[\r\n]/g;
        separators.lastIndex = start;
        let match;
        while ((match = separators.exec(text))) {
            const index = match.index;
            append(text.slice(start, index));
            const event = endLine();
            if (event) yield event;
            start = index + 1;
            if (text[index] === '\r') {
                if (text[start] === '\n') { start++; separators.lastIndex = start; }
                else if (start === text.length) skipLF = true;
            }
        }
        append(text.slice(start));
    }

    for await (const chunk of source) {
        streamBytes += chunk.byteLength;
        if (streamBytes > maxStreamBytes) fail('SSE stream exceeds the size limit.', 'RESPONSE_LIMIT');
        yield* consume(decoder.decode(chunk, { stream: true }));
    }
    yield* consume(decoder.decode());
    if (line.length) { const event = endLine(); if (event) yield event; }
    const last = dispatch();
    if (last) yield last;
}

// --- stream reducer -----------------------------------------------------
/** Built-in tool kinds the reducer reports as progress. */
const BUILTIN_KINDS = {
    image_generation_call: 'image_generation',
    web_search_call: 'web_search',
    file_search_call: 'file_search',
    code_interpreter_call: 'code_interpreter',
    computer_call: 'computer',
    mcp_call: 'mcp',
    mcp_list_tools: 'mcp',
    local_shell_call: 'local_shell',
    custom_tool_call: 'custom_tool',
};

/**
 * Turns raw Responses API streaming events into a small, stable set of application events
 * and keeps track of the final response object. Also accumulates streamed text so that a
 * truncated stream still yields something useful.
 *
 * Application events (all have `type`):
 *   response.created {responseId, status, model}        response.status {status}
 *   text.delta {text, itemId}                           text.done {text, itemId}
 *   refusal.delta {text}                                reasoning.delta {text}   reasoning.done {text}
 *   tool.call.start {itemId, name, callId}              tool.args.delta {itemId, bytes}
 *   tool.args.done {itemId, name, arguments}
 *   builtin.start {kind, itemId}  builtin.progress {kind, itemId, status}  builtin.done {kind, item}
 *   item.done {item}                                    stream.error {code, message}
 * @param {{ emit?: Function }} [options]
 * @returns {object}
 */
export function createStreamReducer({ emit = () => {} } = {}) {
    let response = null;
    let lastSequence = null;
    let streamError = null;
    const items = new Map();            // output_index -> item (as added)
    const textByItem = new Map();       // item_id -> accumulated text
    const argsByItem = new Map();       // item_id -> accumulated arguments

    const notify = (event) => { try { emit(event); } catch { /* observers never break a request */ } };
    const kindOf = (item) => BUILTIN_KINDS[item?.type] ?? null;

    /**
     * Apply one raw stream event and emit the matching application event.
     * @param {object} event
     * @returns {void}
     * @ai.hint pure
     */
    function handle(event) {
        if (Number.isSafeInteger(event.sequence_number)) lastSequence = event.sequence_number;
        switch (event.type) {
            case 'response.created':
                response = event.response ?? response;
                notify({
                    type: 'response.created', responseId: response?.id ?? null,
                    status: response?.status ?? 'in_progress', model: response?.model ?? null,
                });
                break;
            case 'response.queued':
            case 'response.in_progress':
                response = event.response ?? response;
                notify({ type: 'response.status', status: event.type.slice('response.'.length), responseId: response?.id ?? null });
                break;
            case 'response.output_item.added': {
                const item = event.item ?? {};
                items.set(event.output_index, item);
                if (item.type === 'function_call') {
                    notify({ type: 'tool.call.start', itemId: item.id ?? null, name: item.name ?? null, callId: item.call_id ?? null });
                } else if (item.type === 'reasoning') {
                    notify({ type: 'reasoning.start', itemId: item.id ?? null });
                } else if (item.type === 'message') {
                    notify({ type: 'message.start', itemId: item.id ?? null, role: item.role ?? 'assistant' });
                } else if (kindOf(item)) {
                    notify({ type: 'builtin.start', kind: kindOf(item), itemId: item.id ?? null, item });
                }
                break;
            }
            case 'response.output_text.delta': {
                if (typeof event.delta !== 'string') throw new ApiError('The text delta is not a string.', { code: 'INVALID_SSE' });
                const id = event.item_id ?? `#${event.output_index}`;
                textByItem.set(id, (textByItem.get(id) ?? '') + event.delta);
                notify({ type: 'text.delta', text: event.delta, itemId: id });
                break;
            }
            case 'response.output_text.done':
                notify({ type: 'text.done', text: event.text ?? textByItem.get(event.item_id) ?? '', itemId: event.item_id ?? null });
                break;
            case 'response.refusal.delta':
                notify({ type: 'refusal.delta', text: String(event.delta ?? '') });
                break;
            case 'response.refusal.done':
                notify({ type: 'refusal.done', text: String(event.refusal ?? '') });
                break;
            case 'response.reasoning_summary_text.delta':
            case 'response.reasoning_text.delta':
                notify({ type: 'reasoning.delta', text: String(event.delta ?? ''), itemId: event.item_id ?? null });
                break;
            case 'response.reasoning_summary_text.done':
            case 'response.reasoning_text.done':
                notify({ type: 'reasoning.done', text: String(event.text ?? ''), itemId: event.item_id ?? null });
                break;
            case 'response.function_call_arguments.delta': {
                const id = event.item_id ?? `#${event.output_index}`;
                const delta = String(event.delta ?? '');
                argsByItem.set(id, (argsByItem.get(id) ?? '') + delta);
                notify({ type: 'tool.args.delta', itemId: id, bytes: Buffer.byteLength(delta) });
                break;
            }
            case 'response.function_call_arguments.done': {
                const item = items.get(event.output_index);
                notify({
                    type: 'tool.args.done', itemId: event.item_id ?? null, name: event.name ?? item?.name ?? null,
                    arguments: event.arguments ?? argsByItem.get(event.item_id) ?? '',
                });
                break;
            }
            case 'response.output_item.done': {
                const item = event.item ?? items.get(event.output_index) ?? {};
                items.set(event.output_index, item);
                if (kindOf(item)) notify({ type: 'builtin.done', kind: kindOf(item), itemId: item.id ?? null, item });
                notify({ type: 'item.done', item });
                break;
            }
            case 'response.completed':
            case 'response.failed':
            case 'response.incomplete':
                response = event.response ?? response;
                break;
            case 'error': {
                // Shape: { type:'error', error:{ type, code, message, param } } (nested) or flat { code, message }.
                const payload = event.error && typeof event.error === 'object' ? event.error : event;
                streamError = new ApiError(`Responses API stream error: ${payload.message ?? payload.code ?? 'unknown'}`, {
                    code: 'STREAM_ERROR', apiCode: payload.code ?? null, apiType: payload.type ?? null, param: payload.param ?? null,
                });
                notify({ type: 'stream.error', code: payload.code ?? null, message: payload.message ?? 'stream error' });
                // Do not throw yet: the API normally follows with response.failed carrying the final state.
                break;
            }
            default: {
                // Progress events of built-in tools: response.<tool>_call.<status>
                const match = /^response\.([a-z_]+_call)(?:_[a-z_]+)?\.([a-z_]+)$/.exec(event.type);
                if (match && BUILTIN_KINDS[match[1]]) {
                    notify({
                        type: 'builtin.progress', kind: BUILTIN_KINDS[match[1]], itemId: event.item_id ?? null,
                        status: match[2], raw: event.type,
                    });
                }
            }
        }
    }

    return {
        handle,
        /**
         * Response object seen so far, or null before response.created.
         * @returns {object|null}
         * @ai.hint pure
         */
        get response() { return response; },
        /**
         * Last SSE sequence_number, or null when none has arrived.
         * @returns {number|null}
         * @ai.hint pure
         */
        get lastSequence() { return lastSequence; },
        /**
         * Error event from the stream, if the API sent one.
         * @returns {ApiError|null}
         * @ai.hint pure
         */
        get streamError() { return streamError; },
        /**
         * Output items in arrival order.
         * @returns {object[]}
         * @ai.hint pure
         */
        get items() { return [...items.values()]; },
        /**
         * Text accumulated so far (useful when the stream was cut before response.completed).
         * @returns {string}
         * @ai.hint pure
         */
        partialText() { return [...textByItem.values()].join(''); },
    };
}

/**
 * Concatenate all assistant output_text parts of a response.
 * @param {object} response
 * @returns {string}
 * @ai.hint pure
 */
export function outputText(response) {
    if (!Array.isArray(response?.output)) return '';
    const parts = [];
    for (const item of response.output) {
        if (item?.type !== 'message' || !Array.isArray(item.content)) continue;
        for (const part of item.content) {
            if (part?.type === 'output_text' && typeof part.text === 'string') parts.push(part.text);
        }
    }
    return parts.join('');
}

/**
 * Refusal text of a response, if any.
 * @param {object} response
 * @returns {string}
 * @ai.hint pure
 */
export function refusalText(response) {
    if (!Array.isArray(response?.output)) return '';
    for (const item of response.output) {
        for (const part of item?.content ?? []) if (part?.type === 'refusal') return String(part.refusal ?? '');
    }
    return '';
}

/**
 * Normalize usage from a response; returns null if the usage block is missing or malformed.
 * @param {object} usage
 * @returns {object|null}
 * @ai.hint pure
 */
export function normalizeUsage(usage) {
    if (!usage || typeof usage !== 'object') return null;
    const int = (value) => (Number.isSafeInteger(value) && value >= 0 ? value : 0);
    const input = int(usage.input_tokens);
    const output = int(usage.output_tokens);
    if (!Number.isSafeInteger(usage.input_tokens) || !Number.isSafeInteger(usage.output_tokens)) return null;
    return {
        input, output,
        cached: Math.min(input, int(usage.input_tokens_details?.cached_tokens)),
        reasoning: Math.min(output, int(usage.output_tokens_details?.reasoning_tokens)),
        total: int(usage.total_tokens) || input + output,
    };
}
