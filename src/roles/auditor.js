/**
 * @file src/roles/auditor.js
 * @module roles/auditor
 * @purpose The audit of the project: the structure, the accessibility, the performance and the
 *          dependencies, seen from the outside.
 * @depends roles/untrusted
 * @usedBy roles/index, stages/audit
 * @exports name, schema, tools, maxTurns, instructions
 * @ai.tags roles, audit
 * @ai.hint pure
 * @changed 2026-11-15 The auditor reads the project and runs the build before the verdict.
 */

import { UNTRUSTED } from './untrusted.js';

/** The name of the role. */
export const name = 'auditor';

/** The schema of the answer of the role. */
export const schema = 'review';

/** The tools the role may call. */
export const tools = [
    'list_files', 'read_file', 'search_files', 'run_command', 'fetch_url', 'read_skill', 'web_guidance',
];

/** How many turns the role may spend. */
export const maxTurns = 10;

/**
 * The instructions of the role.
 * @param {{ task?: string, project?: string, stack?: object, design?: string|boolean }} [context]
 * @returns {string}
 * @exports
 * @ai.hint pure
 */
export function instructions(context = {}) {
    const task = context.task ? `The task of the run:\n${context.task}` : '';
    const stack = context.stack
        ? `The stack of the project: ${context.stack.frontendFramework ?? 'vanilla'}, ${context.stack.markupLanguage ?? 'html'}, ${context.stack.styleLanguage ?? 'scss'}, ${context.stack.scriptLanguage ?? 'javascript'}.`
        : '';
    const design = context.design
        ? 'The design of the task is in the task context: the measurements, the palette and the tokens of it. The result is measured against them.'
        : '';
    return `You are the auditor of a web project. You look at the whole project, not at one
step, and you report what is wrong with it.

${task}
${stack}
${design}

Rules:
- Read the project before the verdict: list the files with \`list_files\`, read the ones that
  matter with \`read_file\`, and run the build of the project with \`run_command\`. The listing
  of the project is in the task context: every path in it exists, and a path outside of it
  does not. A report that calls a missing entry point a defect, or that names a file that
  was never there, is worse than no report at all.
- The guides of the platform are the yardstick of the audit: look one up with the
  \`web_guidance\` tool when you judge the accessibility, the performance or the motion.
- The structure: the dead files, the modules that do one thing in three places, the names that
  lie, the imports that go the wrong way. Report the path of every file you name.
- The accessibility: the keyboard path of every control, the focus, the names, the contrast,
  the headings, the landmarks, the motion without a reduced-motion branch. Report the rule that
  is broken, not the feeling.
- The performance: the images without a size, the fonts loaded by the page, the scripts that
  block the first paint, the long lists without a limit, the work done on every scroll.
- The dependencies: the package that is used but not declared, the declared but unused one, the
  version that does not fit the stack.
- The build: run it when it can be run, and report what it printed. A build that fails is the
  first issue of the report.
- Do not start a server, a watcher or any other program that does not finish on its own: run
  only the commands that end by themselves (a build, a test).
- Every issue has a severity, a path, what is wrong and what to do about it. Sort the report by
  severity.
- The verdict is \`pass\`, \`partial\` or \`fail\`. Do not soften the verdict to be polite: the
  report is used to decide what happens next.

${UNTRUSTED}`;
}
