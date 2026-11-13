/**
 * @file src/memory.js
 * @module memory
 * @purpose The permanent memory: the facts, the decisions and the traps that outlive a run.
 *
 *   The memory is a SQLite database with a full-text index. It holds three kinds of
 *   records: the lessons of the runs (facts, conventions, decisions, preferences,
 *   pitfalls, summaries and notes), the summaries of the files of a project and the
 *   finished tasks.
 *
 *   Every record has a scope: `global` is shared by every project, `project` belongs to
 *   one directory. A run reads the memory before it starts and writes what it learned
 *   after it ends — so the next run starts with the knowledge of the previous one.
 *
 * @depends node:path, node:fs, node:sqlite, config/paths
 * @usedBy stages/collect, stages/learn, pipeline, cli
 * @exports MEMORY_KINDS, MEMORY_SCOPES, openMemory, memoryFile, memoryContext, rememberLessons
 * @ai.tags memory, sqlite, fts
 * @ai.hint io
 * @ai.hint legacy-0.2
 * @changed 2026-11-13 Ported from the monolith: node:sqlite, FTS5, no dependencies.
 */

import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { defaultHome, homeMemoryDb } from './config/paths.js';

/** The kinds of a record of the memory. */
export const MEMORY_KINDS = Object.freeze([
    'fact', 'convention', 'decision', 'preference', 'pitfall', 'summary', 'note',
]);

/** The scopes of a record of the memory. */
export const MEMORY_SCOPES = Object.freeze(['global', 'project']);

/**
 * The current time in the format of the database.
 * @returns {string}
 * @ai.hint pure
 */
const now = () => new Date().toISOString();

/**
 * The path of the database of the memory.
 * @param {string} [home]
 * @returns {string}
 * @exports
 * @ai.hint pure
 */
export function memoryFile(home = null) {
    return home ? homeMemoryDb(home) : homeMemoryDb(defaultHome());
}

/**
 * The query of the full-text search: every word becomes a quoted prefix token joined
 * with OR, so an inflected word still matches.
 * @param {string} text
 * @returns {string}
 * @ai.hint pure
 */
function ftsQuery(text) {
    const words = String(text ?? '').toLowerCase().match(/[\p{L}\p{N}_]{2,}/gu) ?? [];
    const stems = words.map((word) => (word.length > 5 ? word.slice(0, Math.max(4, word.length - 2)) : word));
    const unique = [...new Set(stems)].slice(0, 24);
    return unique.map((word) => `"${word.replaceAll('"', '')}"*`).join(' OR ');
}

/**
 * The list of the tags as one string.
 * @param {string|string[]} tags
 * @returns {string}
 * @ai.hint pure
 */
function tagsToText(tags) {
    return (Array.isArray(tags) ? tags : String(tags ?? '').split(','))
        .map((tag) => String(tag).trim().toLowerCase())
        .filter(Boolean)
        .join(',');
}

/**
 * Open the memory.
 *
 * @param {{ file?: string, project?: string|null }} options
 * @returns {object} the api of the memory
 * @exports
 * @ai.hint io
 */
