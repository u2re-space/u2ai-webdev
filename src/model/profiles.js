/**
 * @file src/model/profiles.js
 * @module model/profiles
 * @purpose Model profiles: context window, max output, effort ceiling and effort ladder.
 * @exports MODEL_PROFILES, getModelProfile, snapEffort, contextBytes, maxOutputFor
 * @ai.tags model, profiles
 * @ai.hint pure
 */
import { ENUMS } from '../config/constants.js';

/**
 * @typedef {{ window: number, maxOutput: number, ceiling: string|null, efforts: string[]|null,
 *   schemaChannel: string }} ModelProfile
 */

/**
 * Built-in model profiles. A ceiling of `null` means "no built-in limit".
 *
 * The window is the size of the context in bytes, the output cap is the longest answer in
 * tokens. The text models of the house are tuned by the live answers of the gateway
 * (RouterAI, November 2026):
 *
 *   - MiniMax M3.1 Flash — 1M tokens of context (4 MiB of text) and 524K of output. The
 *     endpoint refuses to work without reasoning ("Reasoning is mandatory for this endpoint
 *     and cannot be disabled"), so `none` is not on its ladder: a request for `none` is raised
 *     to `low` instead of being refused.
 *   - Gemini 4 Hydrogen — 1M tokens of context (4 MiB of text) and 64K of output. The card
 *     of the vendor names the four levels of the effort (`low`, `medium`,
 *     `high`, `xhigh`); there is no `none`, so the reasoning off is raised to `low`. The schema
 *     travels as a tool of its own (`auto`): the model calls its tools and submits the answer
 *     with the call of the schema.
 *   - Kimi K3.1 Pro — 1M tokens of context (4 MiB of text) and 944K of output. It takes the
 *     reasoning off without a refusal and answers in a fraction of the time (about 0.8 s
 *     against about 31 s at `medium` on the same question), so `none` stays on its ladder; the
 *     ceiling is `medium`, because the levels above it cost the same seconds. The model is the
 *     fallback of the house: the run answers with it when the primary model refuses.
 */
const GPT_MAX_OUTPUT = 128 * 1000;
const GPT_WINDOW = 256 * 1024;
export const MODEL_PROFILES = Object.freeze({
    'minimax/minimax-m3.1-flash': { window: 1024 * 1024 * 4, maxOutput: 512 * 1024, ceiling: 'xhigh', efforts: ['low', 'medium', 'high', 'xhigh'], schemaChannel: 'format' },
    'google/gemini-4-hydrogen': { window: 1024 * 1024 * 4, maxOutput: 64 * 1024, ceiling: 'xhigh', efforts: ['low', 'medium', 'high', 'xhigh'], schemaChannel: 'auto' },
    'moonshotai/kimi-k3.1-pro': { window: 1024 * 1024 * 4, maxOutput: 944_000, ceiling: 'high', efforts: ['none', 'low', 'medium', 'high'], schemaChannel: 'auto' },
    'openai/gpt-6.2-sol': { window: GPT_WINDOW * 4, maxOutput: GPT_MAX_OUTPUT, ceiling: 'xhigh', efforts: ['low', 'medium', 'high', 'xhigh'], schemaChannel: 'format' },
    'openai/gpt-6.1-sol': { window: GPT_WINDOW * 4, maxOutput: GPT_MAX_OUTPUT, ceiling: 'xhigh', efforts: ['low', 'medium', 'high', 'xhigh'], schemaChannel: 'format' },
    'openai/gpt-6.1-terra': { window: GPT_WINDOW * 4, maxOutput: GPT_MAX_OUTPUT, ceiling: 'xhigh', efforts: ['low', 'medium', 'high', 'xhigh'], schemaChannel: 'format' },
    'openai/gpt-6-luna': { window: GPT_WINDOW * 4, maxOutput: GPT_MAX_OUTPUT, ceiling: 'xhigh', efforts: ['low', 'medium', 'high', 'xhigh'], schemaChannel: 'format' },
    'gpt-6.2-sol': { window: GPT_WINDOW * 4, maxOutput: GPT_MAX_OUTPUT, ceiling: 'xhigh', efforts: ['low', 'medium', 'high', 'xhigh'], schemaChannel: 'format' },
    'gpt-6.1-sol': { window: GPT_WINDOW * 4, maxOutput: GPT_MAX_OUTPUT, ceiling: 'xhigh', efforts: ['low', 'medium', 'high', 'xhigh'], schemaChannel: 'format' },
    'gpt-6.1-terra': { window: GPT_WINDOW * 4, maxOutput: GPT_MAX_OUTPUT, ceiling: 'xhigh', efforts: ['low', 'medium', 'high', 'xhigh'], schemaChannel: 'format' },
    'gpt-6-luna': { window: GPT_WINDOW * 4, maxOutput: GPT_MAX_OUTPUT, ceiling: 'xhigh', efforts: ['low', 'medium', 'high', 'xhigh'], schemaChannel: 'format' },
    'openai/gpt-image-2.6-sunburst': { window: 0, maxOutput: 0, ceiling: null, efforts: [] },
    'gpt-image-2.6-sunburst': { window: 0, maxOutput: 0, ceiling: null, efforts: [] },
});

