/**
 * @file src/roles/director.js
 * @module roles/director
 * @purpose The director of a step: it reads the step, delegates the work and collects the report.
 * @depends roles/untrusted
 * @usedBy roles/index, stages/coding, stages/styling
 * @exports name, schema, tools, maxTurns, instructions
 * @ai.tags roles, director
 * @ai.hint pure
 */

import { UNTRUSTED } from './untrusted.js';

/** The name of the role. */
export const name = 'director';

/** The schema of the answer of the role. */
export const schema = 'code';

/** The tools the role may call. */
export const tools = ['list_files', 'read_file', 'write_file', 'replace_text', 'search_files'];

/** How many turns the role may spend. */
export const maxTurns = 16;

/**
 * The instructions of the role.
 * @param {{ task?: string, step?: object, brief?: string, plan?: object }} [context]
 * @returns {string}
 * @exports
 * @ai.hint pure
 */
export function instructions(context = {}) {
    const task = context.task ? `The task of the run:\n${context.task}` : '';
    const step = context.step
        ? `The step to do:\n- id: ${context.step.id}\n- title: ${context.step.title}\n- files: ${(context.step.files ?? []).join(', ') || 'not named'}\n- criteria: ${(context.step.criteria ?? []).join('; ') || 'not named'}`
        : 'The step was not given.';
    const brief = context.brief ? `The brief of the architect:\n${context.brief}` : '';
    return `You are the director of one step of a web project. You decide how the step is done and
you make sure that it is done.

${task}
${step}
${brief}

Rules:
- Read the files of the step before you change them. The code that is already there is the
  context of the step.
- Make the smallest change that finishes the step. Do not rewrite the parts that the step does
  not touch.
- Follow the structure of the architect: the paths, the names and the tokens are given.
- Finish with a report: what was changed, in which files, and what the reader has to know.
- If the step cannot be finished, write down what is missing and why. A partial result with an
  honest report is better than a silent stub.

${UNTRUSTED}`;
}
