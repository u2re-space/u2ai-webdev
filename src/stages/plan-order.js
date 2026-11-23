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
 * @exports PLAN_STAGES, planEdges, planOrder, placeVectorStage, placeIconifyStage,
 *          placeStylesBeforeCode, placeAnimationAfterStyles, placeAssetsAfterVector
 * @ai.tags stages, plan, order
 * @ai.hint pure
 * @changed 2026-11-15 Порядок стадий, которые делают шаги плана, задаёт сам план.
 * @changed 2026-11-20 Круг зависимостей рвётся порядком реестра, а не отменяет план.
 * @changed 2026-11-20 Стадия вектора не стоит в середине: до разметки или в самом конце.
 * @changed 2026-11-20 Стадия иконок стоит после стилиста.
 * @changed 2026-11-20 Стадия кода стоит после стилиста: стили задают контракт страницы.
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
 * Поставить стадию анимации после стилиста.
 *
 * Движение живёт в стилях: анимация правит ту же таблицу, что и стили, и править её
 * раньше стилей нечего. Анимация стоит прямо после стилей и до кода: код пишется по
 * контракту стилей, и состояния страницы — часть этого контракта.
 *
 * @param {string[]} names имена стадий в порядке прогона
 * @returns {{ names: string[], moved: boolean }}
 * @exports
 * @ai.hint pure
 */
export function placeAnimationAfterStyles(names = []) {
    const list = Array.isArray(names) ? [...names] : [];
    const animation = list.indexOf(ANIMATION_STAGE);
    const styling = list.indexOf(STYLING_STAGE);
    if (animation < 0 || styling < 0) return { names: list, moved: false };
    if (animation > styling) return { names: list, moved: false };
    // Анимация раньше стилей: она встаёт прямо после стилиста.
    list.splice(animation, 1);
    const target = list.indexOf(STYLING_STAGE);
    list.splice(target < 0 ? list.length : target + 1, 0, ANIMATION_STAGE);
    return { names: list, moved: true };
}

/**
 * Поставить стадию ассетов после вектора.
 *
 * Ассеты раскладываются по местам, когда известно всё множество картинок: вырезки
 * референса и нарисованный вектор. Разметка подключает уже окончательные файлы, поэтому
 * стадия ассетов стоит между вектором и разметкой.
 *
 * @param {string[]} names имена стадий в порядке прогона
 * @returns {{ names: string[], moved: boolean }}
 * @exports
 * @ai.hint pure
 */
export function placeAssetsAfterVector(names = []) {
    const list = Array.isArray(names) ? [...names] : [];
    const assets = list.indexOf(ASSETS_STAGE);
    const vector = list.indexOf(ASSETS_AFTER);
    if (assets < 0 || vector < 0) return { names: list, moved: false };
    if (assets > vector) return { names: list, moved: false };
    // Ассеты раньше вектора: они встают прямо после него.
    list.splice(assets, 1);
    const target = list.indexOf(ASSETS_AFTER);
    list.splice(target < 0 ? list.length : target + 1, 0, ASSETS_STAGE);
    return { names: list, moved: true };
}

/**
 * Стадия вектора и её место в цепочке.
 *
 * Ассеты рисует редактор, и разметка их подключает. Ставить стадию вектора между
 * разметкой и сборкой нельзя: разметка ждёт картинку, которой ещё нет, и прогон
 * до вектора не доходит. Стадия вектора стоит либо до разметки, либо в самом конце
 * цепочки — после сборки и взгляда на страницу.
 *
 * Когда разметка уже позади (продолжение прогона), вектор встаёт до сборки: сборка
 * переносит `public/` в бандл, и ассет, нарисованный после неё, в дистрибутив не
 * попадает.
 */
const VECTOR_STAGE = 'vector';
const VECTOR_BEFORE = 'markup';
const VECTOR_AFTER = 'sight';
const VECTOR_BEFORE_BUILD = 'build';
const ICONIFY_STAGE = 'iconify';
const ICONIFY_AFTER = 'styling';
const STYLING_STAGE = 'styling';
const CODING_STAGE = 'coding';
const ANIMATION_STAGE = 'animation';
const ASSETS_STAGE = 'assets';
const ASSETS_AFTER = 'vector';

