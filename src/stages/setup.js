/**
 * @file src/stages/setup.js
 * @module stages/setup
 * @purpose The environment of the project: the dependencies, the scripts and the proof that the
 *          project starts.
 *
 *   The stage asks the installer for the environment and then applies the deterministic part
 *   of the answer itself: the dependencies and the scripts go into `package.json`, the files
 *   that are named in the answer are written, and the readiness of the project is checked.
 *
 *   The check is honest: a project without the installed packages is not ready, and the stage
 *   says so instead of hiding it.
 *
 * @depends node:path, node:fs/promises, roles/index, stages/architect, stages/workspace,
 *          agent/fs-tools, agent/paths, cli/install
 * @usedBy stages/index, stages/markup, stages/coding, pipeline
 * @exports SETUP_FILE, detectPackageManager, ensureScaffold, hasEnvironment, applySetup,
 *          setupReadiness, writeSetup, readSetup, setupStage, INSTALL_CORRECTION
 * @ai.tags stages, setup, dependencies
 * @ai.hint io
 * @ai.hint legacy-0.2
 * @changed 2026-11-13 Ported from the monolith: the setup is applied by the code, not only reported.
 */

import path from 'node:path';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { runRole } from '../roles/index.js';
import { writeTextFile } from '../agent/fs-tools.js';
import { saveDependency } from '../cli/install.js';
import { preparedScaffoldFiles, writePreparedScaffold } from '../generate/scaffold.js';
import { architectureText } from './architect.js';
import { runId, runFile, writeJsonFile, readJsonFile } from './workspace.js';

/** The name of the file of the setup inside the directory of the run. */
export const SETUP_FILE = 'setup.json';

/**
 * The correction of an installer that only described its work.
 *
 * The answer of the installer is the environment: the dependencies, the scripts and the files.
 * An answer with none of them is a plan, not an environment.
 * @type {string}
 * @exports
 * @ai.hint pure
 */
export const INSTALL_CORRECTION = 'Your answer names no dependency, no script and no file: that is a description of the work, not the work. Do it now — read the manifest of the project, add the dependencies and the scripts that the stack needs, and answer with them.';

/** The lock files that tell which package manager the project uses. */
const LOCK_FILES = Object.freeze([
    { file: 'pnpm-lock.yaml', manager: 'pnpm' },
    { file: 'yarn.lock', manager: 'yarn' },
    { file: 'bun.lockb', manager: 'bun' },
    { file: 'bun.lock', manager: 'bun' },
    { file: 'package-lock.json', manager: 'npm' },
    { file: 'npm-shrinkwrap.json', manager: 'npm' },
]);

/**
 * The package manager of the project, by its lock file.
 * @param {string} root
 * @returns {Promise<string>} the manager, or `none` when the project has no manifest
 * @exports
 * @ai.hint io
 */
export async function detectPackageManager(root) {
    for (const item of LOCK_FILES) {
        const found = await stat(path.join(root, item.file)).then((info) => info.isFile()).catch(() => false);
        if (found) return item.manager;
    }
    const manifest = await stat(path.join(root, 'package.json')).then((info) => info.isFile()).catch(() => false);
    return manifest ? 'npm' : 'none';
}

/**
 * Read the manifest of the project.
 * @param {string} root
 * @returns {Promise<{ manifest: object|null, text: string|null, exists: boolean }>}
 * @ai.hint io
 */
async function readManifest(root) {
    const file = path.join(root, 'package.json');
    const text = await readFile(file, 'utf8').catch(() => null);
    if (text === null) return { manifest: null, text: null, exists: false };
    try {
        const parsed = JSON.parse(text);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            return { manifest: null, text, exists: true };
        }
        return { manifest: parsed, text, exists: true };
    } catch {
        return { manifest: null, text, exists: true };
    }
}

/**
 * True when the answer of the installer holds an environment.
 *
 * The environment is the dependencies, the scripts and the files: an answer without them is a
 * description of the work.
 * @param {object} data
 * @returns {boolean}
 * @exports
 * @ai.hint pure
 */
