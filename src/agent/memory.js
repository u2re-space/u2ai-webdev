/**
 * @file src/agent/memory.js
 * @module agent/memory
 * @purpose The memory of the run: the files that were made, kept in the memory as well as on
 *          the disk.
 *
 *   The work of a run is text, and the text is written to the disk at once — or not at all.
 *   A role that wrote `styles.scss` in her answer, and whose step was interrupted before the
 *   answer reached the disk, has lost the work: the answer is in the journal of the run, but
 *   the file is not on the disk, and the next stage does not see it.
 *
 *   This module is that memory. Every file the run writes goes here first, and the memory
 *   lives in the run directory — it dies with the run, like everything else of the run, and
 *   it is **not** the RAM of the process: it is on the disk, so a run that was paused and
 *   continued finds the file it made yesterday.
 *
 *   The memory has two halves:
 *
 *   - the **files**: the text of the files the run made, by their path. A stage that needs
 *     a file the disk does not have takes it from here.
 *   - the **answers**: the answers of the roles, by the step and the pass they belong to. A
 *     run that is continued does not pay for an answer it already has.
 *
 * @depends node:path, node:fs/promises, access/ramdisk
 * @usedBy agent/context, stages/step
 * @exports RUN_MEMORY_DIR, memoryDirectory, openMemory, writeMemoryFile, readMemoryFile,
 *          memoryFiles, writeMemoryAnswer, readMemoryAnswer, memoryAnswers
 * @ai.tags house, memory, ram, reuse
 * @ai.hint io
 */

import path from 'node:path';
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { createRamdiskFileSystem } from '../access/ramdisk.js';

/** The name of the directory of the memory of the run, inside the run directory. */
export const RUN_MEMORY_DIR = 'memory';

/** The name of the directory of the files of the memory, inside the memory. */
const FILES_DIR = 'files';

/** The name of the directory of the answers of the memory, inside the memory. */
const ANSWERS_DIR = 'answers';

/** The most bytes one file of the memory may take. */
const MAX_FILE_BYTES = 4 * 1024 * 1024;

/**
 * The directory of the memory of the run.
 *
 * @param {string} root the working directory of the project
 * @param {object} config the configuration of the run
 * @param {string} id the identifier of the run
 * @returns {string} the absolute path
 * @exports
 * @ai.hint pure
 */
export function memoryDirectory(root, config = {}, id = '') {
    const work = String(config?.output?.work ?? '.ai/tmp').trim() || '.ai/tmp';
    const rel = path.posix.join(work.split(path.sep).join('/'), String(id ?? '').trim(), RUN_MEMORY_DIR);
    return path.resolve(root ?? process.cwd(), rel);
}

/**
 * The path of a file of the memory.
 *
 * The path of the project is kept as it is, under a directory of its own: two files of
 * different directories may have the same name, and the memory has to tell them apart.
 *
 * @param {string} dir the directory of the memory
 * @param {string} rel the path of the file, relative to the project
 * @returns {string} the absolute path
 * @exports
 * @ai.hint pure
 */
