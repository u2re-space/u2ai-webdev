# @u2ai/webdev

AI web developer: it plans a web project, collects the context of the design, writes the markup,
the code and the styles, draws the vector graphics, picks the icons, reviews the result and
remembers the lessons.

- Named CLI as `ai-webdev`.
- Config in `~/.ai-webdev/config.json`.
- Node.js 26+, ESM, no SDK (plain `fetch`).
- Only the Responses API; every role answers with a strict JSON of its own schema.
- Repository: <https://github.com/u2re-space/u2ai-webdev>.

The package was split out of the `ai` monolith: the web work lives here, with its own
configuration, its own stages, its own roles and its own tests. The monolith commands `ai gen` and
the web part of `ai run` are bridges that forward to this CLI and return its exit code.

## Install

```bash
npm install -g @u2ai/webdev
```

From a checkout:

```bash
npm install
npm link        # puts `ai-webdev` into PATH
```

The only dependency is the MCP client (`@modelcontextprotocol/node`); everything else is a built-in
module of Node.

## Quick start

```bash
export AI_WEBDEV_API_KEY=sk-...      # or put the key into ~/.ai-webdev/config.json

ai-webdev config init                # write ~/.ai-webdev/config.json
ai-webdev "make a landing page for a coffee shop"
ai-webdev plan "make a landing page for a coffee shop"     # only the plan
ai-webdev stages                                           # the stages of the pipeline
```

The task is the whole input: an unknown command is a task, so `ai-webdev "make a landing"` is the
same as `ai-webdev run "make a landing"`.

## Commands

| Command | What it does |
|---|---|
| `run <task>` | Take the task through the whole pipeline of the stages. |
| `plan <task>` | Plan the work and show the plan. |
| `stages` | Show the stages of the pipeline. |
| `component [publish\|list\|search\|show\|rm\|path]` | The local registry of the components. |
| `install <tag>[@version]` | Install a component as a local `file:` package. |
| `config [init\|show\|path]` | The configuration of the home. |
| `jobs [list\|show\|cancel\|rm\|prune\|run]` | The background jobs. |
| `memory [list\|search\|add\|rm\|tasks]` | The permanent memory of the project. |
| `skills [list\|search\|show\|path\|rm]` | The skill packs of the project, of the home and of the package. |

`ai-webdev --help` prints the same list with every flag of the run.

## The pipeline

A run is a sequence of stages. Every stage reads the result of the ones before it, writes its own
report into the directory of the run and hands the result to the next one.

| Stage | What it does |
|---|---|
| `collect` | Read the inputs of the project, the map of the project, the registry of the components, the skill packs and the memory. |
| `pictures` | Prepare the crops of the reference that are pictures: the chess piece, the board, the badge. |
| `plan` | Break the task into steps, each with its role, its files and its check. |
| `architect` | Decide the structure of the project: the files, the modules and the order. |
| `setup` | Prepare the environment: the scaffold, the dependencies and the entry points. |
| `markup` | Write the markup of the pages. |
| `coding` | Write the code: the scripts, the modules, the data. |
| `styling` | Write the styles: the tokens, the layout, the states. |
| `vector` | Draw the vector graphics as code: the SVG of the ornaments and the illustrations. |
| `iconify` | Choose the icons of the interface and check that every one of them is on the disk. |
| `review` | Review the result: the markup, the code, the styles and the accessibility. |
| `audit` | Audit the project: the dead code, the duplicates, the unused assets. |
| `learn` | Write the lessons of the run into the permanent memory. |

`--route <stages>` chooses the stages the run goes through (the stages they need are added
automatically), `--stop-after <stage>` (or `--stop-after=<stage>`) pauses the run on the
border of a stage, and `--resume <id>` continues it later. The name of the stage of the pause
is not case sensitive, and it is checked against the stages of the run: a stage that is out
of the route or switched off is a usage error, not a pause that never comes.

### The pictures of the reference

The sheet of the measurements names the crops of the reference: the chess piece, the wooden
board, the badge. A crop is a rectangle of the screenshot, so the page around the object is
still in the picture. The stage `pictures` gives those crops to the sibling CLI `ai-image`,
which cuts the object out, and puts the result into `assets/import/`. The roles get the path of
the prepared picture in the context of the run.

```json
{
  "pictures": {
    "kinds": ["image", "illustration", "artwork", "photo", "ornament"],
    "command": "background",
    "alphaMode": "auto",
    "dir": "assets/import",
    "max": 6
  }
}
```

The kinds say which crops of the sheet are pictures. The command is the one of `ai-image`:
`background`, `alpha`, `trim` or `edit`; the section `commands` names another command for a
kind, and the section `prompts` names the prompt of the command `edit`. The stage never stops
the run: a crop that cannot be prepared is reported, and the crop stays as it was. A picture
that is already in the directory is not prepared again — the model is not asked for the same
cut twice.

