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

Commands:
  component [publish|list|search|show|rm|path]  The local registry of the components.
  install <tag>[@version]                      Install a component as a local file: package.

Options:
  -h, --help     Print this help.
  -v, --version  Print the version.

The commands arrive with the stages that own them: run, plan, markup, code, style,
review, audit, icons, svg, jobs, memory, map.`;
