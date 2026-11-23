/**
 * @file src/agent/pace.js
 * @module agent/pace
 * @purpose Choose the speed, the quality and the effort of a stage from the pace dials of the
 *          config. The dials of one stage never move the dials of another one.
 * @depends config/constants, model/profiles
 * @usedBy stages/index, roles/index, cli
 * @exports FINE_QUALITY_KEYS, defaultFineQuality, fineQuality, stageEffort, assertPaceBudget,
 *          resolvePace, effortFor, stageEffortFor, lowerEffort
 * @ai.tags pace, quality
 * @ai.hint pure
 */

import { ENUMS } from '../config/constants.js';

/**
 * The per-stage dials. Each one tunes its own stage and never touches the shared speed and
 * quality of the run.
 */
export const FINE_QUALITY_KEYS = Object.freeze([
    'codeQuality', 'decorQuality', 'architectQuality', 'iconifierQuality', 'reviewerQuality',
]);

/** The stage a role works in, so that the right dial moves. */
export const STAGE_OF_ROLE = Object.freeze({
    coder: 'codeQuality',
    markup: 'codeQuality',
    styler: 'codeQuality',
    animator: 'decorQuality',
    illustrator: 'decorQuality',
    editor: 'decorQuality',
    architect: 'architectQuality',
    iconifier: 'iconifierQuality',
    reviewer: 'reviewerQuality',
    auditor: 'reviewerQuality',
});

/** One full band of quality points moves the effort by one level. */
const QUALITY_BAND = 25;

/**
 * The default of a per-stage dial: the middle between the speed and the quality.
 * @param {number} speed
 * @param {number} quality
 * @returns {number}
 * @exports
 * @ai.hint pure
 */
export function defaultFineQuality(speed, quality) {
    const s = Number.isInteger(speed) ? speed : 0;
    const q = Number.isInteger(quality) ? quality : 0;
    return Math.round((s + q) / 2);
}

/**
 * The value of one dial: the configured number, or the default when it is unset.
 * @param {object} pace
 * @param {string} key
 * @returns {number}
 * @exports
 * @ai.hint pure
 */
export function fineQuality(pace, key) {
    const raw = pace?.[key];
    return Number.isInteger(raw) ? raw : defaultFineQuality(pace?.speed, pace?.quality);
}

/**
 * Move an effort by how far its stage dial sits from the default of that dial.
 *
 * The baseline is the default of the dial, so an untouched dial leaves the effort where the pace
 * already put it.
 * @param {string} effort
 * @param {number} baseline
 * @param {number} stageQuality
 * @returns {string}
 * @exports
 * @ai.hint pure
 */
export function stageEffort(effort, baseline, stageQuality) {
    const ladder = ENUMS.reasoningEfforts;
    if (!ladder.includes(effort)) return effort;
    const delta = Math.round((stageQuality - baseline) / QUALITY_BAND);
    if (!delta) return effort;
    const index = ladder.indexOf(effort);
    return ladder[Math.max(0, Math.min(ladder.length - 1, index + delta))];
}

/**
 * Check that the two dials of the run stay inside their budget.
 * @param {number} speed
 * @param {number} quality
 * @returns {void}
 * @exports
 * @ai.hint pure
 */
export function assertPaceBudget(speed, quality) {
    if (!Number.isInteger(speed) || speed < 0 || speed > 100) throw new Error('pace.speed: целое 0..100');
    if (!Number.isInteger(quality) || quality < 0 || quality > 100) throw new Error('pace.quality: целое 0..100');
}

/**
 * The effective pace of a stage: the mode, the speed, the quality and the dial of the stage.
 * @param {{ config?: object, stage?: string|null, role?: string|null }} request
 * @returns {{ mode: string, speed: number, quality: number, stageQuality: number }}
 * @exports
 * @ai.hint pure
 */
export function resolvePace({ config = {}, stage = null, role = null } = {}) {
    const pace = config.pace ?? {};
    const mode = ENUMS.paceModes.includes(pace.mode) ? pace.mode : 'auto';
    const speed = Number.isInteger(pace.speed) ? pace.speed : 50;
    const quality = Number.isInteger(pace.quality) ? pace.quality : 50;
    // `auto` follows the numbers of the user; the other two modes shift them by a quarter.
    const effective = mode === 'speed'
        ? { speed: Math.min(100, speed + 25), quality: Math.max(0, quality - 25) }
        : mode === 'quality'
            ? { speed: Math.max(0, speed - 25), quality: Math.min(100, quality + 25) }
            : { speed, quality };
    const key = stage ?? (role ? STAGE_OF_ROLE[role] : null);
    const stageQuality = key
        ? fineQuality({ ...pace, speed: effective.speed, quality: effective.quality }, key)
        : effective.quality;
    return { mode, ...effective, stageQuality };
}

/**
 * The effort of a role from the profile of the stages.
 *
 * The profile lives in the config (`reasoning.stageEffort`): a role that is not in it
 * keeps the effort of the run. A profile that is turned off (`null`) keeps nothing.
 * @param {{ config?: object, role?: string|null }} request
 * @returns {string|null}
 * @exports
 * @ai.hint pure
 */
export function stageEffortFor({ config = {}, role = null } = {}) {
    const key = String(role ?? '').trim().toLowerCase();
    if (!key) return null;
    const profile = config?.reasoning?.stageEffort;
    if (!profile || typeof profile !== 'object' || Array.isArray(profile)) return null;
    const level = profile[key];
    return typeof level === 'string' && level ? level : null;
}

/**
 * The lower of two efforts.
 *
 * The ladder of the efforts is the order of the enum: `low` is below `high`, `high` is
 * below `xhigh`. The name of a level that is not in the ladder is kept as it is.
 * @param {string|null} first
 * @param {string|null} second
 * @returns {string|null}
 * @exports
 * @ai.hint pure
 */
export function lowerEffort(first, second) {
    const a = String(first ?? '');
    const b = String(second ?? '');
    if (!a) return b || null;
    if (!b) return a;
    const ladder = ENUMS.reasoningEfforts;
    const at = ladder.indexOf(a);
    const bt = ladder.indexOf(b);
    if (at < 0 || bt < 0) return a;
    return ladder[Math.min(at, bt)];
}

/**
 * The effort of a role: the effort of the role, the effort of its stage under the
 * ceiling of the run, or the ceiling itself.
 *
 * The profile of the stages says what a stage asks for; `reasoning.effort` is the budget
 * of the run: a stage never works above it. An effort set for the role itself
 * (`roles.<role>.effort`) is taken as it is.
 * @param {{ config?: object, role?: string|null, effort?: string|null }} request
 * @returns {string|null}
 * @exports
 * @ai.hint pure
 */
export function effortFor({ config = {}, role = null, effort = null } = {}) {
    const ceiling = config?.reasoning?.effort ?? null;
    const asked = stageEffortFor({ config, role });
    const base = effort ?? (asked ? lowerEffort(asked, ceiling) : ceiling);
    if (!base) return null;
    const pace = resolvePace({ config, role });
    const key = role ? STAGE_OF_ROLE[role] : null;
    if (!key) return base;
    const moved = stageEffort(base, defaultFineQuality(pace.speed, pace.quality), pace.stageQuality);
    // The dial of the stage is an explicit wish of the user: it may lift the effort above
    // the ceiling of the run.
    return moved;
}
