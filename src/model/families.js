/**
 * @file src/model/families.js
 * @module model/families
 * @purpose The families of models: a named list of interchangeable models, from the cheapest
 *          to the most expensive.
 *
 *   A family lives in the config as a list of models and is named where a model is expected
 *   with the prefix `family:` — `roles.markup.model: "family:gpt"`.
 *
 *   The run answers with the cheapest member of the family that takes the effort the role
 *   asks for. The rest of the list is the ladder of the budget: when the model of the family
 *   refuses, the next member answers in its place.
 *
 * @depends model/profiles
 * @usedBy model/trust, roles/index, openai/fallback, config/validate
 * @exports FAMILY_PREFIX, familyName, familyModels, resolveModelRef, familyLadder
 * @ai.tags model, families
 * @ai.hint pure
 */

import { getModelProfile, snapEffort } from './profiles.js';

/** The prefix that names a family of models instead of a model. */
export const FAMILY_PREFIX = 'family:';

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * The name of the family a reference names, or null when it names a model.
 * @param {string|null} ref the reference
 * @returns {string|null}
 * @exports
 * @ai.hint pure
 */
export function familyName(ref) {
    const text = String(ref ?? '').trim();
    if (!text.toLowerCase().startsWith(FAMILY_PREFIX)) return null;
    return text.slice(FAMILY_PREFIX.length).trim() || null;
}

/**
 * The models of a family, from the cheapest to the most expensive.
 * @param {object|null} config
 * @param {string} name the name of the family
 * @returns {string[]}
 * @exports
 * @ai.hint pure
 */
export function familyModels(config, name) {
    const list = config?.modelFamilies?.[String(name ?? '').trim()];
    if (!Array.isArray(list)) return [];
    return list.map((item) => String(item ?? '').trim()).filter(Boolean);
}

/**
 * The model a reference names.
 *
 * A reference that names a model is that model. A reference that names a family is the
 * cheapest member of the family that takes the asked effort; when no member takes it, the
 * cheapest one answers anyway. A reference that names a family that does not exist names no
 * model at all.
 * @param {string|null} ref the reference: a model or `family:<name>`
 * @param {object|null} [config]
 * @param {{ effort?: string|null }} [options] the effort the model has to take
 * @returns {string|null}
 * @exports
 * @ai.hint pure
 */
export function resolveModelRef(ref, config = null, { effort = null } = {}) {
    const text = String(ref ?? '').trim();
    if (!text) return null;
    const name = familyName(text);
    if (!name) return text;
    const members = familyModels(config, name);
    if (!members.length) return null;
    const wanted = String(effort ?? '').trim();
    if (!wanted) return members[0];
    for (const member of members) {
        if (snapEffort(wanted, getModelProfile(member, config)) === wanted) return member;
    }
    return members[0];
}

/**
 * The ladder of the budget of a model: the members of its family that stand above it.
 * @param {object|null} config
 * @param {string|null} model
 * @returns {string[]}
 * @exports
 * @ai.hint pure
 */
export function familyLadder(config, model) {
    const name = String(model ?? '').trim();
    if (!name) return [];
    const families = config?.modelFamilies;
    if (!isRecord(families)) return [];
    const out = [];
    for (const members of Object.values(families)) {
        if (!Array.isArray(members)) continue;
        const list = members.map((item) => String(item ?? '').trim()).filter(Boolean);
        const at = list.indexOf(name);
        if (at < 0) continue;
        for (const item of list.slice(at + 1)) if (!out.includes(item)) out.push(item);
    }
    return out;
}
