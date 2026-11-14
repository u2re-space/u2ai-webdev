/**
 * @file src/roles/index.js
 * @module roles/index
 * @purpose The registry of the roles and the loop that runs one of them with its tools.
 *
 *   A role is a prompt, a schema of the answer, a list of tools and a limit of turns. The
 *   registry knows the built-in roles; the config may add its own and may override the model,
 *   the effort, the instructions and the tools of any of them.
 *
 *   The loop is the one of the monolith, made small: the model answers, the calls of the tools
 *   are executed, their answers go back into the same conversation, and the loop ends when the
 *   model answers without asking for a tool, or when the turns run out.
 *
 * @depends openai/responses, agent/schemas, agent/skills, agent/docs, agent/tools, agent/pace
 * @usedBy stages/index, cli
 * @exports ROLES, ROLE_NAMES, resolveRole, buildInstructions, runRole, roleSchema, roleReason
 * @ai.tags roles, agent
 * @ai.hint keep
 */

import { parseResponse, textPart } from '../openai/responses.js';
import { schemaFor } from '../agent/schemas.js';
import { buildSkillInstructions, discoverSkills, skillsForRole } from '../agent/skills.js';
import { documentationForRole } from '../agent/docs.js';
import { createToolset } from '../agent/tools.js';
import { effortFor } from '../agent/pace.js';

import * as untrusted from './untrusted.js';
import * as planner from './planner.js';
import * as architect from './architect.js';
import * as director from './director.js';
import * as coder from './coder.js';
import * as markup from './markup.js';
import * as styler from './styler.js';
import * as iconifier from './iconifier.js';
import * as installer from './installer.js';
import * as editor from './editor.js';
import * as reviewer from './reviewer.js';
import * as auditor from './auditor.js';
import * as learner from './learner.js';

/**
 * The built-in roles, by name.
 * @type {Readonly<Record<string, object>>}
 */
export const ROLES = Object.freeze({
    planner,
    architect,
    director,
    coder,
    markup,
    styler,
    iconifier,
    installer,
    editor,
    reviewer,
    auditor,
    learner,
});

/** The names of the built-in roles. */
export const ROLE_NAMES = Object.freeze(Object.keys(ROLES));

/**
 * The schema of the answer of a role.
 * @param {string} role
 * @returns {object|null}
 * @exports
 * @ai.hint pure
 */
export function roleSchema(role) {
    const definition = ROLES[String(role ?? '').toLowerCase()];
    if (!definition) return null;
    return definition.schema ? schemaFor(definition.schema) : null;
}

/**
 * The effective definition of a role: the built-in one, changed by the config.
 *
 * The chain of the config is `roles.<name>` and then `roles.default`; a field that is null in
 * both falls back to the built-in value.
 * @param {string} role
 * @param {object} [config]
 * @returns {{ name: string, schema: string|null, tools: string[], maxTurns: number,
 *   model: string|null, effort: string|null, summary: string|null, temperature: number|null,
 *   maxOutputTokens: number|null, instructions: string|null }|null}
 * @exports
 * @ai.hint pure
 */
export function resolveRole(role, config = {}) {
    const key = String(role ?? '').trim().toLowerCase();
    const base = ROLES[key];
    if (!base) return null;

    const roles = config?.roles ?? {};
    const own = roles[key] && typeof roles[key] === 'object' ? roles[key] : {};
    const fallback = roles.default && typeof roles.default === 'object' ? roles.default : {};

    /** The first of the values that is not null. */
    const pick = (field, fallbackValue = null) => {
        for (const source of [own, fallback]) {
            const value = source[field];
            if (value !== null && value !== undefined) return value;
        }
        return fallbackValue;
    };

    const tools = pick('tools', base.tools);
    const maxTurns = pick('maxTurns', base.maxTurns);
    const roleEffort = pick('effort', null);
    const effort = roleEffort
        ? effortFor({ config, role: key, effort: roleEffort })
        : effortFor({ config, role: key });

    return {
        name: key,
        schema: base.schema ?? null,
        tools: Array.isArray(tools) ? tools : base.tools,
        maxTurns: Number.isInteger(maxTurns) && maxTurns > 0 ? maxTurns : base.maxTurns,
        model: pick('model', config?.model ?? null),
        effort,
        summary: pick('summary', config?.reasoning?.summary ?? null),
        temperature: pick('temperature', config?.temperature ?? null),
        maxOutputTokens: pick('maxOutputTokens', config?.maxOutputTokens ?? null),
        instructions: pick('instructions', null),
    };
}

/**
 * The instructions of a role: its prompt, the instructions of the config, the standards of the
 * documentation and the skill packs.
 * @param {{ role: string, config?: object, context?: object, root?: string, env?: object }} request
 * @returns {Promise<string>}
 * @exports
 * @ai.hint io
 */
