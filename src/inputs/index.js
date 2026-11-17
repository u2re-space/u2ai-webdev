/**
 * @file src/inputs/index.js
 * @module inputs/index
 * @purpose Collect the inputs of a run into one context the roles read.
 *
 *   The context is the sum of the parts: the task, the essence of the task, the design
 *   direction, the measurements, the palette, the tokens, the instructions of the project
 *   and the pictures. Every part says whether it was found, and the conflicts between the
 *   parts are reported rather than resolved silently — except the tokens of the stylesheet,
 *   which win over the document.
 *
 * @depends node:path, node:fs/promises, inputs/design-md, inputs/measurements, inputs/palette,
 *          inputs/tokens, inputs/assets, inputs/references, inputs/candidates, config/paths
 * @usedBy stages/collect, stages/index
 * @exports collectEssence, collectInputs, inputContext, inputSummary, mergeInputs
 * @ai.tags inputs, context
 * @ai.hint io
 * @changed 2026-11-15 The essence of the task: the files of `inputs.extra` (`--input`).
 * @changed 2026-11-15 The paths of the inputs are lists of candidates: the first file that
 *                       is there is the input, and the found path is kept.
 */

import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { parseDesignMd, designConflicts } from './design-md.js';
import { parseMeasurements, summarizeMeasurements } from './measurements.js';
import { parsePalette, paletteTokens } from './palette.js';
import { parseTokensCss, cssConflicts } from './tokens.js';
import { collectAssetFiles, readProjectInstructions } from './assets.js';
import { findReferences } from './references.js';
import { findInput, findContractInput, inputCandidates } from './candidates.js';

/**
 * Read a file of the project, when it is there.
 * @param {string} root
 * @param {string} file
 * @returns {Promise<string|null>}
 */
async function readOptional(root, file) {
    if (!file) return null;
    return await readFile(path.resolve(root, file), 'utf8').catch(() => null);
}

/**
 * Read the files with the essence of the task.
 *
 * The files are the notes of the author of the task: they say what matters and what does
 * not. A missing file is not an error: the part is simply absent, and the report says so.
 *
 * A file may be a template: the placeholder `{{message}}` is replaced with the task of the run,
 * so the notes and the task live in one file.
 * @param {string} root
 * @param {string[]} files the paths, relative to the root
 * @param {string} [task] the task of the run
 * @returns {Promise<{ files: Array<{ path: string, text: string }>, warnings: string[] }>}
 * @exports
 * @ai.hint io
 */
export async function collectEssence(root, files = [], task = '') {
    const out = [];
    const warnings = [];
    const message = String(task ?? '').trim();
    for (const file of Array.isArray(files) ? files : []) {
        const rel = String(file ?? '').trim();
        if (!rel) continue;
        const text = await readOptional(root, rel);
        if (text === null) {
            warnings.push(`The file ${rel} was not found.`);
            continue;
        }
        out.push({
            path: rel,
            text: message ? text.replaceAll('{{message}}', message) : text,
        });
    }
    return { files: out, warnings };
}

/**
 * The warning about an input that is not there: the candidates are named, so the user
 * knows where the file may live.
 * @param {string} name what the input is
 * @param {string[]} candidates the paths that were tried
 * @returns {string}
 * @ai.hint pure
 */
function missing(name, candidates) {
    return `The ${name} was not found (tried: ${candidates.join(', ')}).`;
}

/**
 * Collect the inputs of a run.
 *
 * The paths come from the config: `inputs.designMd`, `inputs.measurements`, `inputs.palette`,
 * `inputs.tokens` and `inputs.extra` — the files with the essence of the task. Every path
 * is a list of candidates, and the first file that is there is the input. A missing file is
 * not an error: the part is simply absent, and the report says so.
 * @param {{ root: string, config?: object, task?: string }} options
 * @returns {Promise<object>} the collected inputs
 * @exports
 * @ai.hint io
 */
