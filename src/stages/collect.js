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
 * @depends node:path, inputs/index, agent/map, agent/skills, registry
 * @usedBy stages/index, stages/plan, stages/architect, pipeline
 * @exports collectStage, collectText, componentCards, projectCards
 * @ai.tags stages, context, collect
 * @ai.hint io
 * @ai.hint legacy-0.2
 * @changed 2026-11-13 Ported from the monolith: the context of a run is collected in one place.
 */

import path from 'node:path';
import { collectInputs, inputContext, inputSummary } from '../inputs/index.js';
import { ensureProjectMap, projectMapFile } from '../agent/map.js';
import { discoverSkills, loadSkillPacks, skillDirectories } from '../agent/skills.js';
import { openRegistry } from '../registry.js';

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

    return blocks.join('\n\n');
}

/**
 * The stage of the collection: the inputs, the project, the registry and the skills.
 *
 * @param {{ root?: string, config?: object, task?: string, env?: object }} request
 * @returns {Promise<{ stage: string, ok: boolean, inputs: object, summary: object,
 *   project: object, components: object[], skills: object, warnings: string[], text: string }>}
 * @exports
 * @ai.hint io
 */
export async function collectStage({
    root = process.cwd(),
    config = {},
    task = '',
    env = process.env,
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

    const collected = {
        stage: 'collect',
        ok: true,
        inputs,
        summary: inputSummary(inputs),
        project,
        components,
        skills: { packs, directories },
        warnings,
        text: '',
    };
    collected.text = collectText(collected);
    return collected;
}
