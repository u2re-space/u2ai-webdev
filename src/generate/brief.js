/**
 * @file src/generate/brief.js
 * @module generate/brief
 * @purpose Turn a generation request into a task, the instructions of the roles and a manifest.
 *
 *   The brief is the contract between the user and the run: what kind of project it is, which
 *   files it must have, which limits it has, and which references it follows. It is written to
 *   `.ai/generation.json`, so a resumed run reads the same brief and does not drift.
 *
 * @depends node:path, node:fs/promises, generate/fidelity, generate/platform, generate/scaffold
 * @usedBy stages/plan, stages/architect
 * @exports GENERATION_KINDS, KIND_OUTPUTS, buildGenerationBrief, writeGenerationManifest,
 *          readGenerationManifest
 * @ai.tags generate, brief, manifest
 * @ai.hint pure
 * @ai.hint legacy-0.2
 */

import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fidelityContract, effectiveFidelity, fidelityInstructions } from './fidelity.js';
import { platformInstructions, resolvePlatform } from './platform.js';
import {
    filesForKind,
    filesForStack,
    kindRules,
    renderGenerationTask,
    recommendStack,
    stackText,
} from './scaffold.js';

/** The kinds of a generation task. */
export const GENERATION_KINDS = Object.freeze(['landing', 'site', 'backend', 'app', 'component']);

/** The files of every kind, before the stack changes them. */
export const KIND_OUTPUTS = Object.freeze(Object.fromEntries(
    GENERATION_KINDS.map((kind) => [kind, Object.freeze(filesForKind(kind))]),
));

/**
 * One group of references as bullet lines. An empty group is left out.
 * @param {string} label
 * @param {string[]} items
 * @returns {string[]}
 * @ai.hint pure
 */
function referenceLines(label, items) {
    if (!items?.length) return [];
    return [`${label}:`, ...items.map((item) => `- ${item}`)];
}

/**
 * Build the task, the instructions and the manifest of a generation.
 * @param {{ kind?: string|null, prompt?: string, name?: string, fidelity?: number,
 *   creativity?: number, quality?: number, platform?: string|object, references?: object,
 *   stagedRefs?: object[], framework?: string|null, scriptLanguage?: string|null,
 *   styleLanguage?: string|null, markup?: string|null, iconSet?: string|null,
 *   components?: object[] }} request
 * @returns {{ task: string, instructions: string, manifest: object }}
 * @exports
 * @ai.hint pure
 */
export function buildGenerationBrief({
    kind = null,
    prompt = '',
    name = 'app',
    fidelity,
    creativity,
    quality = 50,
    platform = 'chromium',
    references = {},
    stagedRefs = [],
    framework = null,
    scriptLanguage = null,
    styleLanguage = null,
    markup = null,
    iconSet = null,
    components = [],
} = {}) {
    if (kind !== null && !GENERATION_KINDS.includes(kind)) {
        throw new Error(`Вид генерации: ${GENERATION_KINDS.join('|')}`);
    }

    const profile = typeof platform === 'string' ? resolvePlatform(platform) : (platform ?? resolvePlatform());
    const contract = fidelityContract({
        fidelity: fidelity ?? 80,
        creativity: creativity ?? 20,
    });
    const effective = effectiveFidelity(contract.fidelity, quality);

    const refs = {
        images: [...(references.images ?? [])],
        files: [...(references.files ?? [])],
        templates: [...(references.templates ?? [])],
        examples: [...(references.examples ?? [])],
        urls: [...(references.urls ?? [])],
    };

    const recommendations = recommendStack({ kind, prompt, references: refs });
    const outputs = kind ? filesForStack({ kind, framework, scriptLanguage, styleLanguage, markup }) : [];

    const manifest = {
        kind,
        prompt: String(prompt ?? ''),
        name,
        fidelity: contract.fidelity,
        effectiveFidelity: effective,
        creativity: contract.creativity,
        measured: null,
        method: contract.method,
        reason: contract.reason,
        platform: profile.id,
        experimentalFlags: false,
        references: refs,
        stagedRefs: stagedRefs.map((item) => ({
            rel: item.rel,
            bytes: item.bytes,
            mime: item.mime,
            width: item.width ?? null,
            height: item.height ?? null,
        })),
        outputs,
        stack: {
            kind,
            text: stackText(kind, profile, recommendations.libraries, {
                framework,
                scriptLanguage,
                styleLanguage,
                markupLanguage: markup,
            }),
        },
        recommendations,
        components: Array.isArray(components) ? components.map((item) => ({
            tag: item.tag,
            version: item.version ?? '0.1.0',
            name: item.name ?? item.tag,
        })) : [],
        iconSet: iconSet ?? 'auto',
    };

    const listed = [
        ...referenceLines('Images and mockups', refs.images),
        ...referenceLines('Files', refs.files),
        ...referenceLines('Templates', refs.templates),
        ...referenceLines('Design examples', refs.examples),
        ...referenceLines('Source URLs', refs.urls),
    ];
    const stagedLines = stagedRefs.length
        ? ['', 'Staged references (project-relative paths):', ...stagedRefs.map((item) => {
            const dim = item.width && item.height ? ` (${item.width}×${item.height})` : '';
            return `- ${item.rel}${dim}`;
        })]
        : [];

    const task = [
        renderGenerationTask({
            kind,
            prompt,
            platform: profile,
            recommendations,
            name,
            framework,
            scriptLanguage,
            styleLanguage,
            markup,
        }),
        '',
        `Fidelity target: ${effective}%. The match itself is not measured. Do not invent a percentage.`,
        `The requested fidelity of ${contract.fidelity}% at quality ${quality}% works as ${effective}%.`,
        `Creativity for the parts that are not in the references: ${contract.creativity}%.`,
        '',
        listed.length ? 'References:' : 'References: none attached.',
        ...listed,
        ...stagedLines,
        '',
        'The contract file .ai/generation.json is written. Add the paths you created to it and leave measured null.',
        '',
        'The customer asks:',
        '',
        '```md',
        String(prompt).trim() || '(no text; follow the references)',
        '```',
    ].join('\n');

    const instructions = [
        platformInstructions(profile),
        '',
        kindRules(kind, recommendations, { framework, markup }),
        '',
        fidelityInstructions({ ...contract, fidelity: effective }),
    ].join('\n');

    return { task, instructions, manifest };
}

/**
 * Write the manifest of a generation into `.ai/generation.json`.
 * @param {string} root the working directory
 * @param {object} manifest
 * @returns {Promise<string>} the path of the file
 * @exports
 * @ai.hint io
 */
export async function writeGenerationManifest(root, manifest) {
    const dir = path.join(root, '.ai');
    await mkdir(dir, { recursive: true });
    const file = path.join(dir, 'generation.json');
    await writeFile(file, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    return file;
}

/**
 * Read the manifest of a generation, when it is there.
 * @param {string} root the working directory
 * @returns {Promise<object|null>}
 * @exports
 * @ai.hint io
 */
export async function readGenerationManifest(root) {
    const file = path.join(root, '.ai', 'generation.json');
    const text = await readFile(file, 'utf8').catch(() => null);
    if (text === null) return null;
    try {
        const parsed = JSON.parse(text);
        return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
        return null;
    }
}