export async function collectInputs({ root, config = {}, task = '' } = {}) {
    const inputs = config.inputs ?? {};
    const warnings = [];

    const designCandidates = inputCandidates(inputs.designMd, 'designMd');
    const designFile = await findContractInput(root, 'design', designCandidates);
    const design = parseDesignMd(designFile?.text ?? '');
    if (!designFile) warnings.push(missing('design document', designCandidates));

    const measurementCandidates = inputCandidates(inputs.measurements, 'measurements');
    const measurementFile = await findContractInput(root, 'measurements', measurementCandidates);
    const measurements = parseMeasurements(measurementFile?.text ?? '');
    if (!measurementFile) warnings.push(missing('sheet of the measurements', measurementCandidates));
    warnings.push(...measurements.warnings);

    const paletteCandidates = inputCandidates(inputs.palette, 'palette');
    const paletteFile = await findContractInput(root, 'palette', paletteCandidates);
    const palette = parsePalette(paletteFile?.text ?? '');
    if (!paletteFile) warnings.push(missing('palette', paletteCandidates));
    warnings.push(...palette.warnings);

    const tokensCandidates = inputCandidates(inputs.tokens, 'tokens');
    const tokensFile = await findContractInput(root, 'tokens', tokensCandidates);
    const tokens = parseTokensCss(tokensFile?.text ?? '');
    if (!tokensFile) warnings.push(missing('tokens of the stylesheet', tokensCandidates));
    warnings.push(...tokens.warnings);

    // The tokens of the stylesheet win; the other sources are compared with them.
    const conflicts = [];
    if (tokens.present) {
        conflicts.push(...cssConflicts(tokens.tokens, design.tokens));
        conflicts.push(...cssConflicts(tokens.tokens, paletteTokens(palette)));
    }
    if (design.present) conflicts.push(...designConflicts(design, tokens.tokens));

    const instructions = inputs.projectInstructions === false
        ? { files: [], text: '' }
        : await readProjectInstructions({ root });

    // The essence of the task: the notes of the author of the task.
    const essence = await collectEssence(root, inputs.extra ?? [], task);
    warnings.push(...essence.warnings);

    const assets = await collectAssetFiles({
        root,
        dirs: [
            ...(config.output?.dir ? [path.join(config.output.dir, 'refs')] : []),
            ...(config.output?.assets ? [config.output.assets] : []),
            ...(config.output?.dir ? [path.join(config.output.dir, 'assets')] : []),
            ...(config.output?.work ? [config.output.work] : []),
        ],
    });

    // The reference of the design: the screenshot the roles have to look at.
    const references = await findReferences({ root, config, task });

    return {
        task: String(task ?? ''),
        essence: essence.files,
        design,
        measurements,
        palette,
        tokens,
        conflicts,
        instructions,
        assets,
        references,
        files: {
            design: designFile?.path ?? null,
            measurements: measurementFile?.path ?? null,
            palette: paletteFile?.path ?? null,
            tokens: tokensFile?.path ?? null,
        },
        warnings,
    };
}

/**
 * Merge the inputs of this run into the inputs of the earlier run.
 *
 * A continued run reads the inputs back from the disk, but the flags of this run may name
 * something the earlier run did not know: the essence of the task (`--input`) and the
 * picture of the task (`--image`). The parts the earlier run collected are kept — they
 * describe the design as it was — and the new parts are put in front of them.
 * @param {object|null} stored the inputs of the earlier run
 * @param {object|null} fresh the inputs of this run
 * @returns {object|null}
 * @exports
 * @ai.hint pure
 */
export function mergeInputs(stored = null, fresh = null) {
    if (!stored) return fresh;
    if (!fresh) return stored;

    const essence = [];
    const seenEssence = new Set();
    for (const item of [...(fresh.essence ?? []), ...(stored.essence ?? [])]) {
        const key = String(item?.path ?? '');
        if (!key || seenEssence.has(key)) continue;
        seenEssence.add(key);
        essence.push(item);
    }

    const references = [];
    const seenReferences = new Set();
    for (const item of [...(fresh.references ?? []), ...(stored.references ?? [])]) {
        const key = String(item?.path ?? '');
        if (!key || seenReferences.has(key)) continue;
        seenReferences.add(key);
        references.push(item);
    }

    return {
        ...stored,
        essence,
        references,
        files: { ...(stored.files ?? {}), ...(fresh.files ?? {}) },
        warnings: [...(fresh.warnings ?? []), ...(stored.warnings ?? [])],
    };
}

/**
 * The text of the context: what the roles read before they work.
 *
 * The parts that are absent are skipped: an empty section only costs tokens and teaches nothing.
 * @param {object} collected the result of `collectInputs`
 * @returns {string}
 * @exports
 * @ai.hint pure
 */
