/**
 * @file src/agent/markup-styles.js
 * @module agent/markup-styles
 * @purpose Проверка того, что разметка и стили проекта говорят на одном языке.
 *
 *   Класс в разметке, для которого в стилях нет ни одного правила, — это элемент без
 *   оформления: страница выглядит не так, как задумано. Класс в стилях, которого нет в
 *   разметке, — правило, которое никому не достаётся. Обе ошибки ломают страницу молча:
 *   сборка проходит, а смотреть на результат некому.
 *
 *   Разметку и стили пишут разные роли, и ремонт может переписать разметку целиком и
 *   переименовать классы, а стили останутся от прежней разметки. Поэтому проверка
 *   сравнивает не файлы, а имена: класс разметки и класс правила.
 *
 * @depends node:fs/promises, agent/paths
 * @usedBy stages/review, stages/styling
 * @exports markupClasses, styleClasses, checkMarkupStyles, renamedClasses
 * @ai.tags styles, markup, check
 * @ai.hint io
 */

import { readFile } from 'node:fs/promises';

import { resolveInside } from './paths.js';

/** Класс в селекторе: имя начинается с буквы или с подчёркивания. */
const CLASS_IN_SELECTOR = /\.([_a-zA-Z][\w-]*)/g;

/**
 * Имена классов, которые использует разметка.
 * @param {string} html
 * @returns {string[]} имена, по алфавиту
 * @exports
 * @ai.hint pure
 */
export function markupClasses(html) {
    const text = String(html ?? '');
    const found = new Set();
    // Атрибут `class` стоит после пробела: так `data-class` не попадёт в список.
    const pattern = /\sclass\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
    for (const match of text.matchAll(pattern)) {
        const value = match[1] ?? match[2] ?? match[3] ?? '';
        for (const name of value.split(/\s+/)) {
            if (name) found.add(name);
        }
    }
    return [...found].sort();
}

/**
 * Убрать из стилей то, что не является селектором: адреса, комментарии и строки.
 * @param {string} text
 * @returns {string}
 * @ai.hint pure
 */
function stripNoise(text) {
    return String(text ?? '')
        .replace(/url\([^)]*\)/gi, 'url()')
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/(^|\s)\/\/[^\n]*/g, '$1')
        .replace(/'[^']*'/g, "''")
        .replace(/"[^"]*"/g, '""');
}

/**
 * Разделить список селекторов по запятым, не считая запятые в скобках.
 * @param {string} text
 * @returns {string[]}
 * @ai.hint pure
 */
function splitSelectors(text) {
    const parts = [];
    let depth = 0;
    let current = '';
    for (const ch of String(text ?? '')) {
        if (ch === '(' || ch === '[') depth += 1;
        else if (ch === ')' || ch === ']') depth -= 1;
        if (ch === ',' && depth <= 0) {
            parts.push(current);
            current = '';
            continue;
        }
        current += ch;
    }
    parts.push(current);
    return parts.map((item) => item.trim()).filter(Boolean);
}

/**
 * Селекторы блока: `&` в них — это селектор родителя.
 *
 * Вложенность в SCSS — правило: `&__title` внутри `.card` — это `.card__title`. Без
 * подстановки имя класса не узнать, и проверка сказала бы, что класс не описан.
 * @param {string} prelude то, что стоит перед `{`
 * @param {string[][]} stack селекторы открытых блоков
 * @returns {string[]}
 * @ai.hint pure
 */
function resolveSelectors(prelude, stack) {
    const parts = splitSelectors(prelude);
    const parents = stack.length ? stack[stack.length - 1] : [];
    const out = [];
    for (const part of parts) {
        if (!parents.length) {
            out.push(part);
            continue;
        }
        for (const parent of parents) {
            out.push(part.includes('&') ? part.replace(/&/g, parent) : part);
        }
    }
    return out;
}

