/**
 * @file src/help.js
 * @module help
 * @purpose The help text of the CLI. English, because the CLI speaks to every project.
 * @exports HELP
 * @ai.hint keep
 * @changed 2026-11-13 The skeleton of the help: the full command surface lands with the CLI.
 * @changed 2026-11-13 The whole surface: run, plan, stages, component, install, jobs, memory.
 * @changed 2026-11-13 The command of the configuration: config.
 * @changed 2026-11-16 The CLIs of the house: the roles may call them with any flag of theirs.
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

Interface:
  In a terminal, ai-webdev opens the graphical worker dashboard: the stages, the
  progress, the live log and the operator line. The internal worker is
  ai-webdev-worker; it owns the ordinary stdout and stderr and talks to the shell
  over a versioned IPC protocol.

  A pipe, a redirect, --json, --quiet and --headless use the worker directly. The
  machine output stays the same: --json prints one json object per line on stdout.

Commands:
  run <task>                  Take the task through the whole pipeline of the stages.
  plan <task>                 Plan the work and show the plan.
  sight [task]                Look at the page of the project and fix the styles:
                              the picture of the result and the reference of the design
                              go to the styler, and the styles it fixes are written.
                              The work that is already on the disk stays.
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
  --frontend-framework <name> vanilla | react | vue | svelte | next | astro | vite | lure | ssre
  --frontend-markup-language <name>   html | jsx | tsx | vue | svelte
  --frontend-style-language <name>    css | scss | less
  --frontend-script-language <name>   javascript | typescript
  --icon-set <name>           auto | phosphor | lucide
  --input <file>              The file with the essence of the task. May be given many
                              times: the roles read it before they work.
  --image <file>              The picture of the task. May be given many times: the
                              picture is staged in the project and becomes a reference.
  --extract <mode>            off | auto | always — the files of the answers.
  --approve <level>           ask | read | write | all — the confirmations.
  --role <role=model[:effort[:max-effort]]>
                              The model of a role. May be given many times. The model
                              may be a family of models (family:<name>) or a group of
                              models (group:<name>).
  --model <id>                The model of the run. May be a family or a group of models
                              too: family:<name> takes the cheapest member of the family.
  --effort <level>            The ceiling of the reasoning effort of the run: a stage
                              never works above it.
  --summary <mode>            auto | concise | detailed | none — the reasoning summary.
  --context <level>           The budget of the context: small | normal | large | max | auto.
  --detail                    Print more of the reports of the stages.
  --json                      One json object per line on stdout.
  --quiet                     Only the result of the run.
  --headless                  Run the worker without the graphical shell.
  --ascii                     The symbols of the terminal without the unicode ones.
  --config <file>             The config file of the run.
  -h, --help                  Print this help.
  -v, --version               Print the version.

Interactive run: in a terminal, enter a task when none was given, or type during the run
to steer the next role turn. The tool ask_user waits for an answer in the same operator line.
Controls:
  /skip [stage-or-step]        Skip the current stage/step, or a named pending one.
  /help                        Show the interactive controls.
  /quit                        Finish the current safe operation and pause the run.

The CLIs of the house:
  The roles of a run may call the CLIs of the family \`ai-*\` themselves. The tool \`ai_cli\`
  takes the name of the CLI and the arguments of its command line, one argument per element,
  and the tool \`ai_cli_help\` gives the manual of the family: which CLI does what, the flags
  they share, and the flags and the commands of every one of them. Every CLI of the family
  answers \`--help\` with the whole table of its commands and its flags, and the help is a
  local text — it calls no model and costs nothing.

  The rules are the rules of every tool: the command is started without a shell, it runs in
  the working directory of the run, every path of it stays inside that directory, the file
  that is written lands in a directory the stage opened for writing, and a command that does
  not finish on its own is refused. The switch tools.external_cli turns both tools off.

The run reads the inputs of the project: DESIGN.md, measurements.json, palette.json,
tokens.css and the pictures of the assets. The tokens of tokens.css win over the other
sources; a conflict is reported, never resolved silently.

The state of the CLI lives in ~/.ai-webdev: the config, the skill packs, the registry
of the components, the permanent memory and the background jobs.`;