export async function buildInstructions({ role, config = {}, context = {}, root = process.cwd(), env = process.env }) {
    const key = String(role ?? '').trim().toLowerCase();
    const definition = ROLES[key];
    if (!definition) throw new Error(`Неизвестная роль: ${role}`);

    const blocks = [];
    const prompt = definition.instructions(context);
    if (prompt) blocks.push(prompt);

    const extra = config?.roles?.[key]?.instructions ?? config?.roles?.default?.instructions ?? null;
    if (extra) blocks.push(`## Extra instructions\n${String(extra).trim()}`);

    const documentation = documentationForRole(config, key);
    if (documentation) blocks.push(`## Standards\n${documentation}`);

    const packs = await skillsForRole({
        dir: config?.skills?.dir ?? null,
        role: key,
        env,
    });
    if (packs) blocks.push(packs);

    const skills = await discoverSkills(root, {
        extraDirs: config?.skills?.dir ? [config.skills.dir] : [],
        env,
    });
    const list = buildSkillInstructions(skills);
    if (list) blocks.push(list);

    return blocks.join('\n\n');
}

/**
 * Run one role: the model answers, the tools run, their answers go back, and the loop ends.
 *
 * The loop keeps the whole conversation in the `input` array, because the Responses API takes
 * the items of the conversation as they are: a user message, then a pair of a call and its
 * answer for every tool call.
 * @param {{ client: object, config?: object, role: string, input?: string, parts?: object[],
 *   context?: object, root?: string, env?: object, toolset?: object, maxTurns?: number,
 *   signal?: AbortSignal|null, notify?: (event: object) => void }} request
 * @returns {Promise<{ role: string, text: string, data: object|null, toolCalls: object[],
 *   turns: number, usage: object|null, model: string|null, stopped: string }>}
 * @exports
 * @ai.hint io
 */
export async function runRole({
    client,
    config = {},
    role,
    input = '',
    parts = [],
    context = {},
    root = process.cwd(),
    env = process.env,
    toolset = null,
    maxTurns = null,
    signal = null,
    notify = () => {},
}) {
    if (!client?.responses) throw new Error('Клиент API не передан.');
    const key = String(role ?? '').trim().toLowerCase();
    const definition = resolveRole(key, config);
    if (!definition) throw new Error(`Неизвестная роль: ${role}`);

    const instructions = await buildInstructions({ role: key, config, context, root, env });
    const tools = toolset ?? createToolset({ root, config, role: key, env });
    const specs = tools.specsFor(key, definition.tools);
    const schema = roleSchema(key);
    const schemaName = definition.schema ?? 'response';
    const limit = Number.isInteger(maxTurns) && maxTurns > 0 ? maxTurns : definition.maxTurns;

    const items = [{ role: 'user', content: [textPart(input), ...(parts ?? [])] }];
    const calls = [];
    let turns = 0;
    let stopped = 'completed';
    let answer = null;

    while (turns < limit) {
        turns += 1;
        const raw = await client.responses.create({
            model: definition.model,
            instructions,
            input: items,
            tools: specs,
            schema,
            schemaName,
            effort: definition.effort,
            summary: definition.summary,
            temperature: definition.temperature,
            maxOutputTokens: definition.maxOutputTokens,
            signal,
        });

        const parsed = parseResponse(raw);
        const toolCalls = parsed.toolCalls ?? [];
        // The call of the schema is the answer, not a tool to run.
        const answerCall = schema ? toolCalls.find((call) => call.name === schemaName) : null;
        const work = toolCalls.filter((call) => call.name !== schemaName);

        if (!work.length) {
            answer = parsed;
            if (answerCall) answer.data = answerCall.arguments ?? parsed.data;
            stopped = 'completed';
            break;
        }

        for (const call of work) {
            calls.push(call);
            notify({ type: 'role.tool', role: key, name: call.name, turn: turns });
            let output;
            try {
                output = await tools.execute(call.name, call.arguments ?? {});
            } catch (error) {
                output = `The tool failed: ${error?.message ?? String(error)}`;
            }
            const callId = call.callId ?? call.id ?? `${call.name}-${calls.length}`;
            items.push({
                type: 'function_call',
                call_id: callId,
                name: call.name,
                arguments: JSON.stringify(call.arguments ?? {}),
            });
            items.push({ type: 'function_call_output', call_id: callId, output: String(output ?? '') });
        }

        if (turns >= limit) {
            stopped = 'maxTurns';
            answer = parsed;
        }
    }

    if (!answer) {
        answer = { text: '', data: null, toolCalls: [], usage: null, model: definition.model, refusal: '', error: null, raw: null };
    }

    notify({ type: 'role.done', role: key, turns, toolCalls: calls.length, stopped });

    return {
        role: key,
        text: answer.text ?? '',
        data: answer.data ?? null,
        refusal: answer.refusal ?? '',
        error: answer.error ?? null,
        toolCalls: calls,
        turns,
        usage: answer.usage ?? null,
        model: answer.model ?? definition.model,
        stopped,
    };
}

/**
 * Why a role answered without the data of its schema.
 *
 * A role that says nothing but a text is not a failure without a reason: the refusal of the
 * model, the error of the answer or the text itself say what happened.
 *
 * @param {object} result the answer of a role
 * @returns {string} a short reason, in Russian
 * @exports
 * @ai.hint pure
 */
export function roleReason(result = {}) {
    const refusal = String(result?.refusal ?? '').trim();
    if (refusal) return `отказ модели: ${refusal}`;
    const error = result?.error;
    if (error) {
        const message = typeof error === 'string' ? error : (error?.message ?? JSON.stringify(error));
        return `ошибка ответа: ${String(message).slice(0, 300)}`;
    }
    const text = String(result?.text ?? '').trim();
    if (text) return `ответ без данных: ${text.slice(0, 300)}`;
    return 'ответ пуст';
}

export { untrusted };