## The roles

Every stage is done by a role: a prompt, a schema of the answer, a list of tools and a limit of
turns.

| Role | What it does |
|---|---|
| `planner` | Break the task into steps. |
| `architect` | Design the structure of the project. |
| `director` | Lead the steps of the plan and keep the whole in one state. |
| `coder` | Write the code. |
| `markup` | Write the markup. |
| `styler` | Write the styles. |
| `iconifier` | Pick the icons. |
| `installer` | Set the environment up. |
| `editor` | Edit the vector graphics and the decorations. |
| `reviewer` | Review the result. |
| `auditor` | Audit the project. |
| `learner` | Write the lessons. |

`--role <role>=<model>[:<effort>[:<max-effort>]]` gives a role its own model; the flag may be
given many times. The config may override the model, the effort, the instructions and the tools of
any role, and may add roles of its own.

## The inputs of a run

A run reads the direction of the design from the project itself:

| Input | What it gives |
|---|---|
| `DESIGN.md` | The intent of the design: the pages, the blocks, the tone. |
| `measurements.json` | The measurements of the reference: the frames, the gaps, the sizes. |
| `palette.json` | The colors of the design. |
| `tokens.css` | The tokens of the design: the variables of the stylesheet. |
| `AGENTS.md`, `CLAUDE.md` | The instructions of the project. |
| `.ai/refs/`, `.ai/assets/` | The pictures: the references, the crops, the assets. |

The values of `tokens.css` win over the document and over the palette. A conflict between the
sources is reported, never resolved silently.

The bridges to the sibling CLIs add more: `ai-decompose` splits a reference into screens,
`ai-measure` measures a reference, and `ai-image` makes the pictures that the project needs.

## Configuration

The configuration lives in `~/.ai-webdev/config.json` (`AI_WEBDEV_HOME` moves the whole home
directory). The file is optional: the CLI works on the defaults until the file appears.
`ai-webdev config init` writes the starter file once — only the fields a user is expected to edit,
everything else stays on the defaults.

```json
{
  "model": "moonshotai/kimi-k3.1-pro",
  "reasoning": { "effort": "xhigh", "summary": "auto" },
  "backends": [
    { "baseURL": "https://routerai.ru/api/v1", "env": "ROUTERAI_API_KEY" },
    { "baseURL": "https://api.proxyapi.ru/v1", "env": "PROXYAPI_API_KEY" }
  ],
  "stack": {
    "frontendFramework": "vanilla",
    "markupLanguage": "html",
    "styleLanguage": "scss",
    "scriptLanguage": "javascript",
    "iconSet": "auto"
  },
  "agent": { "fidelity": 70, "creativity": 30, "platform": "chromium", "approve": "write", "extract": "auto" },
  "pace": { "mode": "auto", "speed": 50, "quality": 50 },
  "stages": {
    "plan": { "enabled": true, "maxTurns": 12 },
    "collect": { "enabled": true, "maxTurns": 8 }
  },
  "bridges": {
    "decompose": { "enabled": true },
    "measure": { "enabled": true },
    "image": { "enabled": true }
  }
}
```

The precedence is: defaults → `~/.ai-webdev/config.json` → `--config <file>` → `AI_WEBDEV_*`
environment → the flags of the command.

The sections of the file:

| Section | What it holds |
|---|---|
| `model`, `baseURL`, `apiKey`, `backends`, `modelsBackends`, `fallback` | The API: the model, the hosts, the pool of the fallbacks. |
| `reasoning`, `limits`, `models` | The effort, the summaries, the budgets of the run and the ceilings of the models. |
| `tools` | The tools the roles may call. |
| `stack` | The stack the generator writes for: the framework, the markup, the styles, the script, the icons. |
| `agent` | The knobs of the run: `fidelity`, `creativity`, `platform`, `kind`, `approve`, `extract`. |
| `pace` | The dials of the team: `speed`, `quality` and the per-stage dials. |
| `stages` | Every stage: `enabled` and `maxTurns`. |
| `output` | Where the artifacts go: `dir` (`.ai/`) and `work` (`.tmp/`). |
| `inputs` | The names of the input files. |
| `pictures` | The crops of the reference that are prepared: the kinds, the command of `ai-image`, the directory, the limit. |
| `memory` | The permanent memory: the file, the scope, the limit, the summaries of the files, the finished tasks. |
| `components` | The local registry: the directory, the index, the vendor directory. |
| `bridges` | The sibling CLIs: `decompose`, `measure`, `image` — each may be switched off. |
| `roles`, `customRoles` | The roles: the model, the effort, the instructions, the tools. |
| `documentation` | The standards a role is given: the CSS units, the shapes, the icon sets, the WCAG rules. |
| `mcp` | The external tool servers. |
| `skills` | The directory of the skill packs. |

