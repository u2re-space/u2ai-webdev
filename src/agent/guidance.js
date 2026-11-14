/**
 * @file src/agent/guidance.js
 * @module agent/guidance
 * @purpose The guides of the modern web platform that ship with the package.
 *
 *   The pack `modern-web-guidance` of the Chrome team is a catalog of the guides: how to
 *   build a dialog, a grid, a carousel, a form with the platform of today instead of the
 *   library of yesterday. The pack lives in `skills/modern-web-guidance` of the package,
 *   and the guides are plain markdown files under `guides/<category>/<id>.md`.
 *
 *   This module is the reader of that catalog. It searches the guides by their words and
 *   gives the text of the ones that fit the task. Everything happens on the disk of the
 *   package: no network, no npm, no waiting.
 *
 *   The upstream pack has its own CLI (`npx modern-web-guidance@latest search|retrieve`).
 *   It is the fallback: the tool of the agent calls it when the bundled guides are not
 *   there or when the caller asks for it.
 *
 * @depends node:path, node:url, node:fs/promises
 * @usedBy agent/tools, cli/skills
 * @exports GUIDANCE_SKILL, builtinSkillsDir, guidanceSkillDir, guidesDir, guideIndex,
 *          searchGuides, readGuide, guidanceCategories, runGuidanceCli
 * @ai.tags guidance, skills, web
 * @ai.hint io
 */

import path from 'node:path';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

/** The name of the pack of the guidance. */
export const GUIDANCE_SKILL = 'modern-web-guidance';

/** The words that mean nothing in a search. */
const STOP_WORDS = new Set([
    'the', 'and', 'for', 'with', 'that', 'this', 'from', 'into', 'how', 'what', 'when',
    'where', 'which', 'your', 'you', 'are', 'was', 'use', 'using', 'used', 'can', 'make',
    'build', 'page', 'site', 'component', 'react', 'vue', 'svelte', 'angular', 'tailwind',
]);

/**
 * The directory of the package.
 * @returns {string}
 * @ai.hint pure
 */
function packageRoot() {
    const here = path.dirname(fileURLToPath(import.meta.url));
    return path.resolve(here, '..', '..');
}

/**
 * The directory of the skill packs that ship with the package.
 * @returns {string}
 * @exports
 * @ai.hint pure
 */
export function builtinSkillsDir() {
    return path.join(packageRoot(), 'skills');
}

/**
 * The directory of the pack of the guidance.
 * @returns {string}
 * @exports
 * @ai.hint pure
 */
export function guidanceSkillDir() {
    return path.join(builtinSkillsDir(), GUIDANCE_SKILL);
}

/**
 * The directory of the guides of the pack.
 * @returns {string}
 * @exports
 * @ai.hint pure
 */
export function guidesDir() {
    return path.join(guidanceSkillDir(), 'guides');
}

/**
 * The words of a text: the lower case ones, without the short and the common.
 * @param {string} text
 * @returns {string[]}
 * @ai.hint pure
 */
function words(text) {
    return String(text ?? '')
        .toLowerCase()
        .split(/[^a-z0-9+.-]+/)
        .map((word) => word.replace(/^[.-]+|[.-]+$/g, ''))
        .filter((word) => word.length > 2 && !STOP_WORDS.has(word));
}

/**
 * The map of the words of a text: how many times each of them is there.
 * @param {string} text
 * @returns {Map<string, number>}
 * @ai.hint pure
 */
function frequencies(text) {
    const map = new Map();
    for (const word of words(text)) {
        map.set(word, (map.get(word) ?? 0) + 1);
    }
    return map;
}

/**
 * The title of a guide: the first heading of the file.
 * @param {string} text
 * @returns {string}
 * @ai.hint pure
 */