export function inputContext(collected = {}) {
    const blocks = [];

    if (collected.task) blocks.push(`# Task\n${collected.task}`);

    const essence = Array.isArray(collected.essence) ? collected.essence : [];
    for (const item of essence) {
        const text = String(item?.text ?? '').trim();
        if (!text) continue;
        blocks.push([
            '# The essence of the task',
            `Source: ${item.path}`,
            'This file holds the essence of the task: what the result has to be and how it',
            'has to behave. Follow it. The other parts of the context describe the design and',
            'the project, they do not overrule it.',
            text,
        ].join('\n'));
    }

    const design = collected.design;
    if (design?.present) {
        const lines = ['# Design direction (DESIGN.md)'];
        if (design.tokens.length) {
            lines.push('Tokens:');
            for (const token of design.tokens) lines.push(`- ${token.name}: ${token.value}`);
        }
        if (design.typography.length) {
            lines.push('Typography:');
            for (const item of design.typography) lines.push(`- ${item.name}: ${item.value}`);
        }
        if (design.spacing.length) {
            lines.push('Spacing:');
            for (const item of design.spacing) lines.push(`- ${item.name}: ${item.value}`);
        }
        if (design.components.length) {
            lines.push('Components:');
            for (const item of design.components) lines.push(`- ${item}`);
        }
        if (design.layout.length) {
            lines.push('Layout:');
            for (const item of design.layout) lines.push(`- ${item}`);
        }
        blocks.push(lines.join('\n'));
    }

    const sheet = collected.measurements;
    if (sheet?.present) {
        const summary = summarizeMeasurements(sheet);
        const lines = [
            '# Measurements',
            `Source: ${summary.source || 'unknown'} · unit: ${sheet.unit} · confidence: ${summary.confidence}`
            + (sheet.rootFontSize ? ` · root font size: ${sheet.rootFontSize}px` : ''),
        ];
        if (sheet.elements.length) {
            lines.push('Elements:');
            for (const item of sheet.elements.slice(0, 60)) {
                const box = item.box ? `${item.box.width}×${item.box.height} at ${item.box.x},${item.box.y}` : 'no box';
                const size = item.widthRem ? ` (${item.widthRem}rem wide)` : '';
                const crop = item.crop ? ` → ${item.crop}` : '';
                lines.push(`- ${item.name || item.kind} [${item.kind}] ${box}${size}${crop}`);
                if (item.text) lines.push(`  Exact text (preserve line breaks): ${JSON.stringify(item.text)}`);
            }
        }
        if (sheet.regions.length) {
            lines.push('Regions:');
            for (const item of sheet.regions.slice(0, 40)) {
                lines.push(`- ${item.name || item.kind} [${item.kind}]${item.crop ? ` → ${item.crop}` : ''}`);
            }
        }
        if (sheet.spacing.length) {
            lines.push('Spacing scale:');
            for (const item of sheet.spacing) lines.push(`- ${item.name}: ${item.value}${item.unit} (${item.rem ?? '?'}rem)`);
        }
        blocks.push(lines.join('\n'));
    }

    const references = Array.isArray(collected.references) ? collected.references : [];
    if (references.length) {
        const lines = [
            '# The reference of the design',
            'The screenshot of the reference is attached to the request. It is the picture the',
            'result has to look like: the regions, the proportions, the colours and the spaces.',
        ];
        for (const item of references) lines.push(`- ${item.path}`);
        blocks.push(lines.join('\n'));
    }

    const pictures = Array.isArray(collected.pictures) ? collected.pictures : [];
    if (pictures.length) {
        const lines = [
            '# The pictures prepared from the crops',
            'These are the objects of the reference, cut out of the screenshot. Use them as the',
            'assets of the result, not as the screenshots they came from.',
        ];
        for (const item of pictures) {
            const use = item.use ? ` — ${item.use}` : '';
            lines.push(`- ${item.name} [${item.kind}] → ${item.file}${use}`);
        }
        blocks.push(lines.join('\n'));
    }

    const palette = collected.palette;
    if (palette?.present) {
        const lines = ['# Palette'];
        for (const color of palette.colors) {
            const contrast = color.contrast ? `, contrast ${color.contrast}:1` : '';
            lines.push(`- ${color.token || color.name}: ${color.hex}${contrast} (${color.method || color.confidence})`);
        }
        blocks.push(lines.join('\n'));
    }

    const tokens = collected.tokens;
    if (tokens?.present && tokens.tokens.length) {
        const lines = ['# Tokens of the project (tokens.css)'];
        for (const token of tokens.tokens) lines.push(`- ${token.name}: ${token.value}`);
        blocks.push(lines.join('\n'));
    }

    if (collected.conflicts?.length) {
        const lines = ['# Conflicts between the inputs'];
        for (const conflict of collected.conflicts) {
            lines.push(`- ${conflict.name}: ${conflict.first} against ${conflict.second}`);
        }
        lines.push('The value of tokens.css wins; the other one is reported, not applied.');
        blocks.push(lines.join('\n'));
    }

    if (collected.instructions?.text) {
        blocks.push(`# Project instructions\n${collected.instructions.text}`);
    }

    return blocks.join('\n\n');
}

/**
 * A short report of the inputs: what was found and what was not.
 * @param {object} collected
 * @returns {{ design: boolean, measurements: boolean, palette: boolean, tokens: boolean,
 *   essence: number, assets: number, references: number, instructions: number,
 *   conflicts: number, warnings: string[] }}
 * @exports
 * @ai.hint pure
 */
export function inputSummary(collected = {}) {
    return {
        design: Boolean(collected.design?.present),
        measurements: Boolean(collected.measurements?.present),
        palette: Boolean(collected.palette?.present),
        tokens: Boolean(collected.tokens?.present),
        essence: Array.isArray(collected.essence) ? collected.essence.length : 0,
        assets: collected.assets?.length ?? 0,
        references: collected.references?.length ?? 0,
        instructions: collected.instructions?.files?.length ?? 0,
        conflicts: collected.conflicts?.length ?? 0,
        warnings: collected.warnings ?? [],
    };
}