The home directory holds:

```
~/.ai-webdev/
  config.json      the configuration
  skills/          the skill packs
  components/      the sources of the local registry
  components.db    the index of the registry (SQLite)
  memory.db        the permanent memory (SQLite)
  jobs/            the background jobs
```

### Environment

| Variable | Meaning |
|---|---|
| `AI_WEBDEV_HOME` | The home directory of the CLI (`~/.ai-webdev` by default). |
| `AI_WEBDEV_CONFIG` | The path of the configuration file. |
| `AI_WEBDEV_API_KEY` | The key of the API (`OPENAI_API_KEY` also works). |
| `AI_WEBDEV_BASE_URL` | The endpoint of the API (`OPENAI_BASE_URL` also works). |
| `AI_WEBDEV_MODEL` | The model of the roles (`AI_MODEL` also works). |
| `AI_WEBDEV_BACKENDS` | The JSON list of the backends. |
| `AI_WEBDEV_EFFORT` | The reasoning effort of the run. |
| `AI_WEBDEV_FRAMEWORK`, `AI_WEBDEV_MARKUP`, `AI_WEBDEV_STYLE`, `AI_WEBDEV_SCRIPT`, `AI_WEBDEV_ICON_SET` | The stack of the generator. |
| `AI_WEBDEV_FIDELITY`, `AI_WEBDEV_CREATIVITY`, `AI_WEBDEV_KIND` | The knobs of the generation. |
| `AI_WEBDEV_SPEED`, `AI_WEBDEV_QUALITY`, `AI_WEBDEV_PACE` | The dials of the team. |
| `AI_WEBDEV_STAGE_<STAGE>` | `0` or `false` switches one stage off. |
| `AI_WEBDEV_BRIDGE_<BRIDGE>` | `0` or `false` switches one bridge off. |
| `AI_WEBDEV_RETRIES`, `AI_WEBDEV_TIMEOUT_MS`, `AI_WEBDEV_MAX_TURNS` | The limits of one request. |

The messages of the configuration validator are in Russian, as in the sibling packages
`@u2ai/images` and `@u2ai/decomposer`; every other message of the CLI is in English.

## The write policy

Two fields decide whether a run touches the project:

- `agent.extract` — `off` (nothing is written, the files stay in the report), `auto` and `always`
  (the files of the answers are written; the two behave the same in this package).
- `agent.approve` — the level of the confirmations: `ask` and `read` write nothing, `write` writes
  the files of the answers, `all` writes the files too.

So a run writes only when `extract` is not `off` and `approve` is `write` or `all`. The flags
`--extract` and `--approve` change the two fields for one run only. A file that already exists is
never overwritten, and `package.json` is never written by a run.

## The local registry of the components

A component is a reusable piece of the interface: a tag, a version, a framework, a summary and the
sources. The project declares it in `.ai/component.json`; the registry keeps a copy of the sources,
so the project stays free to change.

```bash
ai-webdev component publish            # publish the component of this project
ai-webdev component list
ai-webdev component search "form"
ai-webdev component show button@1.0.0
ai-webdev install button@1.0.0         # a local file: package in vendor/components/button
```

The registry is personal and needs no network: it lives in the home of the CLI. The `collect` stage
puts the cards of the registry into the context of the run, so the roles reuse a component that is
already written instead of writing it again.

## The permanent memory

The memory is a SQLite database with a full-text index: the lessons of the runs, the summaries of
the files and the finished tasks. The lessons are the ones the `learn` stage writes at the end of a
run; the next run reads them and starts from what the earlier one has learned.

```bash
ai-webdev memory add "The project uses Vite and SCSS" --as convention
ai-webdev memory list
ai-webdev memory search "vite"
ai-webdev memory rm 12
ai-webdev memory tasks
```

The kinds of a record: `fact`, `convention`, `decision`, `preference`, `pitfall`, `summary`,
`note`. The scopes: `global` (every project) and `project` (this directory).

## The skill packs

A skill pack is a directory with a `SKILL.md` inside: the markdown that teaches a role
something the model does not know. The packs are looked for in the project
(`.agents/skills/`, `.koda/skills/`, `.claude/skills/`, `.rules/skills/`), in the home
(`~/.agents/skills/`) and in the package itself. The copy of the project wins over the copy of
the home, and the copy of the home wins over the one of the package.

```bash
ai-webdev skills list                # every pack: the name, the source, the description
ai-webdev skills search dialog       # the packs that mention the words
ai-webdev skills show modern-web-guidance
ai-webdev skills path modern-web-guidance
ai-webdev skills rm demo             # only the packs of the project
```

