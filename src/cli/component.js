/**
 * @file src/cli/component.js
 * @module cli/component
 * @purpose `ai-webdev component` — publish, list, search, show and remove the components of the
 *          local registry.
 *
 *   The registry is personal: it lives in the home of the CLI and needs no network. A component
 *   is published from a project that carries the contract `.ai/component.json`; the sources are
 *   copied, so the project stays free to change.
 *
 * @depends node:path, node:fs/promises, registry, generate/component, cli/errors
 * @usedBy cli
 * @exports componentCommand
 * @ai.tags cli, component, registry
 * @ai.hint io
 * @ai.hint legacy-0.2
 * @changed 2026-11-13 Ported from the monolith: the registry of the personal components.
 */

import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { openRegistry } from '../registry.js';
import { COMPONENT_CONTRACT_PATH, componentTagName } from '../generate/component.js';
import { UsageError } from './errors.js';

/**
 * One line of a component in a list.
 * @param {object} component
 * @returns {string}
 * @ai.hint pure
 */
function cardLine(component) {
    const tags = component.tags?.length ? ` [${component.tags.join(', ')}]` : '';
    return `${component.tag}@${component.version}\t${component.framework}\t${component.summary || '—'}${tags}`;
}

/**
 * `ai-webdev component [publish|list|search|show|rm|path]`
 * @param {{ config: object, cwd: string, args: string[], flags?: Record<string, string|boolean>,
 *   write?: (text: string) => void }} ctx
 * @returns {Promise<number>} the exit code
 * @exports
 * @ai.hint io
 */
export async function componentCommand(ctx) {
    const { config, cwd, args = [], flags = {}, write = (text) => process.stdout.write(text) } = ctx;
    const sub = args[0] ?? 'list';

    const registry = openRegistry({
        file: config.components?.dbFile,
        dir: config.components?.dir,
    });

    try {
        if (sub === 'path') {
            write(`Каталог: ${config.components?.dir}\nИндекс:  ${config.components?.dbFile}\n`);
            return 0;
        }

        if (sub === 'publish') {
            const sourceRoot = path.resolve(cwd, args[1] ?? '.');
            let contract = null;
            const wanted = String(flags.tag ?? '').trim();
            if (wanted) {
                const at = wanted.lastIndexOf('@');
                const tag = at > 0 ? wanted.slice(0, at) : wanted;
                const version = at > 0 ? wanted.slice(at + 1) : null;
                const text = await readFile(path.join(sourceRoot, COMPONENT_CONTRACT_PATH), 'utf8')
                    .catch(() => { throw new UsageError(`${COMPONENT_CONTRACT_PATH} не найден в ${sourceRoot}.`); });
                try {
                    contract = JSON.parse(text);
                } catch (error) {
                    throw new UsageError(`Некорректный JSON в ${path.join(sourceRoot, COMPONENT_CONTRACT_PATH)}: ${error.message}`);
                }
                if (tag) contract.tag = componentTagName(tag);
                if (version) contract.version = version;
            }
            const result = await registry.publish({ sourceRoot, contract, tags: flags.tags ?? '' });
            write(`${result.replaced ? 'Обновлён' : 'Опубликован'} компонент ${result.tag}@${result.version}\n`);
            write(`Файлов: ${result.files.length}  Содержимое: ${result.sha256}\n`);
            write(`${result.path}\n`);
            write(`Установка в проект: ai-webdev install ${result.tag}\n`);
            return 0;
        }

        if (sub === 'list') {
            const items = registry.list({ framework: flags.framework ?? null });
            if (!items.length) {
                write('Реестр пуст. Опубликуйте компонент из проекта с контрактом:\n  ai-webdev component publish\n');
                return 0;
            }
            for (const item of items) write(`${cardLine(item)}\n`);
            write(`Всего: ${items.length}\n`);
            return 0;
        }

        if (sub === 'search') {
            const query = args.slice(1).join(' ').trim();
            if (!query) throw new UsageError('Укажите запрос: ai-webdev component search <текст>');
            const items = registry.search(query, { framework: flags.framework ?? null });
            if (!items.length) {
                write(`Ничего не найдено: ${query}\n`);
                return 1;
            }
            for (const item of items) write(`${cardLine(item)}\n`);
            return 0;
        }

        if (sub === 'show') {
            const raw = String(args[1] ?? '').trim();
            const at = raw.lastIndexOf('@');
            const tag = at > 0 ? raw.slice(0, at).toLowerCase() : raw.toLowerCase();
            const version = at > 0 ? raw.slice(at + 1) : null;
            if (!tag) throw new UsageError('Укажите тег: ai-webdev component show <tag>[@версия]');
            const found = registry.get(tag, version);
            if (!found) {
                write(`Компонент не найден: ${tag}${version ? `@${version}` : ''}\n`);
                return 1;
            }
            const readme = await readFile(path.join(found.dir, 'README.md'), 'utf8').catch(() => null);
            if (readme) write(readme.endsWith('\n') ? readme : `${readme}\n`);
            else write(`${JSON.stringify(found.contract, null, 2)}\n`);
            write(`\n--- ${found.tag}@${found.version}  ${found.dir}  установок: ${found.installs}\n`);
            return 0;
        }

        if (sub === 'rm' || sub === 'remove') {
            const raw = String(args[1] ?? '').trim();
            const at = raw.lastIndexOf('@');
            const tag = at > 0 ? raw.slice(0, at).toLowerCase() : raw.toLowerCase();
            const version = at > 0 ? raw.slice(at + 1) : null;
            if (!tag) throw new UsageError('Укажите тег: ai-webdev component rm <tag>[@версия]');
            const result = registry.remove(tag, { version, keepFiles: Boolean(flags['keep-files']) });
            if (!result.removed.length) {
                write(`Компонент не найден: ${tag}${version ? `@${version}` : ''}\n`);
                return 1;
            }
            write(`Удалён из реестра: ${result.removed.join(', ')}\n`);
            if (flags['keep-files']) write(`Исходники оставлены: ${result.kept}\n`);
            return 0;
        }

        throw new UsageError('Доступно: ai-webdev component list | publish [путь] | search <текст> | show <tag> | rm <tag> | path');
    } finally {
        registry.close();
    }
}
