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
 * @depends openai/responses, agent/schemas, agent/skills, agent/docs, agent/tools, agent/pace,
 *          model/profiles, model/trust
 * @usedBy stages/index, cli
 * @exports ROLES, ROLE_NAMES, resolveRole, readOnlyOperation, buildInstructions, runRole, roleSchema, roleReason,
 *          SCHEMA_CORRECTION, FINAL_ANSWER, WORK_CORRECTION, WORK_ORDER, syntaxCorrection,
 *          partialCorrection
 * @ai.tags roles, agent
 * @ai.hint keep
 * @changed 2026-11-15 Роли читают сводку контекста прогона и пишут свои ответы в него.
 */

import { parseResponse, textPart, imagePart } from '../openai/responses.js';
import { assetPart, scrubDataUrls, sniffType } from '../shared/data-urls.js';
import { readFile } from 'node:fs/promises';
import { resolveInside } from '../agent/paths.js';
import { schemaFor, schemaProblems, schemaText } from '../agent/schemas.js';
import { buildSkillInstructions, discoverSkills, skillsForRole } from '../agent/skills.js';
import { documentationForRole } from '../agent/docs.js';
import { sourcesBlock } from '../agent/sources.js';
import { createToolset } from '../agent/tools.js';
import { toolSpecs as buildToolSpecs } from '../agent/tool-specs.js';
import { createDelegator } from '../agent/delegation.js';
import { effortFor } from '../agent/pace.js';
import { getModelProfile, maxOutputFor, snapEffort } from '../model/profiles.js';
import { familyOf, rankPath, resolveModelRef } from '../model/refs.js';
import { houseModel } from '../model/trust.js';
import { stageForRole } from '../stages/roles.js';
import { pageFrameContractFor } from './page-frame.js';

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
export const SCHEMA_CORRECTION = 'Your answer carried no data of the schema, or the data did not match it. Answer once more with the schema of the role — the call that carries it — and with nothing else.';

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
    return `The styles of the step are on the disk, but a stylesheet uses files that were never written:\n${lines}\n\nWrite every one of these files now with the tool \`write_file\`. A partial of Sass is a file whose name starts with an underscore: the stylesheet names it without the underscore (\`@use 'variables'\`), the file on the disk has it (\`src/_variables.scss\`). Put the rules of that layer into that file — the tokens and the custom properties into the file of the variables, the reset and the base into the file of the base, the rest into the file of the layer they belong to. If a layer does not belong to this step, remove its \`@use\` line from the stylesheet that names it instead of writing an empty file.${rest}\nDo not answer until the files are on the disk.`;
}

/** The tools that write into the project. */
const WRITE_TOOLS = Object.freeze(['write_file', 'replace_text', 'patch_file', 'copy_path', 'generate_svg']);
const STYLER_FORBIDDEN_TOOLS = new Set(['run_command', 'run_script', 'run_skill']);
const STYLER_RESEARCH_TOOLS = new Set(['read_skill', 'web_guidance']);
const STYLER_RESEARCH_LIMIT = 3;
const DELEGATED_TOOLS = new Set([
    'list_files', 'read_file', 'find_line', 'search_files', 'read_skill', 'web_guidance',
    'fetch_url', 'search_icons', 'batch', 'write_file', 'replace_text', 'patch_file',
    'copy_path', 'generate_svg',
]);
const VECTOR_TOOLS = new Set([
    'list_files', 'read_file', 'write_file', 'replace_text', 'search_files', 'read_skill',
]);
const PAGE_FRAME_ROLES = new Set(['markup', 'styler']);
const READ_ONLY_TOOLS = new Set([
    'list_files', 'read_file', 'find_line', 'search_files', 'list_backups',
    'read_skill', 'web_guidance', 'fetch_url', 'search_icons', 'ask_user',
]);
const REVIEW_TOOLS = new Set(['read_file', 'find_line']);

/**
 * Whether an operation only reads and has no report or summary to produce.
 *
 * Read-only tools do not make a review read-only for budget purposes when its schema is the
 * report. Plain-text roles can declare `outputMode: 'summary'` for the same reason.
 * @param {{ schema?: object|null, tools?: object[], outputMode?: string|null }} operation
 * @returns {boolean}
 * @exports
 * @ai.hint pure
 */
export function readOnlyOperation({ schema = null, tools = [], outputMode = null } = {}) {
    if (schema || outputMode === 'summary') return false;
    return Array.isArray(tools) && tools.every((tool) => READ_ONLY_TOOLS.has(String(tool?.name ?? '')));
}

