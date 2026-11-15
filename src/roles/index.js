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
 *   A role that answers with a text instead of the data of its schema is asked once more, and
 *   the last turn belongs to the answer: when the turns run out, the role is asked to give its
 *   answer without any tool, so the stage gets the data of the schema even after a long run of
 *   tool calls.
 *
 *   A role of a step has to write the files of the step. An answer that names no file and that
 *   wrote nothing is a description of the work, not the work: such a role is told to do it.
 *
 * @depends openai/responses, agent/schemas, agent/skills, agent/docs, agent/tools, agent/pace
 * @usedBy stages/index, cli
 * @exports ROLES, ROLE_NAMES, resolveRole, buildInstructions, runRole, roleSchema, roleReason,
 *          SCHEMA_CORRECTION, FINAL_ANSWER, WORK_CORRECTION, WORK_ORDER, syntaxCorrection,
 *          partialCorrection
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
 * The correction of a role that answered with a text instead of the data of its schema.
 *
 * The role is asked once more: the answer of the schema is a call like any other, and a model
 * that missed it usually missed it because nobody told it.
 * @type {string}
 * @exports
 * @ai.hint pure
 */
export const SCHEMA_CORRECTION = 'Your answer carried no data of the schema. Answer once more with the schema of the role — the call that carries it — and with nothing else.';

/**
 * The last call of a role whose turns have run out.
 *
 * The tools are over, and the model is asked for the answer alone: with the tools in hand it
 * knows what it has done, and the stage gets the data of the schema.
 * @type {string}
 * @exports
 * @ai.hint pure
 */
export const FINAL_ANSWER = 'The turns of the role are over. Do not call any tool any more: give the final answer of the role in the schema of the role now, with what you have.';

/**
 * The correction of a role that described its work instead of doing it.
 *
 * A role of a step has to write the files of the step. An answer that names no file and that
 * wrote nothing is a plan, not a result: the role is told to do the work with its tools.
 * @type {string}
 * @exports
 * @ai.hint pure
 */
export const WORK_CORRECTION = 'You have not done the work yet: your answer names no file, and nothing was written. Do the work now with the tools — read what you need, write the files of the step, and answer with their contents. Do not describe what you are going to do: the answer is the result of the work.';

/**
 * The second correction of a role that still only described its work.
 *
 * The first correction is a request; the second one is an order with the tools named. A role
 * that answers with a plan twice is not going to work on the plan: it has to be told, in
 * plain words, which call to make.
 * @type {string}
 * @exports
 * @ai.hint pure
 */
export const WORK_ORDER = 'Still nothing is written. Stop describing the work: make the calls. For every file of the step call the tool `write_file` with its path and its full content — one call per file, no exceptions. Do not answer until the files are on the disk. If you cannot write a file, say why in the notes of the answer.';

/**
 * The correction of a role whose files do not compile.
 *
 * The files of the step are on the disk, but the compiler refused them: a lost quote, a
 * stray backslash, a rule that is not closed. The role is told what the compiler said and
 * has to fix the files with its tools.
 * @param {Array<{ file: string, message: string }>} errors
 * @returns {string}
 * @exports
 * @ai.hint pure
 */
export function syntaxCorrection(errors = []) {
    const list = (Array.isArray(errors) ? errors : [])
        .map((item) => `- ${item?.file ?? 'файл'}: ${item?.message ?? 'ошибка'}`)
        .join('\n');
    return `The files of the step are on the disk, but they do not compile. Fix them now with the tools: read the file, repair the broken line, write the file again. The compiler said:\n${list}\n\nA file that is written as text with "\\n" inside a string, or with a backslash at the end of a line, is broken — write the real line breaks and the real escapes. Write the repaired file under the same path as the broken one: a copy with another name leaves the broken file on the disk. Do not answer until the files are fixed.`;
}

/**
 * The correction of a role whose styles use files that were never written.
 *
 * A stylesheet that `@use`s a file that is not on the disk breaks the build of the project:
 * the page stays without styles. The names of the missing files are given with the path they
 * have to be written under — a partial of Sass is a file whose name starts with an
 * underscore — and the role has to write them or to drop the `@use` that names them.
 * @param {{ file: string, ref: string, expected: string, partial: string }[]} missing
 * @param {Array<{ file: string, message: string }>} [errors] the other errors of the check
 * @returns {string}
 * @exports
 * @ai.hint pure
 */
