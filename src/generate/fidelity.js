/**
 * @file src/generate/fidelity.js
 * @module generate/fidelity
 * @purpose The targets of a generation: how close the result follows the references, and how far
 *          it may go from them.
 *
 *   The two numbers are a contract, not a measurement. This package does not compare a rendered
 *   page with a mockup, so the result never carries a match percentage: the measured field
 *   stays null and the model is told not to invent one.
 *
 * @depends none
 * @usedBy generate/brief, stages/plan
 * @exports DEFAULT_FIDELITY, DEFAULT_CREATIVITY, clampPercent, effectiveFidelity,
 *          fidelityContract, fidelityInstructions
 * @ai.tags generate, fidelity, creativity
 * @ai.hint pure
 * @ai.hint legacy-0.2
 */

/** How closely the result should follow the attached references. */
export const DEFAULT_FIDELITY = 80;

/** How much may be added that is not in the references. */
export const DEFAULT_CREATIVITY = 20;

/**
 * Accept an integer percent, or throw.
 * @param {number} value
 * @param {string} name the name of the field, used in the error
 * @returns {number}
 * @exports
 * @ai.hint pure
 */
export function clampPercent(value, name) {
    if (!Number.isInteger(value) || value < 0 || value > 100) {
        throw new Error(`${name}: целое 0..100`);
    }
    return value;
}

/**
 * The working fidelity: the quality of the run scales the stated target.
 *
 * A quality of 0 keeps 60% of the target, a quality of 100 keeps all of it.
 * @param {number} stated
 * @param {number} quality
 * @returns {number}
 * @exports
 * @ai.hint pure
 */
export function effectiveFidelity(stated, quality) {
    const scaled = Math.round(stated * (600 + quality * 4) / 1000);
    return Math.min(100, Math.max(0, scaled));
}

/**
 * The contract of the targets and the fact that no comparator ran.
 * @param {{ fidelity?: number, creativity?: number }} [options]
 * @returns {{ fidelity: number, creativity: number, measured: null, method: 'unmeasured', reason: string }}
 * @exports
 * @ai.hint pure
 */
export function fidelityContract({ fidelity = DEFAULT_FIDELITY, creativity = DEFAULT_CREATIVITY } = {}) {
    return {
        fidelity: clampPercent(fidelity, 'fidelity'),
        creativity: clampPercent(creativity, 'creativity'),
        measured: null,
        method: 'unmeasured',
        reason: 'Сверка с изображением макета не выполняется: кадр макета и вёрстка не сравниваются.',
    };
}

/**
 * What the two percents mean, and the rule that forbids an invented score.
 * @param {{ fidelity: number, creativity: number }} contract
 * @returns {string}
 * @exports
 * @ai.hint pure
 */
export function fidelityInstructions(contract) {
    return [
        `Fidelity target: ${contract.fidelity}%. 100 follows the visible structure, the text, the palette and the order of the blocks of the references. 0 may depart from them. The other ${100 - contract.fidelity}% is the allowed deviation.`,
        `Creativity: ${contract.creativity}%. 0 adds nothing that is not in the references. 100 may add sections, copy and decoration freely. Creativity does not raise the allowed deviation from a reference.`,
        'The visual fidelity is not measured. Do not write a match percentage. Leave measured null.',
    ].join('\n');
}
