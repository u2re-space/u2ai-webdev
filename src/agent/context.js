/**
 * @file src/agent/context.js
 * @module agent/context
 * @purpose Контекст прогона: что он сделал, что решил и какие ответы уже получил.
 *
 *   Контекст живёт в каталоге прогона — `<work>/<id>/context/` — и умирает вместе с ним.
 *   Это не постоянная память проекта: здесь лежит то, что знает *этот* прогон, поэтому
 *   новый прогон начинается с чистой головы, а старый никогда не мешает новому.
 *
 *   Четыре вещи лежат в контексте:
 *
 *     journal.ndjson  что происходило, по одной записи на строку, в порядке событий;
 *     state.json      что прогон знает сейчас: картинки, стадии, факты;
 *     cache/          ответы, которые инструменты уже давали, чтобы не спрашивать дважды;
 *     notes.md        дайджест, который читает человек.
 *
 *   Контекст — это ещё и то, что читают роли: краткая сводка контекста называет точные
 *   пути картинок прогона, поэтому модель не ищет файл там, где его нет.
 *
 * @depends node:path, node:crypto, node:fs/promises, stages/workspace
 * @usedBy pipeline, roles/index, agent/tools, stages
 * @exports CONTEXT_DIR, JOURNAL_FILE, STATE_FILE, NOTES_FILE, CACHE_DIR, openContext,
 *          contextDirectory, contextRel, cacheKeyFor, buildBrief
 * @ai.tags context, cache, journal
 * @ai.hint io
 * @changed 2026-11-15 Контекст прогона: журнал, состояние, кэш и сводка.
 */

import path from 'node:path';
import { createHash } from 'node:crypto';
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { workRoot, sanitizeId } from '../stages/workspace.js';
import { workRel, writeFileAtomic } from '../shared/house.js';

/** Имя каталога контекста внутри каталога прогона. */
export const CONTEXT_DIR = 'context';

/** Журнал прогона: по одной записи на строку, в порядке событий. */
export const JOURNAL_FILE = 'journal.ndjson';

/** Состояние прогона: что он знает сейчас. */
export const STATE_FILE = 'state.json';

/** Дайджест прогона: то, что читает человек. */
export const NOTES_FILE = 'notes.md';

/** Ответы, которые инструменты уже давали. */
export const CACHE_DIR = 'cache';

/** Длина одной записи журнала — больше не пишем. */
const MAX_TEXT = 4000;

/** Длина сводки контекста, которая идёт в промпт роли. */
const MAX_BRIEF = 4000;

/**
 * Каталог прогона.
 * @param {string} root корень проекта
 * @param {object} config конфигурация прогона
 * @param {string} runId идентификатор прогона
 * @returns {string}
 * @exports
 * @ai.hint pure
 */
export function runDirectoryOf(root, config = {}, runId = '') {
    return path.join(workRoot(root, config), sanitizeId(runId));
}

/**
 * Каталог контекста прогона.
 * @param {string} root корень проекта
 * @param {object} config конфигурация прогона
 * @param {string} runId идентификатор прогона
 * @returns {string}
 * @exports
 * @ai.hint pure
 */
export function contextDirectory(root, config = {}, runId = '') {
    return path.join(runDirectoryOf(root, config, runId), CONTEXT_DIR);
}

/**
 * Путь контекста прогона так, как его читает модель.
 * @param {string} root корень проекта
 * @param {object} config конфигурация прогона
 * @param {string} runId идентификатор прогона
 * @returns {string}
 * @exports
 * @ai.hint pure
 */
export function contextRel(root, config = {}, runId = '') {
    return `${workRel(config)}/${sanitizeId(runId)}/${CONTEXT_DIR}`;
}

/**
 * Ключ записи кэша: имя файла, который её хранит.
 * @param {unknown} value то, что опознаёт ответ
 * @returns {string}
 * @exports
 * @ai.hint pure
 */
export function cacheKeyFor(value) {
    const text = typeof value === 'string' ? value : JSON.stringify(value ?? null);
    return createHash('sha256').update(text).digest('hex').slice(0, 24);
}

/**
 * Текст не длиннее предела.
 * @param {unknown} value
 * @param {number} [max]
 * @returns {string}
 * @ai.hint pure
 */
function clip(value, max = MAX_TEXT) {
    const text = String(value ?? '');
    if (text.length <= max) return text;
    return `${text.slice(0, max)}… (${text.length} знаков)`;
}

