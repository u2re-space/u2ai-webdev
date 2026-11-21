/**
 * @file src/stages/style-entry.js
 * @module stages/style-entry
 * @purpose Стили проекта: один файл, один язык, одно имя для всех ролей.
 *
 *   Роли говорили о стилях по-разному: разметка писала в HTML `styles.css`, а стилист
 *   писал `src/styles.scss`. Имя файла стилей — не мнение роли, а факт проекта: план
 *   называет файл, который пишет стилист, и этот файл — правда. Здесь факт собирается в
 *   одно место, чтобы бриф архитектуры, который читают все роли, называл одно и то же.
 *
 *   Порядок источников: план (файлы шага стилиста) — архитектура (путь модуля стилей) —
 *   дом (`src/styles.<язык>`). Язык следует за файлом: `.scss` — это scss, `.css` — это
 *   css.
 *
 *   У стилей два имени, и их нельзя путать: исходник (`src/styles.scss`) — то, что пишет
 *   стилист и что импортирует скрипт; ссылка (`src/styles.css`) — то, что грузит браузер,
 *   и это артефакт сборки, а не файл проекта. Оба имени выходят из одного места, и
 *   разметка с кодом берут своё.
 *
 *   Третье имя — как стили попадают на страницу. В проекте со сборщиком скрипт импортирует
 *   исходник, сборщик компилирует его, и разметка не linksт ни одного css: ссылка на
 *   артефакт сборки ломает сборку. В обычном проекте страница грузит скомпилированный css
 *   (его пишет сборка), и скрипт исходник не импортирует: браузер не читает scss. Роли
 *   должны знать это одно и то же — иначе разметка линкует `.scss`, а код импортирует
 *   stylesheet в проекте, где страница и так грузит css.
 *
 * @depends node:path, node:fs/promises
 * @usedBy stages/architect, stages/markup, stages/coding, stages/styling, stages/build
 * @exports STYLE_LANGUAGES, WIRINGS, styleFiles, styleEntry, styleLanguage, styleEntryOf,
 *          styleWiring, styleContract, stylesOf, scriptOf, importSpecifier, bundledProject
 * @ai.tags styles, plan, contract
 * @ai.hint pure
 * @changed 2026-11-21 Контракт стилей вырос: у него есть ещё скрипт проекта и способ, которым
 *                       стили попадают на страницу.
 */

import path from 'node:path';
import { readFile, stat } from 'node:fs/promises';

/** Языки, которые дом знает. */
export const STYLE_LANGUAGES = Object.freeze(['scss', 'sass', 'css', 'less']);

/** Способы, которыми стили попадают на страницу. */
export const WIRINGS = Object.freeze({
    /** Сборщик приносит стили: скрипт импортирует исходник, разметка не линкует css. */
    BUNDLED: 'bundled',
    /** Страница грузит скомпилированный css: разметка линкует ссылку, скрипт не импортирует. */
    LINKED: 'linked',
});

/** Фреймворки, которые приносят стили сборщиком. */
const BUNDLED_FRAMEWORKS = Object.freeze(['vite', 'react', 'vue', 'svelte', 'next', 'astro']);

/** Расширение каждого языка. */
const EXTENSION_OF = Object.freeze({
    scss: '.scss',
    sass: '.sass',
    css: '.css',
    less: '.less',
});

/** Язык по расширению файла: `.scss` и `.sass` — один язык, компилятор у них один. */
const LANGUAGE_OF = Object.freeze({
    '.scss': 'scss',
    '.sass': 'scss',
    '.css': 'css',
    '.less': 'less',
});

/** Имена точки входа стилей, от лучшей к худшей. */
const ENTRY_NAMES = Object.freeze(['main', 'styles', 'style', 'index', 'app', 'theme', 'global']);

/**
 * Файлы стилей, которые пишет план.
 *
 * Шаг роли `styler` — это стили проекта: его файлы и есть стили. Файлы других ролей
 * смотрю с осторожностью: `.css` в шаге кода — это не стили проекта, а чужой файл.
 * @param {object|null} plan план прогона
 * @returns {string[]}
 * @exports
 * @ai.hint pure
 */
export function styleFiles(plan = null) {
    const steps = Array.isArray(plan?.steps) ? plan.steps : [];
    const files = [];
    for (const step of steps) {
        if (String(step?.role ?? '').trim().toLowerCase() !== 'styler') continue;
        for (const file of Array.isArray(step?.files) ? step.files : []) {
            const rel = String(file ?? '').trim().replace(/\\/g, '/');
            if (rel) files.push(rel);
        }
    }
    return files;
}

/**
 * Файл стилей или нет такого.
 * @param {string} rel путь файла
 * @returns {boolean}
 * @exports
 * @ai.hint pure
 */