function titleOf(text) {
    const match = String(text ?? '').match(/^#\s+(.+)$/m);
    return match ? match[1].trim() : '';
}

/**
 * The summary of a guide: the first paragraph after the title.
 * @param {string} text
 * @returns {string}
 * @ai.hint pure
 */
function summaryOf(text) {
    const body = String(text ?? '').replace(/^#\s+.+$/m, '').trim();
    const paragraph = body.split(/\n\s*\n/)[0] ?? '';
    return paragraph.replace(/\s+/g, ' ').trim();
}

/** The index of the guides, built once per process. */
let indexPromise = null;

/**
 * The catalog of the guides: every guide of the pack with its id, its category, its title
 * and its summary.
 *
 * The index is built once and kept: the guides are read from the disk of the package, and
 * a run of the agent asks for them many times.
 *
 * @param {{ force?: boolean }} [options]
 * @returns {Promise<Array<{ id: string, category: string, title: string, summary: string,
 *   path: string, text: string, titleWords: Map<string, number>, summaryWords: Map<string, number>,
 *   bodyWords: Map<string, number> }>>}
 * @exports
 * @ai.hint io
 */
export async function guideIndex({ force = false } = {}) {
    if (!force && indexPromise) return indexPromise;
    indexPromise = (async () => {
        const root = guidesDir();
        const guides = [];
        let categories = [];
        try {
            categories = await readdir(root, { withFileTypes: true });
        } catch {
            return guides;
        }
        for (const category of categories) {
            if (!category.isDirectory()) continue;
            const dir = path.join(root, category.name);
            let files = [];
            try {
                files = await readdir(dir);
            } catch {
                continue;
            }
            for (const file of files) {
                if (!file.endsWith('.md')) continue;
                const full = path.join(dir, file);
                const text = await readFile(full, 'utf8').catch(() => null);
                if (text === null) continue;
                const title = titleOf(text);
                const summary = summaryOf(text);
                guides.push({
                    id: file.slice(0, -3),
                    category: category.name,
                    title: title || file.slice(0, -3),
                    summary,
                    path: full,
                    text,
                    titleWords: frequencies(`${file.slice(0, -3)} ${title}`),
                    summaryWords: frequencies(summary),
                    bodyWords: frequencies(text),
                });
            }
        }
        guides.sort((a, b) => a.id.localeCompare(b.id));
        return guides;
    })();
    return indexPromise;
}

/**
 * The categories of the guides with the count of the guides in them.
 * @returns {Promise<Array<{ category: string, count: number }>>}
 * @exports
 * @ai.hint io
 */
export async function guidanceCategories() {
    const guides = await guideIndex();
    const counts = new Map();
    for (const guide of guides) {
        counts.set(guide.category, (counts.get(guide.category) ?? 0) + 1);
    }
    return [...counts.entries()]
        .map(([category, count]) => ({ category, count }))
        .sort((a, b) => a.category.localeCompare(b.category));
}

/**
 * The score of a guide for the words of a query.
 *
 * The score is the sum over the words of the query: the rarity of the word times how many
 * times it is in the title, the summary and the body. The title counts most: a guide
 * about a dialog says it in the title.
 *
 * @param {object} guide the guide of the index
 * @param {string[]} terms the words of the query
 * @param {Map<string, number>} rarity how many guides have the word
 * @param {number} total how many guides the search looks at
 * @returns {number}
 * @ai.hint pure
 */
function scoreOf(guide, terms, rarity, total) {
    let score = 0;
    for (const term of terms) {
        const weight = Math.log(1 + (total / (rarity.get(term) ?? 1)));
        score += weight * (
            (guide.titleWords.get(term) ?? 0) * 4
            + (guide.summaryWords.get(term) ?? 0) * 2
            + (guide.bodyWords.get(term) ?? 0)
        );
    }
    return score;
}

/**
 * Search the guides by the words of a query.
 *
 * The answer is a list of the guides that fit, the best first: the id, the category, the
 * title and the summary of each of them. The ids are what the retrieve takes.
 *
 * @param {string} query the words of the search
 * @param {{ limit?: number, category?: string }} [options]
 * @returns {Promise<Array<{ id: string, category: string, title: string, summary: string, score: number }>>}
 * @exports
 * @ai.hint io
 */
export async function searchGuides(query, { limit = 8, category = '' } = {}) {
    const guides = await guideIndex();
    const terms = words(query);
    if (!guides.length || !terms.length) return [];

    const wanted = String(category ?? '').trim().toLowerCase();
    const pool = wanted ? guides.filter((guide) => guide.category === wanted) : guides;
    if (!pool.length) return [];

    const rarity = new Map();
    for (const guide of pool) {
        for (const word of new Set([
            ...guide.titleWords.keys(),
            ...guide.summaryWords.keys(),
            ...guide.bodyWords.keys(),
        ])) {
            rarity.set(word, (rarity.get(word) ?? 0) + 1);
        }
    }

    const phrase = String(query ?? '').trim().toLowerCase();
    const scored = pool
        .map((guide) => {
            let score = scoreOf(guide, terms, rarity, pool.length);
            const haystack = `${guide.id} ${guide.title}`.toLowerCase();
            if (phrase.length > 3 && haystack.includes(phrase)) score += 40;
            return { id: guide.id, category: guide.category, title: guide.title, summary: guide.summary, score };
        })
        .filter((guide) => guide.score > 0)
        .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));

    const max = Number.isSafeInteger(Number(limit)) && Number(limit) > 0 ? Number(limit) : 8;
    return scored.slice(0, max);
}