/**
 * Имена классов, о которых говорят стили.
 *
 * Считаются и обычные селекторы (`.card__title`), и вложенные (`&__title` внутри
 * `.card`), и классы в составных селекторах (`.card.is-open`).
 * @param {string} source содержимое таблицы стилей
 * @returns {string[]} имена, по алфавиту
 * @exports
 * @ai.hint pure
 */
export function styleClasses(source) {
    const text = stripNoise(source);
    const classes = new Set();
    const stack = [];
    let buffer = '';
    for (const ch of text) {
        if (ch === '{') {
            const selectors = resolveSelectors(buffer, stack);
            for (const selector of selectors) {
                for (const match of selector.matchAll(CLASS_IN_SELECTOR)) classes.add(match[1]);
            }
            stack.push(selectors);
            buffer = '';
            continue;
        }
        if (ch === '}') {
            stack.pop();
            buffer = '';
            continue;
        }
        if (ch === ';') {
            buffer = '';
            continue;
        }
        buffer += ch;
    }
    return [...classes].sort();
}

/**
 * Список файлов: строка или массив строк.
 * @param {string|string[]|null} value
 * @returns {string[]}
 * @ai.hint pure
 */
function asList(value) {
    if (Array.isArray(value)) return value.map((item) => String(item ?? '').trim()).filter(Boolean);
    const one = String(value ?? '').trim();
    return one ? [one] : [];
}

/**
 * Прочитать файл проекта. Файл, который не прочитался, — это предупреждение, а не падение.
 * @param {string} root
 * @param {string} rel
 * @param {string[]} warnings
 * @returns {Promise<string|null>}
 * @ai.hint io
 */
async function readText(root, rel, warnings) {
    try {
        const { abs } = await resolveInside(root, rel);
        return await readFile(abs, 'utf8');
    } catch (error) {
        warnings.push(`Файл ${rel} не прочитан: ${error?.message ?? error}`);
        return null;
    }
}

/**
 * Сходство разметки и стилей: классы разметки без правил и правила без разметки.
 *
 * `orphans` — классы, которые использует разметка и для которых нет ни одного правила:
 * элементы с ними остаются без оформления. `unused` — классы, которые описывают стили, но
 * которых нет в разметке: правила достаются никому.
 * @param {{ root?: string, markup?: string|string[], styles?: string|string[] }} request
 * @returns {Promise<{ used: string[], styled: string[], orphans: string[], unused: string[],
 *   ok: boolean, warnings: string[] }>}
 * @exports
 * @ai.hint io
 */
export async function checkMarkupStyles({ root = process.cwd(), markup = [], styles = [] } = {}) {
    const used = new Set();
    const styled = new Set();
    const warnings = [];
    for (const rel of asList(markup)) {
        const text = await readText(root, rel, warnings);
        if (text === null) continue;
        for (const name of markupClasses(text)) used.add(name);
    }
    for (const rel of asList(styles)) {
        const text = await readText(root, rel, warnings);
        if (text === null) continue;
        for (const name of styleClasses(text)) styled.add(name);
    }
    const orphans = [...used].filter((name) => !styled.has(name)).sort();
    const unused = [...styled].filter((name) => !used.has(name)).sort();
    return {
        used: [...used].sort(),
        styled: [...styled].sort(),
        orphans,
        unused,
        ok: orphans.length === 0,
        warnings,
    };
}

/**
 * Классы, которые были в разметке, остались в стилях и исчезли из разметки.
 *
 * Это переименование: правила остались от прежнего имени, а элемент получил другое. Такой
 * класс и есть тот самый класс, который потерял оформление.
 * @param {string[]} before классы до ремонта
 * @param {string[]} after классы сейчас
 * @param {string[]} known классы, у которых есть правило в стилях
 * @returns {string[]} имена, по алфавиту
 * @exports
 * @ai.hint pure
 */
export function renamedClasses(before = [], after = [], known = []) {
    const afterSet = new Set(asList(after));
    const knownSet = new Set(asList(known));
    const out = [];
    for (const name of new Set(asList(before))) {
        if (!afterSet.has(name) && knownSet.has(name)) out.push(name);
    }
    return out.sort();
}
