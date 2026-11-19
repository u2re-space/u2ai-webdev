/**
 * @file src/model/refs.js
 * @module model/refs
 * @purpose The references to models: a model, a family of models or a group of models.
 *
 *   A family is a named list of interchangeable models, from the cheapest to the most
 *   expensive. The run answers with the cheapest member of the family that takes the effort
 *   the role asks for, and the rest of the list is the ladder of the budget: when the model
 *   of the family refuses, the next member answers in its place.
 *
 *   The list of a family is also a ranking: a role may be pinned to a rank of the family and
 *   answers with the member on that place, whatever the effort. The head of the list is the
 *   rank 0 — the model of the house for the work that wants the best of the family.
 *
 *   A group is a named list of models of one kind — the small and the budget models of the
 *   house. The members of a group are peers: the one that fits the work answers. A member
 *   may name the limit of the context it is trusted with (`maxContext`, in tokens): the
 *   member is not asked when the context of the role is bigger than the limit.
 *
 *   A reference names a family with the prefix `family:` and a group with the prefix `group:`.
 *
 * @depends model/profiles
 * @usedBy model/trust, roles/index, openai/fallback, config/validate
 * @exports FAMILY_PREFIX, GROUP_PREFIX, familyName, groupName, familyModels, groupMembers,
 *          resolveModelRef, familyLadder, groupLadder, rankPath, familyOf
 * @ai.tags model, families, groups
 * @ai.hint pure
 */

import { contextBytes, getModelProfile, snapEffort } from './profiles.js';

/** The prefix that names a family of models instead of a model. */
export const FAMILY_PREFIX = 'family:';

/** The prefix that names a group of models instead of a model. */
export const GROUP_PREFIX = 'group:';

/**
 * The bytes one token of the house weighs — the estimate of `util/text.js`, kept here so the
 * limits of the groups are counted the same way the requests are budgeted.
 */
const BYTES_PER_TOKEN = 3.5;

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * The name of the family a reference names, or null when it names no family.
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
 * The name of the group a reference names, or null when it names no group.
 * @param {string|null} ref the reference
 * @returns {string|null}
 * @exports
 * @ai.hint pure
 */
