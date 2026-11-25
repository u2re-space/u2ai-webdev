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
 * @exports PLAN_STAGES, STYLE_CODE_PHASES, planEdges, planOrder, placeGraphicsStage,
 *          placeIconifyStage
 * @ai.tags stages, plan, order
 * @ai.hint pure
 * @changed 2026-11-15 Порядок стадий, которые делают шаги плана, задаёт сам план.
 * @changed 2026-11-20 Круг зависимостей рвётся порядком реестра, а не отменяет план.
 * @changed 2026-11-20 Стадия вектора не стоит в середине: до разметки или в самом конце.
 * @changed 2026-11-20 Стадия иконок стоит после стилиста.
 * @changed 2026-11-24 Фазы стилей и кода: скелет кода, черновик контракта, полные стили,
 *                       полный код. Скелет растёт из разметки, стили одевают скелет.
 * @changed 2026-11-24 Стадия ассетов стоит после разметки: разметка линкует картинки
 *                     по именам из контекста, и круг между ними не возникает.
 */

import { LIVE_ROLES, ROLE_STAGES, stageForRole } from './roles.js';

/**
 * Стадии, которые исполняют шаги плана.
 *
 * Шаг роли исполняют все её стадии: черновик контракта и полная работа. Поэтому в
 * графе стадий шаг роли стоит сразу за всеми её стадиями — иначе план, где шаг кода
 * зависит от шага стилей, связал бы только полные стадии, а черновики остались бы
 * вне зависимостей.
 * @type {ReadonlySet<string>}
 */
export const PLAN_STAGES = Object.freeze(new Set([
    ...Object.values(LIVE_ROLES),
    ...Object.values(ROLE_STAGES).flat(),
]));

/**
 * Стадия, которая исполняет шаг.
 *
 * Шаг роли исполняют несколько стадий: черновик контракта и полная работа. В графе
 * стадий шаг стоит за последней из них — той, что делает работу целиком: зависимость
 * «шаг кода зависит от шага стилей» говорит, что полный код ждёт полных стилей.
 * @param {object} step
 * @returns {string|null} имя стадии или null
 * @ai.hint pure
 */
function stageOfStep(step) {
    return stageForRole(step?.role);
}

/**
 * Нарушает ли ребро порядок фаз стилей и кода?
 *
 * Пол фаз сильнее плана: план может попросить код раньше стилей, но фазы стоят в
 * своём порядке всегда. Ребро, которое против него, отбрасывается — иначе в графе
 * появляется круг, и порядок решает не порядок фаз, а случай.
 * @param {string} from
 * @param {string} to
 * @returns {boolean}
 * @ai.hint pure
 */
function breaksPhaseOrder(from, to) {
    const a = STYLE_CODE_PHASES.indexOf(from);
    const b = STYLE_CODE_PHASES.indexOf(to);
    if (a < 0 || b < 0) return false;
    return a > b;
}

