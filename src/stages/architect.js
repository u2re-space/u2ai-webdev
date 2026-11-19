/**
 * @file src/stages/architect.js
 * @module stages/architect
 * @purpose The structure of the project: the modules, their files, the tokens they share.
 *
 *   The architect reads the plan and the collected context and answers with the shape of the
 *   code. The answer is normalized against the enums of the config: a framework that the
 *   scaffold does not know is reported and replaced by the one of the config.
 *
 *   The result is written to the directory of the run and turned into the brief that the
 *   roles of the next stages read.
 *
 * @depends roles/index, inputs/index, stages/plan, stages/workspace, config/constants
 * @usedBy stages/index, stages/setup, stages/markup, stages/coding, stages/styling
 * @exports ARCHITECTURE_FILE, normalizeArchitecture, architectureText, writeArchitecture,
 *          readArchitecture, architectStage
 * @ai.tags stages, architecture, brief
 * @ai.hint io
 * @ai.hint legacy-0.2
 * @changed 2026-11-13 Ported from the monolith: the architecture is a file of the run.
 */

import { runRole } from '../roles/index.js';
import { inputContext } from '../inputs/index.js';
import { readReferences } from '../inputs/references.js';
import { ENUMS } from '../config/constants.js';
import { planText } from './plan.js';
import { runId, runFile, writeJsonFile, readJsonFile } from './workspace.js';

/** The name of the file of the architecture inside the directory of the run. */
export const ARCHITECTURE_FILE = 'architecture.json';

/**
 * Pick the first of the values that the config allows.
 * @param {unknown} value
 * @param {string[]} allowed
 * @param {string} fallback
 * @param {string} where the name of the field, for the warning
 * @param {string[]} warnings
 * @returns {string}
 * @ai.hint pure
 */
function allowed(value, allowedValues, fallback, where, warnings) {
    const text = String(value ?? '').trim().toLowerCase();
    if (!text) return fallback;
    if (allowedValues.includes(text)) return text;
    warnings.push(`${where}: "${text}" не входит в список (${allowedValues.join(', ')}), взято "${fallback}".`);
    return fallback;
}

/**
 * Normalize the architecture of the model into the shape the stages read.
 * @param {object} data
 * @param {object} [config] the config, for the stack of the project
 * @returns {{ summary: string, stack: object, modules: object[], tokens: object[], notes: string,
 *   warnings: string[] }}
 * @exports
 * @ai.hint pure
 */
export function normalizeArchitecture(data = {}, config = {}) {
    const warnings = [];
    const stack = config?.stack ?? {};
    const source = data && typeof data === 'object' ? data : {};
    const rawStack = source.stack && typeof source.stack === 'object' ? source.stack : {};

    const normalizedStack = {
        framework: allowed(rawStack.framework, ENUMS.frontendFrameworks, stack.frontendFramework ?? 'vanilla', 'Стек: фреймворк', warnings),
        markup: allowed(rawStack.markup, ENUMS.markupLanguages, stack.markupLanguage ?? 'html', 'Стек: разметка', warnings),
        style: allowed(rawStack.style, ENUMS.styleLanguages, stack.styleLanguage ?? 'scss', 'Стек: стили', warnings),
        script: allowed(rawStack.script, ENUMS.scriptLanguages, stack.scriptLanguage ?? 'javascript', 'Стек: скрипты', warnings),
        iconSet: allowed(rawStack.iconSet, ENUMS.iconSets, stack.iconSet ?? 'auto', 'Стек: набор иконок', warnings),
    };

    const modules = (Array.isArray(source.modules) ? source.modules : []).map((module) => {
        const item = module && typeof module === 'object' ? module : {};
        const name = String(item.name ?? '').trim();
        const path = String(item.path ?? '').trim();
        if (!name) warnings.push('Модуль без имени пропущен.');
        if (!path) warnings.push(`Модуль ${name || 'без имени'}: нет пути к файлу.`);
        return {
            name: name || path || 'модуль',
            path,
            purpose: String(item.purpose ?? '').trim(),
            exports: Array.isArray(item.exports) ? item.exports.map((value) => String(value).trim()).filter(Boolean) : [],
            dependsOn: Array.isArray(item.dependsOn) ? item.dependsOn.map((value) => String(value).trim()).filter(Boolean) : [],
        };
    }).filter((module) => module.name);

    const tokens = (Array.isArray(source.tokens) ? source.tokens : []).map((token) => {
        const item = token && typeof token === 'object' ? token : {};
        const name = String(item.name ?? '').trim().replace(/^--/, '');
        if (!name) warnings.push('Токен без имени пропущен.');
        return {
            name,
            value: String(item.value ?? '').trim(),
            kind: String(item.kind ?? 'color').trim().toLowerCase(),
        };
    }).filter((token) => token.name);

    return {
        summary: String(source.summary ?? '').trim(),
        stack: normalizedStack,
        modules,
        tokens,
        notes: String(source.notes ?? '').trim(),
        warnings,
    };
}

