/**
 * @file src/stages/pass.js
 * @module stages/pass
 * @purpose Проходы роли: одна роль работает по шагу в несколько заходов.
 *
 *   Раньше стадия и роль были одно и то же: стадия `styling` звала роль `styler` по всем
 *   её шагам, и роль писала файл целиком. Потом роль писала то, чего ещё нет: кодер
 *   без стилей не знает, какие имена классов дать странице, а стилест без кода не знает,
 *   каких состояний ждать. Роль ждала того, что появляется после неё, и прогон стоял.
 *
 *   Теперь одна роль может иметь несколько проходов: `styler` сначала пишет черновик
 *   контракта (токены, палитра, каркас), `coder` — скелет модулей по этому контракту, а
 *   потом обе роли делают свою работу целиком, видя результат друг друга.
 *
 *   Проход — это не новая роль и не новый шаг плана. Это тот же шаг, тот же отчёт и тот
 *   же файл: различаются только задача, которая ставится роли, и то, что роль уже
 *   написала. Поэтому отчёт прохода пишется рядом с отчётом шага, а не вместо него:
 *   прогон, который продолжается, видит обе части работы.
 *
 * @depends node:path
 * @usedBy stages/step, stages/styling, stages/coding, stages/index
 * @exports PASSES, passFor, passOf, isPass, passKey, passReportPath
 * @ai.tags stages, passes, roles
 * @ai.hint pure
 * @changed 2026-11-24 Роль работает по шагу в несколько заходов: черновик контракта, потом работа.
 */

import path from 'node:path';
import { runFile } from './workspace.js';

/**
 * Проходы ролей: роль — и её проходы по порядку.
 *
 * Ключ прохода — короткое имя, по нему стадия находит проход и по нему же лежит
 * отчёт: `styler.draft` и `styler.full`.
 * @type {Readonly<Record<string, ReadonlyArray<string>>>}
 */
export const PASSES = Object.freeze({
    styler: Object.freeze(['draft', 'full']),
    coder: Object.freeze(['draft', 'full']),
});

/**
 * Имя прохода по умолчанию: последний — это работа целиком.
 * @param {string} role
 * @returns {string}
 * @exports
 * @ai.hint pure
 */
export function defaultPass(role) {
    const list = PASSES[String(role ?? '').trim().toLowerCase()] ?? [];
    return list.length ? list[list.length - 1] : 'full';
}

/**
 * Проходы роли по порядку.
 * @param {string} role
 * @returns {string[]}
 * @exports
 * @ai.hint pure
 */
export function passesOf(role) {
    const key = String(role ?? '').trim().toLowerCase();
    return [...(PASSES[key] ?? [])];
}

/**
 * Проход роли по имени.
 * @param {string} role
 * @param {string} pass
 * @returns {string|null} имя прохода или null, если такого нет
 * @exports
 * @ai.hint pure
 */
export function passFor(role, pass) {
    const key = String(role ?? '').trim().toLowerCase();
    const list = PASSES[key] ?? [];
    const name = String(pass ?? '').trim().toLowerCase();
    return list.includes(name) ? name : null;
}

/**
 * Ключ прохода: роль и имя вместе. Он же — имя файла отчёта.
 * @param {string} role
 * @param {string} pass
 * @returns {string}
 * @exports
 * @ai.hint pure
 */
export function passKey(role, pass) {
    const who = String(role ?? '').trim().toLowerCase();
    const name = String(pass ?? '').trim().toLowerCase() || 'full';
    return `${who}.${name}`;
}

/**
 * Имя файла отчёта прохода. Отчёт прохода лежит рядом с отчётом шага и не заменяет его:
 * шаг сделан, когда сделаны все его проходы.
 * @param {string} stepId
 * @param {string} role
 * @param {string} pass
 * @returns {string}
 * @exports
 * @ai.hint pure
 */
export function passReportName(stepId, role, pass) {
    const step = String(stepId ?? '').trim() || 'step';
    return `${step}.${passKey(role, pass)}`;
}

/**
 * Имя файла — это отчёт прохода?
 *
 * Имя прохода — из известного набора (`draft`, `full`), а роль — из известного набора
 * ролей с проходами. Всё остальное — отчёт шага.
 * @param {string} name имя файла
 * @returns {boolean}
 * @exports
 * @ai.hint pure
 */
export function isPassReportName(name) {
    const file = String(name ?? '').trim().replace(/\.json$/i, '');
    const parts = file.split('.');
    if (parts.length < 3) return false;
    const pass = parts[parts.length - 1].toLowerCase();
    const role = parts[parts.length - 2].toLowerCase();
    const list = PASSES[role];
    if (!list) return false;
    return list.includes(pass);
}

/**
 * Путь файла отчёта прохода.
 * @param {string} root
 * @param {object} config
 * @param {string|null} id
 * @param {string} stepId
 * @param {string} role
 * @param {string} pass
 * @param {string} dir каталог отчётов шагов
 * @returns {string}
 * @exports
 * @ai.hint pure
 */
export function passReportPath(root, config = {}, id = null, stepId, role, pass, dir = 'steps') {
    return runFile(root, config, id, path.join(dir, `${passReportName(stepId, role, pass)}.json`));
}
