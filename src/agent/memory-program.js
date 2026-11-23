/**
 * @file src/agent/memory-program.js
 * @module agent/memory-program
 * @purpose Долговременная память проекта как внешняя программа: `ai-memory`.
 *
 *   Память — это не то, что роль знает от себя: это то, что проекту уже решали. Внешняя
 *   программа `ai-memory` хранит вики проекта, решения и открытые вопросы, и отдаёт их
 *   по запросу. Роль зовёт её одним инструментом, и инструмент идёт туда, где программа
 *   уже есть: если подключён MCP-сервер памяти — через него, иначе через саму программу.
 *
 *   Программа пишет журнал в stderr, а ответ отдаёт в stdout: журнал не часть ответа.
 *
 * @depends agent/programs
 * @usedBy agent/tools, roles/memory-note
 * @exports MEMORY_PROGRAM, memoryProgram, memoryConnection, memoryArgs, callMemoryProgram
 * @ai.tags tools, memory, external
 * @ai.hint io
 */

import { runProgram } from './programs.js';
import JSON5 from 'json5';

/** Имя программы памяти по умолчанию. */
export const MEMORY_PROGRAM = 'ai-memory';

/**
 * Настройка программы памяти: имя программы, время и выключатель.
 * @param {object} config
 * @returns {{ enabled: boolean, command: string, timeoutMs: number }}
 * @exports
 * @ai.hint pure
 */
export function memoryProgram(config = {}) {
    const section = config?.memory?.program ?? {};
    const command = String(section.command ?? MEMORY_PROGRAM).trim() || MEMORY_PROGRAM;
    return {
        enabled: section.enabled !== false,
        command,
        timeoutMs: Number.isSafeInteger(section.timeoutMs) && section.timeoutMs > 0
            ? section.timeoutMs
            : 60_000,
    };
}

/**
 * Соединение MCP с памятью, если оно есть.
 *
 * Имя соединения может быть любым: сервер памяти называют и `ai-memory`, и `memory`.
 * @param {object[]} tools инструменты MCP-серверов
 * @returns {object|null}
 * @exports
 * @ai.hint pure
 */
export function memoryConnection(tools = []) {
    for (const entry of Array.isArray(tools) ? tools : []) {
        const name = String(entry?.connection?.name ?? '').trim().toLowerCase();
        if (!name) continue;
        if (name === MEMORY_PROGRAM || name === 'memory' || name.includes('memory')) return entry;
    }
    return null;
}

/**
 * Аргументы инструмента памяти: объект или строка с JSON.
 *
 * Строка без JSON — это слова запроса: модель часто передаёт запрос словами, а не
 * объектом с полями.
 * @param {unknown} value
 * @returns {object}
 * @exports
 * @ai.hint pure
 */
export function memoryArgs(value) {
    if (value && typeof value === 'object' && !Array.isArray(value)) return value;
    const text = String(value ?? '').trim();
    if (!text) return {};
    try {
        // JSON5: аргументы вызова пишет модель, и «почти JSON» разбирается так же.
        const parsed = JSON5.parse(text);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch { /* не JSON: слова запроса */ }
    return { query: text };
}

/**
 * Позвать инструмент памяти через программу.
 *
 * Программа не бросает исключений: её отсутствие и её отказ приходят ответом.
 * @param {{ tool: string, args?: object, root?: string, env?: object, config?: object }} request
 * @returns {Promise<string>}
 * @exports
 * @ai.hint io
 */
export async function callMemoryProgram({ tool, args = {}, root = process.cwd(), env = process.env, config = {} } = {}) {
    const program = memoryProgram(config);
    if (!program.enabled) {
        return 'Программа памяти выключена в конфигурации (memory.program.enabled).';
    }
    const result = await runProgram({
        command: program.command,
        args: ['call', String(tool ?? '').trim(), JSON.stringify(args ?? {})],
        cwd: root,
        env,
        timeoutMs: program.timeoutMs,
    });
    if (!result.ok) {
        // Журнал программы — это stderr; последние строки его объясняют отказ.
        const log = String(result.stderr ?? '')
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => line && !/^\d{4}-\d{2}-\d{2}T/.test(line))
            .slice(-3)
            .join('\n');
        return `Программа памяти не ответила: ${result.reason ?? 'неизвестная причина'}`
            + `${log ? `\n${log}` : ''}`;
    }
    return String(result.stdout ?? '').trim() || 'Программа памяти не вернула ничего.';
}