export function groupName(ref) {
    const text = String(ref ?? '').trim();
    if (!text.toLowerCase().startsWith(GROUP_PREFIX)) return null;
    return text.slice(GROUP_PREFIX.length).trim() || null;
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
 * One member of a group: the model and the limit of the context it is trusted with.
 * @param {unknown} value a string or `{ model, maxContext }`
 * @returns {{ model: string, maxContext: number|null }|null}
 * @ai.hint pure
 */
function memberOf(value) {
    if (typeof value === 'string') {
        const model = value.trim();
        return model ? { model, maxContext: null } : null;
    }
    if (!isRecord(value)) return null;
    const model = String(value.model ?? '').trim();
    if (!model) return null;
    const maxContext = Number.isSafeInteger(value.maxContext) && value.maxContext > 0
        ? value.maxContext
        : null;
    return { model, maxContext };
}

/**
 * The members of a group, with the limits of their context.
 * @param {object|null} config
 * @param {string} name the name of the group
 * @returns {{ model: string, maxContext: number|null }[]}
 * @exports
 * @ai.hint pure
 */
export function groupMembers(config, name) {
    const list = config?.modelGroups?.[String(name ?? '').trim()];
    if (!Array.isArray(list)) return [];
    return list.map(memberOf).filter(Boolean);
}

/**
 * Whether a model takes the effort a role asks for.
 * @param {string} model
 * @param {string} effort the effort the role asks for
 * @param {object|null} config
 * @returns {boolean}
 * @ai.hint pure
 */
function takesEffort(model, effort, config) {
    if (!effort) return true;
    return snapEffort(effort, getModelProfile(model, config)) === effort;
}

/**
 * Whether a member of a group may be asked with the context of the role.
 *
 * The budget of the context is the one of the role (`roles.<role>.context`: a word or a byte
 * count); `auto` is the window of the model itself. The limit of the member is in tokens.
 * @param {{ model: string, maxContext: number|null }} member
 * @param {string|number|null} context the budget of the context of the role
 * @param {object|null} config
 * @returns {boolean}
 * @ai.hint pure
 */
function fitsContext(member, context, config) {
    if (!member.maxContext) return true;
    const profile = getModelProfile(member.model, config);
    const bytes = contextBytes(context ?? 'auto', profile);
    const tokens = Math.floor(bytes / BYTES_PER_TOKEN);
    return tokens <= member.maxContext;
}

/**
 * The model a reference names.
 *
 * A reference that names a model is that model. A reference that names a family is the
 * cheapest member of the family that takes the asked effort; a family pinned to a rank
 * answers with the member on that place, whatever the effort. A reference that names a group
 * is the first member of the group that takes the effort and fits the context of the role.
 * A reference that names a family or a group that does not exist names no model at all.
 * @param {string|null} ref the reference: a model, `family:<name>` or `group:<name>`
 * @param {object|null} [config]
 * @param {{ effort?: string|null, context?: string|number|null, rank?: number|null }} [options]
 * @returns {string|null}
 * @exports
 * @ai.hint pure
 */
export function resolveModelRef(ref, config = null, { effort = null, context = null, rank = null } = {}) {
    const text = String(ref ?? '').trim();
    if (!text) return null;
    const wanted = String(effort ?? '').trim();

    const group = groupName(text);
    if (group) {
        const members = groupMembers(config, group);
        if (!members.length) return null;
        for (const member of members) {
            if (!takesEffort(member.model, wanted, config)) continue;
            if (!fitsContext(member, context, config)) continue;
            return member.model;
        }
        // No member takes both: the first one that takes the effort answers, and when no
        // member takes it, the first member answers anyway.
        for (const member of members) {
            if (takesEffort(member.model, wanted, config)) return member.model;
        }
        return members[0].model;
    }

    const family = familyName(text);
    if (family) {
        const members = familyModels(config, family);
        if (!members.length) return null;
        // A pinned rank: the member on that place of the family answers, and the effort is
        // pulled down to what it takes. A rank beyond the list is the last member of it.
        if (Number.isSafeInteger(rank) && rank >= 0) {
            return members[Math.min(rank, members.length - 1)] ?? members[0];
        }
        if (!wanted) return members[0];
        for (const member of members) {
            if (takesEffort(member, wanted, config)) return member;
        }
        return members[0];
    }

    return text;
}

/**
 * The path of the ranks of one entry of the config: a number or a list of numbers.
 *
 * The path is a list of the places of a family: the role answers on the first place and
 * steps down to the next one when its work is done.
 * @param {unknown} value the value of the config
 * @returns {number[]|null}
 * @exports
 * @ai.hint pure
 */
export function rankPath(value) {
    if (Number.isSafeInteger(value) && value >= 0) return [value];
    if (!Array.isArray(value)) return null;
    const list = value.filter((item) => Number.isSafeInteger(item) && item >= 0);
    return list.length ? list : null;
}

/**
 * The family of models a model belongs to, or null when it belongs to none.
 * @param {object|null} config
 * @param {string|null} model
 * @returns {string[]|null}
 * @exports
 * @ai.hint pure
 */
export function familyOf(config, model) {
    const name = String(model ?? '').trim();
    if (!name) return null;
    const families = config?.modelFamilies;
    if (!isRecord(families)) return null;
    for (const list of Object.values(families)) {
        if (!Array.isArray(list)) continue;
        const members = list.map((item) => String(item ?? '').trim()).filter(Boolean);
        if (members.includes(name)) return members;
    }
    return null;
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

/**
 * The other members of the groups the model belongs to: the peers that answer when it
 * refuses.
 * @param {object|null} config
 * @param {string|null} model
 * @returns {string[]}
 * @exports
 * @ai.hint pure
 */
export function groupLadder(config, model) {
    const name = String(model ?? '').trim();
    if (!name) return [];
    const groups = config?.modelGroups;
    if (!isRecord(groups)) return [];
    const out = [];
    for (const list of Object.values(groups)) {
        if (!Array.isArray(list)) continue;
        const members = list.map(memberOf).filter(Boolean);
        // Only the groups the model belongs to count.
        if (!members.some((member) => member.model === name)) continue;
        for (const member of members) {
            if (member.model === name || out.includes(member.model)) continue;
            out.push(member.model);
        }
    }
    return out;
}