const WRITE_READY_TOOL = Object.freeze({
    type: 'function',
    name: 'write_ready',
    description: 'INTERNAL WRITE GATE — not delegation. Call this exact tool name by itself after inspection to unlock your own file-writing tools on the next turn. It writes no files and starts no other role. Then write the files named by your step with write_file.',
    parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
});

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
 * both falls back to the built-in value. The model has one link more: the model of the house
 * for the role (`house.models` of the config, `model/trust`) sits between the pin of the role
 * and the pin of the default role, so a role that has its own model of the house keeps it —
 * and a role that names its own model in the config keeps that one.
 *
 * The effort is pulled down to what the model really takes: the Kimi has no levels above
 * `medium`, so the markup — a Kimi job — works on `medium` however deep the profile of the
 * stages asks.
 * @param {string} role
 * @param {object} [config]
 * @returns {{ name: string, schema: string|null, tools: string[], maxTurns: number,
 *   model: string|null, effort: string|null, summary: string|null, temperature: number|null,
 *   maxOutputTokens: number|null, outputMode: string|null, instructions: string|null }|null}
 * @exports
 * @ai.hint pure
 */
export function resolveRole(role, config = {}, { stage = null } = {}) {
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
    const asked = roleEffort
        ? effortFor({ config, role: key, effort: roleEffort })
        : effortFor({ config, role: key });

    // The model of the role: the pin of the role wins, then the model of the house for the
    // role, then the pin of the default role, then the model of the run. A role that names
    // its own model is never moved. A name that names a family of models is the member of
    // the family that takes the effort of the role; a name that names a group of models is
    // the member of the group that takes the effort and fits the context.
    const ownModel = own.model !== null && own.model !== undefined ? own.model : null;
    const fallbackModel = fallback.model !== null && fallback.model !== undefined ? fallback.model : null;
    const context = pick('context', null);
    // The path of the ranks of the role in its family: the stage that only polishes walks
    // its own path, the role of the house keeps the path of the house.
    const path = rankPathFor(config, key, stage);
    const rank = path?.[0] ?? null;
    const model = resolveModelRef(ownModel, config, { effort: asked, context, rank })
        ?? houseModel(key, config, { effort: asked, context, rank })
        ?? resolveModelRef(fallbackModel, config, { effort: asked, context, rank })
        ?? resolveModelRef(config?.model ?? null, config, { effort: asked, context, rank });

    // The effort is pulled down to what the model really takes: a model with a lower ceiling
    // refuses the level above it. The Kimi, for one, has no levels above `medium`.
    const effort = snapEffort(asked, getModelProfile(model, config)) ?? asked;

    // The family the model came from: the role may step down to the next rank of its path
    // when its work is done.
    const family = familyOf(config, model);

    return {
        name: key,
        schema: base.schema ?? null,
        outputMode: base.outputMode ?? (base.schema ? 'writeup' : null),
        tools: Array.isArray(tools) ? tools : base.tools,
        maxTurns: Number.isInteger(maxTurns) && maxTurns > 0 ? maxTurns : base.maxTurns,
        model,
        effort,
        asked,
        family,
        path,
        summary: pick('summary', config?.reasoning?.summary ?? null),
        temperature: pick('temperature', config?.temperature ?? null),
        maxOutputTokens: pick('maxOutputTokens', config?.maxOutputTokens ?? null),
        instructions: pick('instructions', null),
    };
}

/**
 * The path of the ranks of a role in its family of models.
 *
 * The path is a list of the places of the family: the role answers on the first place and
 * steps down to the next one when its work is done. A stage that only polishes walks its own
 * path — the stage wins over the role.
 * @param {object|null} config
 * @param {string} role the name of the role
 * @param {string|null} stage the name of the stage
 * @returns {number[]|null}
 * @exports
 * @ai.hint pure
 */
export function rankPathFor(config, role, stage = null) {
    const ranks = config?.house?.ranks;
    if (!ranks || typeof ranks !== 'object') return null;
    const key = String(role ?? '').trim().toLowerCase();
    const stageName = String(stage ?? '').trim().toLowerCase();
    // The stage of the call, then the stage of the pipeline the role works in.
    for (const name of [stageName, stageForRole(key)]) {
        if (!name) continue;
        const path = rankPath(ranks.stages?.[name]);
        if (path) return path;
    }
    return rankPath(ranks.roles?.[key]);
}

/**
 * The instructions of a role: its prompt, the instructions of the config, the standards of
 * the documentation, the pages behind them, the skill packs and the brief of the context
 * of the run.
 *
 * The brief tells the role what the run already knows: the stages that are done, the decisions
 * that were made and the files that were written. A role that knows this does not ask again.
 * @param {{ role: string, config?: object, context?: object, root?: string, env?: object,
 *   runContext?: object|null }} request
 * @returns {Promise<string>}
 * @exports
 * @ai.hint io
 */