/**
 * The architecture as the brief the roles read.
 * @param {object} architecture
 * @returns {string}
 * @exports
 * @ai.hint pure
 */
export function architectureText(architecture = {}) {
    const out = ['# The architecture of the project'];
    if (architecture.summary) out.push(architecture.summary, '');

    const stack = architecture.stack ?? {};
    out.push('## The stack');
    out.push(`- framework: ${stack.framework}`);
    out.push(`- markup: ${stack.markup}`);
    out.push(`- styles: ${stack.style}`);
    out.push(`- scripts: ${stack.script}`);
    out.push(`- icons: ${stack.iconSet}`);
    out.push('');

    if (architecture.modules?.length) {
        out.push('## The modules');
        for (const module of architecture.modules) {
            out.push(`### ${module.name} — ${module.path}`);
            if (module.purpose) out.push(module.purpose);
            if (module.exports?.length) out.push(`- exports: ${module.exports.join(', ')}`);
            if (module.dependsOn?.length) out.push(`- needs: ${module.dependsOn.join(', ')}`);
            out.push('');
        }
    }

    if (architecture.tokens?.length) {
        out.push('## The tokens');
        for (const token of architecture.tokens) out.push(`- --${token.name}: ${token.value} (${token.kind})`);
        out.push('');
    }

    if (architecture.notes) out.push('## The notes', architecture.notes, '');

    return out.join('\n').trim();
}

/**
 * The path of the architecture of a run.
 * @param {string} root
 * @param {object} config
 * @param {string} id
 * @returns {string}
 * @exports
 * @ai.hint pure
 */
export function architecturePath(root, config = {}, id = null) {
    return runFile(root, config, id, ARCHITECTURE_FILE);
}

/**
 * Write the architecture of a run.
 * @param {string} root
 * @param {object} config
 * @param {string} id
 * @param {object} architecture
 * @returns {Promise<string>}
 * @exports
 * @ai.hint io
 */
export async function writeArchitecture(root, config = {}, id = null, architecture = {}) {
    return await writeJsonFile(architecturePath(root, config, id), architecture);
}

/**
 * Read the architecture of a run. A missing file gives null.
 * @param {string} root
 * @param {object} config
 * @param {string} id
 * @returns {Promise<object|null>}
 * @exports
 * @ai.hint io
 */
export async function readArchitecture(root, config = {}, id = null) {
    return await readJsonFile(architecturePath(root, config, id));
}

/**
 * The stage of the architecture: the architect reads the plan and answers with the shape of
 * the code.
 *
 * @param {{ client: object, config?: object, root?: string, task?: string, plan?: object|null,
 *   inputs?: object|null, runId?: string|null, notify?: (event: object) => void, env?: object, input?: object|null }} request
 * @returns {Promise<{ stage: string, ok: boolean, architecture: object|null, brief: string,
 *   file: string|null, warnings: string[], turns: number, usage: object|null, runId: string }>}
 * @exports
 * @ai.hint io
 */
export async function architectStage({
    client,
    config = {},
    root = process.cwd(),
    task = '',
    plan = null,
    inputs = null,
    runId: id = null,
    notify = () => {},
    env = process.env,
    runContext = null,
    input = null,
} = {}) {
    if (!client?.responses) throw new Error('Клиент API не передан.');

    const run = id ?? runId();
    const blocks = [];
    if (task) blocks.push(String(task).trim());
    const planBlock = plan ? planText(plan) : '';
    if (planBlock) blocks.push(planBlock);
    const inputBlock = inputs ? inputContext(inputs) : '';
    if (inputBlock) blocks.push(inputBlock);
    // The reference of the design: the architect sees the picture it has to structure.
    const reference = await readReferences(root, inputs?.references ?? []);

    const result = await runRole({
        client,
        config,
        role: 'architect',
        input: blocks.join('\n\n'),
        context: {
            task: String(task ?? ''),
            plan,
            stack: config?.stack ?? {},
            design: Boolean(inputBlock),
            reference: reference.names,
            referenceSizes: reference.sizes,
        },
        root,
        env,
        maxTurns: config?.stages?.architect?.maxTurns ?? null,
        notify,
        parts: reference.parts,
        runContext,
        stage: 'architect',
        inputChannel: input,
    });

    if (!result.data) {
        return {
            stage: 'architect',
            ok: false,
            architecture: null,
            brief: '',
            file: null,
            warnings: ['Архитектор не вернул структуру проекта.'],
            turns: result.turns,
            usage: result.usage,
            runId: run,
        };
    }

    const architecture = normalizeArchitecture(result.data, config);
    const file = await writeArchitecture(root, config, run, architecture);
    // The answer that does not fit the schema is kept, but it is reported.
    const schemaWarnings = (result.schemaProblems ?? []).map((problem) => `Структура не по схеме: ${problem}.`);
    return {
        stage: 'architect',
        ok: true,
        architecture,
        brief: architectureText(architecture),
        file,
        warnings: [...(architecture.warnings ?? []), ...schemaWarnings],
        turns: result.turns,
        usage: result.usage,
        runId: run,
    };
}
