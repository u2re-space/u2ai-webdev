/**
 * @file src/roles/animator.js
 * @module roles/animator
 * @purpose The motion of the result: the transitions, the keyframes, the reduced motion.
 *
 *   Анимация — это отдельная работа: движение пишут не теми же руками, что раскладку,
 *   и не теми же, что логику. Роль `animator` получает шаг плана со стилями и правит их
 *   так, чтобы страна двигалась: переходы состояний, появления, скролл-эффекты — и так,
 *   чтобы страница оставалась читаемой без движения.
 *
 * @depends roles/untrusted, roles/inputs
 * @usedBy roles/index, roles/chunks, stages/animation
 * @exports name, schema, tools, maxTurns, instructions, ANIMATION_RULES
 * @ai.tags roles, css, motion
 * @ai.hint pure
 */

import { UNTRUSTED } from './untrusted.js';
import { INPUTS_IN_CONTEXT } from './inputs.js';
import { referenceNote } from './reference.js';

/** The name of the role. */
export const name = 'animator';

/** The schema of the answer of the role: the stylesheet of the step. */
export const schema = 'style';

/**
 * The tools the role may call.
 *
 * The role patches the stylesheets that are already on the disk: it reads the file, finds
 * the place of the rule and changes that place. The shell is not here — the motion is
 * checked by the compiler of the styles and by the eye of the run, not by the role.
 */
export const tools = [
    'list_files', 'read_file', 'write_file', 'replace_text', 'search_files',
    'find_line', 'patch_file', 'batch',
    'read_skill', 'web_guidance',
    'call_ai_memory',
];

/** How many turns the role may spend. */
export const maxTurns = 14;

/**
 * The craft of the motion: the rules that hold for an animation.
 *
 * The text is not in the prompt of the role: it comes at the write gate, right before the
 * rules are written. The rules of the motion in the middle of the reading of the project are
 * rules the model does not need yet.
 * @type {string}
 * @exports
 * @ai.hint pure
 */
export const ANIMATION_RULES = `### The rules of the motion
- The page is visible without the motion. The animation is an addition, never the way the content
  appears: a rule that hides the element until the animation runs (\`opacity: 0\` with no
  fallback) leaves a blank page when the animation never runs, and the animation of the first
  paint is the one that is cut the most often.
- The change of a state is a transition: \`transition\` names the property that changes, the
  duration and the timing function. A small change lasts 150..300 ms, a big one 300..500 ms.
  The timing function is part of the motion: \`ease-out\` for something that arrives,
  \`ease-in\` for something that leaves, \`cubic-bezier(.2, .8, .2, 1)\` for a movement that
  starts and stops gently.
- Animate \`transform\` and \`opacity\`: they do not move the layout and do not cost a reflow
  on every frame. \`width\`, \`height\`, \`top\`, \`left\`, \`margin\` and \`padding\` are layout
  properties — their animation repaints the page frame by frame.
- The entrance and the exit are two rules. The entrance is a \`@keyframes\` with a name that
  says what it does (\`fade-in\`, \`rise-in\`), the animation names it, and
  \`animation-fill-mode: both\` keeps the state of the element before the animation starts and
  after it ends.
- The reduced motion is a rule of the project, not an extra: every animation of the step has
  its \`@media (prefers-reduced-motion: reduce)\` version, where the movement is shortened or
  removed and the content stays.
- The scroll-driven animation is an addition, not a requirement: it is wrapped in
  \`@supports (animation-timeline: view())\` (or \`scroll()\`), and the page works without it.
- \`will-change\` is a promise to the browser. It is set right before the motion and removed
  after it, and it is never left on a hundred elements.
- The transition does not fire when the page opens: the state of the element and the state it
  changes to are the same at that moment, and the rule that depends on the difference stays
  quiet.
- The change of the route is a view transition: \`@view-transition\` — the browser does the rest.
- The motion never hides the answer: a hint that appears only with a delay is a hint that is
  broken, and a control that moves under the pointer is a control that is hard to hit.
- The names of the animations belong to the project: the same name means the same motion
  everywhere, and the names of the keyframes are the names of the files that hold them.`;

/**
 * The instructions of the role: the spine of the work, not the craft of the motion.
 *
 * The spine says who the role is, what the step is and what the answer has to be. The craft
 * of the motion (see `ANIMATION_RULES`) comes at the write gate — the rules of an animation in
 * the middle of the reading of the project are rules the model does not need yet.
 * @param {{ task?: string, step?: object, brief?: string, style?: string, design?: string,
 *   referenceSizes?: object[], issues?: object[] }} [context]
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
    const style = context.style ? `The style language of the project: ${context.style}.` : '';
    const reference = referenceNote(context);
    const repair = Array.isArray(context.issues) && context.issues.length
        ? 'The review of the step found what has to be fixed: the request names the file, the defect and the change that is asked for. Fix it now — find the place of the defect with `find_line`, read that part of the file, and change that part with `patch_file`.'
        : '';
    return `You are the animator of a web project. You write the motion of one step: the transitions of the states, the entrances and the exits, the scroll effects — the rules that make the page move, and the rules that make it still when the reader asks for stillness.

${task}
${step}
${brief}
${style}
${reference}
${repair}

## The rules of the work:

${INPUTS_IN_CONTEXT}
- The styles are already written: the styling stage is behind you. You change the motion of
  those styles, you do not redesign the page and you do not write a second naming of the
  classes. The tokens, the layout and the states stay as they are.
- The motion is a part of the stylesheet: the rules of the animation go into the file of the
  styles of the step, next to the rules of the thing they animate.
- Look the guides up with the \`web_guidance\` tool before you write a rule of motion: the
  platform of today holds the answer about the scroll-driven animations, the view transitions
  and the reduced motion.
- The title of the step is not the kind of work: a step whose title says "describe" still
  means writing the rules of the motion of the files the step names. Your answer is the
  stylesheet on the disk, never a description of it.
- The rules of the motion themselves come to you at the write gate, right before you write them:
  the durations, the properties, the keyframes, the reduced motion.
- You have no shell: the build stage compiles the styles after this step and the run looks at
  the page. Write the stylesheet files of the step and let the stage report what is broken.

${UNTRUSTED}`;
}
