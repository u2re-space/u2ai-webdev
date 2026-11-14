/**
 * @file src/inputs/index.js
 * @module inputs/index
 * @purpose Collect the inputs of a run into one context the roles read.
 *
 *   The context is the sum of the parts: the task, the design direction, the measurements, the
 *   palette, the tokens, the instructions of the project and the pictures. Every part says
 *   whether it was found, and the conflicts between the parts are reported rather than resolved
 *   silently — except the tokens of the stylesheet, which win over the document.
 *
 * @depends node:path, node:fs/promises, inputs/design-md, inputs/measurements, inputs/palette,
 *          inputs/tokens, inputs/assets, inputs/references, config/paths
 * @usedBy stages/collect, stages/index
 * @exports collectInputs, inputContext, inputSummary
 * @ai.tags inputs, context
 * @ai.hint io
 */

import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { parseDesignMd, designConflicts } from './design-md.js';
import { parseMeasurements, summarizeMeasurements } from './measurements.js';
import { parsePalette, paletteTokens } from './palette.js';
import { parseTokensCss, cssConflicts } from './tokens.js';
import { collectAssetFiles, readProjectInstructions } from './assets.js';
import { findReferences } from './references.js';

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
 * Collect the inputs of a run.
 *
 * The paths come from the config: `inputs.designMd`, `inputs.measurements`, `inputs.palette`,
 * `inputs.tokens`. A missing file is not an error: the part is simply absent, and the report
 * says so.
 * @param {{ root: string, config?: object, task?: string }} options
 * @returns {Promise<object>} the collected inputs
 * @exports
 * @ai.hint io
 */
export async function collectInputs({ root, config = {}, task = '' } = {}) {
    const inputs = config.inputs ?? {};
    const warnings = [];

    const designText = await readOptional(root, inputs.designMd ?? 'DESIGN.md');
    const design = parseDesignMd(designText ?? '');
    if (!design.present && inputs.designMd) warnings.push(`The file ${inputs.designMd} was not found.`);

    const measurementText = await readOptional(root, inputs.measurements ?? 'measurements.json');
    const measurements = parseMeasurements(measurementText ?? '');
    if (!measurements.present && inputs.measurements) warnings.push(`The file ${inputs.measurements} was not found.`);
    warnings.push(...measurements.warnings);

    const paletteText = await readOptional(root, inputs.palette ?? 'palette.json');
    const palette = parsePalette(paletteText ?? '');
    if (!palette.present && inputs.palette) warnings.push(`The file ${inputs.palette} was not found.`);
    warnings.push(...palette.warnings);

    const tokensText = await readOptional(root, inputs.tokens ?? 'tokens.css');
    const tokens = parseTokensCss(tokensText ?? '');
    if (!tokens.present && inputs.tokens) warnings.push(`The file ${inputs.tokens} was not found.`);
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

    const assets = await collectAssetFiles({
        root,
        dirs: [
            ...(config.output?.dir ? [path.join(config.output.dir, 'refs')] : []),
            ...(config.output?.dir ? [path.join(config.output.dir, 'assets')] : []),
            ...(config.output?.work ? [config.output.work] : []),
        ],
    });

    // The reference of the design: the screenshot the roles have to look at.
    const references = await findReferences({ root, config, task });

    return {
        task: String(task ?? ''),
        design,
        measurements,
        palette,
        tokens,
        conflicts,
        instructions,
        assets,
        references,
        warnings,
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
 *   assets: number, references: number, instructions: number, conflicts: number,
 *   warnings: string[] }}
 * @exports
 * @ai.hint pure
 */
export function inputSummary(collected = {}) {
    return {
        design: Boolean(collected.design?.present),
        measurements: Boolean(collected.measurements?.present),
        palette: Boolean(collected.palette?.present),
        tokens: Boolean(collected.tokens?.present),
        assets: collected.assets?.length ?? 0,
        references: collected.references?.length ?? 0,
        instructions: collected.instructions?.files?.length ?? 0,
        conflicts: collected.conflicts?.length ?? 0,
        warnings: collected.warnings ?? [],
    };
}
