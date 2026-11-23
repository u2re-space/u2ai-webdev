/**
 * @file src/stages/scope.js
 * @module stages/scope
 * @purpose Границы шага: какие файлы шаг может write, а какие принадлежат другому шагу.
 *
 *   План раздаёт файлы между шагами, и шаг отвечает только за свои. Границы нужны в двух
 *   местах: когда ответ роли кладётся на диск и когда роль пишет файл своим инструментом.
 *   Второе было дырой: кодер правил таблицу стилей — работу стаилиста и аниматора — и
 *   никто его не останавливал.
 *
 * @depends node:path
 * @usedBy stages/step, agent/tools
 * @exports stepScope, inScope
 * @ai.tags stages, files, scope
 * @ai.hint pure
 */

/**
 * The files of a step, and the files that belong to the other steps.
 *
 * The boundaries of a step are the files it named and the files that no other step of the
 * plan named. A file that another step owns is not written: the answer of a role does not
 * take the work of another step away, and the project keeps one version of itself.
 *
 * @param {object} step
 * @param {object|null} [plan] the plan of the run
 * @returns {{ paths: string[], owned: string[] }}
 * @exports
 * @ai.hint pure
 */
export function stepScope(step, plan = null) {
    const paths = [];
    const owned = [];
    const id = String(step?.id ?? '').trim();
    for (const file of Array.isArray(step?.files) ? step.files : []) {
        const rel = String(file ?? '').trim().replace(/\\/g, '/');
        if (rel) paths.push(rel);
    }
    const steps = Array.isArray(plan?.steps) ? plan.steps : [];
    for (const other of steps) {
        if (String(other?.id ?? '').trim() === id) continue;
        for (const file of Array.isArray(other?.files) ? other.files : []) {
            const rel = String(file ?? '').trim().replace(/\\/g, '/');
            if (rel) owned.push(rel);
        }
    }
    return { paths, owned };
}

/**
 * Is the file inside the boundaries of the step?
 *
 * The file of this step is its own — the step named it, or it lies in a directory the step
 * named. The file of another step is not: that file is the work of that step, and the
 * answer of this role does not get to write over it.
 *
 * @param {string} rel
 * @param {{ paths?: string[], owned?: string[] }|null} scope
 * @returns {boolean}
 * @exports
 * @ai.hint pure
 */
export function inScope(rel, scope) {
    if (!scope) return true;
    const name = String(rel ?? '').trim().replace(/\\/g, '/');
    if (!name) return false;
    const owns = (item) => {
        const own = String(item ?? '').replace(/\\/g, '/').replace(/\/+$/, '');
        if (!own) return false;
        return name === own || name.startsWith(`${own}/`);
    };
    for (const item of Array.isArray(scope.paths) ? scope.paths : []) {
        if (owns(item)) return true;
    }
    for (const item of Array.isArray(scope.owned) ? scope.owned : []) {
        if (owns(item)) return false;
    }
    return true;
}
