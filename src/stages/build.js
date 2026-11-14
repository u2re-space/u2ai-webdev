/**
 * @file src/stages/build.js
 * @module stages/build
 * @purpose The styles of the project are connected: the entry point, the compilation and the
 *          links of the markup.
 *
 *   A model writes `styles/main.scss` with three partials beside it and forgets two things:
 *   the entry point does not always `@use` the partials, and the page links a CSS file that
 *   was never built. The result looks right on the screen of the model and looks broken in
 *   the browser: the styles are simply not there.
 *
 *   The stage does what the model forgot, and it does it without the model:
 *   * it finds the entry point of the styles (the stylesheet that is not a partial and that
 *     nobody uses);
 *   * it adds the missing `@use` for a partial that nobody uses;
 *   * it names the files that a stylesheet uses and that were never written;
 *   * it compiles the entry with the `sass` of the project;
 *   * it makes sure that the markup points at the CSS that exists and at the script that runs.
 *
 *   Nothing here talks to the model: the stage is deterministic, so it may be re-run.
 *
 * @depends node:path, node:fs/promises, agent/programs, agent/syntax, stages/workspace
 * @usedBy stages/index, pipeline
 * @exports BUILD_FILE, STYLE_EXTENSIONS, listStyleFiles, styleReferences, partitionStyles,
 *          primaryEntry, insertUses, ensureUses, htmlRefs, resolveRef, hrefFor,
 *          ensureHtmlWiring, compileStyles, missingReferences, verifyStyles, scratchStyles,
 *          isViteProject, importPath, scriptImports, ensureStyleImport, insertImport,
 *          removeStyleLink, buildPath, writeBuild, readBuild, buildStage
 * @ai.tags stages, build, styles, sass
 * @ai.hint io
 * @changed 2026-11-14 Первая версия: стили собираются и подключаются кодом.
 */

import path from 'node:path';
import os from 'node:os';
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';

import { runProgram } from '../agent/programs.js';
import { findSass, firstError, styleReferences, missingStyleReferences } from '../agent/syntax.js';
import { runId, runFile, writeJsonFile, readJsonFile } from './workspace.js';

export { styleReferences };

/** The name of the file of the build inside the directory of the run. */
export const BUILD_FILE = 'build.json';

/** The extensions of the stylesheets the stage knows. */
export const STYLE_EXTENSIONS = Object.freeze(['.scss', '.sass']);

/** The directories that never hold the styles of the project. */
const SKIP_DIRS = /^(?:\.git|node_modules|\.hg|\.svn|dist|build|coverage|\.next|\.nuxt|\.cache|\.venv|venv|__pycache__|target|\.backup|\.tmp|\.ai)$/i;

/** The names of the entry point of the styles, from the best to the worst. */
const ENTRY_NAMES = Object.freeze(['main', 'styles', 'style', 'index', 'app', 'theme', 'global']);

/** The names of a partial that looks like a scratch copy and is not a part of the styles. */
const SCRATCH_NAMES = /(?:^|[-_.])(?:incorrect|wrong|copy|old|backup|bak|tmp|temp|fix|draft)(?:[-_.]|$)/i;

/**
 * The files of the styles of the project.
 *
 * The walk is shallow and skips the noisy directories: the styles of a project live near its
 * entry point, not inside `node_modules`.
 * @param {string} root
 * @param {{ limit?: number, depth?: number }} [options]
 * @returns {Promise<string[]>} the paths, relative to the root, in posix form
 * @exports
 * @ai.hint io
 */
export async function listStyleFiles(root, { limit = 200, depth = 6 } = {}) {
    const found = [];
    /**
     * Walk one directory.
     * @param {string[]} parts the parts of the path of the directory
     * @param {number} level the depth of the walk
     * @returns {Promise<void>}
     * @ai.hint io
     */
    async function walk(parts, level) {
        if (found.length >= limit || level > depth) return;
        const entries = await readdir(path.join(root, ...parts), { withFileTypes: true }).catch(() => null);
        if (!entries) return;
        for (const entry of entries) {
            if (found.length >= limit) return;
            if (entry.isDirectory()) {
                if (SKIP_DIRS.test(entry.name)) continue;
                await walk([...parts, entry.name], level + 1);
                continue;
            }
            if (!entry.isFile()) continue;
            if (!STYLE_EXTENSIONS.includes(path.extname(entry.name).toLowerCase())) continue;
            found.push(path.posix.join(...parts, entry.name));
        }
    }
    await walk([], 0);
    return found.sort();
}

/**
 * The file of the styles that a name points to.
 * @param {string} ref the name as it is written
 * @param {string} from the file that names it
 * @param {string[]} files all the files of the styles
 * @returns {string|null}
 * @exports
 * @ai.hint pure
 */