export function hasEnvironment(data = {}) {
    const list = (value) => (Array.isArray(value) ? value.length : 0);
    return list(data.dependencies) + list(data.scripts) + list(data.files) > 0;
}

/**
 * The skeleton of the project: the manifest, the config of the bundler and the rules.
 *
 * A project without a manifest has no environment, and the environment is not a matter of
 * taste: the code writes the skeleton itself, with the stack of the architect, instead of
 * asking the model for it. A project that already has a manifest is left alone.
 *
 * @param {{ root: string, architecture?: object|null, kind?: string|null }} request
 * @returns {Promise<{ written: string[], skipped: string[], scaffolded: boolean }>}
 * @exports
 * @ai.hint io
 */
export async function ensureScaffold({ root, architecture = null, kind = 'landing' } = {}) {
    const exists = await stat(path.join(root, 'package.json'))
        .then((info) => info.isFile())
        .catch(() => false);
    if (exists) return { written: [], skipped: ['package.json'], scaffolded: false };

    const stack = architecture?.stack ?? {};
    const files = preparedScaffoldFiles({
        kind,
        name: path.basename(root),
        framework: stack.framework ?? 'vanilla',
        scriptLanguage: stack.script ?? null,
        styleLanguage: stack.style ?? null,
        markup: stack.markup ?? null,
    });
    const result = await writePreparedScaffold(root, files);
    return { ...result, scaffolded: true };
}

/**
 * Apply the answer of the installer to the project.
 *
 * The dependencies and the scripts go into `package.json`; the files of the answer are written
 * when they are not there yet. Nothing is deleted, and a script that already exists is kept
 * unless `overwrite` says otherwise.
 *
 * @param {{ root: string, data: object, overwrite?: boolean, maxWriteBytes?: number }} request
 * @returns {Promise<{ manifest: object|null, manifestChanged: boolean, dependencies: string[],
 *   scripts: string[], files: string[], warnings: string[] }>}
 * @exports
 * @ai.hint io
 */
export async function applySetup({ root, data = {}, overwrite = false, maxWriteBytes = 4 * 1024 * 1024 } = {}) {
    const warnings = [];
    const dependencies = [];
    const scripts = [];
    const files = [];

    const { manifest, text, exists } = await readManifest(root);
    if (exists && !manifest) {
        warnings.push('package.json есть, но это не корректный JSON: зависимости не тронуты.');
    }
    const next = manifest ? { ...manifest } : (exists ? null : { name: 'app', version: '0.1.0', private: true });

    for (const item of Array.isArray(data.dependencies) ? data.dependencies : []) {
        const name = String(item?.name ?? '').trim();
        const version = String(item?.version ?? '').trim();
        if (!name || !version) {
            warnings.push('Зависимость без имени или версии пропущена.');
            continue;
        }
        if (!next) break;
        saveDependency({ manifest: next, name, specifier: version, dev: Boolean(item.dev) });
        dependencies.push(`${name}@${version}${item.dev ? ' (dev)' : ''}`);
    }

    for (const item of Array.isArray(data.scripts) ? data.scripts : []) {
        const name = String(item?.name ?? '').trim();
        const command = String(item?.command ?? '').trim();
        if (!name || !command) {
            warnings.push('Скрипт без имени или команды пропущен.');
            continue;
        }
        if (!next) break;
        next.scripts = next.scripts ?? {};
        if (next.scripts[name] && !overwrite) {
            warnings.push(`Скрипт "${name}" уже есть и не тронут.`);
            continue;
        }
        next.scripts[name] = command;
        scripts.push(`${name}: ${command}`);
    }

    for (const item of Array.isArray(data.files) ? data.files : []) {
        const rel = String(item?.path ?? '').trim();
        const content = typeof item?.content === 'string' ? item.content : null;
        if (!rel || content === null) {
            warnings.push('Файл без пути или содержимого пропущен.');
            continue;
        }
        if (path.basename(rel) === 'package.json') {
            files.push(rel);
            continue;
        }
        try {
            const written = await writeTextFile({
                root,
                file: rel,
                content,
                overwrite,
                maxBytes: maxWriteBytes,
                backupSlot: 'setup',
            });
            files.push(written.rel);
        } catch (error) {
            warnings.push(`Файл ${rel} не записан: ${error?.message ?? error}`);
        }
    }

    let manifestChanged = false;
    if (next && (dependencies.length || scripts.length)) {
        const before = text ?? '';
        const after = `${JSON.stringify(next, null, 2)}\n`;
        if (before !== after) {
            await writeFile(path.join(root, 'package.json'), after, 'utf8');
            manifestChanged = true;
        }
    }

    return { manifest: next, manifestChanged, dependencies, scripts, files, warnings };
}

