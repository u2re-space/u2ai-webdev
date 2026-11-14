/**
 * @file src/cli/skills.js
 * @module cli/skills
 * @purpose `ai-webdev skills` — the skill packs of the project, of the home and of the package.
 *
 *   The packs are the markdown a user drops next to the project to teach a role something
 *   the model does not know. The command shows them, looks one up, shows the text of one
 *   and removes the ones of the project.
 *
 *   The pack of the package — the guides of the modern web platform — is listed like any
 *   other, but it is not removed: it belongs to the installation, not to the project.
 *
 * @depends node:path, agent/skills, cli/errors
 * @usedBy cli
 * @exports skillsCommand
 * @ai.tags cli, skills
 * @ai.hint io
 * @changed 2026-11-14 The command of the skill packs: list, search, show, path and rm.
 */

import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { skillCatalog, removeSkillPack } from '../agent/skills.js';
import { UsageError } from './errors.js';

/**
 * One line of a pack in a list.
 * @param {object} pack
 * @returns {string}
 * @ai.hint pure
 */
function cardLine(pack) {
    const summary = String(pack.description ?? '').split('\n')[0].trim();
    return `${pack.name}\t${pack.kind}\t${summary || '—'}`;
}

/**
 * `ai-webdev skills [list|search|show|path|rm]`
 *
 * @param {{ cwd: string, args?: string[], flags?: object, renderer?: object,
 *   write?: (text: string) => void, env?: object }} ctx
 * @returns {Promise<number>} the exit code
 * @exports
 * @ai.hint io
 */
export async function skillsCommand(ctx) {
    const { cwd, args = [], flags = {}, renderer = null, env = process.env } = ctx;
    const write = ctx.write ?? ((text) => renderer?.note?.(text) ?? process.stdout.write(text));
    const sub = String(args[0] ?? 'list').trim();
    const catalog = await skillCatalog(cwd, { env });

    if (sub === 'list') {
        if (!catalog.length) {
            write('Скилл-паков нет. Положите каталог со SKILL.md в .agents/skills/ проекта.');
            return 0;
        }
        for (const pack of catalog) write(cardLine(pack));
        write(`Всего: ${catalog.length}`);
        return 0;
    }

    if (sub === 'search') {
        const query = args.slice(1).join(' ').trim();
        if (!query) throw new UsageError('Укажите запрос: ai-webdev skills search <текст>.');
        const needle = query.toLowerCase();
        const found = catalog.filter((pack) => `${pack.name} ${pack.description ?? ''}`.toLowerCase().includes(needle));
        if (!found.length) {
            write(`Ничего не найдено: ${query}`);
            return 1;
        }
        for (const pack of found) write(cardLine(pack));
        write(`Найдено: ${found.length}`);
        return 0;
    }

    if (sub === 'show') {
        const name = String(args[1] ?? '').trim();
        if (!name) throw new UsageError('Укажите пак: ai-webdev skills show <имя>.');
        const pack = catalog.find((item) => item.name === name);
        if (!pack) {
            write(`Пак не найден: ${name}`);
            return 1;
        }
        const text = await readFile(pack.path, 'utf8').catch(() => null);
        if (text === null) {
            write(`Файл не читается: ${pack.path}`);
            return 1;
        }
        write(text.endsWith('\n') ? text : `${text}\n`);
        return 0;
    }

    if (sub === 'path') {
        const name = String(args[1] ?? '').trim();
        if (!name) {
            const dirs = [...new Set(catalog.map((pack) => pack.dir))];
            for (const dir of dirs) write(dir);
            return 0;
        }
        const pack = catalog.find((item) => item.name === name);
        if (!pack) {
            write(`Пак не найден: ${name}`);
            return 1;
        }
        write(pack.path);
        return 0;
    }

    if (sub === 'rm' || sub === 'remove') {
        const name = String(args[1] ?? '').trim();
        if (!name) throw new UsageError('Укажите пак: ai-webdev skills rm <имя>.');
        const result = await removeSkillPack(name, cwd, { env });
        if (result.removed) {
            write(`Удалён пак: ${name} (${path.relative(cwd, result.path ?? '') || result.path})`);
            return 0;
        }
        if (result.reason === 'builtin') {
            write(`Пак ${name} встроен в пакет установки: его не удаляют.`);
            return 1;
        }
        if (result.reason === 'home') {
            write(`Пак ${name} лежит в домашнем каталоге: удалите его там.`);
            return 1;
        }
        write(`Пак не найден в проекте: ${name}`);
        return 1;
    }

    throw new UsageError('Доступно: ai-webdev skills list | search <текст> | show <имя> | path [имя] | rm <имя>');
}