export function isStyleFile(rel = '') {
    return Object.prototype.hasOwnProperty.call(LANGUAGE_OF, path.extname(String(rel ?? '').trim().toLowerCase()));
}

/**
 * Частичный файл — это `_tokens.scss`: его подключает точка входа, и сам по себе он
 * страницу не красит.
 * @param {string} rel путь файла
 * @returns {boolean}
 * @ai.hint pure
 */
function isPartial(rel) {
    return path.posix.basename(String(rel ?? '')).startsWith('_');
}

/**
 * Точка входа среди файлов стилей.
 *
 * Частичные файлы отпадают: страницу красит тот, кого зовут. Из остальных побеждает
 * имя, известное дому (`main`, `styles`), потом путь: файл ближе к корню проекта.
 * @param {string[]} files файлы стилей
 * @returns {string|null}
 * @exports
 * @ai.hint pure
 */
export function styleEntry(files = []) {
    const list = [...new Set((Array.isArray(files) ? files : [])
        .map((item) => String(item ?? '').trim().replace(/\\/g, '/'))
        .filter(Boolean))];
    if (!list.length) return null;
    const candidates = list.filter((file) => !isPartial(file));
    const pool = candidates.length ? candidates : list;
    const rank = (file) => {
        const name = path.posix.basename(file).replace(/\.(scss|sass|css|less)$/i, '').toLowerCase();
        const index = ENTRY_NAMES.indexOf(name);
        return index === -1 ? ENTRY_NAMES.length : index;
    };
    return [...pool].sort((a, b) => (rank(a) - rank(b))
        || a.split('/').length - b.split('/').length
        || a.localeCompare(b))[0];
}

/**
 * Язык файла стилей.
 * @param {string|null} rel путь файла
 * @param {string} fallback язык, когда файл не назван
 * @returns {string}
 * @exports
 * @ai.hint pure
 */
export function styleLanguage(rel = null, fallback = 'scss') {
    const ext = path.extname(String(rel ?? '').trim().toLowerCase());
    const language = LANGUAGE_OF[ext];
    if (language) return language;
    const known = String(fallback ?? '').trim().toLowerCase();
    return STYLE_LANGUAGES.includes(known) ? known : 'scss';
}

/**
 * Скрипт проекта: файл шага кодера, который грузит страница.
 *
 * Это тот файл, относительно которого считается путь импорта стилей: `scripts/main.js`
 * импортирует `styles/main.scss` как `../styles/main.scss`.
 * @param {object|null} plan план прогона
 * @returns {string|null}
 * @exports
 * @ai.hint pure
 */
export function scriptOf(plan = null) {
    const steps = Array.isArray(plan?.steps) ? plan.steps : [];
    for (const step of steps) {
        if (String(step?.role ?? '').trim().toLowerCase() !== 'coder') continue;
        for (const file of Array.isArray(step?.files) ? step.files : []) {
            const rel = String(file ?? '').trim().replace(/\\/g, '/');
            if (/\.(?:m?js|cjs|jsx|ts|tsx)$/i.test(rel)) return rel;
        }
    }
    return null;
}

/**
 * Путь импорта стилей: имя файла относительно скрипта.
 * @param {string} scriptRel путь скрипта
 * @param {string} styleRel путь стилей
 * @returns {string}
 * @exports
 * @ai.hint pure
 */
export function importSpecifier(scriptRel, styleRel) {
    const dir = path.posix.dirname(String(scriptRel ?? ''));
    const rel = dir === '.' ? String(styleRel ?? '') : path.posix.relative(dir, String(styleRel ?? ''));
    if (!rel) return './';
    return rel.startsWith('.') ? rel : `./${rel}`;
}

/**
 * Собирает ли сборщик проект стили.
 *
 * Конфиг сборщика — доказательство, манифест — второе: проект может пользоваться сборщиком и
 * без своего конфига. Манifest читается с диска: стек архитектуры отвечает на вопрос о
 * проекте, который ещё не создан.
 * @param {string} root корень проекта
 * @returns {Promise<boolean>}
 * @exports
 * @ai.hint io
 */
export async function bundledProject(root) {
    if (!root) return false;
    const names = ['vite.config.js', 'vite.config.mjs', 'vite.config.ts', 'vite.config.mts', 'vite.config.cjs'];
    for (const name of names) {
        const found = await stat(path.join(root, name)).then((info) => info.isFile()).catch(() => false);
        if (found) return true;
    }
    const text = await readFile(path.join(root, 'package.json'), 'utf8').catch(() => null);
    if (text === null) return false;
    let manifest = null;
    try {
        manifest = JSON.parse(text);
    } catch {
        return false;
    }
    return Boolean(manifest?.dependencies?.vite || manifest?.devDependencies?.vite);
}

/**
 * Есть ли манифест у проекта.
 * @param {string} root корень проекта
 * @returns {Promise<boolean>}
 * @ai.hint io
 */