/**
 * One guide by its id.
 *
 * The id is the name of the file without the extension; the category may be given too,
 * when two categories hold a guide with the same name.
 *
 * @param {string} id
 * @param {{ category?: string }} [options]
 * @returns {Promise<{ id: string, category: string, title: string, summary: string, text: string }|null>}
 * @exports
 * @ai.hint io
 */
export async function readGuide(id, { category = '' } = {}) {
    const wanted = String(id ?? '').trim();
    if (!wanted) return null;
    const guides = await guideIndex();
    const wanted2 = wanted.toLowerCase();
    const found = guides.find((guide) => {
        if (guide.id.toLowerCase() !== wanted2) return false;
        if (!category) return true;
        return guide.category === String(category).trim().toLowerCase();
    });
    if (!found) return null;
    return {
        id: found.id,
        category: found.category,
        title: found.title,
        summary: found.summary,
        text: found.text,
    };
}

/**
 * The program of the CLI of the upstream pack, with the arguments of the call.
 * @param {string[]} args
 * @returns {{ command: string, args: string[] }}
 * @ai.hint pure
 */
function cliProgram(args) {
    const list = ['-y', 'modern-web-guidance@latest', ...args];
    if (process.platform !== 'win32') {
        return { command: 'npx', args: list };
    }
    // On Windows the program of npm is a batch file, and Node refuses to start a batch
    // file without a shell. The line is built here and every argument is quoted.
    const line = ['npx', ...list]
        .map((arg) => `"${String(arg).replace(/"/g, '')}"`)
        .join(' ');
    return { command: 'cmd.exe', args: ['/d', '/s', '/c', line] };
}

/**
 * The path of the file the CLI wrote its answer to, when it wrote one.
 *
 * The CLI saves an answer bigger than 9.5 KB in a temporary file and prints the path of
 * it: the answer of the tool is then the text of that file.
 *
 * @param {string} output
 * @returns {string|null}
 * @exports
 * @ai.hint pure
 */
export function savedOutputPath(output) {
    const match = String(output ?? '').match(/saved to ([^\s]+\.md)/i);
    return match ? match[1] : null;
}

/**
 * Run the CLI of the upstream pack: the fallback of the bundled guides.
 *
 * The command is `npx -y modern-web-guidance@latest <args>`. The answer is the text of
 * the program: its stdout, and its stderr when the program failed. The notes of npm are
 * dropped: they are the noise of the runner, not the answer.
 *
 * The arguments are checked before they are started: only the letters, the digits and the
 * marks of a path are allowed, so a query of the model cannot become a command.
 *
 * @param {string[]} args the arguments of the program
 * @param {{ cwd?: string, env?: object, timeoutMs?: number, spawn?: Function }} [options]
 * @returns {Promise<{ ok: boolean, code: number|null, output: string, file: string|null }>}
 * @exports
 * @ai.hint io
 */
export async function runGuidanceCli(args, { cwd = process.cwd(), env = process.env, timeoutMs = 120_000, spawn } = {}) {
    const list = (Array.isArray(args) ? args : []).map((item) => String(item));
    for (const arg of list) {
        if (!/^[A-Za-z0-9 ._+@/:=-]+$/.test(arg)) {
            return { ok: false, code: null, output: `The argument is not allowed: ${arg}`, file: null };
        }
    }
    const program = spawn ?? (await import('node:child_process')).spawn;
    const { command, args: programArgs } = cliProgram(list);

    return await new Promise((resolve) => {
        let stdout = '';
        let stderr = '';
        let settled = false;
        let timer = null;
        const done = (value) => {
            if (settled) return;
            settled = true;
            if (timer) clearTimeout(timer);
            resolve(value);
        };
        let child;
        try {
            child = program(command, programArgs, {
                cwd,
                env,
                shell: false,
                windowsHide: true,
            });
        } catch (error) {
            resolve({ ok: false, code: null, output: error?.message ?? String(error), file: null });
            return;
        }
        timer = setTimeout(() => {
            child.kill();
            done({ ok: false, code: null, output: 'The CLI of the guidance did not finish in time.', file: null });
        }, timeoutMs);
        child.stdout?.on('data', (chunk) => { stdout += String(chunk); });
        child.stderr?.on('data', (chunk) => { stderr += String(chunk); });
        child.on('error', (error) => {
            done({ ok: false, code: null, output: error?.message ?? String(error), file: null });
        });
        child.on('close', (code) => {
            const notes = stderr.split(/\r?\n/).filter((line) => !/^npm notice/.test(line.trim()));
            const output = [stdout.trim(), notes.join('\n').trim()].filter(Boolean).join('\n');
            done({ ok: code === 0, code, output, file: savedOutputPath(output) });
        });
    });
}
