/**
 * @file src/stages/roles.js
 * @module stages/roles
 * @purpose Роли, чьи шаги исполняют стадии прогона, и угадывание роли по файлам шага.
 *
 *   План раздаёт шаги по ролям, и каждая стадия забирает свои шаги по имени роли. Роль,
 *   которую не забирает ни одна стадия, — это шаг, который никто не сделает: план обещает
 *   работу, а прогон её не делает, и никто об этом не говорит. Так и потерялись шаги с
 *   ролью `planner`: роль знает реестр ролей, но её не исполняет ни одна стадия.
 *
 *   Здесь — список живых ролей (роль и стадия, которая берёт её шаги) и правило угадывания:
 *   роль шага, который назвал не ту, определяется по расширению файлов. Угадать нельзя —
 *   шаг выпадает из плана, и об этом говорит предупреждение.
 *
 * @depends node:path
 * @usedBy stages/plan, roles/planner
 * @exports LIVE_ROLES, LIVE_ROLE_NAMES, liveRole, stageForRole, roleForFiles, planRole,
 *          foreignFiles, withoutForeignFiles
 * @ai.tags stages, roles, plan
 * @ai.hint pure
 * @ai.hint legacy-0.2
 * @changed 2026-11-15 Роль шага — та, что исполняет стадия: план больше не обещает шаги,
 *          которые никто не сделает.
 */

import path from 'node:path';

/**
 * Живые роли: роль шага — и стадия, которая берёт её шаги.
 *
 * Стадия `setup` здесь не стоит: окружение готовится для всего прогона, а не по шагам.
 *
 * Имена ролей и имена стадий не всегда совпадают: векторную графику рисует роль
 * `editor`, а стадия, которая берёт её шаги, называется `vector`; иконки выбирает роль
 * `iconifier`, а её стадия — `iconify`. Здесь лежит карта: роль → стадия.
 * @type {Readonly<Record<string, string>>}
 */
export const LIVE_ROLES = Object.freeze({
    markup: 'markup',
    coder: 'coding',
    styler: 'styling',
    animator: 'animation',
    editor: 'vector',
    iconifier: 'iconify',
    illustrator: 'assets',
});

/** Имена живых ролей. */
export const LIVE_ROLE_NAMES = Object.freeze(Object.keys(LIVE_ROLES));

/**
 * Расширение файла — и роль, которая такой файл пишет.
 *
 * Картинки здесь не стоят: растровую картинку готовит стадия `pictures`, а векторную
 * рисует роль `editor`.
 * @type {Readonly<Record<string, string>>}
 */
const ROLE_BY_EXTENSION = Object.freeze({
    '.html': 'markup',
    '.htm': 'markup',
    '.vue': 'markup',
    '.svelte': 'markup',
    '.js': 'coder',
    '.mjs': 'coder',
    '.cjs': 'coder',
    '.jsx': 'coder',
    '.ts': 'coder',
    '.tsx': 'coder',
    '.md': 'coder',
    '.txt': 'coder',
    '.yml': 'coder',
    '.yaml': 'coder',
    '.css': 'styler',
    '.scss': 'styler',
    '.sass': 'styler',
    '.less': 'styler',
    '.svg': 'editor',
});

/**
 * Файлы окружения: их готовит стадия `setup`, а не роль шага.
 *
 * Манифест и конфиг сборки не пишет роль шага: их пишет установщик, и он же ставит
 * зависимости. Шаг, который просит роль `installer` написать `package.json`, не должен
 * попасть в план: иначе роль кода перепишет манифест.
 * @type {RegExp}
 */
const ENVIRONMENT_FILES = /^(?:package\.json|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|npm-shrinkwrap\.json|bun\.lockb?|tsconfig(?:\.[\w-]+)?\.json|jsconfig\.json|vite\.config\.[jt]s|webpack\.config\.[jt]s|rollup\.config\.[jt]s|esbuild\.config\.[jt]s|\.gitignore|\.npmrc|\.nvmrc|\.editorconfig|\.env(?:\..+)?)$/i;

/**
 * Живая ли роль.
 * @param {string} role
 * @returns {string|null} имя роли или null
 * @exports
 * @ai.hint pure
 */
export function liveRole(role) {
    const key = String(role ?? '').trim().toLowerCase();
    return LIVE_ROLE_NAMES.includes(key) ? key : null;
}

/**
 * Стадия, которая исполняет роль.
 * @param {string} role
 * @returns {string|null} имя стадии или null
 * @exports
 * @ai.hint pure
 */
export function stageForRole(role) {
    const key = liveRole(role);
    return key ? LIVE_ROLES[key] : null;
}

/**
 * Роль шага, угаданная по его файлам.
 *
 * Угадывает та роль, которой принадлежит первый файл шага: разметка — разметке, стили —
 * стилям. Файлы окружения не угадываются: их готовит стадия `setup`.
 * @param {string[]} files
 * @returns {string|null} имя роли или null
 * @exports
 * @ai.hint pure
 */
