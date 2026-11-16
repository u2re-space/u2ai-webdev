/**
 * @file src/roles/cli-note.js
 * @module roles/cli-note
 * @purpose The rule that keeps a role from guessing the flags of a CLI of the house.
 *
 *   The CLIs of the house — `ai`, `ai-webdev`, `ai-decompose`, `ai-measure`, `ai-image` —
 *   carry the table of their commands and their flags in themselves: `--help` prints it. A
 *   role that guesses a flag pays for the guess with a failed call and a wasted turn, and
 *   the help of a CLI is a local text: it calls no model and costs nothing.
 *
 * @depends none
 * @usedBy roles/planner, roles/architect, roles/editor, roles/reviewer, roles/auditor,
 *          roles/installer
 * @exports FAMILY_CLI_NOTE
 * @ai.tags roles, cli, family
 * @ai.hint pure
 */

/**
 * The rule about the CLIs of the house, written for the list of rules of a role.
 * @type {string}
 * @exports
 * @ai.hint pure
 */
export const FAMILY_CLI_NOTE = '- The CLIs of the house answer `--help`: when you do not remember a flag of `ai-decompose`, `ai-measure` or `ai-image`, ask the CLI with the tool `ai_cli` — ["--help"] prints the whole table of the commands and the flags of that CLI, ["--version"] prints the version, and both cost nothing. The manual of the family is in the tool `ai_cli_help`.';
