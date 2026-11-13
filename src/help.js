/**
 * @file src/help.js
 * @module help
 * @purpose The help text of the CLI. English, because the CLI speaks to every project.
 * @exports HELP
 * @ai.hint keep
 * @changed 2026-11-13 The skeleton of the help: the full command surface lands with the CLI.
 */

/**
 * The help text.
 * @type {string}
 * @exports
 * @ai.hint pure
 */
export const HELP = `ai-webdev — plan, build and refine web projects with AI.

Usage:
  ai-webdev <command> [options]

Options:
  -h, --help     Print this help.
  -v, --version  Print the version.

The commands arrive with the stages that own them: run, plan, markup, code, style,
review, audit, component, install, icons, svg, jobs, memory, map.`;