/**
 * Пустое состояние прогона.
 * @param {string} id
 * @returns {object}
 * @ai.hint pure
 */
function emptyState(id) {
    return {
        id,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        references: [],
        stages: {},
        facts: {},
        files: [],
    };
}

/**
 * Краткая сводка контекста: то, что должны знать роли прогона.
 *
 * Пути картинок — главное здесь: модель, которой сказали, где картинка, не идёт искать её
 * в рабочем каталоге прогона.
 * @param {object} state
 * @param {{ maxChars?: number }} [options]
 * @returns {string}
 * @exports
 * @ai.hint pure
 */
export function buildBrief(state, { maxChars = MAX_BRIEF } = {}) {
    const lines = ['# The context of this run'];
    const references = Array.isArray(state?.references) ? state.references : [];
    if (references.length) {
        lines.push('', 'The pictures of this run — these paths are exact, do not look for them anywhere else:');
        for (const item of references) {
            const kind = item?.kind === 'subref' ? 'a sub-reference' : 'the original picture';
            lines.push(`- \`${item?.rel ?? ''}\` — ${kind}`);
        }
    }
    const stages = Object.values(state?.stages ?? {});
    if (stages.length) {
        lines.push('', 'The stages of this run:');
        for (const stage of stages) {
            const status = stage?.status === 'failed' ? 'failed' : 'done';
            const summary = stage?.summary ? ` — ${stage.summary}` : '';
            lines.push(`- ${stage?.id ?? 'stage'}: ${status}${summary}`);
        }
    }
    const facts = state?.facts ?? {};
    for (const [key, value] of Object.entries(facts)) {
        if (key === 'notes') continue;
        const text = typeof value === 'string' ? value : JSON.stringify(value);
        if (!text) continue;
        lines.push('', `## ${key}`, text);
    }
    const files = Array.isArray(state?.files) ? state.files : [];
    if (files.length) {
        lines.push('', 'The files the run wrote:');
        for (const file of files.slice(-24)) lines.push(`- ${file}`);
    }
    const text = lines.join('\n');
    if (text.length <= maxChars) return text;
    return `${text.slice(0, maxChars)}\n… (the context is longer: ${text.length} chars)`;
}

/**
 * Открыть контекст прогона.
 *
 * Выключенный контекст — тоже объект: все его методы ничего не делают и никогда не падают,
 * поэтому вызывающей стороне не нужны ветки.
 * @param {{ root: string, config?: object, runId?: string, enabled?: boolean, cache?: boolean,
 *   maxBriefChars?: number }} options
 * @returns {Promise<object>} контекст прогона
 * @exports
 * @ai.hint io
 */
