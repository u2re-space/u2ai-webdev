/**
 * @file src/stages/collect.js
 * @module stages/collect
 * @purpose The collection of the context: the inputs, the project, the registry of the components
 *          and the skill packs.
 *
 *   The stage reads everything the roles may need and puts it into one text. Nothing here
 *   talks to the model: the collection is deterministic, so it can be re-run, cached and read
 *   by the user when a stage goes wrong.
 *
 *   A part that cannot be read is skipped and reported: a missing `DESIGN.md` is not a reason
 *   to stop the run.
 *
 * @depends node:path, inputs/index, agent/map, agent/skills, registry, stages/workspace
 * @usedBy stages/index, stages/plan, stages/architect, pipeline
 * @exports collectStage, collectText, componentCards, projectCards, INPUTS_FILE,
 *          inputsPath, writeInputs, readInputs
 * @ai.tags stages, context, collect
 * @ai.hint io
 * @ai.hint legacy-0.2
 * @changed 2026-11-13 Ported from the monolith: the context of a run is collected in one place.
 * @changed 2026-11-14 The collected inputs are written to the run: a resumed run needs them.
 */

import path from 'node:path';
import { collectInputs, inputContext, inputSummary } from '../inputs/index.js';
import { ensureProjectMap, projectMapFile } from '../agent/map.js';
import { discoverSkills, loadSkillPacks, skillDirectories } from '../agent/skills.js';
import { openRegistry } from '../registry.js';
import { memoryContext } from '../memory.js';
import { runFile, writeJsonFile, readJsonFile } from './workspace.js';

/** The file of the run that holds the collected inputs. */
export const INPUTS_FILE = 'inputs.json';

/**
 * The path of the file of the collected inputs.
 * @param {string} root
 * @param {object} config
 * @param {string} [id]
 * @returns {string}
 * @exports
 * @ai.hint pure
 */
export function inputsPath(root, config = {}, id = null) {
    return runFile(root, config, id, INPUTS_FILE);
}

/**
 * Write the collected inputs into the directory of the run.
 *
 * A resumed run skips the stage of the collection, so the inputs of the earlier run are
 * read back from here: without them the roles of the later stages would work with nothing.
 *
 * @param {string} root
 * @param {object} config
 * @param {string} [id]
 * @param {object} inputs
 * @returns {Promise<string>} the path of the file
 * @exports
 * @ai.hint io
 */
export async function writeInputs(root, config = {}, id = null, inputs = {}) {
    return await writeJsonFile(inputsPath(root, config, id), inputs);
}

/**
 * Read the collected inputs of a run. A missing file gives null.
 * @param {string} root
 * @param {object} config
 * @param {string} [id]
 * @returns {Promise<object|null>}
 * @exports
 * @ai.hint io
 */
export async function readInputs(root, config = {}, id = null) {
    return await readJsonFile(inputsPath(root, config, id));
}

/**
 * The files of the project as short lines: the path and the size.
 * @param {object} files the files of the map of the project
 * @param {number} [limit]
 * @returns {string[]}
 * @ai.hint pure
 */
export function projectCards(files = {}, limit = 200) {
    const list = files && typeof files === 'object' ? files : {};
    return Object.entries(list)
        .map(([rel, record]) => `- ${rel} (${record?.bytes ?? 0} bytes)`)
        .slice(0, limit);
}

/**
 * The components of the registry as short lines.
 * @param {object[]} components
 * @returns {string[]}
 * @ai.hint pure
 */
export function componentCards(components = []) {
    return (Array.isArray(components) ? components : []).map((item) => {
        const tags = item.tags?.length ? ` [${item.tags.join(', ')}]` : '';
        return `- ${item.tag}@${item.version} — ${item.summary || item.name || 'без описания'} (${item.framework})${tags}`;
    });
}

/**
 * The collected context as the text the roles read.
 * @param {object} collected the result of `collectStage`
 * @returns {string}
 * @exports
 * @ai.hint pure
 */