The pack of the package is `modern-web-guidance`: 209 guides of the modern web platform
(the dialogs, the forms, the layout, the animation, the accessibility, the performance) by the
Chrome, Edge, Firefox and MDN teams, under Apache-2.0. The roles that write or judge the
interface read it with the tool `web_guidance`:

| Call | What it does |
|---|---|
| `web_guidance` with `query` | The search: the ids and the summaries of the guides that fit the words. |
| `web_guidance` with `ids` | The retrieve: the whole text of the guides, by their ids. |

The guides are read from the disk of the package: no network, no npm, no waiting. The CLI of the
upstream (`npx modern-web-guidance@latest search|retrieve`) is the fallback — for the guide that
is newer than the bundle, and for the caller that asks for the CLI (`source: "cli"`).

## The process of a run

A run may be paused and continued: the plan, the progress and the reports live on the disk, in the
directory of the run (`.tmp/<id>/` by default, the id is the time).

```bash
ai-webdev run "make a landing" --stop-after plan     # pause after the plan
ai-webdev run --resume 20261113-142530                # continue it
ai-webdev jobs run -- npm run build                    # a background job of the project
ai-webdev jobs list
```

A run that was interrupted keeps its progress: the next run with `--resume <id>` continues at the
stage it has not finished.

## The bridges to the sibling CLIs

Three external CLIs may help a run. Each of them is a subprocess, each of them may be switched off
in the config (`bridges.<name>.enabled`), and a bridge that fails never breaks the run — it only
empties its part of the context.

| Bridge | What it does |
|---|---|
| `ai-decompose` | Splits a reference into screens and fragments. |
| `ai-measure` | Measures a reference: the frames, the gaps, the sizes. |
| `ai-image` | Makes the pictures the project needs. |

The binary of a bridge is looked up in the environment variable of the bridge, in the checkout of
the sibling package, in `node_modules` and in the `PATH`.

## Examples

```bash
# a landing page with a strict fidelity to the reference
ai-webdev run landing "repeat the mockup" --fidelity 90 --creativity 10

# a React project with TypeScript and Lucide
ai-webdev run "a small app" --frontend-framework react --frontend-script-language typescript --icon-set lucide

# only the plan and the architecture
ai-webdev plan "a shop with a cart" --route plan,architect

# pause after the markup, look at the files, then continue
ai-webdev run "a shop with a cart" --stop-after markup

# the machine-readable run: one json object per line
ai-webdev run "a shop with a cart" --json

# what the pipeline is
ai-webdev stages --json
```

## Exit codes

| Code | Meaning |
|---|---|
| 0 | The run succeeded. |
| 1 | The run failed: the network, the model, the file. |
| 2 | The arguments were wrong; nothing was tried. |
| 130 | The run was interrupted. |

## Library API

```js
import { main, loadConfig, STAGES, ROLES } from '@u2ai/webdev';

const exitCode = await main(['run', 'make a landing page', '--route', 'plan']);
```

`main` is the whole CLI. `loadConfig` returns the merged configuration, `STAGES` is the registry of
the stages, and `runPipeline` (from `src/pipeline.js`) runs the pipeline without the CLI.

## The access layer

`src/access` is the door between the model and the machine: the files and the commands under one
root. Both halves work through a backend, so the same rules hold on a native disk, in the memory,
or over a remote one.

```js
import { createAccess } from './src/access/index.js';

const access = createAccess({ root: process.cwd() });

await access.fs.writeText('notes/todo.md', '# todo');
const read = await access.fs.readText('notes/todo.md');
const found = await access.fs.search({ query: 'todo' });

const answer = await access.exec.run('node', ['--version']);
```

The rules of the paths live in one place and are never optional: a path may not leave the root —
neither through `..` nor through a symbolic link — the secret files and the secret directories are
never accessible, and the read-only directories may be read, but never written. The words of the
refusals belong to the package: `src/agent/paths.js` keeps them Russian and borrows the rules from
`src/access/paths.js`.

## Limits

- The package writes the files of the answers, but never overwrites a file that exists and never
  writes `package.json`.
- The icons are downloaded as files: a missing icon is a warning of the `iconify` stage, not a
  broken page.
- The vector graphics are SVG documents: they are written and checked as text, not redrawn.
- There is no image generator in this package: the pictures are the work of the `ai-image` bridge.
- A run that is interrupted keeps its progress on the disk and can be continued with `--resume`.

## Development

```bash
npm test          # the whole suite, offline
npm run check     # node --check over every file of the package
npm pack --dry-run
```

The suite needs no network and no key: the calls of the API are made by a fake client.

## License

MIT