function resolveReference(ref, from, files) {
    const dir = path.posix.dirname(from);
    const base = path.posix.join(dir === '.' ? '' : dir, ref);
    const name = path.posix.basename(base);
    const parent = path.posix.dirname(base);
    const candidates = [
        base,
        `${base}.scss`,
        `${base}.sass`,
        path.posix.join(parent, `_${name}`),
        path.posix.join(parent, `_${name}.scss`),
        path.posix.join(parent, `_${name}.sass`),
    ];
    return candidates.find((item) => files.includes(item)) ?? null;
}

/**
 * Split the stylesheets into the entry points, the partials and the orphans.
 *
 * A partial is a file whose name starts with an underscore. A stylesheet that nobody uses is
 * an orphan: its rules are never on the page.
 * @param {string[]} files the paths of the stylesheets
 * @param {Map<string, string>} contents the text of every stylesheet
 * @returns {{ entries: string[], partials: string[], orphans: string[], used: string[] }}
 * @exports
 * @ai.hint pure
 */
export function partitionStyles(files = [], contents = new Map()) {
    const list = Array.isArray(files) ? files : [];
    const partials = [];
    const candidates = [];
    for (const file of list) {
        const name = path.posix.basename(file);
        if (name.startsWith('_')) {
            partials.push(file);
            continue;
        }
        candidates.push(file);
    }
    const used = new Set();
    for (const file of list) {
        const text = contents?.get?.(file) ?? '';
        for (const ref of styleReferences(text)) {
            const target = resolveReference(ref, file, list);
            if (target) used.add(target);
        }
    }
    const entries = candidates.filter((file) => !used.has(file));
    const orphans = partials.filter((file) => !used.has(file));
    return { entries, partials, orphans, used: [...used] };
}

/**
 * The stylesheets that look like a scratch copy of another one.
 *
 * A model that repairs a file sometimes writes the fixed copy beside the broken one: the
 * copy is not a part of the styles, and it must not be built or linked.
 * @param {string[]} files
 * @returns {string[]}
 * @exports
 * @ai.hint pure
 */
export function scratchStyles(files = []) {
    return (Array.isArray(files) ? files : []).filter((file) => SCRATCH_NAMES.test(path.posix.basename(file)));
}

/**
 * The main entry point of the styles.
 *
 * The name decides: `main.scss` before `theme.scss`. The path breaks the tie: the file near
 * the root of the project is the entry point.
 * @param {string[]} entries
 * @returns {string|null}
 * @exports
 * @ai.hint pure
 */
export function primaryEntry(entries = []) {
    const list = Array.isArray(entries) ? entries : [];
    if (!list.length) return null;
    const rank = (file) => {
        const name = path.posix.basename(file).replace(/\.(scss|sass)$/i, '').toLowerCase();
        const index = ENTRY_NAMES.indexOf(name);
        return index === -1 ? ENTRY_NAMES.length : index;
    };
    return [...list].sort((a, b) => (rank(a) - rank(b)) || a.split('/').length - b.split('/').length || a.localeCompare(b))[0];
}

/**
 * Add the `@use` of the partials into a stylesheet.
 *
 * The rules of Sass want the `@use` before any other rule, so the lines go after the last
 * `@use`, `@forward`, `@import` or `@charset` of the head, and after the comment that opens
 * the file.
 * @param {string} content
 * @param {string[]} names the names of the partials, without the underscore
 * @returns {string}
 * @exports
 * @ai.hint pure
 */
export function insertUses(content, names = []) {
    const list = (Array.isArray(names) ? names : []).map((item) => String(item ?? '').trim()).filter(Boolean);
    if (!list.length) return String(content ?? '');
    const text = String(content ?? '');
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    const lines = text.split(/\r?\n/);
    let at = 0;
    for (let index = 0; index < Math.min(lines.length, 80); index++) {
        const line = lines[index];
        if (/^\s*@(?:use|forward|import|charset)\b/.test(line)) {
            at = index + 1;
            continue;
        }
        if (!line.trim() || /^\s*(?:\/\/|\/\*|\*)/.test(line)) continue;
        break;
    }
    const added = list.map((name) => `@use '${name}';`);
    return [...lines.slice(0, at), ...added, ...lines.slice(at)].join(eol);
}

/**
 * Add the missing `@use` into the entry points.
 *
 * A partial that nobody uses renders nothing: its rules never reach the page. The partial is
 * added to the entry point of its own directory.
 * @param {string} root
 * @param {{ entries: string[], orphans: string[] }} styles
 * @param {{ contents?: Map<string, string>, apply?: boolean }} [options]
 * @returns {Promise<{ added: { file: string, partial: string }[], planned: { file: string, partial: string }[],
 *   skipped: string[] }>}
 * @exports
 * @ai.hint io
 */