export async function openContext({
    root,
    config = {},
    runId = '',
    enabled = true,
    cache = true,
    maxBriefChars = MAX_BRIEF,
} = {}) {
    const id = sanitizeId(runId);
    const dir = contextDirectory(root, config, id);
    const rel = contextRel(root, config, id);

    const state = emptyState(id);
    const entries = [];

    if (!enabled) {
        return disabledContext({ id, dir, rel, state });
    }

    await mkdir(path.join(dir, CACHE_DIR), { recursive: true });

    // Состояние более раннего прогона с тем же id: продолжение прогона помнит то, что знают.
    const stored = await readFile(path.join(dir, STATE_FILE), 'utf8').catch(() => null);
    if (stored) {
        try {
            const parsed = JSON.parse(stored);
            // Массив — это не состояние: его поля не положить в состояние.
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) Object.assign(state, parsed, { id });
        } catch { /* сломанное состояние — подсказка, а не повод упасть */ }
    }

    /**
     * Записать состояние на диск.
     * @returns {Promise<void>}
     */
    const saveState = async () => {
        state.updatedAt = new Date().toISOString();
        await writeFileAtomic(path.join(dir, STATE_FILE), `${JSON.stringify(state, null, 2)}\n`);
    };

    const context = {
        enabled: true,
        id,
        dir,
        rel,
        state,
        /**
         * The map of the run: the index of the files of the working directory.
         *
         * The map hangs on the context because it is the same knowledge: the context says
         * what the run knows, and the map says what is on the disk. The tools need both.
         * @type {object|null}
         */
        map: null,

        /**
         * Положить запись в журнал прогона.
         * @param {string} kind что произошло
         * @param {object} [payload] подробности
         * @param {object} [meta] стадия и роль, к которым это относится
         * @returns {Promise<object|null>} запись
         * @ai.hint io
         */
        async record(kind, payload = {}, meta = {}) {
            try {
                const entry = {
                    at: new Date().toISOString(),
                    kind: String(kind ?? 'note'),
                    stage: meta?.stage ? String(meta.stage) : null,
                    role: meta?.role ? String(meta.role) : null,
                    ...payload,
                };
                if (typeof entry.text === 'string') entry.text = clip(entry.text);
                entries.push(entry);
                await mkdir(dir, { recursive: true });
                await appendFile(path.join(dir, JOURNAL_FILE), `${JSON.stringify(entry)}\n`, 'utf8');
                return entry;
            } catch {
                // Контекст — свидетель: прогон, который не может его записать, всё равно идёт.
                return null;
            }
        },

        /**
         * Заметка прогона.
         * @param {string} text
         * @param {object} [meta]
         * @returns {Promise<object|null>}
         * @ai.hint io
         */
        async note(text, meta = {}) {
            return await context.record('note', { text: String(text ?? '') }, meta);
        },

        /**
         * Решение прогона: ответ стадии, на который опираются следующие.
         * @param {string} text
         * @param {object} [meta]
         * @returns {Promise<object|null>}
         * @ai.hint io
         */
        async decision(text, meta = {}) {
            return await context.record('decision', { text: String(text ?? '') }, meta);
        },

        /**
         * План прогона.
         * @param {string} text
         * @param {object} [meta]
         * @returns {Promise<object|null>}
         * @ai.hint io
         */
        async plan(text, meta = {}) {
            return await context.record('plan', { text: String(text ?? '') }, meta);
        },

        /**
         * Ответ роли или стадии.
         * @param {string} text
         * @param {object} [meta]
         * @returns {Promise<object|null>}
         * @ai.hint io
         */
        async answer(text, meta = {}) {
            return await context.record('answer', { text: String(text ?? '') }, meta);
        },

        /**
         * Действие роли: вызов инструмента, записанный файл.
         * @param {string} text
         * @param {object} [meta]
         * @returns {Promise<object|null>}
         * @ai.hint io
         */
        async action(text, meta = {}) {
            return await context.record('action', { text: String(text ?? '') }, meta);
        },

        /**
         * Состояние стадии прогона.
         * @param {string} stageId идентификатор стадии
         * @param {string} status done или failed
         * @param {string} [summary] что сделала стадия, одной фразой
         * @param {object} [meta]
         * @returns {Promise<object|null>}
         * @ai.hint io
         */
        async stage(stageId, status = 'done', summary = '', meta = {}) {
            const key = String(stageId ?? '');
            state.stages[key] = {
                id: key,
                status: String(status ?? 'done'),
                summary: clip(summary, 400),
                at: new Date().toISOString(),
            };
            await saveState().catch(() => {});
            return await context.record('stage', { stage: key, status: String(status ?? 'done'), summary: clip(summary, 400) }, meta);
        },

        /**
         * Запомнить факт прогона.
         * @param {string} key
         * @param {unknown} value
         * @returns {Promise<void>}
         * @ai.hint io
         */
        async set(key, value) {
            state.facts[String(key ?? '')] = value;
            await saveState().catch(() => {});
        },

        /**
         * Факт прогона.
         * @param {string} key
         * @returns {unknown}
         * @ai.hint pure
         */
        get(key) {
            return state.facts?.[String(key ?? '')];
        },

        /**
         * Картинки прогона: точные пути, которые должны использовать роли.
         * @param {Array<{ rel: string, kind?: string }>} references
         * @returns {Promise<void>}
         * @ai.hint io
         */
        async references(references = []) {
            state.references = (Array.isArray(references) ? references : []).map((item) => ({
                rel: String(item?.rel ?? ''),
                kind: String(item?.kind ?? 'original'),
            }));
            await saveState().catch(() => {});
        },

        /**
         * Файл, который прогон записал.
         * @param {string} file путь файла
         * @returns {Promise<void>}
         * @ai.hint io
         */
        async file(file) {
            const rel = String(file ?? '');
            if (!rel) return;
            if (!state.files.includes(rel)) state.files.push(rel);
            await saveState().catch(() => {});
        },

        /**
         * Ответ, который уже лежит в кэше.
         * @param {string} key
         * @returns {Promise<object|null>}
         * @ai.hint io
         */
        async cached(key) {
            if (!cache) return null;
            const text = await readFile(path.join(dir, CACHE_DIR, `${cacheKeyFor(key)}.json`), 'utf8').catch(() => null);
            if (text === null) return null;
            try {
                const parsed = JSON.parse(text);
                return parsed && typeof parsed === 'object' ? parsed : null;
            } catch {
                return null;
            }
        },

        /**
         * Положить ответ в кэш.
         * @param {string} key
         * @param {unknown} value
         * @returns {Promise<void>}
         * @ai.hint io
         */
        async put(key, value) {
            if (!cache) return;
            try {
                await mkdir(path.join(dir, CACHE_DIR), { recursive: true });
                await writeFileAtomic(
                    path.join(dir, CACHE_DIR, `${cacheKeyFor(key)}.json`),
                    `${JSON.stringify(value ?? null)}\n`,
                );
            } catch { /* кэш, который не пишется, только замедляет */ }
        },

        /**
         * Краткая сводка контекста: то, что читают роли прогона.
         * @param {{ maxChars?: number }} [options]
         * @returns {string}
         * @ai.hint pure
         */
        brief(options = {}) {
            return buildBrief(state, { maxChars: options?.maxChars ?? maxBriefChars });
        },

        /**
         * Записи журнала.
         * @param {{ kind?: string|null, stage?: string|null, limit?: number }} [filter]
         * @returns {Promise<object[]>}
         * @ai.hint io
         */
        async journal(filter = {}) {
            const text = await readFile(path.join(dir, JOURNAL_FILE), 'utf8').catch(() => '');
            const list = text
                .split('\n')
                .map((line) => line.trim())
                .filter(Boolean)
                .map((line) => {
                    try { return JSON.parse(line); }
                    catch { return null; }
                })
                .filter(Boolean);
            let out = list;
            if (filter?.kind) out = out.filter((entry) => entry.kind === filter.kind);
            if (filter?.stage) out = out.filter((entry) => entry.stage === filter.stage);
            const limit = Number.isSafeInteger(filter?.limit) ? filter.limit : out.length;
            return out.slice(-Math.max(0, limit));
        },

        /**
         * Записать дайджест прогона: то, что читает человек после него.
         * @returns {Promise<string|null>} путь файла
         * @ai.hint io
         */
        async digest() {
            try {
                const list = await context.journal();
                const lines = [
                    `# The context of the run ${id}`,
                    '',
                    `Created: ${state.createdAt}`,
                    `Updated: ${state.updatedAt}`,
                    '',
                ];
                if (state.references.length) {
                    lines.push('## The pictures', '');
                    for (const item of state.references) lines.push(`- \`${item.rel}\` — ${item.kind}`);
                    lines.push('');
                }
                const stages = Object.values(state.stages ?? {});
                if (stages.length) {
                    lines.push('## The stages', '');
                    for (const stage of stages) lines.push(`- ${stage.id}: ${stage.status}${stage.summary ? ` — ${stage.summary}` : ''}`);
                    lines.push('');
                }
                if (list.length) {
                    lines.push('## What happened', '');
                    for (const entry of list) {
                        const where = [entry.stage, entry.role].filter(Boolean).join('/');
                        lines.push(`- ${entry.at} · ${entry.kind}${where ? ` · ${where}` : ''}${entry.text ? ` — ${entry.text}` : ''}`);
                    }
                    lines.push('');
                }
                if (state.files.length) {
                    lines.push('## The files', '');
                    for (const file of state.files) lines.push(`- ${file}`);
                    lines.push('');
                }
                await mkdir(dir, { recursive: true });
                const file = path.join(dir, NOTES_FILE);
                await writeFileAtomic(file, lines.join('\n'));
                return file;
            } catch {
                return null;
            }
        },

        /**
         * Закрывать нечего: каждая запись контекста заканчивается, когда она возвращается.
         * @returns {Promise<void>}
         * @ai.hint io
         */
        async close() {},
    };

    return context;
}

/**
 * Выключенный контекст: та же форма, но без диска.
 * @param {{ id: string, dir: string, rel: string, state: object }} options
 * @returns {object}
 * @ai.hint pure
 */
function disabledContext({ id, dir, rel, state }) {
    const nothing = async () => null;
    return {
        enabled: false,
        id,
        dir,
        rel,
        state,
        map: null,
        record: nothing,
        note: nothing,
        decision: nothing,
        plan: nothing,
        answer: nothing,
        action: nothing,
        stage: nothing,
        set: nothing,
        get: () => undefined,
        references: nothing,
        file: nothing,
        cached: async () => null,
        put: nothing,
        brief: () => '',
        journal: async () => [],
        digest: async () => null,
        close: nothing,
    };
}