export function partialCorrection(missing = [], errors = []) {
    const list = Array.isArray(missing) ? missing : [];
    const lines = list.map((item) => {
        const file = String(item?.file ?? 'файл');
        const ref = String(item?.ref ?? '').trim();
        const partial = String(item?.partial ?? item?.expected ?? '').trim();
        return `- ${file}: @use '${ref}' — the file ${partial} is not on the disk`;
    }).join('\n');
    const others = (Array.isArray(errors) ? errors : [])
        .filter((item) => !/Файл стилей не найден/.test(String(item?.message ?? '')))
        .map((item) => `- ${item?.file ?? 'файл'}: ${item?.message ?? 'ошибка'}`)
        .join('\n');
    const rest = others ? `\n\nThe compiler said:\n${others}\n` : '';
    return `The styles of the step are on the disk, but a stylesheet uses files that were never written:\n${lines}\n\nWrite every one of these files now with the tool \`write_file\`: a partial of Sass is a file whose name starts with an underscore (${list[0]?.partial ?? 'src/_name.scss'}), and the stylesheet looks for it under that name. Put the rules of that layer into the file: the tokens and the custom properties into \`variables\`, the reset and the base into \`base\`, the rest into the layer they belong to. If a layer does not belong to this step, remove its \`@use\` line from the stylesheet that names it instead of writing an empty file.${rest}\nDo not answer until the files are on the disk.`;
}

/** The tools that write into the project. */
const WRITE_TOOLS = Object.freeze(['write_file', 'replace_text', 'copy_path', 'generate_svg']);

/**
 * Whether the answer of a write tool says that the file is on the disk.
 *
 * A tool that refused the write (the file is there, the path is out of the project, the tool
 * failed) has not done the work: the role that only failed writes has to be told to try again.
 * @param {unknown} output the answer of the tool
 * @returns {boolean}
 * @ai.hint pure
 */
function wroteSomething(output) {
    const text = String(output ?? '').trim();
    if (!text) return false;
    if (/^the tool failed:/i.test(text)) return false;
    if (/запрещена|не найден|уже существует|не удалось|ошибка|отказ/i.test(text)) return false;
    return true;
}

/**
 * A file of an answer that holds nothing: empty, or a marker of a work that is not done.
 * @param {object} file
 * @returns {boolean}
 * @ai.hint pure
 */
