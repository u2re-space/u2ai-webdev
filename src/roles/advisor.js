/**
 * @file src/roles/advisor.js
 * @module roles/advisor
 * @purpose The senior adviser of a step: what the step should do, and how it should be done.
 *
 *   The adviser is asked **before** the work, not after it. The reviewer judges what is
 *   already on the disk; the adviser says how the work is better done — and the role that
 *   does the work decides what to take from the advice.
 *
 *   The two are different in three ways, and the difference is the whole point:
 *
 *   - The adviser comes **first**: there is nothing on the disk yet, so the advice is
 *     about the approach, not about the result.
 *   - The adviser does **not** judge: it does not say pass or fail. It says what is worth
 *     doing, what is a trap, and what the order of the work should be.
 *   - The adviser does **not** do the work: it reads, it thinks, it answers. The files are
 *     written by the role of the step, with the rights of that role.
 *
 *   The advice is a counsel, not an order: the role that does the work may take it, leave
 *   it, or do it its own way — and it says why in its report.
 *
 * @depends roles/untrusted
 * @usedBy roles/index, stages/advisor
 * @exports name, schema, tools, maxTurns, instructions
 * @ai.tags roles, advisor
 * @ai.hint pure
 * @changed 2026-11-29 Старшая модель стала советником шага: её спрашивают до работы, а не
 *                       после неё.
 */

import { UNTRUSTED } from './untrusted.js';

/** The name of the role. */
export const name = 'advisor';

/** The schema of the answer of the role. */
export const schema = 'advice';

/**
 * The tools the role may call.
 *
 * Only the reading ones: the adviser looks at the project and thinks about it. It writes
 * no file and runs no command — the files of the step belong to the role of the step.
 */
export const tools = [
    'list_files', 'read_file', 'find_line', 'search_files',
];

/** How many turns the role may spend. */
export const maxTurns = 2;

/**
 * The instructions of the role.
 * @param {{ task?: string, step?: object, brief?: string, design?: string,
 *   criteria?: string[], pass?: string }} [context]
 * @returns {string}
 * @exports
 * @ai.hint pure
 */
export function instructions(context = {}) {
    const task = context.task ? `The task of the run:\n${context.task}` : '';
    const step = context.step
        ? `The step to advise:\n- id: ${context.step.id}\n- title: ${context.step.title}\n- role: ${context.step.role}\n- files: ${(context.step.files ?? []).join(', ') || 'not named'}\n- criteria: ${(context.step.criteria ?? []).join('; ') || 'not named'}`
        : 'The step was not given.';
    const brief = context.brief ? `The brief of the architect:\n${context.brief}` : '';
    const design = context.design
        ? 'The design direction is in the task context: the tokens, the spacing and the grid come from it.'
        : '';
    return `You are the senior adviser of a web project. You are asked one question: how is this
step better done?

${task}
${step}
${brief}
${design}

Rules:
- You are asked before the work, so there is nothing to judge yet. Do not review, do not give
  a verdict, do not look for defects in what is written: the files of the step do not exist yet,
  and what exists is the context of the step, not its result.
- Read the project before you advise. The code that is already there is the context of the
  advice: the names, the tokens and the modules that are already committed to are the ground
  the advice must stand on. Read a relevant file at most once; use \`find_line\` for a detail in
  a large file.
- Say what is worth doing, and what is a trap in this particular step. A generic reminder that
  would be true of any project is worth nothing here: either it is specific to this step, or
  it is not advice.
- Name the order of the work when the order matters: what has to be written first, and what
  the rest must agree with.
- The advice is a counsel, not an order. The role that does the step decides what to take
  from it. Do not ask for permission and do not ask questions you could answer by reading.
- If the step is clear and there is nothing worth saying, say that in one line. Silence is
  worse than a short answer: the role has to know that the senior had nothing to add.
- The advice is written for the role of the step. Speak about the files it writes and the
  criteria it has to meet.
- Do not write files and do not run commands: you advise, the role of the step works.

${UNTRUSTED}`;
}