/**
 * Check whether the project is ready to work.
 *
 * @param {string} root
 * @param {object} [config]
 * @returns {Promise<{ ok: boolean, checks: { id: string, ok: boolean, message: string }[] }>}
 * @exports
 * @ai.hint io
 */
export async function setupReadiness(root, config = {}) {
    const checks = [];
    /**
     * One check of the readiness.
     * @param {string} id
     * @param {boolean} ok
     * @param {string} message
     * @returns {void}
     * @ai.hint pure
     */
    const check = (id, ok, message) => checks.push({ id, ok, message });

    const { manifest, exists } = await readManifest(root);
    check('manifest', exists, exists ? 'package.json есть.' : 'package.json нет.');
    check('manifest-json', Boolean(manifest), manifest ? 'package.json корректен.' : 'package.json не прочитан.');

    const manager = await detectPackageManager(root);
    check('package-manager', manager !== 'none', `Менеджер пакетов: ${manager}.`);

    const modules = await stat(path.join(root, 'node_modules')).then((info) => info.isDirectory()).catch(() => false);
    check('node-modules', modules, modules ? 'node_modules есть.' : 'node_modules нет: зависимости не установлены.');

    const scripts = manifest?.scripts && typeof manifest.scripts === 'object' ? Object.keys(manifest.scripts) : [];
    check('scripts', scripts.length > 0, scripts.length ? `Скрипты: ${scripts.join(', ')}.` : 'Скриптов нет.');

    const entry = await stat(path.join(root, 'index.html')).then((info) => info.isFile()).catch(() => false);
    check('entry', entry, entry ? 'index.html есть.' : 'index.html нет.');

    const bridges = Object.entries(config?.bridges ?? {})
        .filter(([, value]) => value?.enabled !== false)
        .map(([name]) => name);
    check('bridges', true, bridges.length ? `Мосты включены: ${bridges.join(', ')}.` : 'Мосты выключены.');

    return { ok: checks.every((item) => item.ok), checks };
}

/**
 * The path of the setup of a run.
 * @param {string} root
 * @param {object} config
 * @param {string} id
 * @returns {string}
 * @exports
 * @ai.hint pure
 */
export function setupPath(root, config = {}, id = null) {
    return runFile(root, config, id, SETUP_FILE);
}

/**
 * Write the setup of a run.
 * @param {string} root
 * @param {object} config
 * @param {string} id
 * @param {object} setup
 * @returns {Promise<string>}
 * @exports
 * @ai.hint io
 */
export async function writeSetup(root, config = {}, id = null, setup = {}) {
    return await writeJsonFile(setupPath(root, config, id), setup);
}

/**
 * Read the setup of a run. A missing file gives null.
 * @param {string} root
 * @param {object} config
 * @param {string} id
 * @returns {Promise<object|null>}
 * @exports
 * @ai.hint io
 */
export async function readSetup(root, config = {}, id = null) {
    return await readJsonFile(setupPath(root, config, id));
}

/**
 * The stage of the setup: the installer prepares the environment and the code applies it.
 *
 * @param {{ client: object, config?: object, root?: string, task?: string, plan?: object|null,
 *   architecture?: object|null, runId?: string|null, overwrite?: boolean,
 *   notify?: (event: object) => void, env?: object }} request
 * @returns {Promise<{ stage: string, ok: boolean, setup: object|null, applied: object|null,
 *   readiness: object, file: string|null, warnings: string[], turns: number, usage: object|null,
 *   runId: string }>}
 * @exports
 * @ai.hint io
 */
