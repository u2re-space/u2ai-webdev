/**
 * @file src/roles/style-note.js
 * @module roles/style-note
 * @purpose Что говорить ролям о стилях: как стили попадают на страницу в этом проекте.
 *
 *   У стилей проекта два имени: исходник (`src/styles.scss`) — то, что пишет стилист, и
 *   ссылка (`src/styles.css`) — то, что грузит браузер. И третий факт: как они соединены.
 *   В проекте со сборщиком скрипт импортирует исходник, сборщик компилирует его, и
 *   разметка не линкует ни одного css. В обычном проекте страница грузит скомпилированный
 *   css, и скрипт исходник не импортирует: браузер не читает scss.
 *
 *   Роли, которые говорили о стилях по-разному, и ломали проект: разметка линковала
 *   исходник (браузер его не читает), код импортировал артефакт сборки (он устареет), а
 *   ревьюер требовал того, чего в проекте быть не должно. Здесь один контракт — и одна
 *   формулировка для каждой роли.
 *
 * @depends stages/style-entry
 * @usedBy roles/markup, roles/coder, roles/styler, roles/reviewer, roles/auditor
 * @exports WIRING, markupStyleNote, coderStyleNote, stylerStyleNote, reviewStyleNote
 * @ai.tags roles, styles, contract
 * @ai.hint pure
 * @changed 2026-11-21 Контракт стилей получил способ, которым стили попадают на страницу.
 * @changed 2026-11-21 Разметка html в проекте со сборщиком линкует исходник стилей: сборщик
 *                       компилирует его из ссылки, и стили грузятся без JavaScript.
 */

import { WIRINGS } from '../stages/style-entry.js';

/** Способы, которыми стили попадают на страницу. */
export const WIRING = WIRINGS;

/**
 * Имена стилей проекта: исходник и ссылка.
 * @param {object} styles контракт стилей
 * @returns {{ source: string, link: string, language: string, script: string|null, import: string|null }}
 * @ai.hint pure
 */
function names(styles = {}) {
    return {
        source: String(styles?.source ?? '').trim(),
        link: String(styles?.link ?? '').trim(),
        language: String(styles?.language ?? 'scss').trim() || 'scss',
        script: String(styles?.script ?? '').trim() || null,
        import: String(styles?.import ?? '').trim() || null,
    };
}

/**
 * Что говорить разметке о стилях.
 *
 * **Ссылка `<link>` на исходник препроцессора не работает.** Сборщик (Vite, webpack)
 * компилирует `.scss`/`.sass`/`.less` только там, где до него доходит импорт из
 * JavaScript или из другого css. `<link rel="stylesheet" href="styles.scss">` браузер
 * отдаёт как есть, и он не понимает sass: страница остаётся без стилей, а сборка
 * проходит **успешно** — молча, без единой ошибки. Стилей нет, и никто не сказал
 * почему.
 *
 * Поэтому:
 *
 * - проект на html со сборщиком: **разметка не линкует стили вовсе**, а скрипт
 *   импортирует исходник — сборщик компилирует его и кладёт css в бандл;
 * - проект на html без сборщика: разметка линкует **скомпилированный** css
 *   (`${link}`), и сборка пишет его рядом с исходником;
 * - разметка на языке приложения (`jsx`, `vue`, `svelte`): только импорт — и это
 *   говорит кодеру.
 *
 * @param {object} styles контракт стилей
 * @returns {string}
 * @exports
 * @ai.hint pure
 */
export function markupStyleNote(styles = {}) {
    const { source, link, language, script } = names(styles);
    if (!source) return '';
    const scriptPart = script
        ? ` The script of the project is \`${script}\`: the body of the page loads it with \`<script type="module" src="${script}">\`.`
        : '';
    const frameworkMarkup = ['jsx', 'tsx', 'vue', 'svelte'].includes(String(styles?.markup ?? '').trim().toLowerCase());
    if (styles?.wiring === WIRINGS.BUNDLED && !frameworkMarkup) {
        return `The styles of the project: the stylesheet is \`${source}\` (${language}), and the **script of the project imports it** — the bundler of the project compiles that import and puts the css of the page into the bundle. `
            + '**The head of the page has no `<link rel="stylesheet">`.** A link to the stylesheet '
            + `(\`<link rel="stylesheet" href="${source}">\`) does not work here: the browser cannot read `
            + `${language}, and a bundler compiles a stylesheet only when something imports it — the build `
            + 'would pass and the page would have no styles at all, with no error to explain it. '
            + `Do not link \`${link}\` either: that name is the artifact of a build without the bundler.`
            + scriptPart;
    }
    if (styles?.wiring === WIRINGS.BUNDLED) {
        return `The styles of the project: the stylesheet is \`${source}\` (${language}), and the bundler of the project brings it — the script of the project imports \`${source}\` and the bundler compiles it. The page does not link a stylesheet: there is no \`<link rel="stylesheet">\` in the head, and a link to \`${link}\` breaks the build — that file is an artifact of the bundler, not a file of the project.${scriptPart}`;
    }
    return `The styles of the project: the stylesheet is \`${source}\` (${language}), and the page loads \`${link}\`: the compiled css of that stylesheet, which the build writes next to the source. The head of the page links that exact path — \`${link}\`, never \`${source}\`: a browser cannot read ${language}.${scriptPart}`;
}