/** The profile of a model that is not in the table. */
const DEFAULT_PROFILE = Object.freeze({
    window: 256 * 1024,
    maxOutput: 64 * 1024,
    ceiling: 'high',
    efforts: ['low', 'medium', 'high'],
    schemaChannel: 'auto',
});

/**
 * The profile of a model, with the `models` section of the config applied on top.
 * @param {string|null} model
 * @param {object} [config]
 * @returns {ModelProfile}
 * @exports
 */
export function getModelProfile(model, config = null) {
    const base = MODEL_PROFILES[model] ?? DEFAULT_PROFILE;
    const override = config?.models?.[model];
    if (!override || typeof override !== 'object') return base;
    const merged = {
        window: Number.isSafeInteger(override.window) ? override.window : base.window,
        maxOutput: Number.isSafeInteger(override.maxOutput) ? override.maxOutput : base.maxOutput,
        ceiling: override.ceiling === null ? null : (override.ceiling ?? base.ceiling),
        efforts: Array.isArray(override.efforts) ? override.efforts : base.efforts,
        schemaChannel: typeof override.schemaChannel === 'string' ? override.schemaChannel : base.schemaChannel,
    };
    return merged;
}

/**
 * The order of the effort levels, from the cheapest to the most expensive.
 * @type {string[]}
 */
const EFFORT_ORDER = Object.freeze([...ENUMS.reasoningEfforts]);

/**
 * Clamp an effort to what the model accepts.
 *
 * The ceiling is a hard limit. The ladder is a set of levels the model really understands:
 * a level above the ladder is pulled down to the closest level below it.
 * @param {string|null} effort
 * @param {ModelProfile} profile
 * @returns {string|null}
 * @exports
 */
export function snapEffort(effort, profile) {
    if (!effort) return null;
    const wanted = String(effort);
    if (!EFFORT_ORDER.includes(wanted)) return null;

    let ceiling = profile?.ceiling ?? null;
    if (ceiling && EFFORT_ORDER.includes(ceiling)) {
        const ceilingIndex = EFFORT_ORDER.indexOf(ceiling);
        const wantedIndex = EFFORT_ORDER.indexOf(wanted);
        if (wantedIndex > ceilingIndex) return ceiling;
    }

    const ladder = Array.isArray(profile?.efforts) ? profile.efforts.filter((item) => EFFORT_ORDER.includes(item)) : null;
    if (!ladder || !ladder.length) return wanted;
    if (ladder.includes(wanted)) return wanted;

    const wantedIndex = EFFORT_ORDER.indexOf(wanted);
    let best = null;
    for (const item of ladder) {
        const index = EFFORT_ORDER.indexOf(item);
        if (index <= wantedIndex && (best === null || index > EFFORT_ORDER.indexOf(best))) best = item;
    }
    return best ?? ladder[0];
}

/**
 * The context budget in bytes.
 *
 * A word (`small`, `normal`, `large`, `max`) is a fixed budget; `auto` is the window of the
 * model; a number is a byte count.
 * @param {string|number|null} level
 * @param {ModelProfile} profile
 * @returns {number}
 * @exports
 */
export function contextBytes(level, profile) {
    if (Number.isSafeInteger(level) && level > 0) return level;
    const word = String(level ?? 'auto').trim().toLowerCase();
    if (word === 'auto') return Math.max(0, profile?.window ?? DEFAULT_PROFILE.window);
    const known = ENUMS.contextLevels[word];
    if (known) return known;
    const parsed = Number.parseInt(word, 10);
    if (Number.isSafeInteger(parsed) && parsed > 0) return parsed;
    return Math.max(0, profile?.window ?? DEFAULT_PROFILE.window);
}

/**
 * The output cap of a model for a request.
 * @param {string|null} model
 * @param {object} [config]
 * @param {number|null} [requested]
 * @param {{ readOnly?: boolean }} [options]
 * @returns {number|null}
 * @exports
 */
export function maxOutputFor(model, config = null, requested = null, { readOnly = false } = {}) {
    const profile = getModelProfile(model, config);
    const cap = Number.isSafeInteger(requested) && requested > 0
        ? (profile.maxOutput > 0 ? Math.min(requested, profile.maxOutput) : requested)
        : (profile.maxOutput > 0 ? profile.maxOutput : null);
    if (readOnly && cap !== null) return Math.max(1, Math.floor(cap / 4));
    return cap;
}