async function hasManifest(root) {
    const found = await stat(path.join(root, 'package.json')).then((info) => info.isFile()).catch(() => false);
    return found;
}

/**
 * Как стили попадают на страницу.
 *
 * Манифест проекта — правда: проект, который собирается сборщиком, приносит стили импортом
 * из скрипта, и разметка не линкует css. Проект без манифеста отвечает стеком.
 * @param {{ root?: string|null, config?: object|null, architecture?: object|null }} [request]
 * @returns {Promise<string>} `bundled` или `linked`
 * @exports
 * @ai.hint io
 */
export async function styleWiring({ root = null, config = null, architecture = null } = {}) {
    const framework = String(
        architecture?.stack?.framework ?? config?.stack?.frontendFramework ?? '',
    ).trim().toLowerCase();
    if (root) {
        if (await bundledProject(root)) return WIRINGS.BUNDLED;
        // Манифест есть и сборщика в нём нет: страница грузит скомпилированный css.
        if (await hasManifest(root)) return WIRINGS.LINKED;
    }
    return BUNDLED_FRAMEWORKS.includes(framework) ? WIRINGS.BUNDLED : WIRINGS.LINKED;
}

/**
 * Стили проекта: исходник, ссылка и язык.
 *
 * Исходник — то, что пишет стилист и что импортирует скрипт. Ссылка — то, что грузит
 * браузер: сборка кладёт её рядом с исходником. Для обычного css это тот же файл.
 *
 * @param {{ plan?: object|null, architecture?: object|null, config?: object|null }} [request]
 * @returns {{ source: string, link: string, language: string, from: string, script: string|null }}
 * @exports
 * @ai.hint pure
 */
export function styleEntryOf({ plan = null, architecture = null, config = null } = {}) {
    const stack = architecture?.stack ?? {};
    const fallback = styleLanguage(null, stack.style ?? config?.stack?.styleLanguage ?? 'scss');
    const modules = Array.isArray(architecture?.modules) ? architecture.modules : [];
    const planned = styleEntry(styleFiles(plan));
    const named = styleEntry(modules.map((item) => String(item?.path ?? '')).filter(isStyleFile));
    const from = planned ? 'plan' : (named ? 'architecture' : 'house');
    const source = planned ?? named ?? `src/styles${EXTENSION_OF[fallback] ?? EXTENSION_OF.scss}`;
    const language = styleLanguage(source, fallback);
    // Собирается только то, что дом умеет собирать: из `.less` CSS не получается.
    const link = language === 'scss' ? source.replace(/\.(scss|sass)$/i, EXTENSION_OF.css) : source;
    return { source, link, language, from, script: scriptOf(plan) };
}

/**
 * Контракт стилей целиком: имена, язык, скрипт и способ, которым стили попадают на
 * страницу.
 *
 * @param {{ plan?: object|null, architecture?: object|null, config?: object|null, root?: string|null }} [request]
 * @returns {Promise<{ source: string, link: string, language: string, from: string,
 *   script: string|null, import: string|null, wiring: string }>}
 * @exports
 * @ai.hint io
 */
export async function styleContract({ plan = null, architecture = null, config = null, root = null } = {}) {
    const base = styleEntryOf({ plan, architecture, config });
    const wiring = await styleWiring({ root, config, architecture });
    const script = base.script ?? scriptOf(plan);
    return {
        ...base,
        script,
        import: script ? importSpecifier(script, base.source) : null,
        wiring,
    };
}

/**
 * Стили проекта для стадии: то, что архитектура назвала, или то, что она должна была.
 *
 * Архитектура хранит контракт в себе, и стадия читает его оттуда. Но прогон, начатый
 * до этого, контракта в архитектуре не несёт — тогда стиль считается заново, по плану.
 *
 * Способ, которым стили попадают на страницу, считается по диску всякий раз: проект
 * создаётся после архитектуры, и манифест решает, собирает его сборщик или нет.
 *
 * @param {{ plan?: object|null, architecture?: object|null, config?: object|null, root?: string|null }} [request]
 * @returns {Promise<{ source: string, link: string, language: string, from: string,
 *   script: string|null, import: string|null, wiring: string }>}
 * @exports
 * @ai.hint io
 */
export async function stylesOf({ plan = null, architecture = null, config = null, root = null } = {}) {
    const stored = architecture?.styles ?? null;
    const base = stored?.source && stored?.link
        ? { ...styleEntryOf({ plan, architecture, config }), ...stored }
        : styleEntryOf({ plan, architecture, config });
    const wiring = await styleWiring({ root, config, architecture });
    const script = base.script ?? scriptOf(plan);
    return {
        ...base,
        script,
        import: script ? importSpecifier(script, base.source) : null,
        wiring,
    };
}
