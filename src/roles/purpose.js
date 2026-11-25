/**
 * @file src/roles/purpose.js
 * @module roles/purpose
 * @purpose Назначение работы: что модель собирается написать — и какие гайды под это.
 *
 *   Модель сама говорит, зачем она пишет: «диалог подключения устройства», «сетка
 *   карточек», «переходы панелей». Прогон берёт это назначение и подкладывает гайды:
 *   правила разметки, доступности, сетки, движения — те, что отвечают за назначение.
 *
 *   Так знание приходит к модели **в тот ход, в который она пишет**, а не лежит в
 *   промпте роли заранее. Промпт с сорока источниками — это шум, и модель теряет в
 *   нём главное. Назначение — это несколько строк, и они приходят вовремя.
 *
 *   Назначение не ограничивает модель: гайды — это правила, а не рамки. Модель может
 *   прочитать и другие, и написать больше, чем описала.
 *
 * @depends roles/chunks, agent/docs
 * @usedBy roles/index, agent/tools
 * @exports PURPOSES, purposeFor, guidesForPurpose, purposeBlock
 * @ai.tags purpose, guides, documentation
 * @ai.hint pure
 * @changed 2026-11-25 Назначение приходит от модели и приносит гайды в ход записи.
 */

import { kindOf } from './chunks.js';
import { DOCUMENTATION } from '../agent/docs.js';

/**
 * Назначения и гайды, что им отвечают.
 *
 * Ключ — назначение, значение — источники документации. Источник, которого нет в
 * `DOCUMENTATION`, молча пропускается: гайд — это подсказка, а не условие.
 * @type {Readonly<Record<string, ReadonlyArray<string>>>}
 * @exports
 */
export const PURPOSES = Object.freeze({
    // Разметка и структура.
    markup: Object.freeze(['htmlSemantics', 'a11y']),
    structure: Object.freeze(['htmlSemantics', 'a11y']),
    'page structure': Object.freeze(['htmlSemantics', 'a11y']),
    // Диалоги и формы.
    dialog: Object.freeze(['a11y', 'cssColors', 'cssMotion']),
    modal: Object.freeze(['a11y', 'cssColors', 'cssMotion']),
    form: Object.freeze(['htmlSemantics', 'a11y', 'cssColors']),
    'form validation': Object.freeze(['htmlSemantics', 'a11y', 'cssColors']),
    // Раскладка.
    layout: Object.freeze(['cssGrid', 'cssFlex', 'cssUnits']),
    grid: Object.freeze(['cssGrid', 'cssUnits']),
    flex: Object.freeze(['cssFlex', 'cssUnits']),
    responsive: Object.freeze(['cssGrid', 'cssFlex', 'cssUnits']),
    'responsive layout': Object.freeze(['cssGrid', 'cssFlex', 'cssUnits']),
    // Оформление.
    styles: Object.freeze(['cssColors', 'cssUnits', 'cssShapes', 'cssFonts']),
    theme: Object.freeze(['cssColors', 'cssFonts', 'cssUnits']),
    tokens: Object.freeze(['cssColors', 'cssUnits', 'cssFonts']),
    typography: Object.freeze(['cssFonts', 'cssUnits']),
    // Состояния и движение.
    state: Object.freeze(['cssColors', 'a11y']),
    states: Object.freeze(['cssColors', 'a11y']),
    motion: Object.freeze(['cssMotion', 'a11y']),
    animation: Object.freeze(['cssMotion', 'a11y']),
    transition: Object.freeze(['cssMotion']),
    // Графика.
    icon: Object.freeze(['svg', 'phosphorIcons', 'lucideIcons']),
    icons: Object.freeze(['svg', 'phosphorIcons', 'lucideIcons']),
    illustration: Object.freeze(['svg']),
    // Данные и логика.
    state_management: Object.freeze(['htmlSemantics']),
    logic: Object.freeze(['htmlSemantics']),
    commands: Object.freeze(['htmlSemantics']),
    integration: Object.freeze(['htmlSemantics']),
    // Служебное.
    pwa: Object.freeze(['htmlSemantics', 'a11y']),
    service_worker: Object.freeze(['htmlSemantics']),
});

/**
 * Назначение по виду файла: когда модель не сказала ничего.
 *
 * Файл сам знает, какого ремесла он требует: таблица стилей — это цвета и единицы,
 * скрипт — это логика, разметка — это семантика.
 * @param {string} kind вид файла
 * @returns {string} имя назначения, или пустая строка
 * @exports
 * @ai.hint pure
 */
export function purposeOfKind(kind = '') {
    const name = String(kind ?? '').trim().toLowerCase();
    if (name === 'style') return 'styles';
    if (name === 'markup') return 'markup';
    if (name === 'code') return 'logic';
    if (name === 'svg') return 'illustration';
    if (name === 'image') return 'illustration';
    return '';
}

/**
 * Назначение шага: то, что сказал модель, или то, что следует из вида файла.
 * @param {string} purpose то, что назвала модель
 * @param {string[]} files файлы шага
 * @returns {string} имя назначения, или пустая строка
 * @exports
 * @ai.hint pure
 */
export function purposeFor(purpose = '', files = []) {
    const said = String(purpose ?? '').trim();
    if (said) return said.toLowerCase();
    for (const file of Array.isArray(files) ? files : []) {
        const kind = kindOf(file);
        const guess = purposeOfKind(kind);
        if (guess) return guess;
    }
    return '';
}

/**
 * Гайды назначения: тексты стандартов, что отвечают за него.
 *
 * Назначение, которого нет в таблице, даёт пустой текст: модель описала то, чего
 * таблица не знает, и читать ей нечего. Это не ошибка — описание остаётся в отчёте.
 * @param {string} purpose имя назначения
 * @returns {string} тексты гайдов, или пустая строка
 * @exports
 * @ai.hint pure
 */
export function guidesForPurpose(purpose = '') {
    const name = String(purpose ?? '').trim().toLowerCase();
    if (!name) return '';
    const names = PURPOSES[name];
    if (!names) return '';
    const blocks = [];
    for (const source of names) {
        const text = DOCUMENTATION[source];
        if (!text) continue;
        blocks.push(text);
    }
    return blocks.join('\n\n');
}

/**
 * Блок назначения: то, что говорит роль и то, что к этому пришло.
 *
 * Блок приходит в ход записи — после ворот, перед первым вызовом `write_file`.
 * @param {{ purpose?: string, guides?: string }} request
 * @returns {string} пустая строка, когда подкладывать нечего
 * @exports
 * @ai.hint pure
 */
export function purposeBlock({ purpose = '', guides = '' } = {}) {
    const said = String(purpose ?? '').trim();
    const text = String(guides ?? '').trim();
    if (!said && !text) return '';
    const lines = [];
    if (said) lines.push(`## The purpose of this write\n${said}`);
    if (text) {
        lines.push(
            '',
            '## The guides of this purpose',
            '',
            'These are the standards that answer the purpose above. They are the rules of this',
            'write, not a limit of it: follow them, and go further where the task asks.',
            '',
            text,
        );
    }
    return lines.join('\n');
}
