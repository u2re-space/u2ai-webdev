/**
 * @file src/model/trust.js
 * @module model/trust
 * @purpose The roles that have their own model of the house: the markup is a Kimi job.
 * @depends model/profiles
 * @usedBy roles/index
 * @exports HOUSE_MODELS, houseModel
 * @ai.tags model, trust
 * @ai.hint pure
 */

/**
 * The model of the house for the roles that have one.
 *
 * The markup — the stage `markup` and the role `markup` — is a Kimi job: the Kimi K3.1 Pro
 * builds the structure of the page faster and more surely than the Gemini 4 Hydrogen, and it
 * answers in a fraction of the time. The rest of the run answers on the model of the run.
 *
 * The roles that have no verdict yet keep the model of the run: the vector stage (the role
 * `editor`) is one of them — nobody drew a vector picture well with any of the models of the
 * house, so there is nothing to decide yet.
 *
 * A role that names its own model in the configuration (`roles.markup.model`, the flag
 * `--role markup=<model>`) is never moved.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const HOUSE_MODELS = Object.freeze({
    director: 'openai/gpt-6.1-terra',
    planner: 'openai/gpt-6.1-terra',
    markup: 'openai/gpt-6.1-terra',
    editor: 'openai/gpt-6.1-terra',
    iconfier: 'openai/gpt-6.1-terra',
    coder: 'openai/gpt-6.1-terra'
});

/**
 * The model of the house for a role, or null when the role has none of its own.
 * @param {string|null} role the name of the role
 * @returns {string|null}
 * @exports
 * @ai.hint pure
 */
export function houseModel(role) {
    const key = String(role ?? '').trim().toLowerCase();
    return HOUSE_MODELS[key] ?? null;
}