/**
 * Поставить стадию кода после стилиста.
 *
 * Стили задают контракт страницы: имена классов и токены. Код пишется по этому
 * контракту, а не по своему представлению о нём, поэтому стили идут раньше кода.
 * План может попросить наоборот — код написан, а стили дописываются по нему; такой
 * порядок ломает пол, и прогон говорит об этом.
 *
 * @param {string[]} names имена стадий в порядке прогона
 * @returns {{ names: string[], moved: boolean }}
 * @exports
 * @ai.hint pure
 */
export function placeStylesBeforeCode(names = []) {
    const list = Array.isArray(names) ? [...names] : [];
    const styling = list.indexOf(STYLING_STAGE);
    const coding = list.indexOf(CODING_STAGE);
    if (styling < 0 || coding < 0) return { names: list, moved: false };
    if (coding > styling) return { names: list, moved: false };
    // Код раньше стилей: код встаёт прямо после стилиста.
    list.splice(coding, 1);
    const target = list.indexOf(STYLING_STAGE);
    list.splice(target < 0 ? list.length : target + 1, 0, CODING_STAGE);
    return { names: list, moved: true };
}

/**
 * Поставить стадию вектора на её место: до разметки, до сборки или в конец цепочки.
 *
 * @param {string[]} names имена стадий в порядке прогона
 * @returns {{ names: string[], moved: boolean, reason: string|null }}
 * @exports
 * @ai.hint pure
 */
export function placeVectorStage(names = []) {
    const list = Array.isArray(names) ? [...names] : [];
    const at = (name) => list.indexOf(name);
    const vector = at(VECTOR_STAGE);
    if (vector < 0) return { names: list, moved: false, reason: null };
    const markup = at(VECTOR_BEFORE);

    if (markup >= 0) {
        if (vector < markup) return { names: list, moved: false, reason: null };
        // Вектор после разметки: в середине цепочки он не стоит — только в конце.
        const sight = at(VECTOR_AFTER);
        if (sight >= 0 && vector < sight) {
            list.splice(vector, 1);
            const target = list.indexOf(VECTOR_AFTER);
            list.splice(target < 0 ? list.length : target + 1, 0, VECTOR_STAGE);
            return { names: list, moved: true, reason: 'end' };
        }
        if (sight < 0 && vector < list.length - 1) {
            // Взгляда в прогоне нет: вектор уходит в конец цепочки.
            list.splice(vector, 1);
            list.push(VECTOR_STAGE);
            return { names: list, moved: true, reason: 'end' };
        }
        return { names: list, moved: false, reason: null };
    }

    // Разметки в прогоне нет: она уже сделана. Вектор должен встать до сборки, иначе
    // ассеты не попадут в бандл.
    const build = at(VECTOR_BEFORE_BUILD);
    if (build >= 0 && vector > build) {
        list.splice(vector, 1);
        list.splice(list.indexOf(VECTOR_BEFORE_BUILD), 0, VECTOR_STAGE);
        return { names: list, moved: true, reason: 'build' };
    }
    return { names: list, moved: false, reason: null };
}

/**
 * Поставить стадию иконок после кода и после стилей.
 *
 * Иконки ложатся в разметку готовой страницы, и страница готова, когда написаны и стили,
 * и код: пока стили не написаны, разметка меняется под правил, которых для неё ещё нет;
 * пока не написан код, страница не делает ничего. Стадия иконок не встаёт раньше них,
 * даже если план этого просит.
 *
 * Якорь — та из двух стадий, что идёт позже: код стоит после стилей, и иконки встают
 * после кода. Когда кода в прогоне нет (стадия выключена), якорем остаются стили.
 *
 * @param {string[]} names имена стадий в порядке прогона
 * @returns {{ names: string[], moved: boolean }}
 * @exports
 * @ai.hint pure
 */