export function collectText(collected = {}) {
    const blocks = [];
    const inputs = collected.inputs ? inputContext(collected.inputs) : '';
    if (inputs) blocks.push(inputs);

    const files = projectCards(collected.project?.files);
    if (files.length) {
        blocks.push([
            '# The project',
            `The project has ${collected.project.count} files. The ones that matter:`,
            ...files,
        ].join('\n'));
    }

    const components = componentCards(collected.components);
    if (components.length) {
        blocks.push([
            '# The components of the local registry',
            'These components are already written. Reuse one instead of writing it again.',
            ...components,
        ].join('\n'));
    }

    const packs = collected.skills?.packs ?? [];
    if (packs.length) {
        blocks.push([
            '# The skill packs of the project',
            ...packs.map((pack) => `- ${pack.name}: ${pack.description || 'без описания'}`),
        ].join('\n'));
    }

    if (collected.memory) blocks.push(collected.memory);

    return blocks.join('\n\n');
}

/**
 * The stage of the collection: the inputs, the project, the registry and the skills.
 *
 * @param {{ root?: string, config?: object, task?: string, env?: object, memory?: object|null,
 *   runId?: string|null }} request
 * @returns {Promise<{ stage: string, ok: boolean, inputs: object, summary: object,
 *   project: object, components: object[], skills: object, memory: string, warnings: string[],
 *   text: string, file: string|null }>}
 * @exports
 * @ai.hint io
 */
export async function collectStage({
    root = process.cwd(),
    config = {},
    task = '',
    env = process.env,
    memory = null,
    runId: id = null,
} = {}) {
    const warnings = [];

    const inputs = await collectInputs({ root, config, task });
    warnings.push(...(inputs.warnings ?? []));

    // The map of the project: the files, their sizes and their symbols.
    let project = { count: 0, files: {}, map: null, entry: null };
    try {
        const entry = await ensureProjectMap(root);
        project = {
            count: Object.keys(entry?.map?.files ?? {}).length,
            files: entry?.map?.files ?? {},
            map: path.relative(root, projectMapFile(root)) || '.ai/map.json',
            entry,
        };
    } catch (error) {
        warnings.push(`Карта проекта не собрана: ${error?.message ?? error}`);
    }

    // The registry of the components.
    let components = [];
    const dbFile = config?.components?.dbFile ?? null;
    const dir = config?.components?.dir ?? null;
    if (dbFile && dir) {
        try {
            const registry = openRegistry({ file: dbFile, dir });
            try {
                components = registry.list();
            } finally {
                registry.close();
            }
        } catch (error) {
            warnings.push(`Реестр компонентов не прочитан: ${error?.message ?? error}`);
        }
    } else {
        warnings.push('Реестр компонентов не настроен: путь к индексу не задан.');
    }

    // The skill packs: the flat role packs and the directories with SKILL.md.
    let packs = [];
    let directories = [];
    try {
        packs = await loadSkillPacks({ dir: config?.skills?.dir ?? null, env });
        directories = skillDirectories(root, env);
        const discovered = await discoverSkills(root, {
            extraDirs: config?.skills?.dir ? [config.skills.dir] : [],
            env,
        });
        for (const skill of discovered) {
            if (packs.some((pack) => pack.name === skill.name)) continue;
            packs.push({ name: skill.name, description: skill.description, path: skill.path, kind: 'skill' });
        }
    } catch (error) {
        warnings.push(`Скиллы не прочитаны: ${error?.message ?? error}`);
    }

    // The memory of the project: the lessons of the earlier runs.
    const memoryText = memoryContext(memory, {
        query: task,
        scope: config?.memory?.scope ?? 'project',
        limit: config?.memory?.limit ?? 40,
    });

    const collected = {
        stage: 'collect',
        ok: true,
        inputs,
        summary: inputSummary(inputs),
        project,
        components,
        skills: { packs, directories },
        memory: memoryText,
        warnings,
        text: '',
        file: null,
    };
    // The inputs go to the disk: a resumed run skips this stage and needs them.
    collected.file = await writeInputs(root, config, id, inputs).catch((error) => {
        warnings.push(`Входные данные не записаны: ${error?.message ?? error}`);
        return null;
    });
    collected.text = collectText(collected);
    return collected;
}