/**
 * Рёбра плана между стадиями: шаг зависит от шага — стадия зависит от стадии.
 *
 * Шаги одной роли не дают ребра: их работа и так идёт по порядку шагов внутри стадии.
 *
 * Ребро, которое противоречит порядку фаз, отбрасывается: план может просить код
 * раньше стилей, но фазы стоят в своём порядке всегда — иначе граф получает круг,
 * который разрывается случайно.
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
    const againstPhases = [];
    for (const step of steps) {
        const id = String(step?.id ?? '').trim();
        const to = stageOf.get(id);
        if (!to) continue;
        for (const dep of Array.isArray(step?.dependsOn) ? step.dependsOn : []) {
            const from = stageOf.get(String(dep ?? '').trim());
            if (!from || from === to) continue;
            if (breaksPhaseOrder(from, to)) {
                // План просит порядок, который противоречит полу фаз. Пол сильнее, и
                // прогон говорит об этом: иначе план молча делает не то, что написано.
                if (!againstPhases.includes(`${from}>${to}`)) againstPhases.push(`${from}>${to}`);
                continue;
            }
            // Иконки не ждут письма: они кладутся в разметку, которая уже есть, и
            // разметка не ждёт их — роль письма сама решает, как назвать значок.
            //
            // Без этого правила план, где шаг стилей зависит от шага иконок, а шаг
            // иконок — от шага разметки, даёт круг `write → iconify → write`. Круг
            // разрывался бы случаем, и стадия письма вставала бы после сборки.
            if (from === 'iconify' && to === 'write') continue;
            const key = `${from}>${to}`;
            if (seen.has(key)) continue;
            seen.add(key);
            edges.push([from, to]);
        }
    }
    // Стадии одной роли идут по порядку: скелет кода — раньше полной работы.
    // Без этого ребра план, где шаг стилей зависит от шага кода, мог бы поставить
    // полные стили раньше скелета кода — а стили одевают ровно то, что скелет назвал.
    for (const [role, list] of Object.entries(ROLE_STAGES)) {
        for (let i = 0; i + 1 < list.length; i += 1) {
            const key = `${list[i]}>${list[i + 1]}`;
            if (seen.has(key)) continue;
            seen.add(key);
            edges.push([list[i], list[i + 1]]);
        }
        void role;
    }
    // Фазы разных ролей тоже стоят в порядке: скелет кода — раньше черновика стилей,
    // а черновик стилей — раньше полных стилей. Иначе стили одевали бы пустоту.
    for (const [from, to] of STYLE_CODE_PHASES.slice(0, -1).map((name, i) => [name, STYLE_CODE_PHASES[i + 1]])) {
        const key = `${from}>${to}`;
        if (seen.has(key)) continue;
        seen.add(key);
        edges.push([from, to]);
    }
    return { edges, broken: againstPhases };
}

/**
 * Стадия вектора и её место в цепочке.
 *
 * Ассеты рисует редактор, и разметка их подключает по именам из контекста. Ставить
 * стадию вектора между разметкой и сборкой нельзя: картинка, нарисованная после
 * разметки, ещё может быть подключена ею по имени, но ассет, которого нет при сборке,
 * в дистрибутив не попадает. Стадия вектора стоит либо до разметки, либо в самом конце
 * цепочки — после сборки и взгляда на страницу.
 *
 * Когда разметка уже позади (продолжение прогона), вектор встаёт до сборки: сборка
 * переносит `public/` в бандл, и ассет, нарисованный после неё, в дистрибутив не
 * попадает.
 */
const GRAPHICS_STAGE = 'graphics';
const GRAPHICS_BEFORE = 'write';
const GRAPHICS_AFTER = 'sight';
const GRAPHICS_BEFORE_BUILD = 'build';
const ICONIFY_STAGE = 'iconify';
const ICONIFY_AFTER = 'write';
const WRITE_STAGE = 'write';

/**
 * Стадия письма.
 *
 * Фаз больше нет: разметку, стили, код и движение пишет одна стадия `write` и одна
 * роль `builder`. Порядок внутри неё задаёт план, а не реестр: шаг идёт после тех
 * шагов, от которых он зависит.
 *
 * Раньше здесь стояли четыре фазы — `pre-coding`, `pre-styling`, `styling`, `coding` —
 * и порядок между ними был полом: он рвал круг плана, когда тот просил код раньше
 * стилей. Теперь круга нет: стадия одна, и порядок внутри неё — дело плана.
 * @type {ReadonlyArray<string>}
 * @exports
 */
export const STYLE_CODE_PHASES = Object.freeze([
    WRITE_STAGE,
]);


/**
 * Поставить стадию графики на её место: до письма, до сборки или в конец цепочки.
 *
 * Графика — это вырезки референса, векторные рисунки и их места. Ставить её между
 * письмом и сборкой нельзя: картинка, сделанная после письма, ещё может быть
 * подключена по имени, но ассет, которого нет при сборке, в дистрибутив не попадает.
 * Стадия графики стоит либо до письма, либо в самом конце цепочки — после сборки и
 * взгляда на страницу.
 *
 * Когда письмо уже позади (продолжение прогона), графика встаёт до сборки: сборка
 * переносит `public/` в бандл, и ассет, сделанный после неё, в дистрибутив не
 * попадает.
 *
 * @param {string[]} names имена стадий в порядке прогона
 * @returns {{ names: string[], moved: boolean, reason: string|null }}
 * @exports
 * @ai.hint pure
 */
