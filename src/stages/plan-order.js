/**
 * @file src/stages/plan-order.js
 * @module stages/plan-order
 * @purpose Порядок стадий по плану: шаг зависит от шага — стадии идут в том же порядке.
 *
 *   Реестр стадий задаёт порядок по умолчанию: разметка, код, стили. Но план знает
 *   больше: шаг `select-icons` зависит от шага `create-markup`, а шаг `create-styles`
 *   зависит от `select-icons`. Стадии, которые исполняют эти шаги, должны идти в том же
 *   порядке: иначе роль пишет поверх работы, которой ещё нет, и результат одного шага
 *   стирает результат другого.
 *
 *   Порядок реестра остаётся правилом развязки: план, который не задаёт зависимостей
 *   между стадиями, не меняет порядок прогона. Зависимости реестра между двумя
 *   стадиями шагов уступают плану, а остальные (сборка — после стилей, ревью — после
 *   всего) остаются в силе.
 *
 *   Круг зависимостей в плане — это ошибка плана: порядок остаётся прежним, и прогон
 *   говорит об этом.
 *
 * @depends stages/roles
 * @usedBy pipeline
 * @exports PLAN_STAGES, planEdges, planOrder
 * @ai.tags stages, plan, order
 * @ai.hint pure
 * @changed 2026-11-15 Порядок стадий, которые делают шаги плана, задаёт сам план.
 */

import { LIVE_ROLES, stageForRole } from './roles.js';

/** Стадии, которые исполняют шаги плана. */
export const PLAN_STAGES = Object.freeze(new Set(Object.values(LIVE_ROLES)));

/**
 * Стадия, которая исполняет шаг.
 * @param {object} step
 * @returns {string|null} имя стадии или null
 * @ai.hint pure
 */
function stageOfStep(step) {
    return stageForRole(step?.role);
}

/**
 * Рёбра плана между стадиями: шаг зависит от шага — стадия зависит от стадии.
 *
 * Шаги одной роли не дают ребра: их работа и так идёт по порядку шагов внутри стадии.
 * @param {object} plan
 * @returns {{ edges: Array<[string, string]> }}
 * @exports
 * @ai.hint pure
 */
export function planEdges(plan) {
    const steps = Array.isArray(plan?.steps) ? plan.steps : [];
    const stageOf = new Map();
    for (const step of steps) {
        const id = String(step?.id ?? '').trim();
        if (!id) continue;
        const stage = stageOfStep(step);
        if (stage) stageOf.set(id, stage);
    }
    const edges = [];
    const seen = new Set();
    for (const step of steps) {
        const id = String(step?.id ?? '').trim();
        const to = stageOf.get(id);
        if (!to) continue;
        for (const dep of Array.isArray(step?.dependsOn) ? step.dependsOn : []) {
            const from = stageOf.get(String(dep ?? '').trim());
            if (!from || from === to) continue;
            const key = `${from}>${to}`;
            if (seen.has(key)) continue;
            seen.add(key);
            edges.push([from, to]);
        }
    }
    return { edges };
}

/**
 * Порядок стадий, который задаёт план.
 *
 * @param {object[]} stages стадии прогона в порядке реестра
 * @param {object|null} plan план прогона
 * @returns {{ stages: object[], warnings: string[] }}
 * @exports
 * @ai.hint pure
 */
export function planOrder(stages = [], plan = null) {
    const list = Array.isArray(stages) ? [...stages] : [];
    const warnings = [];
    if (list.length < 2) return { stages: list, warnings };

    const names = list.map((stage) => stage.name);
    const known = new Set(names);
    const planStages = new Set(names.filter((name) => PLAN_STAGES.has(name)));
    if (planStages.size < 2) return { stages: list, warnings };

    const { edges } = planEdges(plan);
    if (!edges.length) return { stages: list, warnings };

    // Кто от кого зависит: реестр задаёт зависимости между стадиями, план — между
    // стадиями шагов. Между двумя стадиями шагов решает план.
    const outgoing = new Map(names.map((name) => [name, new Set()]));
    const incoming = new Map(names.map((name) => [name, 0]));
    const link = (from, to) => {
        if (from === to || !known.has(from) || !known.has(to)) return;
        if (outgoing.get(from).has(to)) return;
        outgoing.get(from).add(to);
        incoming.set(to, incoming.get(to) + 1);
    };
    for (const stage of list) {
        for (const dep of stage.dependsOn ?? []) {
            if (!known.has(dep)) continue;
            if (planStages.has(dep) && planStages.has(stage.name)) continue;
            link(dep, stage.name);
        }
    }
    for (const [from, to] of edges) link(from, to);

    // Развязка по кругу: порядок реестра решает, кто идёт первым.
    const index = new Map(names.map((name, i) => [name, i]));
    const ready = names.filter((name) => incoming.get(name) === 0);
    const out = [];
    while (ready.length) {
        ready.sort((a, b) => index.get(a) - index.get(b));
        const name = ready.shift();
        out.push(name);
        for (const next of outgoing.get(name)) {
            incoming.set(next, incoming.get(next) - 1);
            if (incoming.get(next) === 0) ready.push(next);
        }
    }
    if (out.length !== names.length) {
        warnings.push('План задаёт круг зависимостей между стадиями — порядок прогона остался прежним.');
        return { stages: list, warnings };
    }

    const byName = new Map(list.map((stage) => [stage.name, stage]));
    const ordered = out.map((name) => byName.get(name));
    // Стадии шагов в новом порядке — их видно в отчёте прогона.
    const steps = ordered.map((stage) => stage.name).filter((name) => planStages.has(name));
    const before = names.filter((name) => planStages.has(name));
    if (steps.join('>') !== before.join('>')) {
        warnings.push(`Порядок стадий задан планом: ${steps.join(' → ')}.`);
    }
    return { stages: ordered, warnings };
}