export async function ensureUses(root, styles = {}, { contents = new Map(), apply = true } = {}) {
    const entries = Array.isArray(styles.entries) ? styles.entries : [];
    const orphans = Array.isArray(styles.orphans) ? styles.orphans : [];
    const added = [];
    const planned = [];
    const skipped = [];
    for (const orphan of orphans) {
        const name = path.posix.basename(orphan);
        if (SCRATCH_NAMES.test(name)) {
            skipped.push(orphan);
            continue;
        }
        const dir = path.posix.dirname(orphan);
        const entry = entries.find((file) => path.posix.dirname(file) === dir) ?? primaryEntry(entries);
        if (!entry) {
            skipped.push(orphan);
            continue;
        }
        const plain = name.replace(/^_/, '').replace(/\.(scss|sass)$/i, '');
        const text = contents?.get?.(entry) ?? await readFile(path.join(root, entry), 'utf8').catch(() => '');
        if (!text) {
            skipped.push(orphan);
            continue;
        }
        const already = styleReferences(text).some((ref) => {
            const base = path.posix.basename(ref).replace(/\.(scss|sass)$/i, '');
            return base === plain;
        });
        if (already) continue;
        planned.push({ file: entry, partial: orphan });
        if (!apply) continue;
        const updated = insertUses(text, [`./${plain}`]);
        await mkdir(path.dirname(path.join(root, entry)), { recursive: true });
        await writeFile(path.join(root, entry), updated, 'utf8');
        contents?.set?.(entry, updated);
        added.push({ file: entry, partial: orphan });
    }
    return { added, planned, skipped };
}

/**
 * The links of a markup file.
 * @param {string} html
 * @returns {{ styles: string[], scripts: string[] }} the paths as they are written
 * @exports
 * @ai.hint pure
 */
