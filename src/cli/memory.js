/**
 * @file src/cli/memory.js
 * @module cli/memory
 * @purpose The command of the permanent memory: `ai-webdev memory`.
 *
 *   The memory is the SQLite database of the lessons of the runs, the summaries of the
 *   files and the finished tasks. The command shows what the memory knows and lets a
 *   user add or forget a record.
 *
 * @depends memory, config/paths, cli/errors
 * @usedBy cli
 * @exports memoryCommand
 * @ai.tags cli, memory
 * @ai.hint io
 * @changed 2026-11-13 First version: the command of the permanent memory.
 */

import { openMemory, memoryFile } from '../memory.js';
import { defaultHome } from '../config/paths.js';
import { UsageError } from './errors.js';

/**
 * One line of a record of the memory.
 * @param {object} record
 * @returns {string}
 * @ai.hint pure
 */
function recordLine(record) {
    const tags = record?.tags?.length ? ` [${record.tags.join(', ')}]` : '';
    return `${record?.id ?? ''}\t${record?.kind ?? ''}\t${record?.scope ?? ''}\t${record?.text ?? ''}${tags}`;
}

/**
 * `ai-webdev memory [list|search|add|rm|tasks]`
 *
 * @param {{ config: object, cwd: string, args?: string[], flags?: object, renderer?: object,
 *   env?: object }} ctx
 * @returns {Promise<number>} the exit code
 * @exports
 * @ai.hint io
 */
export async function memoryCommand(ctx) {
    const { config, cwd, args = [], flags = {}, renderer = null, env = process.env } = ctx;
    const sub = args[0] ?? 'list';
    const file = config?.memory?.dbFile ?? memoryFile(defaultHome(env));
    const scope = String(flags.scope ?? config?.memory?.scope ?? 'project');
    const memory = openMemory({ file, project: cwd });

    try {
        if (sub === 'list') {
            const records = memory.list({ scope });
            if (!records.length) {
                renderer?.note?.('The memory is empty.');
                return 0;
            }
            for (const record of records) renderer?.note?.(recordLine(record));
            renderer?.note?.(`Total: ${records.length}`);
            return 0;
        }

        if (sub === 'search') {
            const query = args.slice(1).join(' ').trim();
            if (!query) throw new UsageError('Укажите запрос: ai-webdev memory search <текст>.');
            const records = memory.recall(query, { scope });
            if (!records.length) {
                renderer?.note?.(`Nothing found: ${query}`);
                return 1;
            }
            for (const record of records) renderer?.note?.(recordLine(record));
            return 0;
        }

        if (sub === 'add') {
            const text = args.slice(1).join(' ').trim();
            if (!text) throw new UsageError('Укажите текст: ai-webdev memory add <текст>.');
            const record = memory.remember({
                kind: String(flags.as ?? 'note'),
                scope: String(flags.scope ?? scope),
                text,
                tags: String(flags.tags ?? ''),
            });
            renderer?.note?.(`Remembered #${record.id}: ${record.text}`);
            return 0;
        }

        if (sub === 'rm' || sub === 'forget') {
            const id = Number(args[1]);
            if (!Number.isSafeInteger(id)) throw new UsageError('Укажите номер: ai-webdev memory rm <id>.');
            if (!memory.forget(id)) {
                renderer?.error?.(`Запись не найдена: ${id}`);
                return 1;
            }
            renderer?.note?.(`Forgotten: ${id}`);
            return 0;
        }

        if (sub === 'tasks') {
            const tasks = memory.recentTasks();
            if (!tasks.length) {
                renderer?.note?.('No finished tasks.');
                return 0;
            }
            for (const task of tasks) {
                renderer?.note?.(`${task.id}\t${task.runId ?? ''}\t${task.task}`);
            }
            return 0;
        }

        throw new UsageError('Доступно: ai-webdev memory list | search <текст> | add <текст> | rm <id> | tasks');
    } finally {
        memory.close();
    }
}