export function openMemory({ file = ':memory:', project = null } = {}) {
    if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true });
    const db = new DatabaseSync(file);
    db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 3000;');
    db.exec(`
    CREATE TABLE IF NOT EXISTS memories (
      id INTEGER PRIMARY KEY, kind TEXT NOT NULL, scope TEXT NOT NULL,
      project TEXT NOT NULL DEFAULT '', text TEXT NOT NULL,
      tags TEXT NOT NULL DEFAULT '', files TEXT NOT NULL DEFAULT '', source TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS memories_scope ON memories(scope, project);
    CREATE TABLE IF NOT EXISTS file_summaries (
      project TEXT NOT NULL DEFAULT '', path TEXT NOT NULL, summary TEXT NOT NULL DEFAULT '',
      bytes INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL,
      PRIMARY KEY (project, path)
    );
    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY, project TEXT NOT NULL DEFAULT '', task TEXT NOT NULL,
      run_id TEXT NOT NULL DEFAULT '', summary TEXT NOT NULL DEFAULT '',
      files TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
    );
  `);

    let fts = true;
    try {
        db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(text, tags, files, content='memories', content_rowid='id', tokenize='unicode61');
        CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
          INSERT INTO memories_fts(rowid, text, tags, files) VALUES (new.id, new.text, new.tags, new.files);
        END;
        CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
          INSERT INTO memories_fts(memories_fts, rowid, text, tags, files) VALUES ('delete', old.id, old.text, old.tags, old.files);
        END;
        CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
          INSERT INTO memories_fts(memories_fts, rowid, text, tags, files) VALUES ('delete', old.id, old.text, old.tags, old.files);
          INSERT INTO memories_fts(rowid, text, tags, files) VALUES (new.id, new.text, new.tags, new.files);
        END;
      `);
    } catch {
        // A SQLite build without FTS5 still works: the search falls back to a LIKE.
        fts = false;
    }

    const projectKey = String(project ?? '');

    /**
     * One row of the memories as an object.
     * @param {object|null} raw
     * @returns {object|null}
     * @ai.hint pure
     */
    const row = (raw) => (raw ? {
        id: raw.id,
        kind: raw.kind,
        scope: raw.scope,
        project: raw.project,
        text: raw.text,
        tags: raw.tags ? raw.tags.split(',').filter(Boolean) : [],
        files: raw.files ? raw.files.split(',').filter(Boolean) : [],
        source: raw.source,
        createdAt: raw.created_at,
        updatedAt: raw.updated_at,
    } : null);

    /**
     * The rows that belong to the scope: the global ones and, in the project scope, the
     * ones of this project.
     * @param {string} scope
     * @returns {{ sql: string, params: object }}
     * @ai.hint pure
     */
    const scopeClause = (scope) => {
        if (scope === 'global') return { sql: 'm.scope = $scope', params: { $scope: 'global' } };
        return { sql: "(m.scope = 'global' OR m.project = $project)", params: { $project: projectKey } };
    };

    const api = {
        file,
        project: projectKey,
        fts,

        /**
         * Remember one fact.
         * @param {{ kind?: string, scope?: string, text: string, tags?: string|string[],
         *   files?: string[], source?: string }} input
         * @returns {object} the record
         */
        remember({ kind = 'note', scope = 'project', text, tags = '', files = [], source = '' } = {}) {
            const body = String(text ?? '').trim();
            if (!body) throw new Error('Текст записи памяти не может быть пустым.');
            const recordKind = MEMORY_KINDS.includes(String(kind)) ? String(kind) : 'note';
            const recordScope = MEMORY_SCOPES.includes(String(scope)) ? String(scope) : 'project';
            const stamp = now();
            const info = db.prepare(`INSERT INTO memories (kind, scope, project, text, tags, files, source, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
                recordKind, recordScope, recordScope === 'global' ? '' : projectKey,
                body, tagsToText(tags), (Array.isArray(files) ? files : []).map(String).join(','),
                String(source ?? ''), stamp, stamp,
            );
            return row(db.prepare('SELECT * FROM memories WHERE id = ?').get(info.lastInsertRowid));
        },

        /**
         * The records that match a query.
         * @param {string} query
         * @param {{ scope?: string, kind?: string|null, limit?: number }} [options]
         * @returns {object[]}
         */
        recall(query, { scope = 'project', kind = null, limit = 40 } = {}) {
            const cap = Number.isInteger(limit) && limit > 0 ? limit : 40;
            const scopePart = scopeClause(scope);
            const kindSql = kind ? ' AND m.kind = $kind' : '';
            const params = { ...scopePart.params, $limit: cap, ...(kind ? { $kind: kind } : {}) };
            const text = String(query ?? '').trim();
            if (!text) {
                return db.prepare(`SELECT m.* FROM memories m WHERE ${scopePart.sql}${kindSql}
          ORDER BY m.updated_at DESC, m.id DESC LIMIT $limit`).all(params).map(row);
            }
            if (fts) {
                const match = ftsQuery(text);
                if (match) {
                    const rows = db.prepare(`SELECT m.* FROM memories m JOIN memories_fts f ON f.rowid = m.id
            WHERE memories_fts MATCH $match AND ${scopePart.sql}${kindSql}
            ORDER BY bm25(memories_fts), m.updated_at DESC LIMIT $limit`).all({ $match: match, ...params });
                    if (rows.length) return rows.map(row);
                }
            }
            const like = `%${text.toLowerCase()}%`;
            return db.prepare(`SELECT m.* FROM memories m WHERE ${scopePart.sql}${kindSql}
        AND (lower(m.text) LIKE $like OR lower(m.tags) LIKE $like OR lower(m.files) LIKE $like)
        ORDER BY m.updated_at DESC LIMIT $limit`).all({ ...params, $like: like }).map(row);
        },

        /**
         * Every record of a scope.
         * @param {{ scope?: string, kind?: string|null, limit?: number }} [options]
         * @returns {object[]}
         */
        list({ scope = 'project', kind = null, limit = 200 } = {}) {
            const cap = Number.isInteger(limit) && limit > 0 ? limit : 200;
            const scopePart = scopeClause(scope);
            const kindSql = kind ? ' AND m.kind = $kind' : '';
            return db.prepare(`SELECT m.* FROM memories m WHERE ${scopePart.sql}${kindSql}
        ORDER BY m.updated_at DESC, m.id DESC LIMIT $limit`)
                .all({ ...scopePart.params, $limit: cap, ...(kind ? { $kind: kind } : {}) }).map(row);
        },

        /**
         * Forget one record.
         * @param {number} id
         * @returns {boolean}
         */
        forget(id) {
            const info = db.prepare('DELETE FROM memories WHERE id = ?').run(Number(id));
            return info.changes > 0;
        },

        /**
         * Keep the summary of a file.
         * @param {{ path: string, summary?: string, bytes?: number }} input
         * @returns {object}
         */
        summarizeFile({ path: file, summary = '', bytes = 0 } = {}) {
            const rel = String(file ?? '').trim();
            if (!rel) throw new Error('Путь файла не может быть пустым.');
            const stamp = now();
            db.prepare(`INSERT INTO file_summaries (project, path, summary, bytes, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(project, path) DO UPDATE SET summary = excluded.summary,
          bytes = excluded.bytes, updated_at = excluded.updated_at`).run(
                projectKey, rel, String(summary ?? ''), Number(bytes) || 0, stamp,
            );
            return db.prepare('SELECT * FROM file_summaries WHERE project = ? AND path = ?').get(projectKey, rel);
        },

        /**
         * The summary of one file.
         * @param {string} file
         * @returns {object|null}
         */
        fileSummary(file) {
            const rel = String(file ?? '').trim();
            if (!rel) return null;
            const raw = db.prepare('SELECT * FROM file_summaries WHERE project = ? AND path = ?').get(projectKey, rel);
            return raw ? { path: raw.path, summary: raw.summary, bytes: raw.bytes, updatedAt: raw.updated_at } : null;
        },

        /**
         * The summaries of the files that are known.
         * @param {string[]} [files]
         * @returns {object[]}
         */
        fileSummaries(files = null) {
            const rows = Array.isArray(files) && files.length
                ? files.map((file) => db.prepare('SELECT * FROM file_summaries WHERE project = ? AND path = ?').get(projectKey, String(file))).filter(Boolean)
                : db.prepare('SELECT * FROM file_summaries WHERE project = ? ORDER BY path').all(projectKey);
            return rows.map((row) => ({ path: row.path, summary: row.summary, bytes: row.bytes, updatedAt: row.updated_at }));
        },

        /**
         * Remember a finished task.
         * @param {{ task: string, runId?: string, summary?: string, files?: string[] }} input
         * @returns {object}
         */
        completeTask({ task, runId = '', summary = '', files = [] } = {}) {
            const body = String(task ?? '').trim();
            if (!body) throw new Error('Текст задачи не может быть пустым.');
            const info = db.prepare(`INSERT INTO tasks (project, task, run_id, summary, files, created_at)
        VALUES (?, ?, ?, ?, ?, ?)`).run(
                projectKey, body, String(runId ?? ''), String(summary ?? ''),
                (Array.isArray(files) ? files : []).map(String).join(','), now(),
            );
            return db.prepare('SELECT * FROM tasks WHERE id = ?').get(info.lastInsertRowid);
        },

        /**
         * The finished tasks, the newest first.
         * @param {number} [limit]
         * @returns {object[]}
         */
        recentTasks(limit = 20) {
            const cap = Number.isInteger(limit) && limit > 0 ? limit : 20;
            return db.prepare('SELECT * FROM tasks WHERE project = ? ORDER BY id DESC LIMIT ?')
                .all(projectKey, cap)
                .map((row) => ({
                    id: row.id,
                    task: row.task,
                    runId: row.run_id,
                    summary: row.summary,
                    files: row.files ? row.files.split(',').filter(Boolean) : [],
                    createdAt: row.created_at,
                }));
        },

        /**
         * The memory as the text the roles read.
         * @param {{ query?: string, scope?: string, limit?: number }} [options]
         * @returns {string}
         */
        context({ query = '', scope = 'project', limit = 40 } = {}) {
            const records = api.recall(query, { scope, limit });
            if (!records.length) return '';
            const lines = records.map((record) => {
                const files = record.files.length ? ` (${record.files.join(', ')})` : '';
                return `- [${record.kind}] ${record.text}${files}`;
            });
            return ['# What is already known', ...lines].join('\n');
        },

        /**
         * Close the database.
         * @returns {void}
         */
        close() {
            db.close();
        },
    };

    return api;
}

