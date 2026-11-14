/**
 * @file src/help.js
 * @module help
 * @purpose The help text of the CLI. English, because the CLI speaks to every project.
 * @exports HELP
 * @ai.hint keep
 * @changed 2026-11-13 The skeleton of the help: the full command surface lands with the CLI.
 * @changed 2026-11-13 The whole surface: run, plan, stages, component, install, jobs, memory.
 * @changed 2026-11-13 The command of the configuration: config.
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
  ai-webdev "make a landing page"        the same as: ai-webdev run "make a landing page"

Commands:
  run <task>                  Take the task through the whole pipeline of the stages.
  plan <task>                 Plan the work and show the plan.
  stages                      Show the stages of the pipeline.
  component [publish|list|search|show|rm|path]
                              The local registry of the components.
  install <tag>[@version]     Install a component as a local file: package.
  config [init|show|path]     The configuration of the home.
  jobs [list|show|cancel|rm|prune|run]
                              The background jobs.
  memory [list|search|add|rm|tasks]
                              The permanent memory of the project.
  skills [list|search|show|path|rm]
                              The skill packs of the project, of the home and of the package.
  ... memory add <text> --as <kind>
                              The kind of a record: fact | convention | decision |
                              preference | pitfall | summary | note.

Options of the run:
  --route <stages>            The stages the run goes through, comma separated.
                              The stages they need are added.
  --stop-after <stage>        Pause the run after that stage; it continues later.
  --resume <id>               Continue the run of that id.
  --id <id>                   The id of the run (the time by default).
  --pace <0..100>             The speed of the team.
  --quality <0..100>          The quality of the team.
  --fidelity <0..100>         How close the result is to the reference.
  --creativity <0..100>       How far the result may go from the reference.
  --platform <id>             The web platform of the result (chromium).
  --kind <kind>               landing | site | backend | app | component
  --frontend-framework <name> vanilla | react | vue | svelte | next | astro | vite
  --frontend-markup-language <name>   html | jsx | tsx | vue | svelte
  --frontend-style-language <name>    css | scss | less
  --frontend-script-language <name>   javascript | typescript
  --icon-set <name>           auto | phosphor | lucide
  --extract <mode>            off | auto | always — the files of the answers.
  --approve <level>           ask | read | write | all — the confirmations.
  --role <role=model[:effort[:max-effort]]>
                              The model of a role. May be given many times.
  --model <id>                The model of the run.
  --effort <level>            The ceiling of the reasoning effort of the run: a stage
                              never works above it.
  --summary <mode>            auto | concise | detailed | none — the reasoning summary.
  --context <level>           The budget of the context: small | normal | large | max | auto.
  --detail                    Print more of the reports of the stages.
  --json                      One json object per line on stdout.
  --quiet                     Only the result of the run.
  --ascii                     The symbols of the terminal without the unicode ones.
  --config <file>             The config file of the run.
  -h, --help                  Print this help.
  -v, --version               Print the version.

The run reads the inputs of the project: DESIGN.md, measurements.json, palette.json,
tokens.css and the pictures of the assets. The tokens of tokens.css win over the other
sources; a conflict is reported, never resolved silently.

The state of the CLI lives in ~/.ai-webdev: the config, the skill packs, the registry
of the components, the permanent memory and the background jobs.`;
