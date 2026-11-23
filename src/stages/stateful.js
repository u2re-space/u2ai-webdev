/**
 * @file src/stages/stateful.js
 * @module stages/stateful
 * @purpose Страница с состоянием: SPA, PWA, роутер, приложение.
 *
 *   Такая страница рисуется скриптом: без него на экране пусто, и стилист, который
 *   смотрит на страницу, видит пустоту и считает виноватыми стили. Он начинает их
 *   править, а правка не помогает — скрипта всё ещё нет. Так прогон и стоит.
 *
 *   Порядок для такой страницы другой: разметка, потом скрипты состояния, потом
 *   стили, потом остальной код. Стили и скрипты состояния пишутся по одному контракту —
 *   тому, что назвал архитектор, — и ждать друг друга они не могут.
 *
 * @depends config/constants
 * @usedBy stages/plan-order, stages/styling, cli/run
 * @exports STATEFUL_KINDS, STATEFUL_FRAMEWORKS, isStateful
 * @ai.tags stages, order, state
 * @ai.hint pure
 */

/** The kinds of a task whose page has a state. */
export const STATEFUL_KINDS = Object.freeze(['app', 'site']);

/** The frameworks whose page has a state by their nature. */
export const STATEFUL_FRAMEWORKS = Object.freeze(['react', 'vue', 'svelte', 'next', 'astro', 'lure', 'ssre']);

/**
 * Does the page of this run have a state?
 *
 * The answer comes from the config: `stack.stateful` says it outright (`true` / `false`),
 * and `auto` — from the kind of the task and from the framework of the stack. A landing is
 * a page without a state; an app and a site are pages with one; a framework that renders
 * itself (`react`, `vue`, `svelte`, `next`, `astro`) is a page with one by its nature.
 *
 * @param {{ config?: object|null }} request
 * @returns {boolean}
 * @exports
 * @ai.hint pure
 */
export function isStateful({ config = null } = {}) {
    const asked = config?.stack?.stateful;
    if (asked === true) return true;
    if (asked === false) return false;
    const kind = String(config?.agent?.kind ?? '').trim().toLowerCase();
    if (kind && STATEFUL_KINDS.includes(kind)) return true;
    if (kind === 'landing' || kind === 'component') return false;
    const framework = String(config?.stack?.frontendFramework ?? '').trim().toLowerCase();
    if (framework && STATEFUL_FRAMEWORKS.includes(framework)) return true;
    // Без вида задачи и без фреймворка: страница без состояния — безопасный выбор.
    return false;
}