function isEmptyFile(file) {
    const content = String(file?.content ?? '');
    if (!content.trim()) return true;
    return /^\s*(?:\/\/|#|\/\*|<!--)?\s*(?:placeholder|todo|tbd|fixme|заглушка)\b[^\n]*$/i.test(content);
}

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
 * The arguments of a tool call, cut to what a log needs.
 *
 * The content of a written file is not a part of a log line: it is kept short, so the
 * event of the call stays small.
 * @param {unknown} args
 * @returns {object|null}
 * @exports
 * @ai.hint pure
 */
export function toolCallDetail(args) {
    if (!args || typeof args !== 'object' || Array.isArray(args)) return null;
    const out = {};
    for (const [key, value] of Object.entries(args)) {
        if (typeof value === 'string') {
            out[key] = value.length > 160 ? `${value.slice(0, 160)}… (${value.length} знаков)` : value;
        } else if (Array.isArray(value)) {
            out[key] = value.slice(0, 8).map((item) => (
                typeof item === 'string' && item.length > 80 ? `${item.slice(0, 80)}…` : item
            ));
        } else {
            out[key] = value;
        }
    }
    return out;
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
    requireFiles = false,
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
    let corrected = false;
    let correctedWork = false;
    let workCorrections = 0;
    let fallback = null;
    // The channel of the schema: where the answer of the role travels. A model that is
    // pinned to a JSON answer never calls a tool: it describes the work instead of doing it.
    // The mode comes from the profile of the model, and the role moves the schema into the
    // tool channel when it has to write and only describes the work.
    let schemaChannel = null;
    let withSchema = true;
    // The files the step names: the role has to write them.
    const wantedFiles = Array.isArray(context?.step?.files)
        ? context.step.files.map((item) => String(item ?? '').trim()).filter(Boolean)
        : [];

    /**
     * One call of the model: the request, the answer and the calls it asks for.
     * @param {{ tools?: object[], schema?: object|null, schemaChannel?: string|null }} [options]
     * @returns {Promise<{ parsed: object, work: object[] }>}
     * @ai.hint io
     */
    const ask = async ({
        tools: toolList = specs,
        schema: schemaOverride = undefined,
        schemaChannel: channelOverride = undefined,
    } = {}) => {
        const raw = await client.responses.create({
            model: definition.model,
            instructions,
            input: items,
            tools: toolList,
            schema: schemaOverride === undefined ? (withSchema ? schema : null) : schemaOverride,
            schemaChannel: channelOverride === undefined ? schemaChannel : channelOverride,
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
        if (answerCall) parsed.data = answerCall.arguments ?? parsed.data;
        return { parsed, work };
    };

    // The writes that really wrote a file.
    const writes = [];

    while (turns < limit) {
        turns += 1;
        const { parsed, work } = await ask();

        if (!work.length) {
            answer = parsed;
            const withoutData = Boolean(schema) && !answer.data;
            if (withoutData && !corrected && turns < limit) {
                // The model answered with a text instead of the schema: it is asked once more.
                corrected = true;
                fallback = parsed;
                items.push({ role: 'user', content: [textPart(SCHEMA_CORRECTION)] });
                continue;
            }

            // The work of a step is the files it names. An answer without them is a
            // description of the work: the role is told to do it.
            const wrote = writes.length > 0;
            const files = Array.isArray(answer?.data?.files) ? answer.data.files : [];
            const rest = ['dependencies', 'scripts'].reduce((sum, key) => (
                sum + (Array.isArray(answer?.data?.[key]) ? answer.data[key].length : 0)
            ), 0);
            const useful = files.filter((file) => !isEmptyFile(file)).length + rest;
            const withoutWork = requireFiles && !wrote && useful === 0;
            if (withoutWork && turns < limit && workCorrections < 2) {
                // The first correction asks, the second one orders and names the tools.
                const list = wantedFiles.length ? ` The step names: ${wantedFiles.join(', ')}.` : '';
                workCorrections += 1;
                if (workCorrections === 1) {
                    correctedWork = true;
                    items.push({ role: 'user', content: [textPart(`${WORK_CORRECTION}${list}`)] });
                    // The schema moves into the tool channel: a model that is pinned to a
                    // JSON answer describes the work instead of doing it.
                    schemaChannel = 'tool';
                } else {
                    items.push({ role: 'user', content: [textPart(`${WORK_ORDER}${list}`)] });
                    // The schema is dropped too: the only way to finish is the tool of the work.
                    schemaChannel = 'tool';
                    withSchema = false;
                }
                continue;
            }

            stopped = 'completed';
            break;
        }

        for (const call of work) {
            calls.push(call);
            notify({
                type: 'role.tool',
                role: key,
                name: call.name,
                arguments: toolCallDetail(call.arguments),
                turn: turns,
            });
            let output;
            try {
                output = await tools.execute(call.name, call.arguments ?? {});
            } catch (error) {
                output = `The tool failed: ${error?.message ?? String(error)}`;
            }
            if (WRITE_TOOLS.includes(call.name) && wroteSomething(output)) writes.push(call);
            const callId = call.callId ?? call.id ?? `${call.name}-${calls.length}`;
            // The answer of the tool goes into the log only when it is short: the content
            // of a file is not a line of the log.
            const short = String(output ?? '').trim();
            if (short && short.length <= 140) {
                notify({ type: 'role.tool.result', role: key, name: call.name, output: short });
            }
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

    // The text of the answer before the correction is better than an empty answer.
    if (answer && !answer.text && fallback?.text) {
        answer = { ...answer, text: fallback.text };
    }

    // The last turn belongs to the answer: the role is asked to give it without any tool, so a
    // long run of tool calls still ends with the data of the schema.
    if (schema && !answer?.data && !answer?.refusal && !answer?.error) {
        items.push({ role: 'user', content: [textPart(FINAL_ANSWER)] });
        let final = null;
        try {
            // The schema comes back for the last turn: it is the answer of the role.
            ({ parsed: final } = await ask({ tools: [], schema, schemaChannel: 'format' }));
        } catch (error) {
            final = null;
        }
        if (final?.data) {
            answer = final;
            stopped = 'completed';
        } else if (final?.text && !answer?.text) {
            answer = { ...answer, text: final.text };
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
