/**
 * @file src/cli/install.js
 * @module cli/install
 * @purpose `ai-webdev install` — copy a component of the local registry into a project and
 *          register it there as a `file:` package.
 *
 *   The registry is personal and local: there is no network registry here. The sources of the
 *   component are copied into `<vendorDir>/<tag>` of the project, and `package.json` gets a
 *   dependency of the form `file:./vendor/components/<tag>`, which npm resolves offline.
 *
 * @depends node:path, node:fs/promises, registry, cli/errors
 * @usedBy cli
 * @exports splitSpec, saveDependency, fileSpecifier, installCommand
 * @ai.tags cli, component, registry
 * @ai.hint io
 * @ai.hint legacy-0.2
 * @changed 2026-11-13 Ported from the monolith: the install is a local `file:` package.
 */

import path from 'node:path';
import { cp, mkdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { openRegistry } from '../registry.js';
import { UsageError } from './errors.js';

/**
 * Split `tag@1.2.3` into its parts. A bare `@scope/name` keeps the whole string as the tag.
 * @param {string} spec
 * @returns {{ tag: string, version: string|null }}
 * @exports
 * @ai.hint pure
 */
export function splitSpec(spec) {
    const text = String(spec ?? '').trim();
    if (!text) return { tag: '', version: null };
    const at = text.lastIndexOf('@');
    if (at > 0) return { tag: text.slice(0, at).toLowerCase(), version: text.slice(at + 1) };
    return { tag: text.toLowerCase(), version: null };
}

/**
 * Add or replace one dependency key, keeping the rest of the manifest.
 *
 * The scripts and the existing versions of the other packages are never touched.
 * @param {{ manifest: object, name: string, specifier: string, dev?: boolean }} input
 * @returns {object} the same manifest object
 * @exports
 * @ai.hint pure
 */
export function saveDependency({ manifest, name, specifier, dev = false }) {
    const section = dev ? 'devDependencies' : 'dependencies';
    const other = dev ? 'dependencies' : 'devDependencies';
    manifest[section] = { ...(manifest[section] ?? {}), [name]: specifier };
    // A package cannot sit in both sections at once.
    if (manifest[other] && name in manifest[other]) {
        const { [name]: _removed, ...rest } = manifest[other];
        manifest[other] = rest;
        if (!Object.keys(manifest[other]).length) delete manifest[other];
    }
    return manifest;
}

/**
 * The relative specifier npm understands from the root of the project.
 * @param {string} vendorDir the project-relative destination directory
 * @param {string} tag
 * @returns {string}
 * @exports
 * @ai.hint pure
 */
export function fileSpecifier(vendorDir, tag) {
    const rel = path.posix.join(String(vendorDir).split(/[\\/]+/).filter(Boolean).join('/'), tag);
    return `file:./${rel.replace(/^\.\//, '')}`;
}

/**
 * `ai-webdev install <tag>[@версия] …`
 *
 * @param {{ config: object, cwd: string, args: string[], flags?: Record<string, string|boolean>,
 *   write?: (text: string) => void }} ctx
 * @returns {Promise<number>} the exit code
 * @exports
 * @ai.hint io
 */
export async function installCommand(ctx) {
    const { config, cwd, args = [], flags = {}, write = (text) => process.stdout.write(text) } = ctx;

    const specs = args.map(splitSpec).filter((spec) => spec.tag);
    if (!specs.length) {
        throw new UsageError('Укажите компонент: ai-webdev install <tag>[@версия] […]. Список: ai-webdev component list');
    }

    const manifestPath = path.join(cwd, 'package.json');
    const manifestText = await readFile(manifestPath, 'utf8').catch(() => null);
    if (manifestText === null) {
        throw new UsageError(`В ${cwd} нет package.json. Установите компонент в проект или создайте его: npm init -y`);
    }
    let manifest = null;
    try {
        manifest = JSON.parse(manifestText);
    } catch (error) {
        throw new UsageError(`Некорректный JSON в ${manifestPath}: ${error.message}`);
    }
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
        throw new UsageError(`Некорректный JSON в ${manifestPath}: ожидался объект`);
    }

    const vendorDir = config.components?.vendorDir || 'vendor/components';
    const registry = openRegistry({
        file: config.components?.dbFile,
        dir: config.components?.dir,
    });

    const installed = [];
    const failed = [];
    try {
        for (const spec of specs) {
            const found = registry.get(spec.tag, spec.version);
            if (!found) {
                failed.push(spec.tag);
                write(`В реестре нет компонента ${spec.tag}${spec.version ? `@${spec.version}` : ''}. Список: ai-webdev component list\n`);
                continue;
            }

            const dest = path.resolve(cwd, vendorDir, found.tag);
            const exists = await stat(dest).then(() => true).catch(() => false);
            if (exists && !flags.force && !flags.link) {
                write(`${dest} уже существует — пропущено. Переустановить: ai-webdev install ${found.tag} --force\n`);
                installed.push({ tag: found.tag, version: found.version, dest, skipped: true });
                continue;
            }

            await rm(dest, { recursive: true, force: true });
            await mkdir(path.dirname(dest), { recursive: true });
            let linked = false;
            if (flags.link) {
                try {
                    await symlink(found.dir, dest, 'junction');
                    linked = true;
                } catch (error) {
                    write(`Символьная ссылка не удалась (${error.code ?? error.message}), копируем исходники.\n`);
                }
            }
            if (!linked) await cp(found.dir, dest, { recursive: true });

            saveDependency({
                manifest,
                name: found.name,
                specifier: fileSpecifier(vendorDir, found.tag),
                dev: Boolean(flags.dev),
            });
            registry.recordInstall(found.tag, found.version);
            installed.push({
                tag: found.tag,
                version: found.version,
                dest,
                linked,
                skipped: false,
                contract: found.contract,
            });
            write(`${found.name}@${found.version} → ${path.relative(cwd, dest) || dest}${linked ? ' (ссылка)' : ''}\n`);

            const typed = found.contract?.scriptLanguage === 'typescript';
            if (typed) {
                const built = await stat(path.join(dest, 'dist', `${found.tag}.js`)).then(() => true).catch(() => false);
                if (!built) {
                    write(`${found.tag} на TypeScript: соберите компонент (npm run build в ${dest}), иначе exports указывает на отсутствующий dist/${found.tag}.js\n`);
                }
            }
        }
    } finally {
        registry.close();
    }

    if (flags.save === false) {
        write('package.json не изменён (--no-save).\n');
    } else if (installed.some((item) => !item.skipped)) {
        await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
        write('package.json обновлён. Установите ссылки npm install.\n');
    }

    for (const item of installed.filter((entry) => entry.contract)) {
        write(`  import '${item.contract.name}';  →  <${item.contract.tag}></${item.contract.tag}>\n`);
    }

    return failed.length && !installed.length ? 1 : 0;
}
