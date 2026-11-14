/**
 * @file src/roles/inputs.js
 * @module roles/inputs
 * @purpose The rule that keeps a role from reading the inputs of the run again.
 *
 *   The design direction, the measurements, the palette and the tokens are collected before
 *   the run and put into the context of every role. A role that reads those files again
 *   pays for the whole sheet of the measurements a second time and learns nothing new.
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
export const INPUTS_IN_CONTEXT = '- The design direction, the measurements, the palette and the tokens are already in your context. Do not read those files again: read only the files of the project that are not in the context.';