export function placeIconifyStage(names = []) {
    const list = Array.isArray(names) ? [...names] : [];
    const iconify = list.indexOf(ICONIFY_STAGE);
    if (iconify < 0) return { names: list, moved: false };
    const styling = list.indexOf(ICONIFY_AFTER);
    const coding = list.indexOf(CODING_STAGE);
    // Якорь — поздняя из двух стадий.
    let anchor = ICONIFY_AFTER;
    if (coding >= 0 && (styling < 0 || coding > styling)) anchor = CODING_STAGE;
    const at = list.indexOf(anchor);
    if (at < 0) return { names: list, moved: false };
    if (iconify > at) return { names: list, moved: false };
    list.splice(iconify, 1);
    const target = list.indexOf(anchor);
    list.splice(target < 0 ? list.length : target + 1, 0, ICONIFY_STAGE);
    return { names: list, moved: true };
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
    //
    // Круг в графе стадий — обычное дело: два шага одной роли, разделённые шагом другой
    // роли, дают круг, которого нет в плане. Раньше такой круг отменял порядок плана
    // целиком, и стадии шли по реестру: ассеты рисовались после разметки, которая их
    // ждала. Теперь круг рвётся порядком реестра, а остальные рёбра плана остаются в силе.
    const index = new Map(names.map((name, i) => [name, i]));
    const ready = names.filter((name) => incoming.get(name) === 0);
    const out = [];
    const done = new Set();
    const broken = [];
    while (out.length < names.length) {
        if (!ready.length) {
            // Круг: первым идёт та стадия, что раньше в реестре, и её рёбра теряют силу.
            const name = names.find((item) => !done.has(item) && !ready.includes(item));
            if (!name) break;
            broken.push(name);
            ready.push(name);
        }
        ready.sort((a, b) => index.get(a) - index.get(b));
        const name = ready.shift();
        if (done.has(name)) continue;
        done.add(name);
        out.push(name);
        for (const next of outgoing.get(name)) {
            if (done.has(next)) continue;
            incoming.set(next, incoming.get(next) - 1);
            if (incoming.get(next) === 0) ready.push(next);
        }
    }
    if (broken.length) {
        warnings.push(`План задаёт круг зависимостей между стадиями (${broken.join(', ')}) — `
            + 'порядок реестра решил, кто идёт первым, остальные рёбра плана остались в силе.');
    }

    // Стадия вектора: до разметки, до сборки или в самом конце цепочки.
    const placed = placeVectorStage(out);
    if (placed.moved) {
        warnings.push(placed.reason === 'build'
            ? 'Стадия вектора перенесена перед сборкой: разметка уже сделана, а сборка '
                + 'переносит ассеты в бандл — нарисованное после неё в дистрибутив не попадёт.'
            : 'Стадия вектора перенесена в конец цепочки: между разметкой и сборкой она ждёт '
                + 'сама себя — разметка ждёт ассеты, которых ещё нет.');
    }

    // Стадия кода: после стилиста.
    const withStyles = placeStylesBeforeCode(placed.names);
    if (withStyles.moved) {
        warnings.push('Стадия кода перенесена после стилиста: стили задают контракт страницы — '
            + 'имена классов и токены, — и код пишется по этому контракту.');
    }

    // Стадия ассетов: после вектора, до разметки.
    const withAssets = placeAssetsAfterVector(withStyles.names);
    if (withAssets.moved) {
        warnings.push('Стадия ассетов перенесена после вектора: картинки раскладываются по '
            + 'местам, когда известно всё множество — вырезки референса и нарисованный вектор.');
    }

    // Стадия анимации: после стилиста.
    const withAnimation = placeAnimationAfterStyles(withAssets.names);
    if (withAnimation.moved) {
        warnings.push('Стадия анимации перенесена после стилиста: движение живёт в стилях, '
            + 'и править их раньше стилей нечего.');
    }

    // Стадия иконок: не раньше кода и не раньше стилей.
    const withIcons = placeIconifyStage(withAnimation.names);
    if (withIcons.moved) {
        warnings.push('Стадия иконок перенесена после кода: иконки ложатся в разметку готовой '
            + 'страницы, а страница готова, когда написаны и стили, и код.');
    }

    const byName = new Map(list.map((stage) => [stage.name, stage]));
    const ordered = withIcons.names.map((name) => byName.get(name));
    // Стадии шагов в новом порядке — их видно в отчёте прогона.
    const steps = ordered.map((stage) => stage.name).filter((name) => planStages.has(name));
    const before = names.filter((name) => planStages.has(name));
    if (steps.join('>') !== before.join('>')) {
        warnings.push(`Порядок стадий задан планом: ${steps.join(' → ')}.`);
    }
    return { stages: ordered, warnings };
}
