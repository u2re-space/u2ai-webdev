/**
 * @file src/model/trust.js
 * @module model/trust
 * @purpose The model of the house for the roles that have one: the markup is a Kimi job.
 * @depends config/defaults, model/families
 * @usedBy roles/index
 * @exports HOUSE_MODELS, houseModel
 * @ai.tags model, trust
 * @ai.hint pure
 */

import { defaults } from '../config/defaults.js';
import { resolveModelRef } from './families.js';

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * The built-in model of the house for the roles that have one.
 *
 * The markup — the stage `markup` and the role `markup` — has a model of its own: the model of
 * the house builds the structure of the page faster and more surely than the model of the run,
 * and it answers in a fraction of the time. The rest of the run answers on the model of the run.
 *
 * The roles that have no verdict yet keep the model of the run: the vector stage (the role
 * `editor`) is one of them — nobody drew a vector picture well with any of the models of the
 * house, so there is nothing to decide yet.
 *
 * The config decides: the section `house.models` of the config holds the same map and may
 * change every name of it. A role that names its own model in the configuration
 * (`roles.markup.model`, the flag `--role markup=<model>`) is never moved.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const HOUSE_MODELS = Object.freeze({ ...defaults.house.models });

/**
 * The model of the house for a role, or null when the role has none of its own.
 *
 * The name of the model may be a family of models (`family:gpt`): the role then answers
 * with the cheapest member of the family that takes the effort of the role.
 * @param {string|null} role the name of the role
 * @param {object|null} [config] the configuration of the run
 * @param {{ effort?: string|null }} [options] the effort the model has to take
 * @returns {string|null}
 * @exports
 * @ai.hint pure
 */
export function houseModel(role, config = null, { effort = null } = {}) {
    const key = String(role ?? '').trim().toLowerCase();
    if (!key) return null;
    const models = config?.house?.models;
    let ref = null;
    if (isRecord(models) && Object.hasOwn(models, key)) {
        // The config knows the role: an empty name means that the role has no model of the
        // house and answers on the model of the run.
        const value = models[key];
        ref = typeof value === 'string' && value.trim() ? value.trim() : null;
    } else {
        ref = HOUSE_MODELS[key] ?? null;
    }
    return resolveModelRef(ref, config, { effort });
}