export async function setupStage({
    client,
    config = {},
    root = process.cwd(),
    task = '',
    plan = null,
    architecture = null,
    runId: id = null,
    overwrite = false,
    notify = () => {},
    env = process.env,
} = {}) {
    if (!client?.responses) throw new Error('Клиент API не передан.');

    const run = id ?? runId();
    const manager = await detectPackageManager(root);
    const brief = architecture ? architectureText(architecture) : '';

    // The skeleton of the project first: the manifest, the bundler and the rules.
    const scaffold = await ensureScaffold({ root, architecture });

    const blocks = [];
    if (task) blocks.push(String(task).trim());
    if (plan?.steps?.length) blocks.push(`The plan:\n${plan.steps.map((step) => `- ${step.id}: ${step.title}`).join('\n')}`);
    if (brief) blocks.push(brief);
    if (scaffold.scaffolded) {
        blocks.push(`The skeleton of the project is already written: ${scaffold.written.join(', ')}. Add what is missing: the dependencies, the scripts and the files that the stack needs.`);
    }

    let result = await runRole({
        client,
        config,
        role: 'installer',
        input: blocks.join('\n\n'),
        context: {
            task: String(task ?? ''),
            step: plan?.steps?.[0] ?? null,
            brief,
            stack: config?.stack ?? {},
            packageManager: manager,
            project: root,
        },
        root,
        env,
        maxTurns: config?.stages?.setup?.maxTurns ?? null,
        notify,
    });

    // The installer that only described its work is asked to do it.
    if (result.data && !hasEnvironment(result.data)) {
        result = await runRole({
            client,
            config,
            role: 'installer',
            input: `${blocks.join('\n\n')}\n\n${INSTALL_CORRECTION}`,
            context: {
                task: String(task ?? ''),
                step: plan?.steps?.[0] ?? null,
                brief,
                stack: config?.stack ?? {},
                packageManager: manager,
                project: root,
            },
            root,
            env,
            maxTurns: config?.stages?.setup?.maxTurns ?? null,
            notify,
        });
    }

    if (!result.data) {
        const readiness = await setupReadiness(root, config);
        // The skeleton is written even when the installer says nothing: the manifest and the
        // bundler are the environment of the project.
        const manifest = readiness.checks.find((item) => item.id === 'manifest')?.ok ?? false;
        const empty = {
            summary: '',
            packageManager: manager,
            dependencies: [],
            scripts: [],
            commands: [],
            notes: '',
            scaffold: { written: scaffold.written, skipped: scaffold.skipped },
            applied: { dependencies: [], scripts: [], files: [], manifestChanged: false },
            readiness,
        };
        const file = await writeSetup(root, config, run, empty);
        return {
            stage: 'setup',
            ok: manifest,
            setup: empty,
            applied: null,
            readiness,
            file,
            warnings: manifest
                ? ['Установщик не вернул окружение: остался только каркас проекта.']
                : ['Установщик не вернул окружение.'],
            turns: result.turns,
            usage: result.usage,
            runId: run,
        };
    }

    const data = result.data;
    const applied = await applySetup({ root, data, overwrite });
    const readiness = await setupReadiness(root, config);

    const setup = {
        summary: String(data.summary ?? '').trim(),
        packageManager: String(data.packageManager ?? manager).trim() || manager,
        dependencies: Array.isArray(data.dependencies) ? data.dependencies : [],
        scripts: Array.isArray(data.scripts) ? data.scripts : [],
        commands: Array.isArray(data.commands) ? data.commands : [],
        notes: String(data.notes ?? '').trim(),
        scaffold: { written: scaffold.written, skipped: scaffold.skipped },
        applied: {
            dependencies: applied.dependencies,
            scripts: applied.scripts,
            files: applied.files,
            manifestChanged: applied.manifestChanged,
        },
        readiness,
    };

    const file = await writeSetup(root, config, run, setup);
    const warnings = [...applied.warnings];
    if (!readiness.ok) {
        const failed = readiness.checks.filter((item) => !item.ok).map((item) => item.message);
        warnings.push(...failed);
    }

    return {
        stage: 'setup',
        ok: true,
        setup,
        applied,
        readiness,
        file,
        warnings,
        turns: result.turns,
        usage: result.usage,
        runId: run,
    };
}
