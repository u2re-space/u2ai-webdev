/**
 * @file src/roles/installer.js
 * @module roles/installer
 * @purpose The environment of the project: the dependencies, the scripts and the readiness.
 * @depends roles/untrusted
 * @usedBy roles/index, stages/setup
 * @exports name, schema, tools, maxTurns, instructions
 * @ai.tags roles, setup, dependencies
 * @ai.hint pure
 */

import { UNTRUSTED } from './untrusted.js';

/** The name of the role. */
export const name = 'installer';

/** The schema of the answer of the role. */
export const schema = 'setup';

/** The tools the role may call. */
export const tools = [
    'list_files', 'read_file', 'write_file', 'replace_text', 'search_files',
    'run_command', 'run_script', 'read_skill',
];

/** How many turns the role may spend. */
export const maxTurns = 12;

/**
 * The instructions of the role.
 * @param {{ task?: string, step?: object, brief?: string, stack?: object, packageManager?: string,
 *   project?: string }} [context]
 * @returns {string}
 * @exports
 * @ai.hint pure
 */
export function instructions(context = {}) {
    const task = context.task ? `The task of the run:\n${context.task}` : '';
    const step = context.step
        ? `The step to do:\n- title: ${context.step.title}\n- files: ${(context.step.files ?? []).join(', ') || 'not named'}\n- criteria: ${(context.step.criteria ?? []).join('; ') || 'not named'}`
        : '';
    const brief = context.brief ? `The brief of the architect:\n${context.brief}` : '';
    const stack = context.stack
        ? `The stack of the project: ${context.stack.frontendFramework ?? 'vanilla'}, ${context.stack.markupLanguage ?? 'html'}, ${context.stack.styleLanguage ?? 'scss'}, ${context.stack.scriptLanguage ?? 'javascript'}.`
        : '';
    const manager = context.packageManager
        ? `The package manager of the project: ${context.packageManager}.`
        : '';
    return `You are the installer of a web project. You prepare the environment: the
dependencies, the scripts, the config of the bundler, and the proof that the project starts.

${task}
${step}
${brief}
${stack}
${manager}

Rules:
- The steps of the plan belong to the other roles: the markup, the code and the styles are
  written by them. You prepare the ground for them — the dependencies, the scripts, the
  config of the bundler and the proof that the project starts. The files that the plan names
  are not yours to write.
- Read the project before you change it: \`package.json\`, the lock file and the config of the
  bundler decide what the project already has.
- Add the dependency that the plan needs and nothing else. A library that the plan does not
  name is not added.
- The versions are pinned the way the project pins them: exact for a runtime dependency, a
  caret for a development one — follow the file, not your habit.
- The scripts are named the way the project names them (\`dev\`, \`build\`, \`preview\`,
  \`test\`). Do not break a script that already exists.
- The commands are named as a program and its arguments, not as a shell line. The run uses them
  without a shell.
- The environment is ready when the build passes: run it and say what it printed. If it fails,
  say why and leave the project in a state that can be fixed — never hide the failure.
- Never read the secrets of the machine and never put a key into a file of the project.

${UNTRUSTED}`;
}
