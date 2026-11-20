/**
 * @file src/stages/style-entry.js
 * @module stages/style-entry
 * @purpose Стили проекта: один файл, один язык, одно имя для всех ролей.
 *
 *   Роли говорили о стилях по-разному: разметка писала в HTML `styles.css`, а стилист
 *   писал `styles.scss`. Имя файла стилей — не мнение роли, а факт проекта: план
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
 * @depends node:path
 * @usedBy stages/architect
 * @exports STYLE_LANGUAGES, styleFiles, styleEntry, styleLanguage, styleEntryOf
 * @ai.tags styles, plan, contract
 * @ai.hint pure
 */

import path from 'node:path';

/** Языки, которые дом знает. */
export const STYLE_LANGUAGES = Object.freeze(['scss', 'sass', 'css', 'less']);

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
 * Стили проекта: исходник, ссылка и язык.
 *
 * Исходник — то, что пишет стилист и что импортирует скрипт. Ссылка — то, что грузит
 * браузер: сборка кладёт её рядом с исходником. Для обычного css это тот же файл.
 *
 * @param {{ plan?: object|null, architecture?: object|null, config?: object|null }} [request]
 * @returns {{ source: string, link: string, language: string, from: string }}
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
    return { source, link, language, from };
}

/**
 * Стили проекта для стадии: то, что архитектура назвала, или то, что она должна была.
 *
 * Архитектура хранит контракт в себе, и стадия читает его оттуда. Но прогон, начатый
 * до этого, контракта в архитектуре не несёт — тогда стиль считается заново, по плану.
 *
 * @param {{ plan?: object|null, architecture?: object|null, config?: object|null }} [request]
 * @returns {{ source: string, link: string, language: string, from: string }}
 * @exports
 * @ai.hint pure
 */
export function stylesOf({ plan = null, architecture = null, config = null } = {}) {
    const stored = architecture?.styles ?? null;
    if (stored?.source && stored?.link) return stored;
    return styleEntryOf({ plan, architecture, config });
}