export function placeGraphicsStage(names = []) {
    const list = Array.isArray(names) ? [...names] : [];
    const at = (name) => list.indexOf(name);
    const graphics = at(GRAPHICS_STAGE);
    if (graphics < 0) return { names: list, moved: false, reason: null };
    const writing = at(GRAPHICS_BEFORE);

    if (writing >= 0) {
        if (graphics < writing) return { names: list, moved: false, reason: null };
        // Графика после письма: в середине цепочки она не стоит — только в конце.
        const sight = at(GRAPHICS_AFTER);
        if (sight >= 0 && graphics < sight) {
            list.splice(graphics, 1);
            const target = list.indexOf(GRAPHICS_AFTER);
            list.splice(target < 0 ? list.length : target + 1, 0, GRAPHICS_STAGE);
            return { names: list, moved: true, reason: 'end' };
        }
        if (sight < 0 && graphics < list.length - 1) {
            // Взгляда в прогоне нет: графика уходит в конец цепочки.
            list.splice(graphics, 1);
            list.push(GRAPHICS_STAGE);
            return { names: list, moved: true, reason: 'end' };
        }
        return { names: list, moved: false, reason: null };
    }

    // Письма в прогоне нет: оно уже сделано. Графика должна встать до сборки, иначе
    // ассеты не попадут в бандл.
    const build = at(GRAPHICS_BEFORE_BUILD);
    if (build >= 0 && graphics > build) {
        list.splice(graphics, 1);
        list.splice(list.indexOf(GRAPHICS_BEFORE_BUILD), 0, GRAPHICS_STAGE);
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
    // Якорь — стадия письма: иконки ложатся в разметку, которую уже написали.
    const anchor = ICONIFY_AFTER;
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
 * @param {{ config?: object|null }} [options] конфигурация прогона: вид страницы
 * @returns {{ stages: object[], warnings: string[] }}
 * @exports
 * @ai.hint pure
 */
export function planOrder(stages = [], plan = null, { config = null } = {}) {
    const list = Array.isArray(stages) ? [...stages] : [];
    const warnings = [];
    if (list.length < 2) return { stages: list, warnings };

    const names = list.map((stage) => stage.name);
    const known = new Set(names);
    const planStages = new Set(names.filter((name) => PLAN_STAGES.has(name)));
    if (planStages.size < 2) return { stages: list, warnings };

    const { edges, broken } = planEdges(plan);
    if (broken?.length) {
        warnings.push(`План просит порядок, который противоречит фазам стилей и кода `
            + `(${broken.join(', ')}) — порядок фаз сильнее: скелет кода, черновик `
            + 'контракта стилей, полные стили, полный код.');
    }
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
    const circle = [];
    while (out.length < names.length) {
        if (!ready.length) {
            // Круг: первым идёт та стадия, что раньше в реестре, и её рёбра теряют силу.
            const name = names.find((item) => !done.has(item) && !ready.includes(item));
            if (!name) break;
            circle.push(name);
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
    if (circle.length) {
        warnings.push(`План задаёт круг зависимостей между стадиями (${circle.join(', ')}) — `
            + 'порядок реестра решил, кто идёт первым, остальные рёбра плана остались в силе.');
    }

    // Стадия вектора: до разметки, до сборки или в самом конце цепочки.
    const placed = placeGraphicsStage(out);
    if (placed.moved) {
        warnings.push(placed.reason === 'build'
            ? 'Стадия вектора перенесена перед сборкой: разметка уже сделана, а сборка '
                + 'переносит ассеты в бандл — нарисованное после неё в дистрибутив не попадёт.'
            : 'Стадия вектора перенесена в конец цепочки: между разметкой и сборкой она ждёт '
                + 'сама себя — разметка ждёт ассеты, которых ещё нет.');
    }

    // Фазы стилей и кода: скелет кода, черновик контракта стилей, полные стили, полный
    // код.
    //
    // Порядок фаз один для всех: страница с состоянием и страница без состояния идут
    // одинаково. Скелет растёт из разметки, стили одевают то, что скелет назвал, и
    // полный код идёт по полным стилям.

    // Разметка перед фазами стилей и кода: скелет кода растёт из разметки. Перестройка
    // фаз могла затолкать разметку в их середину — пол ставит её на место.

    // Стадия ассетов: после вектора.

    // Стадия ассетов не раньше разметки: разметка линкует картинки, которые контекст
    // уже назвал, и иллюстратор раскладывает их после. План, который связал их кругом
    // (картинки ждут разметку, стили ждут картинки), больше не ставит ассеты перед
    // разметкой — стили начинаются после разметки в любом случае.

    // Стадия анимации: после стилиста.

    // Стадия иконок: не раньше кода и не раньше стилей.
    const withIcons = placeIconifyStage(placed.names);
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
