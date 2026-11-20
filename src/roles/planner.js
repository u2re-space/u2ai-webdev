/**
 * @file src/roles/planner.js
 * @module roles/planner
 * @purpose The plan of the work: the steps, their order, their files and their criteria.
 * @depends roles/untrusted, stages/roles
 * @usedBy roles/index, stages/plan
 * @exports name, schema, tools, maxTurns, instructions
 * @ai.tags roles, plan
 * @ai.hint pure
 */

import { UNTRUSTED } from './untrusted.js';
import { INPUTS_IN_CONTEXT } from './inputs.js';
import { LIVE_ROLE_NAMES } from '../stages/roles.js';
import { referenceNote } from './reference.js';

/** The name of the role. */
export const name = 'planner';

/** The schema of the answer of the role. */
export const schema = 'plan';

/** The tools the role may call. */
export const tools = [
    'list_files', 'read_file', 'search_files', 'read_skill',
];

/** How many turns the role may spend. */
export const maxTurns = 12;

/**
 * The instructions of the role.
 * @param {{ task?: string, kind?: string, stack?: object, design?: string, project?: string,
 *   reference?: string[], referenceSizes?: object[] }} [context]
 * @returns {string}
 * @exports
 * @ai.hint pure
 */
export function instructions(context = {}) {
    const task = context.task ? `The task:\n${context.task}` : 'The task was not given.';
    const kind = context.kind ? `The kind of the task: ${context.kind}.` : '';
    const stack = context.stack
        ? `The stack of the project: ${context.stack.frontendFramework ?? 'vanilla'}, ${context.stack.markupLanguage ?? 'html'}, ${context.stack.styleLanguage ?? 'scss'}, ${context.stack.scriptLanguage ?? 'javascript'}.`
        : '';
    const design = context.design ? `The design direction is in the task context. Treat it as the source of truth for the look.` : '';
    const reference = referenceNote(context);
    return `You are the planner of a web project. You do not write the code — you decide what
has to be done, in which order, and how one knows that each step is done.

${task}
${kind}
${stack}
${design}
${reference}

Rules:
${INPUTS_IN_CONTEXT}
- The answer is the plan itself, not a description of your work. A step is a piece of work to do
  now, with its files and its criteria. Never answer with a plan like "first I will study the
  project" or "then I will decide the structure": that is a plan of intentions, and it is wrong.
- The plan has at least two steps. If the task needs one step, it is still a plan — say what the
  step is and how it is checked.
- Read the project first: the files that already exist decide what the plan may assume.
- A reference picture is a visual source of truth even when no measurement sheet exists. Use
  the attached screenshot and \`DESIGN.md\` directly; infer the hierarchy, proportions, palette,
  typography and spacing visually. Never require or call a measurer.
- If prepared crops of reference pictures already exist, use them as assets of the result. Their
  absence must not block the work: use the attached reference image directly instead of asking
  for a measurement sheet or a drawn copy of a visible logo or photograph.
- One step is one role's work. The steps are small enough to be done in one sitting and large
  enough to be worth a step. A step that needs two roles is two steps.
- The role of a step is one of: ${LIVE_ROLE_NAMES.map((name) => `\`${name}\``).join(', ')}. The
  stages of the run take the steps of these roles and of no others, so a step with any other
  role is never done. \`markup\` writes the markup, \`coder\` writes the scripts and the modules,
  \`styler\` writes the styles, \`editor\` draws the vector graphics, \`iconifier\` chooses the
  icons.
- The environment, the structure of the project, preparation of any existing picture crops and
  the review are not steps: the stages of the run handle them by themselves. Name prepared
  pictures only when they exist and the step uses them. A step for \`package.json\`, for the
  lock file or for the config of the bundler is not a step: the stage \`setup\` writes them
  before the markup, and a step that names them is dropped from the plan.
- The steps come in an order that can be executed: the markup before the styles, the setup
  before the code that needs the dependencies, the icons before the page that uses them.
- Every step names the files it touches. The paths are relative to the root of the project.
- Every step has criteria that can be checked without asking a human: "the page opens and the
  menu works" is a criterion, "the code is good" is not.
- Put the questions that block the work into \`questions\` instead of guessing. Do not ask about
  what the project or the task already answers.
- Do not plan a step that only says "make it look nice". Name the screen, the section and the state.

${UNTRUSTED}`;
}