/**
 * Что говорить кодеру о стилях.
 * @param {object} styles контракт стилей
 * @returns {string}
 * @exports
 * @ai.hint pure
 */
export function coderStyleNote(styles = {}) {
    const { source, link, language, script, import: specifier } = names(styles);
    if (!source) return '';
    // Разметка на языке приложения не линкует стили: там импорт — единственный путь.
    const frameworkMarkup = ['jsx', 'tsx', 'vue', 'svelte'].includes(String(styles?.markup ?? '').trim().toLowerCase());
    if (styles?.wiring === WIRINGS.BUNDLED && !frameworkMarkup) {
        const how = specifier && script
            ? ` — \`import '${specifier}';\` from \`${script}\`, the path is relative to the script`
            : '';
        return `The styles of the project: the stylesheet is \`${source}\` (${language}), and the **script of the project imports it**${how}. `
            + 'That import is the only way to the styles: the bundler of the project compiles the '
            + 'stylesheet where something imports it, and a `<link rel="stylesheet">` in the head '
            + 'would not be compiled at all — the build would pass, and the page would have no '
            + 'styles. The markup of the project has no stylesheet link, and it must not have one. '
            + `Do not import \`${link}\`: that name is the artifact of a build without the bundler.`;
    }
    if (styles?.wiring === WIRINGS.BUNDLED) {
        const how = specifier && script
            ? ` — \`import '${specifier}';\` from \`${script}\`, the path is relative to the script`
            : '';
        return `The styles of the project: the stylesheet is \`${source}\` (${language}), and the bundler of the project brings it: the script of the project imports \`${source}\`${how}. The import is the one way to the styles — the script does not link the css, and the markup of the project has no stylesheet link.`;
    }
    return `The styles of the project: the stylesheet is \`${source}\` (${language}), and the page loads \`${link}\`: the compiled css of that stylesheet, which the build writes next to the source. The script of the project does not import the stylesheet — a browser cannot read ${language}, and the import of the source breaks the page.`;
}

/**
 * Что говорить стилесту о стилях.
 * @param {object} styles контракт стилей
 * @returns {string}
 * @exports
 * @ai.hint pure
 */
export function stylerStyleNote(styles = {}) {
    const { source, link, language } = names(styles);
    if (!source) return '';
    const artifact = link && link !== source
        ? ` The compiled css of it, \`${link}\`, is the artifact of the build: nobody writes it by hand.`
        : '';
    return `The stylesheet of the project: \`${source}\` (${language}). That is the only stylesheet, and that is its exact name: write that file, and never name another one.${artifact}`;
}

/**
 * Что говорить ревьюеру и аудитору о стилях: как стили попадают на страницу.
 *
 * Ревьюер без этого правила выдумывает требование: в проекте со сборщиком он требует
 * ссылку на css, которой быть не должно, и ремонт ломает проект.
 * @param {object} styles контракт стилей
 * @returns {string}
 * @exports
 * @ai.hint pure
 */
export function reviewStyleNote(styles = {}) {
    const { source, link, language } = names(styles);
    if (!source) return '';
    const frameworkMarkup = ['jsx', 'tsx', 'vue', 'svelte'].includes(String(styles?.markup ?? '').trim().toLowerCase());
    if (styles?.wiring === WIRINGS.BUNDLED && !frameworkMarkup) {
        return `How the styles reach the page in this project: the script of the project imports \`${source}\` (${language}), and the bundler compiles that import — the styles come into the bundle with the script. The markup of the page does not link a stylesheet, and it must not: a bundler compiles a stylesheet only where something imports it, so a \`<link rel="stylesheet" href="${source}">\` would be dropped from the build without a word, and the page would have no styles at all. Do not ask for a link to the stylesheet here, and do not ask the script to import the compiled css \`${link}\` instead of the source — that name is an artifact, not a file of the project.`;
    }
    if (styles?.wiring === WIRINGS.BUNDLED) {
        return `How the styles reach the page in this project: the bundler brings them — the script of the project imports \`${source}\` and the bundler compiles it. The markup of the page does not link a stylesheet, and it must not: a link to \`${link}\` breaks the build, because that file is an artifact of the bundler. Do not ask for a link to the stylesheet here, and do not ask the script to import the compiled css instead of the source.`;
    }
    return `How the styles reach the page in this project: the page loads the compiled css \`${link}\` of the stylesheet \`${source}\` (${language}). The markup links that path, and the script of the project does not import the stylesheet. Do not ask for the other way round: the build of the project decides it.`;
}