export function memoryFilePath(dir, rel) {
    const clean = String(rel ?? '').trim().replace(/\\/g, '/').replace(/^\.\//, '');
    // The path of the проекта inside the memory: `a/b.css` -> `a__b.css`.
    const flat = clean.replace(/\//g, '__').replace(/[^A-Za-z0-9._-]/g, '_');
    return path.join(dir, FILES_DIR, flat || 'file');
}

/**
 * The name of the file of an answer of the memory.
 *
 * @param {string} stepId the identifier of the step
 * @param {string} pass the pass of the role
 * @returns {string} the name of the file
 * @exports
 * @ai.hint pure
 */
export function memoryAnswerName(stepId, pass = '') {
    const step = String(stepId ?? '').trim().replace(/[^A-Za-z0-9._-]/g, '_') || 'step';
    const kind = String(pass ?? '').trim().replace(/[^A-Za-z0-9._-]/g, '_');
    return kind ? `${step}__${kind}.json` : `${step}.json`;
}

/**
 * Open the memory of a run.
 *
 * The memory is a file system in the memory of the process, mirrored on the disk of the run.
 * The disk is the truth: a run that was paused and continued finds its files.
 *
 * @param {{ root: string, config?: object, id?: string, capacityBytes?: number }} options
 * @returns {{ dir: string, ram: object, put: Function, get: Function, has: Function,
 *   files: Function, answer: Function, answers: Function }}
 * @exports
 * @ai.hint io
 */
export function openMemory({ root, config = {}, id = '', capacityBytes = 0 } = {}) {
    const dir = memoryDirectory(root, config, id);
    const ram = createRamdiskFileSystem({ capacityBytes: capacityBytes || undefined });

    /**
     * Put a file into the memory: in the memory of the process and on the disk of the run.
     *
     * @param {string} rel the path of the file, relative to the project
     * @param {string} content the text of the file
     * @returns {Promise<string|null>} the path of the file in the memory, or null
     */
    const put = async (rel, content) => {
        const text = typeof content === 'string' ? content : null;
        if (!text) return null;
        if (Buffer.byteLength(text, 'utf8') > MAX_FILE_BYTES) return null;
        try {
            await ram.writeFile(rel, Buffer.from(text, 'utf8'));
        } catch {
            // The memory of the процесса is full: the disk of the run still holds the file.
        }
        try {
            const abs = memoryFilePath(dir, rel);
            await mkdir(path.dirname(abs), { recursive: true });
            // The path of the проекта travels with the text: the name of the file of the
            // memory is flat, and two files of different directories may share a name.
            await writeFile(abs, `${JSON.stringify({ rel, content: text, at: new Date().toISOString() })}\n`, 'utf8');
        } catch {
            // The run directory is not writable: the memory of the процесса still holds it.
        }
        return rel;
    };

    /**
     * The text of a file of the memory.
     *
     * The memory of the процесса comes first: it is the newer one. The disk of the run is
     * the fallback: it is what a continued run finds.
     *
     * @param {string} rel the path of the file, relative to the project
     * @returns {Promise<string|null>} the text of the file, or null when there is none
     */
    const get = async (rel) => {
        try {
            const bytes = await ram.readFile(rel);
            if (bytes?.length) return Buffer.from(bytes).toString('utf8');
        } catch { /* the file is not in the memory of the процесса */ }
        try {
            const text = await readFile(memoryFilePath(dir, rel), 'utf8');
            const parsed = JSON.parse(text);
            return typeof parsed?.content === 'string' ? parsed.content : null;
        } catch {
            return null;
        }
    };

    /**
     * Is a file in the memory?
     * @param {string} rel the path of the file, relative to the project
     * @returns {Promise<boolean>}
     */
    const has = async (rel) => (await get(rel)) !== null;

    /**
     * The files of the memory, by their path in the project.
     *
     * @returns {Promise<string[]>}
     */
    const files = async () => {
        const out = new Set();
        try {
            for (const key of ram.nodes.keys()) {
                out.add(String(key).split(path.sep).join('/'));
            }
        } catch { /* the memory of the процесса is empty */ }
        try {
            for (const name of await readdir(path.join(dir, FILES_DIR))) {
                const text = await readFile(path.join(dir, FILES_DIR, name), 'utf8').catch(() => null);
                if (!text) continue;
                try {
                    const parsed = JSON.parse(text);
                    if (parsed?.rel) out.add(String(parsed.rel).split(path.sep).join('/'));
                } catch { /* the file of the памяти is not json */ }
            }
        } catch { /* the directory of the files is not there */ }
        return [...out].filter(Boolean);
    };

    /**
     * Put an answer of a role into the memory.
     *
     * @param {string} stepId the identifier of the step
     * @param {string} pass the pass of the role
     * @param {object} answer the answer of the role
     * @returns {Promise<void>}
     */
    const answer = async (stepId, pass, value) => {
        try {
            const abs = path.join(dir, ANSWERS_DIR, memoryAnswerName(stepId, pass));
            await mkdir(path.dirname(abs), { recursive: true });
            await writeFile(abs, `${JSON.stringify(value ?? null, null, 2)}\n`, 'utf8');
        } catch { /* the answer is not remembered: the run goes on */ }
    };

    /**
     * The answer of a role that the memory holds.
     *
     * @param {string} stepId the identifier of the step
     * @param {string} [pass] the pass of the role
     * @returns {Promise<object|null>}
     */
    const answers = async (stepId, pass = '') => {
        try {
            const text = await readFile(path.join(dir, ANSWERS_DIR, memoryAnswerName(stepId, pass)), 'utf8');
            const parsed = JSON.parse(text);
            return parsed && typeof parsed === 'object' ? parsed : null;
        } catch {
            return null;
        }
    };

    return { dir, ram, put, get, has, files, answer, answers };
}