/**
 * The text of the memory for the context of the roles.
 *
 * A memory that is not there is not an error: the run simply starts without it.
 * @param {object|null} memory
 * @param {{ query?: string, scope?: string, limit?: number }} [options]
 * @returns {string}
 * @exports
 * @ai.hint pure
 */
export function memoryContext(memory, { query = '', scope = 'project', limit = 40 } = {}) {
    if (!memory?.context) return '';
    try {
        return memory.context({ query, scope, limit });
    } catch {
        return '';
    }
}

/**
 * Write the lessons of a run into the memory.
 * @param {object|null} memory
 * @param {object[]} lessons
 * @param {{ scope?: string, source?: string }} [options]
 * @returns {{ written: number, warnings: string[] }}
 * @exports
 * @ai.hint io
 */
export function rememberLessons(memory, lessons = [], { scope = 'project', source = '' } = {}) {
    const warnings = [];
    if (!memory?.remember) return { written: 0, warnings: ['Память недоступна: уроки не записаны.'] };
    let written = 0;
    for (const lesson of Array.isArray(lessons) ? lessons : []) {
        const text = String(lesson?.text ?? '').trim();
        if (!text) continue;
        try {
            memory.remember({
                kind: MEMORY_KINDS.includes(lesson?.kind) ? lesson.kind : 'note',
                scope,
                text,
                source,
            });
            written += 1;
        } catch (error) {
            warnings.push(`Урок не записан: ${error?.message ?? error}`);
        }
    }
    return { written, warnings };
}