export async function buildInstructions({ role, config = {}, context = {}, root = process.cwd(), env = process.env, runContext = null }) {
    const key = String(role ?? '').trim().toLowerCase();
    const definition = ROLES[key];
    if (!definition) throw new Error(`Неизвестная роль: ${role}`);

    const blocks = [];
    // The config travels with the context of the role: the roles that work with the page
    // need to know the address of it and the width of the design.
    const prompt = definition.instructions({ ...context, config });
    if (prompt) blocks.push(prompt);

    // The contract of the answer travels in the prompt as well: a gateway that ignores the
    // JSON-schema rule of the API still shows the model the names of the fields.
    const contract = schemaText(schemaFor(definition.schema ?? ''));
    if (contract) blocks.push(contract);

    const extra = config?.roles?.[key]?.instructions ?? config?.roles?.default?.instructions ?? null;
    if (extra) blocks.push(`## Extra instructions\n${String(extra).trim()}`);

    const documentation = documentationForRole(config, key);
    if (documentation) blocks.push(`## Standards\n${documentation}`);

    // The pages behind the standards: the role opens one when the task calls for it.
    const sources = sourcesBlock(config, key);
    if (sources) blocks.push(`## Documentation sources\n${sources}`);

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

    // The brief of the context of the run: what this run already knows.
    const brief = typeof runContext?.brief === 'function' ? runContext.brief() : '';
    if (brief) blocks.push(brief);

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
 * The pictures that a tool names or that `read_file` attached to its answer.
 *
 * A tool that makes a picture — the screenshot of the page, a crop of the measurer — answers
 * with the path of the file. The path in the text is not a picture: the role has to see what
 * was made, so the file goes back into the conversation as an image.
 * @param {string} root
 * @param {string} text the answer of the tool
 * @returns {Promise<object[]>} the parts of the request
 * @exports
 * @ai.hint io
 */
export async function pictureParts(root, text) {
    const body = String(text ?? '');
    if (!body.trim()) return [];
    const found = new Set();
    for (const match of body.matchAll(/[^\s"'`()]+\.(?:png|jpe?g|webp|gif)/gi)) {
        const name = match[0].replace(/[.,;]+$/, '');
        if (!name) continue;
        found.add(name);
    }
    const parts = [];
    for (const name of [...found].slice(0, 4)) {
        try {
            const { abs } = await resolveInside(root, name, { allowRoot: false });
            const bytes = await readFile(abs);
            const image = sniffType(bytes);
            if (image.kind !== 'image'
                || !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(image.mime)) continue;
            parts.push(imagePart(bytes, image.mime));
        } catch {
            // The path is not a picture of the project: nothing to show.
        }
    }
    return parts;
}

/**
 * Run one role: the model answers, the tools run, their answers go back, and the loop ends.
 *
 * The loop keeps the whole conversation in the `input` array, because the Responses API takes
 * the items of the conversation as they are: a user message, then a pair of a call and its
 * answer for every tool call.
 * @param {{ client: object, config?: object, role: string, input?: string, parts?: object[],
 *   context?: object, root?: string, env?: object, toolset?: object, maxTurns?: number,
 *   signal?: AbortSignal|null, notify?: (event: object) => void, runContext?: object|null,
 *   stage?: string|null, schemaChannel?: string|null, depth?: number, inputChannel?: object|null }} request
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
    runContext = null,
    stage = null,
    schemaChannel: forcedChannel = null,
    depth = 0,
    inputChannel = null,
}) {
    if (!client?.responses) throw new Error('Клиент API не передан.');
    inputChannel ??= runContext?.input ?? null;
    const key = String(role ?? '').trim().toLowerCase();
    const roleStage = stage ?? key;
    const definition = resolveRole(key, config, { stage: roleStage });
    if (!definition) throw new Error(`Неизвестная роль: ${role}`);
    // The model of the role and the model that answers the next turn: a role that works on
    // a family of models steps down to the next rank of its path when its work is done.
    let currentModel = definition.model;
    let currentEffort = definition.effort;
    let pathIndex = 0;
    const stepDown = () => {
        const rank = definition.path?.[pathIndex + 1];
        if (rank === undefined) return false;
        const next = definition.family?.[rank];
        if (!next) return false;
        pathIndex += 1;
        currentModel = next;
        currentEffort = snapEffort(definition.asked, getModelProfile(next, config)) ?? currentEffort;
        return true;
    };
    inputChannel?.setLocation?.({
        stage: roleStage,
        role: key,
        step: context?.step?.id ?? null,
        model: definition.model,
        effort: definition.effort,
                mode: forcedChannel ?? 'interactive',
    });

    let instructions = await buildInstructions({ role: key, config, context, root, env, runContext });
    const frameContract = pageFrameContractFor(key);
    if (frameContract) {
        instructions += `\n\n${frameContract}\nThis binding page-frame contract survives partial steps and long research/tool history.`;
    }
    // Keep the deliverable and its acceptance criteria in the high-priority instructions on
    // every model turn. Long guide/tool transcripts must not obscure what this step owns.
    if (context?.step && Array.isArray(context.step.files)) {
        const files = context.step.files.map((item) => String(item ?? '').trim()).filter(Boolean);
        const criteria = (Array.isArray(context.step.criteria) ? context.step.criteria : [])
            .map((item) => String(item ?? '').trim()).filter(Boolean);
        instructions += [
            '',
            '## Binding step contract — do this before anything else',
            `- You own and must write: ${files.join(', ') || '(no file paths named)'}.`,
            criteria.length ? `- Acceptance criteria: ${criteria.join('; ')}.` : '',
            '- These paths and criteria outrank optional research, previews and general recommendations.',
            ...(PAGE_FRAME_ROLES.has(key) ? [
                '- Preserve the page-frame contract: the page canvas, --real-page-width, --zoom, container sizing, and narrow-screen reflow must stay coordinated between markup and styles.',
                '- Do not omit or replace the canvas/zoom contract because a partial step lists only one side of it.',
            ] : []),
            ...(key === 'styler' ? [
                '- Every explicit task requirement outranks the generic styling recommendations in the role prompt.',
                '- Preserve requested dimensions, breakpoints, content treatment and overflow behavior; do not replace specified geometry with a generic pattern.',
            ] : []),
            ...(key === 'styler' ? [
                '- Write the named stylesheet files now. Do not run commands, Python, or shell: the next build stage compiles CSS/SCSS.',
                '- Do not delegate this step. `write_ready` only unlocks your own write tools; it is not delegation.',
            ] : []),
        ].filter(Boolean).join('\n');
    }
    // The toolset of a role reads through the map of the run and remembers its answers in
    // the context of the run.
    const tools = toolset ?? createToolset({
        root,
        config,
        role: key,
        env,
        context: runContext,
        map: runContext?.map ?? null,
        // The tools of the MCP servers of the run: the browser of the DevTools among them.
        mcp: runContext?.mcp ?? [],
        // The log of the sibling CLIs comes live: the run shows what the bridge does while
        // the bridge works.
        notify,
        writeFiles: context?.delegated ? (context?.step?.files ?? []) : null,
        signal,
        askUser: inputChannel?.askUser ? (question) => inputChannel.askUser(question) : null,
    });
    // A delegated role never hands work over again: the hand-over is one level deep.
    const roleToolNames = inputChannel?.interactive && config?.tools?.ask_user !== false
        ? [...new Set([...definition.tools, 'ask_user'])]
        : definition.tools;
    const localSpecs = tools.specsFor(key, roleToolNames)
        .filter((spec) => roleToolNames.includes(spec.name) || spec.name.startsWith('mcp_'));
    const askUserSpec = inputChannel?.interactive && config?.tools?.ask_user !== false
        ? buildToolSpecs(config?.tools, { names: ['ask_user'], role: key })
        : [];
    const specs = [
        ...localSpecs,
        ...askUserSpec.filter((spec) => !localSpecs.some((item) => item.name === spec.name)),
    ]
        .filter((spec) => key !== 'reviewer' || REVIEW_TOOLS.has(spec.name) || spec.name === 'ask_user')
        .filter((spec) => !context?.delegated || DELEGATED_TOOLS.has(spec.name))
        .filter((spec) => key !== 'styler' || !STYLER_FORBIDDEN_TOOLS.has(spec.name))
        .filter((spec) => !context?.vectorOnly || VECTOR_TOOLS.has(spec.name))
        .filter((spec) => !context?.vectorOnly || !String(spec.name).startsWith('mcp_'))
        .filter((spec) => spec.name !== 'ask_user' || (inputChannel?.interactive && config?.tools?.ask_user !== false))
        .filter((spec) => depth === 0 || spec.name !== 'delegate_role');
    const schema = roleSchema(key);
    const readSpecs = specs.filter((spec) => READ_ONLY_TOOLS.has(String(spec?.name ?? '')));
    const hasActionTools = Boolean(requireFiles) && key !== 'reviewer' && readSpecs.length < specs.length;
    const preWriteSpecs = [...readSpecs, ...(hasActionTools ? [WRITE_READY_TOOL] : [])];
    if (hasActionTools) {
        instructions += '\n\nBefore writing files or using any action-capable tool, call `write_ready` on its own first. Until then, only the read tools are available. After `write_ready`, continue with the requested action; the next turn has the full output budget.';
    }
    const schemaName = definition.schema ?? 'response';
    const requestedTurns = Number.isInteger(maxTurns) && maxTurns > 0 ? maxTurns : definition.maxTurns;
    const limit = key === 'reviewer' ? Math.min(requestedTurns, 4) : requestedTurns;

    // The hand-over of the work to another role: a separate session of that role.
    const delegate = createDelegator({
        run: (options) => runRole({ ...options, client, signal, depth: depth + 1 }),
        config,
        root,
        env,
        notify,
        runContext,
        role: key,
        depth,
        resolveRole: (name) => resolveRole(name, config),
        // The delegated role sees the same picture of the reference and the same context of
        // the step: it continues the work, not the conversation.
        parts,
        context,
    });

    const items = [{ role: 'user', content: [textPart(input), ...(parts ?? [])] }];
    const calls = [];
    let turns = 0;
    let stopped = 'completed';
    let answer = null;
    let corrected = false;
    let correctedWork = false;
    let workCorrections = 0;
    let fallback = null;
    let needsFullSummary = false;
    // The channel of the schema: where the answer of the role travels. A model that is
    // pinned to a JSON answer never calls a tool: it describes the work instead of doing it.
    // The mode comes from the profile of the model, the role moves the schema into the
    // tool channel when it has to write and only describes the work, and a stage may pin
    // the channel itself when the answer of the role depends on the tools.
    let schemaChannel = forcedChannel ?? null;
    let withSchema = true;
    let writeReady = false;
    let delegationUsed = false;
    let stylerResearchCalls = 0;
    // The files the step names: the role has to write them.
    const wantsFiles = Boolean(requireFiles);
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
        tools: toolList = writeReady ? specs : preWriteSpecs,
        schema: schemaOverride = undefined,
        schemaChannel: channelOverride = undefined,
        fullOutput = false,
    } = {}) => {
    const availableTools = delegationUsed
            ? toolList.filter((spec) => spec.name !== 'delegate_role')
            : toolList;
        const boundedTools = key === 'styler' && stylerResearchCalls >= STYLER_RESEARCH_LIMIT
            ? availableTools.filter((spec) => !STYLER_RESEARCH_TOOLS.has(spec.name))
            : availableTools;
        const exploring = hasActionTools && !writeReady && boundedTools.length > 0
            && !boundedTools.every((spec) => spec.name === schemaName);
        const useSchema = schemaOverride === undefined
            ? (withSchema && !exploring ? schema : null)
            : schemaOverride;
        const reduced = !fullOutput && (exploring || readOnlyOperation({
            schema: useSchema,
            tools: boundedTools.filter((spec) => spec.name !== WRITE_READY_TOOL.name),
            outputMode: fullOutput || (schema && !boundedTools.length)
                ? null
                : definition.outputMode,
        }));
        const raw = await client.responses.create({
            model: currentModel,
            instructions,
            input: items,
            tools: boundedTools,
            schema: useSchema,
            schemaChannel: channelOverride === undefined ? schemaChannel : channelOverride,
            schemaName,
            effort: currentEffort,
            summary: definition.summary,
            temperature: definition.temperature,
            maxOutputTokens: maxOutputFor(currentModel, config, definition.maxOutputTokens, { readOnly: reduced }),
            verbosity: config?.verbosity ?? (reduced ? 'low' : null),
            signal,
        });

        const parsed = parseResponse(raw);
        const toolCalls = parsed.toolCalls ?? [];
        // The call of the schema is the answer, not a tool to run.
        const answerCall = schema ? toolCalls.find((call) => call.name === schemaName) : null;
        const prematureSchemaAnswer = Boolean(answerCall && !useSchema);
        const work = toolCalls.filter((call) => !schema || call.name !== schemaName);
        if (answerCall) {
            if (answerCall.parseError) {
                // The answer of the schema came as broken JSON: there is no data to read.
                parsed.data = null;
                parsed.schemaProblems = [`$: аргументы вызова не разобраны как JSON (${answerCall.parseError})`];
            } else {
                parsed.data = answerCall.arguments ?? parsed.data;
            }
        }
        if (schema && parsed.data && !parsed.schemaProblems) {
            // The data is kept: the stages know how to fill a missing field. The problems are
            // reported, so a run never passes a malformed answer in silence.
            const problems = schemaProblems(parsed.data, schema);
            if (problems.length) parsed.schemaProblems = problems;
        }
        return { parsed, work, schemaUsed: Boolean(useSchema), prematureSchemaAnswer };
    };

    // The writes that really wrote a file.
    const writes = [];
    // Whether the role has already stepped down to the next member of its family.
    let steppedDown = false;

    let deferredSteering = [];
    const appendSteering = () => {
        const steering = inputChannel?.takeSteering?.() ?? [];
        if (!steering.length) return false;
        const addition = `## Operator steering for this turn\n${steering.map((line) => `- ${line}`).join('\n')}`;
        items.push({ role: 'user', content: [textPart(addition)] });
        return true;
    };

    while (turns < limit) {
        turns += 1;
        appendSteering();
        inputChannel?.setLocation?.({
            stage: roleStage,
            role: key,
            step: context?.step?.id ?? null,
            model: definition.model,
            effort: definition.effort,
            mode: forcedChannel ?? 'interactive',
        });
        const { parsed, work, schemaUsed, prematureSchemaAnswer } = await ask();
        deferredSteering = inputChannel?.takeSteering?.() ?? [];
        const skip = inputChannel?.takeSkip?.({
            stage: roleStage === 'coder' ? 'coding' : roleStage === 'styler' ? 'styling' : roleStage === 'editor' ? 'vector' : roleStage,
            step: context?.step?.id ?? '',
        }) ?? inputChannel?.takeCurrentSkip?.();
        if (skip) {
            stopped = 'skipped';
            answer = { ...parsed, data: null };
            break;
        }

        if (!work.length) {
            if (deferredSteering.length && turns < limit) {
                const pendingText = items.map((item) => item.content?.map?.((part) => part.text ?? '').join('\n') ?? '').join('\n');
                items[items.length - 1] = { role: 'user', content: [textPart(`${pendingText}\n\n## Operator steering for this turn\n${deferredSteering.map((line) => `- ${line}`).join('\n')}`)] };
                deferredSteering = [];
                continue;
            }
            if (deferredSteering.length) {
                items.push({ role: 'user', content: [textPart(`## Operator steering received at the end of this role\n${deferredSteering.map((line) => `- ${line}`).join('\n')}`)] });
                deferredSteering = [];
            }
            answer = parsed;
            if (prematureSchemaAnswer && hasActionTools) {
                fallback = parsed;
                const files = Array.isArray(answer?.data?.files) ? answer.data.files : [];
                const rest = ['dependencies', 'scripts'].reduce((sum, key) => (
                    sum + (Array.isArray(answer?.data?.[key]) ? answer.data[key].length : 0)
                ), 0);
                const withoutWork = wantsFiles && writes.length === 0
                    && files.filter((file) => !isEmptyFile(file)).length + rest === 0;
                if (withoutWork && turns < limit && workCorrections < 2) {
                    const list = wantedFiles.length ? ` The step names: ${wantedFiles.join(', ')}.` : '';
                    workCorrections += 1;
                    items.push({ role: 'user', content: [textPart(workCorrections === 1
                        ? `${WORK_CORRECTION}${list}`
                        : `${WORK_ORDER}${list}`)] });
                    schemaChannel = 'tool';
                    withSchema = false;
                    continue;
                }
                needsFullSummary = true;
                break;
            }
            if (prematureSchemaAnswer) {
                answer = { ...parsed, data: null, schemaProblems: [] };
            }
            if (hasActionTools && wantsFiles && workCorrections > 0 && !writeReady && turns < limit && !answer.data
                && !items.some((item) => item.type === 'function_call_output' && item.output === 'Write-ready. The next turn has the full output budget and the remaining tools.')) {
                const list = wantedFiles.length ? ` The step names: ${wantedFiles.join(', ')}.` : '';
                items.push({ role: 'user', content: [textPart(`${WORK_CORRECTION}${list}`)] });
                schemaChannel = 'tool';
                continue;
            }
            // The exploration turn intentionally has no answer schema. Finish with the schema
            // on a tool-free request, whose output budget is full.
            if (schema && !schemaUsed && hasActionTools && !answer.data) {
                if (wantsFiles && writes.length === 0 && turns < limit && workCorrections < 2) {
                    const list = wantedFiles.length ? ` The step names: ${wantedFiles.join(', ')}.` : '';
                    workCorrections += 1;
                    if (workCorrections === 1) {
                        correctedWork = true;
                        items.push({ role: 'user', content: [textPart(`${WORK_CORRECTION}${list}`)] });
                    } else {
                        items.push({ role: 'user', content: [textPart(`${WORK_ORDER}${list}`)] });
                    }
                    schemaChannel = 'tool';
                    continue;
                }
                if (!answer.data && !answer.refusal && !answer.error) {
                    items.push({ role: 'user', content: [textPart(SCHEMA_CORRECTION)] });
                }
                needsFullSummary = true;
                break;
            }
            if (!schema && hasActionTools && !writeReady && !parsed.refusal && !parsed.error) {
                needsFullSummary = true;
                break;
            }
            const withoutData = Boolean(schema) && !answer.data;
            const problems = Array.isArray(answer?.schemaProblems) ? answer.schemaProblems : [];
            // The answer without data is asked once more: the model gets the schema of the
            // role again and answers with it.
            if (withoutData && !corrected && turns < limit) {
                // The model answered with a text instead of the schema: it is asked once more.
                corrected = true;
                fallback = parsed;
                const detail = problems.length
                    ? `\nThe answer has these schema problems:\n${problems.map((problem) => `- ${problem}`).join('\n')}`
                    : '';
                items.push({ role: 'user', content: [textPart(`${SCHEMA_CORRECTION}${detail}`)] });
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
            const withoutWork = wantsFiles && !wrote && useful === 0;
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

        const readyAtTurnStart = writeReady;
        for (const call of work) {
            let output;
            if (call.name === WRITE_READY_TOOL.name && hasActionTools && !readyAtTurnStart
                && work.length === 1 && !call.parseError) {
                writeReady = true;
                output = 'Write-ready. The next turn has the full output budget and the remaining tools.';
                notify({ type: 'role.write_ready', role: key, turn: turns });
            } else if (call.parseError) {
                // Invalid arguments are reported as such even if the tool was not yet enabled.
                output = `The tool failed: the arguments of the call are not a JSON object (${call.parseError}). Call the tool again with valid JSON.`;
            } else if (hasActionTools && !readyAtTurnStart && !READ_ONLY_TOOLS.has(call.name)) {
                output = 'The tool was not run: call write_ready first. The next turn will have the full output budget.';
            } else if (call.name === 'ask_user' && !inputChannel?.interactive) {
                output = 'No interactive operator is available. Make a reasonable assumption, continue, and state it in your final answer.';
            } else if (call.name === WRITE_READY_TOOL.name && readyAtTurnStart) {
                output = 'Write-ready was already signaled; continue with the requested action.';
            } else if (call.name === WRITE_READY_TOOL.name) {
                output = 'write_ready must be called alone, before any action-capable tool.';
            } else if (call.name === 'delegate_role') {
                if (delegationUsed) {
                    output = 'The tool failed: this role has already handed work over once. Continue with your own step.';
                } else {
                    delegationUsed = true;
                    try {
                        output = await delegate(call.arguments ?? {});
                    } catch (error) {
                        output = `The tool failed: ${error?.message ?? String(error)}`;
                    }
                }
            } else if (key === 'styler' && STYLER_FORBIDDEN_TOOLS.has(call.name)) {
                output = 'Styler shell/CLI tools are disabled. Write the named stylesheets; the build stage compiles them.';
            } else if (key === 'styler' && STYLER_RESEARCH_TOOLS.has(call.name)
                && stylerResearchCalls >= STYLER_RESEARCH_LIMIT) {
                output = 'Styler research limit reached. Follow the step files and criteria, then write the stylesheet.';
            } else if (call.name === 'ask_user' && inputChannel?.interactive) {
                try {
                    output = await tools.execute(call.name, call.arguments);
                } catch (error) {
                    output = `The tool failed: ${error?.message ?? String(error)}`;
                }
            } else {
                try {
                    if (key === 'styler' && STYLER_RESEARCH_TOOLS.has(call.name)) stylerResearchCalls += 1;
                    output = await tools.execute(call.name, call.arguments);
                } catch (error) {
                    output = `The tool failed: ${error?.message ?? String(error)}`;
                }
            }
            if (call.name !== WRITE_READY_TOOL.name) {
                calls.push(call);
                notify({
                    type: 'role.tool',
                    role: key,
                    name: call.name,
                    arguments: toolCallDetail(call.arguments),
                    turn: turns,
                });
            }
            if (call.name === 'ask_user' && inputChannel?.interactive) {
                const callId = call.callId ?? call.id ?? `${call.name}-${calls.length}`;
                items.push({
                    type: 'function_call',
                    call_id: callId,
                    name: call.name,
                    arguments: JSON.stringify(call.arguments ?? {}),
                });
                items.push({ type: 'function_call_output', call_id: callId, output: String(output ?? '') });
                inputChannel?.setLocation?.({ stage: roleStage, role: key, step: context?.step?.id ?? null });
                continue;
            }
            if (WRITE_TOOLS.includes(call.name) && wroteSomething(output)) writes.push(call);
            const callId = call.callId ?? call.id ?? `${call.name}-${calls.length}`;
            // The answer of the tool goes into the log only when it is short: the content
            // of a file is not a line of the log.
            const short = String(output ?? '').trim();
            if (call.name !== WRITE_READY_TOOL.name && short && short.length <= 140) {
                notify({ type: 'role.tool.result', role: key, name: call.name, output: short });
            }
            items.push({
                type: 'function_call',
                call_id: callId,
                name: call.name,
                arguments: JSON.stringify(call.arguments ?? {}),
            });
            // A data URL in the answer of the tool is cut out of the text: the payload goes
            // into the request as what it is — a picture, a file, a text — and the text keeps
            // a short note. The model sees the same thing, and the text does not carry a wall
            // of base64.
            const scrubbed = scrubDataUrls(String(output ?? ''));
            items.push({ type: 'function_call_output', call_id: callId, output: scrubbed.text });
            const assets = scrubbed.assets.map((asset) => assetPart(asset)).filter(Boolean);
            if (assets.length) {
                items.push({
                    role: 'user',
                    content: [
                        textPart('The data of the answer above is attached here: it travels as itself, not as text.'),
                        ...assets,
                    ],
                });
            }
            // A picture that the tool has made goes back into the conversation as a picture:
            // the role has to see what it has just shot, and a path in the text is not a
            // picture. A read_file answer also names an image after attaching it.
            const pictures = await pictureParts(root, String(output ?? ''));
            if (pictures.length) {
                items.push({
                    role: 'user',
                    content: [
                        textPart('The picture the tool has made. Look at it before you continue.'),
                        ...pictures,
                    ],
                });
            }
        }
        if (deferredSteering.length) {
            const pendingText = items.map((item) => item.content?.map?.((part) => part.text ?? '').join('\n') ?? '').join('\n');
            items.push({ role: 'user', content: [textPart(`## Operator steering for this turn\n${deferredSteering.map((line) => `- ${line}`).join('\n')}\n\n${pendingText}`)] });
            deferredSteering = [];
        }
        if (key === 'styler' && work.length && wantedFiles.length) {
            const criteria = (Array.isArray(context?.step?.criteria) ? context.step.criteria : [])
                .map((item) => String(item ?? '').trim()).filter(Boolean);
            items.push({ role: 'user', content: [textPart(
                `Step contract reminder — finish these stylesheet files: ${wantedFiles.join(', ')}. `
                + (criteria.length ? `Acceptance criteria: ${criteria.join('; ')}. ` : '')
                + 'Preserve all explicit task requirements over generic style advice. Do not run Python, shell commands, scripts, or delegate.',
            )] });
        }
        // The work of the role is done: the files are on the disk. A role that works on a
        // family of models steps down to the next rank of its path — the styles are written,
        // the polishing of them is a cheaper work.
        if (writes.length && !steppedDown && stepDown()) {
            steppedDown = true;
            notify({ type: 'role.model', role: key, model: currentModel, rank: definition.path?.[pathIndex] ?? null });
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
    if (stopped !== 'skipped' && schema && !needsFullSummary && !answer?.data && !answer?.refusal && !answer?.error) {
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

    if (needsFullSummary || (!schema && hasActionTools && !writeReady && Boolean(answer?.text))) {
        const needsSchemaPrompt = Boolean(schema)
            && !items.some((item) => item.role === 'user' && item.content?.some?.((part) => part.text === SCHEMA_CORRECTION));
        if (!schema && needsFullSummary) {
            items.push({ role: 'user', content: [textPart('Inspection is complete. Give the requested concise final answer now.')] });
        } else if (needsSchemaPrompt) {
            items.push({ role: 'user', content: [textPart(SCHEMA_CORRECTION)] });
        }
        try {
            const previousAnswer = answer;
            const { parsed: fullAnswer } = await ask({
                tools: [],
                fullOutput: true,
                ...(schema ? { schema, schemaChannel: 'format' } : {}),
            });
            answer = fullAnswer.data || fullAnswer.text || fullAnswer.refusal || fullAnswer.error
                ? fullAnswer
                : previousAnswer;
        } catch {
            // Keep the answer of the read-only turn if the full-budget summary call fails.
        }
    }

    if (!answer) {
        answer = { text: '', data: null, toolCalls: [], usage: null, model: definition.model, refusal: '', error: null, raw: null };
    }

    notify({ type: 'role.done', role: key, stage, turns, toolCalls: calls.length, stopped });

    // The answer of the role goes into the context of the run: the next role builds on it
    // instead of asking the model the same thing again.
    const answerText = String(answer?.text ?? '').trim()
        || (answer?.data ? JSON.stringify(answer.data).slice(0, 2000) : '');
    if (answerText) await runContext?.answer?.(answerText, { role: key, stage });
    if (answer?.error) await runContext?.note?.(String(answer.error), { role: key, stage });

    return {
        role: key,
        text: answer.text ?? '',
        data: answer.data ?? null,
        refusal: answer.refusal ?? '',
        error: answer.error ?? null,
        /** The fields of the answer that do not fit the schema of the role; empty when it fits. */
        schemaProblems: Array.isArray(answer?.schemaProblems) ? answer.schemaProblems : [],
        toolCalls: calls,
        outputFiles: tools.writePaths?.() ?? [],
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