export function htmlRefs(html) {
    const text = String(html ?? '');
    const styles = [];
    const scripts = [];
    const links = text.match(/<link\b[^>]*>/gi) ?? [];
    for (const tag of links) {
        if (!/rel\s*=\s*["']?stylesheet/i.test(tag)) continue;
        const href = tag.match(/href\s*=\s*["']([^"']+)["']/i);
        if (href) styles.push(href[1].trim());
    }
    const tags = text.match(/<script\b[^>]*>/gi) ?? [];
    for (const tag of tags) {
        const src = tag.match(/src\s*=\s*["']([^"']+)["']/i);
        if (src) scripts.push(src[1].trim());
    }
    return { styles, scripts };
}

/**
 * The path of a file of the project, as the markup names it.
 * @param {string} htmlRel the path of the markup
 * @param {string} ref the name as it is written
 * @returns {string} the path relative to the root, in posix form
 * @exports
 * @ai.hint pure
 */
export function resolveRef(htmlRel, ref) {
    const text = String(ref ?? '').trim();
    if (!text) return '';
    if (/^(?:https?:)?\/\//i.test(text) || text.startsWith('data:')) return '';
    const clean = text.split(/[?#]/)[0];
    const dir = path.posix.dirname(String(htmlRel ?? 'index.html'));
    const joined = clean.startsWith('/')
        ? clean.slice(1)
        : path.posix.join(dir === '.' ? '' : dir, clean);
    return path.posix.normalize(joined).replace(/^\.\//, '');
}

/**
 * Compile the stylesheets of the project.
 *
 * The compiler of the project is used: the version of the stylesheets of the project is the
 * version the project was written for. Without a compiler the styles are not built, and the
 * report says so.
 * @param {string} root
 * @param {{ source: string, output: string }[]} targets
 * @param {{ env?: object, timeoutMs?: number }} [options]
 * @returns {Promise<{ compiled: string[], errors: { file: string, message: string }[], note: string|null }>}
 * @exports
 * @ai.hint io
 */
export async function compileStyles(root, targets = [], { env = process.env, timeoutMs = 120_000 } = {}) {
    const list = Array.isArray(targets) ? targets : [];
    const sass = await findSass(root, env);
    if (!sass) {
        return { compiled: [], errors: [], note: 'sass не найден: стили не собраны.' };
    }
    const compiled = [];
    const errors = [];
    for (const target of list) {
        const source = String(target?.source ?? '').trim();
        const output = String(target?.output ?? '').trim();
        if (!source || !output) continue;
        const outFile = path.join(root, output);
        await mkdir(path.dirname(outFile), { recursive: true });
        const result = await runProgram({
            command: sass,
            args: ['--no-source-map', source, output],
            cwd: root,
            env,
            timeoutMs,
        });
        if (result.ok) {
            compiled.push(output);
            continue;
        }
        // The compiler writes the error into the output file when the output is a file: a
        // stylesheet with an error inside is worse than no stylesheet at all.
        await rm(outFile, { force: true }).catch(() => null);
        errors.push({ file: source, message: firstError(result.stderr || result.stdout) });
    }
    return { compiled, errors, note: null };
}

/**
 * The stylesheets that use a file that is not on the disk.
 *
 * A model writes an entry point that `@use`s five files and writes none of them: the page
 * has no styles, and the project of Vite breaks with "Can't find stylesheet to import".
 * The names of the missing files are found here, before the compiler is asked.
 * @param {string} root
 * @param {string[]} files the paths of the stylesheets
 * @param {Map<string, string>} contents the text of every stylesheet
 * @returns {Promise<{ file: string, ref: string, expected: string }[]>}
 * @exports
 * @ai.hint io
 */
export async function missingReferences(root, files = [], contents = new Map()) {
    const out = [];
    for (const file of Array.isArray(files) ? files : []) {
        const content = contents?.get?.(file) ?? await readFile(path.join(root, file), 'utf8').catch(() => null);
        if (content === null) continue;
        const missing = await missingStyleReferences(root, file, { content });
        for (const item of missing) out.push({ file, ref: item.ref, expected: item.expected });
    }
    return out;
}

/**
 * Check that the stylesheets compile, without writing the result into the project.
 *
 * The bundler of Vite compiles the styles itself, so the stage does not build them. But the
 * stage still checks them: a stylesheet that does not compile breaks the build of the user,
 * and the run has to say so instead of leaving a broken project behind.
 * @param {string} root
 * @param {string[]} sources the paths of the stylesheets
 * @param {{ env?: object, timeoutMs?: number }} [options]
 * @returns {Promise<{ checked: string[], errors: { file: string, message: string }[], note: string|null }>}
 * @exports
 * @ai.hint io
 */
export async function verifyStyles(root, sources = [], { env = process.env, timeoutMs = 120_000 } = {}) {
    const list = (Array.isArray(sources) ? sources : []).map((item) => String(item ?? '').trim()).filter(Boolean);
    const sass = await findSass(root, env);
    if (!sass) {
        return { checked: [], errors: [], note: 'sass не найден: стили не проверены.' };
    }
    const checked = [];
    const errors = [];
    const out = path.join(os.tmpdir(), `ai-webdev-check-${process.pid}-${Date.now()}`);
    await mkdir(out, { recursive: true }).catch(() => null);
    for (const source of list) {
        checked.push(source);
        const result = await runProgram({
            command: sass,
            args: ['--no-source-map', source, path.join(out, 'check.css')],
            cwd: root,
            env,
            timeoutMs,
        });
        if (!result.ok) {
            errors.push({ file: source, message: firstError(result.stderr || result.stdout) });
        }
    }
    await rm(out, { recursive: true, force: true }).catch(() => null);
    return { checked, errors, note: null };
}

/**
 * The name of a file of the project, as the markup of the same directory names it.
 * @param {string} htmlRel the path of the markup
 * @param {string} item the path of the file, relative to the root
 * @returns {string}
 * @exports
 * @ai.hint pure
 */
export function hrefFor(htmlRel, item) {
    const dir = path.posix.dirname(String(htmlRel ?? 'index.html'));
    const from = dir === '.' ? '' : dir;
    const rel = from ? path.posix.relative(from, item) : item;
    if (!rel) return './';
    return rel.startsWith('..') ? rel : `./${rel}`;
}

/**
 * Make sure that the markup points at the styles and at the script.
 *
 * The markup of the project may already be right: then nothing is touched. A link to a file
 * that does not exist is reported, and a link that is missing is added.
 * @param {string} root
 * @param {string} htmlRel the path of the markup
 * @param {{ styles?: string[], script?: string|null, apply?: boolean }} options
 * @returns {Promise<{ changed: boolean, added: string[], missing: string[], notes: string[] }>}
 * @exports
 * @ai.hint io
 */
export async function ensureHtmlWiring(root, htmlRel, { styles = [], script = null, apply = true } = {}) {
    const rel = String(htmlRel ?? '').trim();
    const result = { changed: false, added: [], missing: [], notes: [] };
    if (!rel) return result;
    const file = path.join(root, rel);
    const text = await readFile(file, 'utf8').catch(() => null);
    if (text === null) {
        result.notes.push(`Разметка не найдена: ${rel}.`);
        return result;
    }
    const refs = htmlRefs(text);
    const linked = new Set(refs.styles.map((href) => resolveRef(rel, href)).filter(Boolean));

    for (const item of linked) {
        const exists = await stat(path.join(root, item)).then((info) => info.isFile()).catch(() => false);
        if (!exists) result.missing.push(item);
    }

    const wanted = (Array.isArray(styles) ? styles : []).filter(Boolean).filter((item) => !linked.has(item));
    const scriptWanted = String(script ?? '').trim();
    const scriptLinked = refs.scripts.map((src) => resolveRef(rel, src)).filter(Boolean);
    const needScript = scriptWanted && !scriptLinked.includes(scriptWanted);
    if (!wanted.length && !needScript) return result;

    let updated = text;
    if (wanted.length) {
        const tags = wanted
            .map((item) => `    <link rel="stylesheet" href="${hrefFor(rel, item)}" />`)
            .join('\n');
        if (/<\/head>/i.test(updated)) {
            updated = updated.replace(/(\s*)<\/head>/i, `\n${tags}$1</head>`);
        } else {
            updated = `${tags}\n${updated}`;
        }
        result.added.push(...wanted);
    }
    if (needScript) {
        const tag = `    <script type="module" src="${hrefFor(rel, scriptWanted)}"></script>`;
        if (/<\/body>/i.test(updated)) {
            updated = updated.replace(/(\s*)<\/body>/i, `\n${tag}$1</body>`);
        } else {
            updated = `${updated}\n${tag}`;
        }
        result.added.push(scriptWanted);
    }
    if (apply && updated !== text) {
        await writeFile(file, updated, 'utf8');
        result.changed = true;
    }
    return result;
}

/**
 * True when the project is built by Vite.
 *
 * The config of Vite is the proof; the manifest is the second proof, for the project that
 * uses Vite without a config of its own.
 * @param {string} root
 * @returns {Promise<boolean>}
 * @exports
 * @ai.hint io
 */
export async function isViteProject(root) {
    const names = ['vite.config.js', 'vite.config.mjs', 'vite.config.ts', 'vite.config.mts', 'vite.config.cjs'];
    for (const name of names) {
        const found = await stat(path.join(root, name)).then((info) => info.isFile()).catch(() => false);
        if (found) return true;
    }
    const text = await readFile(path.join(root, 'package.json'), 'utf8').catch(() => null);
    if (text === null) return false;
    let manifest = null;
    try {
        manifest = JSON.parse(text);
    } catch {
        return false;
    }
    return Boolean(manifest?.dependencies?.vite || manifest?.devDependencies?.vite);
}

/**
 * The name of the stylesheet as the script of the project names it.
 * @param {string} scriptRel the path of the script
 * @param {string} styleRel the path of the stylesheet
 * @returns {string}
 * @exports
 * @ai.hint pure
 */
export function importPath(scriptRel, styleRel) {
    const dir = path.posix.dirname(String(scriptRel ?? ''));
    const rel = dir === '.' ? String(styleRel ?? '') : path.posix.relative(dir, String(styleRel ?? ''));
    if (!rel) return './';
    return rel.startsWith('.') ? rel : `./${rel}`;
}

/**
 * Add the import of the stylesheet into the script of the project.
 *
 * This is the way of Vite: the bundler sees the import, compiles the SCSS and puts the CSS
 * into the bundle. A script that does not import the stylesheet leaves the page unstyled.
 * @param {string} root
 * @param {string} scriptRel the path of the script
 * @param {string} styleRel the path of the stylesheet
 * @param {{ apply?: boolean }} [options]
 * @returns {Promise<{ changed: boolean, specifier: string, already: boolean }>}
 * @exports
 * @ai.hint io
 */
export async function ensureStyleImport(root, scriptRel, styleRel, { apply = true } = {}) {
    const script = String(scriptRel ?? '').trim();
    const style = String(styleRel ?? '').trim();
    const result = { changed: false, specifier: '', already: false };
    if (!script || !style) return result;
    const specifier = importPath(script, style);
    result.specifier = specifier;
    const file = path.join(root, script);
    const text = await readFile(file, 'utf8').catch(() => null);
    if (text === null) return result;
    // The import is already there when the script names this very stylesheet: the name of
    // the file alone is not a proof — `./domain/main.js` is not `./styles/main.scss`.
    const already = scriptImports(text).some((item) => {
        if (!item.startsWith('.')) return false;
        const dir = path.posix.dirname(script);
        const target = path.posix.normalize(path.posix.join(dir === '.' ? '' : dir, item));
        return target === path.posix.normalize(style);
    });
    if (already) {
        result.already = true;
        return result;
    }
    if (!apply) {
        result.changed = true;
        return result;
    }
    const updated = insertImport(text, specifier);
    await writeFile(file, updated, 'utf8');
    result.changed = true;
    return result;
}

/**
 * The specifiers that a script imports.
 * @param {string} content
 * @returns {string[]}
 * @exports
 * @ai.hint pure
 */
export function scriptImports(content) {
    const text = String(content ?? '');
    const out = [];
    const pattern = /(?:^|\n)\s*import\s+(?:[^'"]*?\sfrom\s+)?['"]([^'"]+)['"]/g;
    let match = pattern.exec(text);
    while (match) {
        const item = match[1].trim();
        if (item && !out.includes(item)) out.push(item);
        match = pattern.exec(text);
    }
    return out;
}

/**
 * Add an import at the top of a script.
 *
 * The import goes after the comment that opens the file and after the imports that are
 * already there.
 * @param {string} content
 * @param {string} specifier
 * @returns {string}
 * @exports
 * @ai.hint pure
 */
export function insertImport(content, specifier) {
    const text = String(content ?? '');
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    const lines = text.split(/\r?\n/);
    let at = 0;
    for (let index = 0; index < Math.min(lines.length, 80); index++) {
        const line = lines[index];
        if (/^\s*import\s/.test(line) || /^\s*export\s+.*\sfrom\s/.test(line)) {
            at = index + 1;
            continue;
        }
        if (!line.trim() || /^\s*(?:\/\/|\/\*|\*)/.test(line)) continue;
        break;
    }
    const statement = `import '${specifier}';`;
    return [...lines.slice(0, at), statement, ...lines.slice(at)].join(eol);
}

/**
 * Remove the links of the markup that point at the stylesheets of the project.
 *
 * The stylesheet that the build produces is not a file of the project: it is the artifact of
 * the compilation. A Vite project gets its styles from the import in the script, so the link
 * to the artifact is redundant — and a link to a file that is not there breaks the build.
 * The link to the source stylesheet goes away as well: the import is the one way to the
 * styles now, and both together load the styles twice.
 * @param {string} root
 * @param {string} htmlRel the path of the markup
 * @param {string|string[]} targets the paths of the stylesheets
 * @param {{ apply?: boolean }} [options]
 * @returns {Promise<{ changed: boolean, removed: boolean }>}
 * @exports
 * @ai.hint io
 */
export async function removeStyleLink(root, htmlRel, targets, { apply = true } = {}) {
    const result = { changed: false, removed: false };
    const html = String(htmlRel ?? '').trim();
    const list = (Array.isArray(targets) ? targets : [targets])
        .map((item) => String(item ?? '').trim())
        .filter(Boolean);
    if (!html || !list.length) return result;
    const file = path.join(root, html);
    const text = await readFile(file, 'utf8').catch(() => null);
    if (text === null) return result;
    const links = text.match(/<link\b[^>]*>/gi) ?? [];
    const doomed = links.filter((tag) => {
        if (!/rel\s*=\s*["']?stylesheet/i.test(tag)) return false;
        const href = tag.match(/href\s*=\s*["']([^"']+)["']/i);
        if (!href) return false;
        return list.includes(resolveRef(html, href[1]));
    });
    if (!doomed.length) return result;
    result.removed = true;
    let updated = text;
    for (const tag of doomed) {
        updated = updated.replace(tag, '');
    }
    updated = updated.replace(/^[ \t]*\r?\n(?=[ \t]*$)/gm, '');
    if (apply && updated !== text) {
        await writeFile(file, updated, 'utf8');
        result.changed = true;
    }
    return result;
}

/**
 * The path of the file of the build of a run.
 * @param {string} root
 * @param {object} config
 * @param {string} [id]
 * @returns {string}
 * @exports
 * @ai.hint pure
 */
export function buildPath(root, config = {}, id = null) {
    return runFile(root, config, id, BUILD_FILE);
}

/**
 * Write the build of a run into the directory of the run.
 * @param {string} root
 * @param {object} config
 * @param {string} [id]
 * @param {object} build
 * @returns {Promise<string>}
 * @exports
 * @ai.hint io
 */
export async function writeBuild(root, config = {}, id = null, build = {}) {
    return await writeJsonFile(buildPath(root, config, id), build);
}

/**
 * Read the build of a run. A missing file gives null.
 * @param {string} root
 * @param {object} config
 * @param {string} [id]
 * @returns {Promise<object|null>}
 * @exports
 * @ai.hint io
 */
export async function readBuild(root, config = {}, id = null) {
    return await readJsonFile(buildPath(root, config, id));
}

/**
 * The markup of the project.
 * @param {string} root
 * @param {string[]} files the files the plan named
 * @returns {Promise<string|null>}
 * @exports
 * @ai.hint io
 */
async function findMarkup(root, files = []) {
    const named = files.find((file) => /\.html?$/i.test(file));
    if (named) {
        const exists = await stat(path.join(root, named)).then((info) => info.isFile()).catch(() => false);
        if (exists) return named;
    }
    for (const name of ['index.html', 'src/index.html', 'public/index.html']) {
        const exists = await stat(path.join(root, name)).then((info) => info.isFile()).catch(() => false);
        if (exists) return name;
    }
    return null;
}

/**
 * The script of the project: the file the markup loads, or the entry point by its name.
 * @param {string} root
 * @param {string} htmlRel
 * @param {string[]} files the files the plan named
 * @returns {Promise<string|null>}
 * @exports
 * @ai.hint io
 */
async function findScript(root, htmlRel, files = []) {
    const text = htmlRel ? await readFile(path.join(root, htmlRel), 'utf8').catch(() => '') : '';
    for (const src of htmlRefs(text).scripts) {
        const rel = resolveRef(htmlRel, src);
        if (!rel) continue;
        const exists = await stat(path.join(root, rel)).then((info) => info.isFile()).catch(() => false);
        if (exists) return rel;
    }
    const named = files.find((file) => /\.(?:js|mjs)$/i.test(file));
    if (named) {
        const exists = await stat(path.join(root, named)).then((info) => info.isFile()).catch(() => false);
        if (exists) return named;
    }
    for (const name of ['scripts/main.js', 'src/main.js', 'js/main.js', 'main.js', 'src/index.js', 'scripts/index.js']) {
        const exists = await stat(path.join(root, name)).then((info) => info.isFile()).catch(() => false);
        if (exists) return name;
    }
    return null;
}

/**
 * The stage of the build: the styles are connected and the project is wired.
 *
 * @param {{ config?: object, root?: string, task?: string, plan?: object|null,
 *   architecture?: object|null, inputs?: object|null, runId?: string|null, apply?: boolean,
 *   notify?: (event: object) => void, env?: object }} request
 * @returns {Promise<{ stage: string, ok: boolean, build: object, file: string|null,
 *   warnings: string[], runId: string }>}
 * @exports
 * @ai.hint io
 */
export async function buildStage({
    config = {},
    root = process.cwd(),
    task = '',
    plan = null,
    architecture = null,
    inputs = null,
    runId: id = null,
    apply = true,
    env = process.env,
} = {}) {
    void task;
    void architecture;
    void inputs;
    const run = id ?? runId();
    const warnings = [];

    const files = await listStyleFiles(root);
    const contents = new Map();
    for (const file of files) {
        contents.set(file, await readFile(path.join(root, file), 'utf8').catch(() => ''));
    }
    const styles = partitionStyles(files, contents);
    // The copies of a repair are not a part of the styles: they are not built and not linked.
    const scratch = scratchStyles([...styles.entries, ...styles.partials]);
    const entries = styles.entries.filter((file) => !scratch.includes(file));
    const partials = styles.partials.filter((file) => !scratch.includes(file));
    const entry = primaryEntry(entries);

    // The partials that nobody uses: their rules never reach the page.
    const uses = await ensureUses(root, { entries, orphans: styles.orphans }, { contents, apply });

    // The stylesheets that use a file that was never written: the page has no styles, and
    // the build of the user breaks with "Can't find stylesheet to import".
    const missing = await missingReferences(root, files, contents);
    for (const item of missing) {
        warnings.push(`Стиль не найден: ${item.file} → ${item.ref} (${item.expected}).`);
    }

    // The markup and the script of the project.
    const named = (Array.isArray(plan?.steps) ? plan.steps : []).flatMap((step) => step?.files ?? []);
    const htmlRel = await findMarkup(root, named);
    const scriptRel = await findScript(root, htmlRel, named);
    const html = htmlRel ? await readFile(path.join(root, htmlRel), 'utf8').catch(() => '') : '';
    let links = htmlRefs(html).styles.map((href) => resolveRef(htmlRel, href)).filter(Boolean);

    // The target of every entry point: the CSS of the same name, unless the markup asks for
    // a file of another name.
    const targets = entries.map((source) => ({
        source,
        output: source.replace(/\.(scss|sass)$/i, '.css'),
    }));
    for (const link of links) {
        if (targets.some((item) => item.output === link)) continue;
        const exists = await stat(path.join(root, link)).then((info) => info.isFile()).catch(() => false);
        if (exists) continue;
        const base = path.posix.basename(link).replace(/\.css$/i, '').toLowerCase();
        const source = entries.find((file) => path.posix.basename(file).replace(/\.(scss|sass)$/i, '').toLowerCase() === base)
            ?? entries.find((file) => path.posix.dirname(file) === path.posix.dirname(link))
            ?? entry;
        if (!source) {
            warnings.push(`Стили не подключены: ${link} не найден, а собрать нечего.`);
            continue;
        }
        const target = targets.find((item) => item.source === source);
        if (target) target.output = link;
    }

    // The styles are compiled. A Vite project does not need the CSS of the project: the
    // bundler compiles the SCSS itself, when the script of the project imports it.
    const vite = await isViteProject(root);
    const primary = targets.find((item) => item.source === entry) ?? targets[0] ?? null;
    let compiled = { compiled: [], errors: [], note: null };
    let imported = null;
    let unlinked = null;

    if (vite && scriptRel && entry) {
        // Vite: the import of the stylesheet goes into the script of the project, and the
        // link of the markup to the CSS of the build goes away — that file is an artifact
        // of the bundler, and a link to it breaks the build of the project.
        imported = await ensureStyleImport(root, scriptRel, entry, { apply });
        if (htmlRel) {
            // The link to the source stylesheet goes away as well: the import is the one way
            // to the styles now, and the two together load the styles twice.
            unlinked = await removeStyleLink(root, htmlRel, [primary?.output, entry], { apply });
        }
        // The bundler compiles the styles itself, but the stage still checks them: a
        // stylesheet that does not compile breaks the build of the user.
        const checked = await verifyStyles(root, [entry], { env });
        compiled = {
            compiled: [],
            errors: checked.errors,
            note: checked.note ?? `Стили подключены импортом в ${scriptRel}: сборщик Vite компилирует SCSS сам.`,
        };
    } else {
        if (vite) {
            warnings.push(
                scriptRel
                    ? 'Точка входа стилей не найдена: стили собраны напрямую.'
                    : 'Скрипт проекта не найден: стили собраны напрямую.',
            );
        }
        compiled = apply
            ? await compileStyles(root, targets, { env })
            : { compiled: [], errors: [], note: 'сборка отключена: файлы не записываются.' };
    }
    for (const error of compiled.errors) {
        warnings.push(`Стили не собрались: ${error.file}: ${error.message}`);
    }
    if (compiled.note) warnings.push(compiled.note);
    if (imported?.changed) {
        warnings.push(`Импорт стилей добавлен: ${scriptRel} → ${imported.specifier}.`);
    } else if (imported?.already) {
        warnings.push(`Импорт стилей на месте: ${imported.specifier}.`);
    }
    if (unlinked?.removed) {
        warnings.push(`Ссылка на собранный CSS удалена: ${primary.output}.`);
    }
    for (const item of scratch) {
        warnings.push(`Файл-черновик не собирается: ${item}.`);
    }
    for (const item of uses.added) {
        warnings.push(`Партиал подключён: ${item.partial} → ${item.file}.`);
    }

    // The markup points at the styles and at the script.
    const wiring = await ensureHtmlWiring(root, htmlRel, {
        styles: primary && compiled.compiled.includes(primary.output) ? [primary.output] : [],
        script: scriptRel,
        apply,
    });
    for (const item of wiring.missing) {
        warnings.push(`Стили не подключены: ${item} не найден.`);
    }
    for (const item of wiring.added) {
        warnings.push(`Подключено: ${item}.`);
    }

    // The links of the markup after the stage touched it.
    const htmlAfter = htmlRel ? await readFile(path.join(root, htmlRel), 'utf8').catch(() => '') : '';
    links = htmlRefs(htmlAfter).styles.map((href) => resolveRef(htmlRel, href)).filter(Boolean);

    const build = {
        styles: entries,
        entry,
        partials,
        orphans: styles.orphans,
        scratch,
        uses: uses.added.map((item) => `${item.file} -> ${item.partial}`),
        skippedPartials: uses.skipped,
        vite,
        compiled: compiled.compiled,
        errors: compiled.errors,
        missing,
        import: imported ? { script: scriptRel, specifier: imported.specifier, changed: imported.changed, already: imported.already } : null,
        removedLink: unlinked?.removed ? primary?.output ?? null : null,
        markup: htmlRel,
        script: scriptRel,
        links: links,
        added: wiring.added,
        missing: wiring.missing,
        changed: wiring.changed,
    };

    const file = await writeBuild(root, config, run, build);

    const ok = compiled.errors.length === 0 && missing.length === 0;
    return {
        stage: 'build',
        ok,
        build,
        file,
        warnings,
        runId: run,
    };
}