export function roleForFiles(files = []) {
    const list = Array.isArray(files) ? files : [];
    for (const file of list) {
        const rel = String(file ?? '').trim().replace(/\\/g, '/');
        if (!rel) continue;
        const name = path.posix.basename(rel);
        if (ENVIRONMENT_FILES.test(name)) continue;
        const role = ROLE_BY_EXTENSION[path.posix.extname(name).toLowerCase()];
        if (role) return role;
    }
    return null;
}

/**
 * Роль шага: та, что названа, или та, что угадывается по файлам.
 *
 * Шаг, который состоит только из файлов окружения, убирается из плана, кем бы он ни был
 * назван: окружение готовит стадия `setup` для всего прогона, и шаг кодера с манифестом
 * уводит роль в чужую работу — установку зависимостей и правку lock-файла.
 *
 * Шаг, который называет чужой файл, теряет этот файл: `index.html` принадлежит разметке,
 * и шаг иллюстратора, который просит ещё и разметку, отдаёт её тому, кому она принадлежит.
 * Файл остаётся в плане — он всё равно нужен кому-то, — но шаг за него не отвечает.
 *
 * @param {string} role роль, которую назвал планировщик
 * @param {string[]} files файлы шага
 * @returns {{ role: string|null, dropped: boolean, warning: string|null }}
 * @exports
 * @ai.hint pure
 */
export function planRole(role = '', files = []) {
    const named = String(role ?? '').trim().toLowerCase();
    const list = (Array.isArray(files) ? files : [])
        .map((item) => String(item ?? '').trim().replace(/\\/g, '/'))
        .filter(Boolean);
    const who = named ? `роль "${named}"` : 'роль не названа';

    const environment = list.filter((file) => ENVIRONMENT_FILES.test(path.posix.basename(file)));
    if (list.length && environment.length === list.length) {
        return {
            role: null,
            dropped: true,
            warning: `шаг состоит только из файлов окружения (${environment.join(', ')}) — их готовит `
                + 'стадия setup, шаг убран из плана.',
        };
    }

    const live = liveRole(named);
    if (live) return { role: live, dropped: false, warning: null };
    const guessed = roleForFiles(list);
    if (guessed) {
        return {
            role: guessed,
            dropped: false,
            warning: `${who} не исполняется ни одной стадией — взята роль "${guessed}" по файлам шага.`,
        };
    }

    const reason = environment.length
        ? `а её файлы (${environment.join(', ')}) готовит стадия setup`
        : `и по файлам шага её угадать нельзя (${list.join(', ') || 'файлы не названы'})`;
    return {
        role: null,
        dropped: true,
        warning: `${who} не исполняется ни одной стадией, ${reason} — шаг убран из плана.`,
    };
}

/**
 * Файлы шага, которые принадлежат другой роли.
 *
 * План раздаёт файлы между шагами, и роль не должна брать чужое: `index.html` — работа
 * разметки, а шаг иллюстратора, который просит ещё и разметку, отдаёт её тому, кому она
 * принадлежит. Остальные файлы шага остаются за ролью.
 *
 * @param {string} role роль шага
 * @param {string[]} files файлы шага
 * @returns {string[]} чужие файлы
 * @exports
 * @ai.hint pure
 */
export function foreignFiles(role = '', files = []) {
    const who = String(role ?? '').trim().toLowerCase();
    const list = (Array.isArray(files) ? files : [])
        .map((item) => String(item ?? '').trim().replace(/\\/g, '/'))
        .filter(Boolean);
    if (!who || !list.length) return [];
    const out = [];
    for (const rel of list) {
        const owner = roleForFiles([rel]);
        // Файл без вида (папка, файл неизвестного вида) остаётся за шагом: его роль не
        // знает, и отдать его некому.
        if (!owner || owner === who) continue;
        out.push(rel);
    }
    return out;
}

/**
 * План без чужих файлов в шагах.
 *
 * План на диске — это план, который был составлен когда-то: роль могла назвать файл,
 * который принадлежит другой роли. Читать такой план — значит отдать роль чужую
 * работу: шаг иллюстратора, в котором назван `index.html`, переписывает разметку.
 * План читается без чужих файлов, и прогон говорит, что отдано.
 *
 * @param {object|null} plan
 * @returns {{ plan: object|null, warnings: string[] }}
 * @exports
 * @ai.hint pure
 */
export function withoutForeignFiles(plan = null) {
    const steps = Array.isArray(plan?.steps) ? plan.steps : [];
    if (!steps.length) return { plan, warnings: [] };
    const warnings = [];
    const out = [];
    for (const step of steps) {
        const role = String(step?.role ?? '').trim().toLowerCase();
        const files = Array.isArray(step?.files) ? step.files : [];
        const foreign = foreignFiles(role, files);
        if (!foreign.length) {
            out.push(step);
            continue;
        }
        const own = files.filter((file) => !foreign.includes(file));
        warnings.push(`Шаг ${step?.id ?? 'шаг'}: чужие файлы отданы их ролям: ${foreign.join(', ')}.`);
        if (!own.length) continue;
        out.push({ ...step, files: own });
    }
    return { plan: { ...plan, steps: out }, warnings };
}
