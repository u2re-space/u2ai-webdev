/**
 * @file src/roles/inputs.js
 * @module roles/inputs
 * @purpose The rule that keeps a role from reading the inputs of the run again.
 *
 *   The design direction, any existing measurements, the palette and the tokens are collected
 *   before the run and put into the context of every role. A role that reads those files again
 *   pays for context it already has and learns nothing new.
 * @depends none
 * @usedBy roles/planner, roles/architect, roles/markup, roles/coder, roles/styler, roles/editor
 * @exports INPUTS_IN_CONTEXT
 * @ai.tags roles, inputs, context
 * @ai.hint pure
 */

/**
 * The rule about the inputs of the run, written for the list of rules of a role.
 * @type {string}
 * @exports
 * @ai.hint pure
 */
export const INPUTS_IN_CONTEXT = '- DESIGN.md, any existing measurements, the palette and the tokens are already in your context when present. Measurements are optional: never request a measurer; when no sheet exists, use the attached reference image and DESIGN.md directly and infer visual details. Do not read collected inputs again: read only project files not in the context. If an element has exact recognized text, reproduce it verbatim; preserve every newline as a visible line break in the markup or styles, and do not turn it into spaces.';
