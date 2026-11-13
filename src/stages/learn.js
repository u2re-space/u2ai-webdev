/**
 * @file src/stages/learn.js
 * @module stages/learn
 * @purpose The lessons of a finished run: the facts, the decisions and the traps that are
 *          worth remembering next time.
 *
 *   The learner has no schema: it writes the lessons as text. The stage parses that text
 *   into the list of lessons and writes it into the directory of the run. The permanent
 *   memory of the project (step-17) reads that list.
 *
 * @depends roles/index, stages/workspace
 * @usedBy stages/index, stages/memory, pipeline
 * @exports LESSONS_FILE, LESSON_KINDS, parseLessons, writeLessons, readLessons, learnStage
 * @ai.tags stages, memory, lessons
 * @ai.hint io
 * @ai.hint legacy-0.2
 * @changed 2026-11-13 Ported from the monolith: уроки прогона пишутся в файл прогона.
 */

import { runRole } from '../roles/index.js';
import { rememberLessons } from '../memory.js';
import { runId, runFile, writeJsonFile, readJsonFile } from './workspace.js';

/** The name of the file of the lessons inside the directory of the run. */
export const LESSONS_FILE = 'lessons.json';

/** The kinds of a lesson. */
export const LESSON_KINDS = Object.freeze([
    'fact', 'convention', 'decision', 'preference', 'pitfall', 'summary', 'note',
]);

/**
 * Parse the text of the learner into the list of the lessons.
 *
 * A lesson is a line of the list: `- [fact] The project uses Vite.` The kind in the
 * brackets is optional; a line without it is a note.
 * @param {string} text
 * @returns {{ kind: string, text: string }[]}
 * @exports
 * @ai.hint pure
 */
export function parseLessons(text) {
    const source = String(text ?? '');
    const lessons = [];
    const seen = new Set();
    for (const raw of source.split(/\r?\n/)) {
        const line = raw.trim();
        if (!line) continue;
        if (!/^[-*]\s+/.test(line) && !/^\d+[.)]\s+/.test(line)) continue;
        const body = line.replace(/^([-*]|\d+[.)])\s+/, '').trim();
        if (!body) continue;
        const match = body.match(/^\[([a-z]+)\]\s*(.+)$/i);
        const kind = match && LESSON_KINDS.includes(match[1].toLowerCase())
            ? match[1].toLowerCase()
            : 'note';
        const value = match ? match[2].trim() : body;
        if (!value) continue;
        const key = `${kind}:${value}`;
        if (seen.has(key)) continue;
        seen.add(key);
        lessons.push({ kind, text: value });
    }
    return lessons;
}

/**
 * The path of the lessons of a run.
 * @param {string} root
 * @param {object} config
 * @param {string} id
 * @returns {string}
 * @exports
 * @ai.hint pure
 */
export function lessonsPath(root, config = {}, id = null) {
    return runFile(root, config, id, LESSONS_FILE);
}

/**
 * Write the lessons of a run.
 * @param {string} root
 * @param {object} config
 * @param {string} id
 * @param {object[]} lessons
 * @returns {Promise<string>}
 * @exports
 * @ai.hint io
 */
export async function writeLessons(root, config = {}, id = null, lessons = []) {
    return await writeJsonFile(lessonsPath(root, config, id), { lessons: Array.isArray(lessons) ? lessons : [] });
}

/**
 * Read the lessons of a run. A missing file gives an empty list.
 * @param {string} root
 * @param {object} config
 * @param {string} id
 * @returns {Promise<object[]>}
 * @exports
 * @ai.hint io
 */
export async function readLessons(root, config = {}, id = null) {
    const data = await readJsonFile(lessonsPath(root, config, id));
    return Array.isArray(data?.lessons) ? data.lessons : [];
}

/**
 * The stage of the lessons.
 *
 * @param {{ client: object, config?: object, root?: string, task?: string, plan?: object|null,
 *   review?: object|null, memory?: string, runId?: string|null, store?: object|null,
 *   notify?: (event: object) => void, env?: object }} request
 * @returns {Promise<{ stage: string, ok: boolean, lessons: object[], text: string,
 *   file: string|null, stored: object, warnings: string[], runId: string }>}
 * @exports
 * @ai.hint io
 */
export async function learnStage({
    client,
    config = {},
    root = process.cwd(),
    task = '',
    plan = null,
    review = null,
    memory = '',
    runId: id = null,
    store = null,
    notify = () => {},
    env = process.env,
} = {}) {
    if (!client?.responses) throw new Error('Клиент API не передан.');
    const run = id ?? runId();

    const blocks = [];
    if (task) blocks.push(String(task).trim());
    if (plan?.steps?.length) {
        blocks.push(`The steps that were done:\n${plan.steps.map((step) => `- ${step.id}: ${step.title}`).join('\n')}`);
    }
    if (review) {
        const issues = Array.isArray(review.issues) ? review.issues : [];
        const findings = issues.map((issue) => `- [${issue.severity ?? 'medium'}] ${issue.path ? `${issue.path}: ` : ''}${issue.message ?? ''}`).join('\n');
        if (findings) blocks.push(`The findings of the reviewer:\n${findings}`);
    }
    if (memory) blocks.push(`The memory of the project:\n${memory}`);
    blocks.push([
        'Write the lessons as a list. One line per lesson, in the form:',
        '- [fact] The project uses Vite in src/main.js.',
        'The kinds are: fact, convention, decision, preference, pitfall, summary, note.',
        'When nothing is worth remembering, answer with one line: nothing to remember.',
    ].join('\n'));

    const result = await runRole({
        client,
        config,
        role: 'learner',
        input: blocks.join('\n\n'),
        context: {
            task: String(task ?? ''),
            step: plan?.steps?.at(-1) ?? null,
            review: review ? JSON.stringify(review.issues ?? []) : '',
            project: root,
            memory,
        },
        root,
        env,
        maxTurns: config?.stages?.learn?.maxTurns ?? null,
        notify,
    });

    const text = String(result.text ?? '').trim();
    const lessons = parseLessons(text);
    const file = await writeLessons(root, config, run, lessons);
    const warnings = [];
    if (!text) warnings.push('Ученик не ответил.');

    // The lessons go into the permanent memory of the project.
    const stored = rememberLessons(store, lessons, {
        scope: config?.memory?.scope ?? 'project',
        source: `run:${run}`,
    });
    warnings.push(...stored.warnings);

    return {
        stage: 'learn',
        ok: true,
        lessons,
        text,
        file,
        stored,
        warnings,
        runId: run,
    };
}
