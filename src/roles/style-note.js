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
    if (styles?.wiring === WIRINGS.BUNDLED) {
        return `How the styles reach the page in this project: the bundler brings them — the script of the project imports \`${source}\` and the bundler compiles it. The markup of the page does not link a stylesheet, and it must not: a link to \`${link}\` breaks the build, because that file is an artifact of the bundler. Do not ask for a link to the stylesheet here, and do not ask the script to import the compiled css instead of the source.`;
    }
    return `How the styles reach the page in this project: the page loads the compiled css \`${link}\` of the stylesheet \`${source}\` (${language}). The markup links that path, and the script of the project does not import the stylesheet. Do not ask for the other way round: the build of the project decides it.`;
}
