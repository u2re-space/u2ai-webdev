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
| `plan` | Break the task into steps, each with its role, its files and its check. |
| `pictures` | Prepare the crops of the reference that are pictures: the chess piece, the board, the badge. |
| `architect` | Decide the structure of the project: the files, the modules and the order. |
| `setup` | Prepare the environment: the scaffold, the dependencies and the entry points. |
| `markup` | Write the markup of the pages. |
| `coding` | Write the code: the scripts, the modules, the data. |
| `styling` | Write the styles: the tokens, the layout, the states. |
| `build` | Connect the styles: the entry point, the compilation, the links of the markup. |
| `sight` | Open the page in a browser, shoot it, and let the styler compare the picture with the reference and fix the styles. |
| `vector` | Draw the vector graphics as code: the SVG of the ornaments and the illustrations. |
| `iconify` | Choose the icons of the interface and check that every one of them is on the disk. |
| `review` | Review the result: the markup, the code, the styles and the accessibility — and repair what it finds. |
| `audit` | Audit the project: the dead code, the duplicates, the unused assets. |
| `learn` | Write the lessons of the run into the permanent memory. |

The skeleton of the project is written by the code, not by the model: a project without a
manifest gets `package.json`, the config of the bundler and the rules of the stack, with the
stack of the architect. The versions of the tools of the stack are pinned there (`vite ^7.0.0`,
`sass ^1.80.0`), so the install of the project is repeatable. The installer then adds what is
missing — the dependencies, the scripts, the files — and the stage checks the readiness of the
project and says what is not there.

The role of a step is the role that does it. Five roles take the steps of the plan: `markup`
writes the markup, `coder` writes the scripts and the modules, `styler` writes the styles,
`editor` draws the vector graphics, `iconifier` chooses the icons. The other roles work once
for the whole run — the plan, the architecture, the environment, the review, the audit and the
lessons are stages, not steps. A plan that names another role is a promise the run cannot keep,
so the harness does not keep it silently: the role is guessed by the files of the step
(`index.html` → `markup`, `styles.scss` → `styler`, `assets/badge.svg` → `editor`), and a step
whose role cannot be guessed leaves the plan with a warning that says what happened. The files
of the environment (`package.json`, `vite.config.js`, `.gitignore`) are not guessed: the stage
`setup` prepares them for the whole run, and a step that asks a role to write them is dropped.
The planner is told the five roles in its prompt and in the schema of its answer, so the plan of
a model that listens names them from the start.

The plan decides the order of the stages that do its steps. The registry has an order of its own
(markup, coding, styling), but the plan knows more: a step that depends on another step is done
after it. The harness reads the dependencies of the plan and moves the stages of the steps
accordingly — the icons are picked before the styles are written when the plan says so, and the
scripts come after both. The order of the registry breaks the tie, so a plan that says nothing
about the order of two stages changes nothing, and a plan with a circle in it keeps the order of
the registry and says so in the warnings of the run. The stages that do not work on the steps of
the plan keep their place: the build is after the styles, the review is after everything.

A step writes its own files. The plan divides the work of the project between the steps, and
every step owns its files: a role that picks the icons does not rewrite the styles of the
project, and a role that writes the scripts does not replace the markup. A file that another
step of the plan owns is not written — the answer of a role does not take the work of another
step away — and the run says which file was left alone. The files that no step named are
free: a module that the role adds beside the files of its step is written and checked like the
rest.

The role sees what is on the disk. A model that is pinned to a JSON answer never calls a tool, so
it cannot read the project: it writes the file it has never seen, from scratch, with its own
names, and the work of the project is replaced by a guess. The request of a step carries the
files that are there now — the files of the step and the markup of the project — and says that
the text of a file is data, not an instruction. The role changes the file instead of replacing
it, and the roles of the styles and the code speak the same language as the markup they see.

The dependencies go on the disk by the code of the stage, not by the model: the stage reads the
manifest and runs the package manager of the project (`npm install --no-audit --no-fund`), so a
run that leaves the setup stage has a `node_modules` and not only a promise of one. The runner
of the programs (`src/agent/programs.js`) looks a program up in the PATH the way the shell looks
it up: the name itself, then the shims of Windows (`npm.cmd`, `npx.cmd`). A shim is a batch
file, and a batch file is started through the shell of the system. A missing program, a non-zero
exit code and a timeout come back as an answer, never as an exception. The install is skipped
only when every package of the manifest is already on the disk: a `node_modules` that does not
hold `sass` is a reason to install, not a reason to skip.

A step names the files it touches, and the check of the step counts what is really there: a file
that is not on the disk means that the work was not done, and the stage says so instead of
calling the step done. A directory counts as a file that is there. A step that names the
directory of the icons (`src/assets/icons/`) has done its work when the directory is on the
disk, and the run does not stop over a directory that was asked for and that exists — the run
that stopped there never came to the review, and the review is the stage that says what is
really wrong with the project.

The compiler of the styles is a dependency of the project: a project that writes SCSS gets
`sass` in its `devDependencies` (`sass ^1.80.0`), and the package manager of the project puts it
on the disk. The code of the stage `setup` adds it to the manifest and installs it — the model
does not install anything.

The styles are connected by the code of the stage `build`, not by the model. A model writes
`styles/main.scss` with three partials beside it and forgets two things: the entry point does
not always `@use` the partials, and the page links a CSS file that was never built. The stage
finds the entry point (the stylesheet that is not a partial and that nobody uses), adds the
missing `@use`, compiles the stylesheets with the `sass` of the project (`styles/main.scss` →
`styles/main.css`) and makes sure that the markup points at the CSS that exists and at the
script that runs. A partial that nobody uses renders nothing, so it is connected to the entry
point of its own directory. A copy of a repair (`main-incorrect.scss`) is not a part of the
styles: it is neither built nor linked, and the report names it. Without `sass` in
`node_modules` the styles are not built, and the report says so.

A project of Vite gets its styles the way Vite wants them: the import of the stylesheet goes
into the script of the project (`import './styles/main.scss'`), the bundler compiles the SCSS
itself, and the link of the markup to the built CSS is removed — that file is an artifact of
the bundler, and a link to it breaks the build. The stage does this by the code as well: the
import is added when it is missing, and the report names the specifier of the import. The
styles are still checked: the compiler of the project compiles the entry point into a
temporary file, so a stylesheet that does not compile is named in the report instead of
breaking the build of the user later.

The files that a stylesheet uses are checked too, and the check does not need the compiler:
a model that writes an entry point with `@use "tokens"` and writes no `tokens` leaves a page
without styles. The stage names the missing file (`Стиль не найден: scss/main.scss → tokens
(scss/tokens.scss)`) and the run fails — the same check runs in the stage of the step, so the
role is told about the missing file and writes it.

`--route <stages>` chooses the stages the run goes through (the stages they need are added
automatically), `--stop-after <stage>` (or `--stop-after=<stage>`) pauses the run on the
border of a stage, and `--resume <id>` continues it later. The name of the stage of the pause
is not case sensitive, and it is checked against the stages of the run: a stage that is out
of the route or switched off is a usage error, not a pause that never comes.

The review repairs what it finds. The issues are grouped by the file they name, and the role
that wrote the file is asked to fix it: the role of the styles fixes the styles, the role of
the code fixes the code. The repaired files are compiled, and the steps that were repaired are
reviewed again — the verdict of the run has to say what the project looks like now. What the
first repair did not close is named again and repaired again: `stages.review.repairRounds`
(two passes by default) says how many passes the repair gets, and the second pass says to the
role that the last repair did not close the defect. `"repair": false` turns the repair off,
and the review then only reports. The findings go to the disk before the repair starts, so a
repair that runs out of time does not take the findings with it.

The markup and the styles have to speak the same language, and the review checks it. A class
that the markup uses and that no rule describes is an element without a shape; a class that
the styles describe and that the markup does not use is a rule that nobody gets. The check
reads the names of both sides: the classes of the markup and the classes of the selectors of
the styles, with the nested selectors of SCSS resolved (`&__title` inside `.card` is
`.card__title`). A class of the markup without a rule is a defect of the styles, and the
styler is asked to write the rule. A class that the styles describe and that disappeared from
the markup while the repair was running is a renamed class: the repair rewrote the markup and
changed the names on the way, so the markup is asked to bring the old names back — the styles
are not rewritten to fit the new names. The names of the classes are a contract, and the
request of the repair says so to every role. `"checkStyles": false` turns the check off, and
the stage `styling` warns about the same mismatch while the styles are still being written.

The audit sees the project as it is. The auditor gets the fresh listing of the files of the
project, the report of the build of the stage and the design of the task as the text it is —
not as a flag that says "there is a design". An auditor that sees nothing but the task
describes a project that does not exist: it calls a missing `package.json` a defect of a
project that has one. The auditor is told to read the project and to run the build before it
gives the verdict, and a model that answered without a single call is asked once more, with
the schema in the channel of the tools. A model that is pinned to a JSON answer
(`schemaChannel: format`) never calls a tool: for it the truth is the context, and the report
of the audit says how many files were on the disk and how many calls the auditor made.

### The eye of the run

The styles of a page cannot be judged by the code that writes them. A rule that compiles may
still break the layout: the type is enormous, the columns run out of the screen, the picture is
stretched. The stage `sight` closes that gap — it opens the page of the project in a real
browser, takes a screenshot of it and gives the picture to the styler together with the
reference of the design, so the role sees what it has written and what it has to reach. The
styles it fixes land on the disk, and the page is shot again: the loop is bounded by
`browser.stylingVisionRounds`.

The stage runs after the stage `build`, because the page has to be assembled before it can be
looked at: the SCSS is compiled and the markup is wired to the stylesheet there. A page that
cannot be opened — no browser, no entry point, a broken build — is reported and the run goes
on: the styles are written either way, they are simply not checked by the eye.

**The page it looks at.** Two engines are supported. **Ego Lite** (`ego-browser`) is the engine
of the house when it is installed: the browser with the window and the interaction. Otherwise
the run falls back to **headless Chrome/Edge**, which is read-only — it opens a page and takes
a picture of it.

The live page of the project is preferred: the dev server of Vite (`npm run dev` →
`http://localhost:5173/`) shows the styles as they are now, compiled by the bundler, so the
next picture shows the fix right away. A server that already runs is used as it is; a server
that is not running is started by the run and stopped by it afterwards. The project on Vite
keeps its styles inside the script (`import './styles.scss'`), so the page of the root has no
styles at all — the build (`dist/`) is what shows something when there is no live server.

**The words of the page.** A picture says how the page looks; the console says why it does not
work. The run speaks to the browser over the Chrome DevTools Protocol and collects the
console, the exceptions and the failed requests while the page loads; the log of the bundler
comes with them. The role that fixes the page reads both: a failed request names the file
that is missing, an exception names the line that broke, a warning of the bundler names the
import that cannot be resolved.

**The memory of the reference.** The notes of the role — what the reference looks like and
what still differs from it — go into the context of the run. The stages after the styles read
them, so they know what the page is and what it is not, without seeing the picture.

```json
{
  "browser": {
    "engine": "auto",
    "executable": null,
    "timeoutMs": 45000,
    "viewport": { "width": 1440, "height": 900 },
    "url": "",
    "devServer": "auto",
    "devTimeoutMs": 60000,
    "stylingVision": "auto",
    "stylingVisionRounds": 2
  }
}
```

`browser.engine` is `auto` (prefer Ego Lite), `ego` (demand it) or `chrome` (demand a headless
Chromium). `browser.url` is the live address of the page; empty means that the run serves the
project itself. `browser.devServer` is `off` (never start it), `auto` (start it when the
project has a `dev` script and nothing answers) or `always`. `browser.stylingVision` is `off`
(never shoot), `auto` (shoot when the reference of the design is there — there is nothing to
compare with otherwise) or `always`.

The same eye is available to the roles as the tool `screenshot`: it shoots a page of the project
and answers with the file of the picture **and with what the page says about itself**. The
styler and the editor may call it, so a role can look at the page in the middle of the work,
not only when the stage asks it to.

The reviewer sees the same pictures and the same words: the screenshots of the stage `sight`
travel with the review, next to the reference of the design, so the verdict is about the page
and not only about the code.

### The command `sight`

`ai-webdev sight` looks at the page of a project that is already there and fixes the styles.
It does not plan, does not write the markup and does not start the whole pipeline: the work
that is on the disk stays, and only the styles are touched.

```bash
ai-webdev sight "Make the landing like the reference" --model google/gemini-4-hydrogen
```

The command finds the reference of the design the way a run finds it, shoots the page of the
project, gives the picture and the words of the page to the styler and writes the styles it
fixed. The files of the project that are not styles are not touched.

The run that was interrupted is continued by its id: `ai-webdev run --resume <id>`. The stages
that are done are skipped, and the stage that fell is done again.

### The hand-over between the roles

A role that meets work of another kind does not do it herself and does not describe it either:
she hands it over. The markup that does not fit the design goes to the styler, the styler who
finds the class names broken goes to the markup, the coder who needs a picture of the page goes
to the role that can take one.

The work goes to a **separate session**: the role that receives it starts with a clean
conversation, her own instructions, her own tools and her own budget of turns. The conversation of
the caller is not continued — a session that has already spent its context on the wrong problem
is the wrong place to solve the right one. What comes back is the report of the role and the
list of the files it wrote; the disk keeps the truth. The pictures of the reference and the
context of the step travel with the work: the role continues the work, not the conversation.

The roles that may be handed work are `markup`, `styler`, `coder`, `editor` and `iconifier`.
The roles of the whole run — the planner, the architect, the reviewer — are not among them:
they work once for the whole run, and a step does not send them a piece of work.

The hand-over is one level deep: a delegated role never gets the delegation tool itself, so
there is no chain of sessions that nobody reads. A role may not hand work to itself.

```json
{
  "tools": { "delegate": true }
}
```

### The pictures of the reference

The sheet of the measurements names the crops of the reference: the chess piece, the wooden
board, the badge. A crop is a rectangle of the screenshot, so the page around the object is
still in the picture. The stage `pictures` gives those crops to the sibling CLI `ai-image`,
which cuts the object out, and puts the result into `assets/import/`. The roles get the path of
the prepared picture in the context of the run.

The stage comes after the stage `plan`: the plan is what measures the reference, and the crops
of a reference that was not measured yet do not exist. The sheet of the measurements is read
again there, so the stages after it work with the numbers that are really on the disk.

The sheet is not the only source of the crops. The measurer cuts the fragments before it writes
the sheet, and a run that died in the middle leaves the fragments cut and no sheet at all.
When the sheet names no crops, the fragments that are on the disk are taken: the list of the
measurer (`<delivery>/stages/crops.json`) and, when there is no list, the files of the crops
themselves (`<delivery>/crops/*.png`). The measurer says `asset` for a fragment that is worth
reusing and `detail` for a fragment that is worth reading closely: an asset is a picture of this
package, a detail is a piece of the screenshot and stays as it is.

```json
{
  "pictures": {
    "kinds": ["image", "illustration", "artwork", "photo", "ornament"],
    "command": "background",
    "alphaMode": "auto",
    "subject": "{name}",
    "dir": "assets/import",
    "max": 6
  }
}
```

The kinds say which crops of the sheet are pictures. The command is the one of `ai-image`:
`background`, `alpha`, `trim` or `edit`; the section `commands` names another command for a
kind, and the section `prompts` names the prompt of the command `edit`.

The section `model` names the model that prepares the pictures: it is passed to `ai-image` as
`--image-model`. Without it the model of the configuration of `ai-image` is used — the seedream
of ByteDance by default, which cuts the subject out with a native alpha and keeps the frame of
the crop.

The subject is what the cut-out has to keep: `{name}` is the name of the item in the sheet,
`{use}` is its use, `{kind}` is its kind. It is passed to `ai-image` as `--subject`, so the
model knows that the piece of the board that fell into the cut of the bishop, and the piece of
the bishop that fell into the cut of the board, are not part of the object and go away.

The stage answers with the pictures, with the sheet of the measurements and with the path of
that sheet (`sheetFile`). The path is not called `files`: in the answer of a stage `files` is
the list of the paths that were written, and the pipeline walks that list. A stage that
answers in an unexpected shape does not kill the run: the run says what happened, writes the
progress and stops on that stage.

The stage never stops the run: a crop that cannot be prepared is reported, and the crop stays
as it was. A picture that is already in the directory is not prepared again — the model is not
asked for the same cut twice.

The prepared picture is the asset, and it is not drawn again. The object is cut out of the
reference, so a new drawing of the same object is an approximation of what is already on the
disk: the badge becomes a filled disc instead of a ring, and the monogram becomes a letter.
The plan does not ask for such a drawing — an element of the measurements whose kind is an
asset is taken as it is — and the stage `vector` does not draw an SVG whose name is the name of
a prepared picture: the step that would draw it is not done, and the report says why. The roles
that write the markup and the code take the prepared file as it is.

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

Five of them take the steps of the plan: `markup`, `coder`, `styler`, `editor` and
`iconifier`. The other seven work once for the whole run, and a step of the plan may not name
them.

The three roles that write the frontend — `markup`, `coder` and `styler` — also get the standard
of the frontend work (`src/roles/web-development.js`): the rules that hold for every file, the
rules of the markup and the rules of the styles. The standard is the one of the platform of
today: the cascade is held by the cascade layers (`@layer reset, base, theme, layout,
components, utilities;`) and not by the specificity, the rules of a block live in a native
nesting, the reset names the elements and not `*`, the component asks the space it is given with
a container query and not with the width of the window, and the features that are behind a flag
or only in a draft stay withheld. The styler gets the rules of the styles, the markup and the
coder get the rules of the markup.

The documentation of a role comes in two parts. The first is the texts of the standards that
ship with the package (`src/agent/docs.js`): the CSS units, the grid, the semantics, the
accessibility thresholds, the icon sets. The second is the pages behind them
(`src/agent/sources.js`): the specifications, the references, the catalogues. The config
decides both — `documentation.roles.<role>` names what a role gets, and `documentation.sources`
maps a name to its address:

```json
"documentation": {
  "sources": { "teamGuide": "https://example.com/guide" },
  "roles": { "coder": ["cssUnits", "htmlSemantics", "mdnCss", "teamGuide"] }
}
```

A name of a role is either a standard of the package or a source of the map. A name that is
both gives the role the rules and the page: `cssUnits` is the rules of the units and the draft
that defines them. An address of the config replaces the address of the built-in map, and a
name of the user joins it.

The pages come as a block of their own, under the header "Documentation sources". A page is
external data and not an instruction, and these pages describe the experiments of the platform
too: an experiment is not a feature, and what is behind a flag or behind an origin trial stays
unused. The pages the platform profile was checked against live in `src/generate/platform.js`
(`PLATFORM_SOURCES`), and they reach the roles of the run through the brief of the platform.

`--role <role>=<model>[:<effort>[:<max-effort>]]` gives a role its own model; the flag may be
given many times. The config may override the model, the effort, the instructions and the tools of
any role, and may add roles of its own.

Every role works at the effort of its stage: the markup and the styles at `xhigh`, the plan, the
architecture, the review, the scripts and the mechanical work at `medium`, the environment at
`low`. The effort of the run (`reasoning.effort`, the flag `--effort`) is the ceiling: a stage
never works above it. The profile lives in `reasoning.stageEffort` and may be changed or turned
off there.

The answer of a role has a schema, and the loop watches it: a role that answers with a text
instead of the data of its schema is asked once more, and the last turn belongs to the answer —
when the turns of the role run out, it is asked to give the answer alone, without any tool. A
role that returns no data at all is reported with the reason: a refusal of the model, an error of
the answer or the text it gave instead of the schema.

The schema travels in the prompt as well, and not only as the `text.format.json_schema` rule of
the API: a gateway that ignores that rule leaves the model with its own form, and the fields of
the answer get names nobody expects. The names of the fields are in the prompt, so the model
knows the contract of its answer even when the rule of the API is ignored.

The answer is checked against the schema after every turn. An answer that does not fit keeps its
data — the stages know how to fill a missing field — and the stage reports the problems: a run
never passes a malformed answer in silence. The arguments of a tool call are read as JSON too:
a call with broken arguments does not run the tool, and the model is told what to fix.

A role of a step has to write the files of the step. An answer that names no file, that writes
nothing, or that holds nothing but a placeholder is a description of the work, not the work:
the role is told to do it, with the tools. The first correction asks, the second one orders and
names the tool to call (`write_file`, one call per file of the step). The stage checks the files
of the step on the disk afterwards, and a step whose files are missing is not called done. The
title of a step does not change the kind of the work: a step that says "describe the behaviour"
still means the files of the behaviour.

The command that does not finish on its own is refused: a server, a watcher or a tail would
hold the run until the timeout. The default time of a command is 60 seconds, and the model may
ask for more.

The files of a step have to compile. After the role has written them, the code checks them:
`node --check` for the scripts, the `sass` of the project for the stylesheets and the
stylesheets of the compiled CSS. A file with a lost quote, a stray backslash or a rule that is
not closed is found by the compiler, not by the reader of the code — and the role is told what
the compiler said, so it can repair the file. A step whose files still do not compile is not
called done. A project without `sass` in `node_modules` has its stylesheets unchecked, and the
report says so. The names of the files that a stylesheet uses are checked without the
compiler: a stylesheet that `@use`s a file that was never written is broken even when there is
no `sass` on the machine, and the role is told the name of the missing file.

A partial of Sass is a file whose name starts with an underscore, and a stylesheet names it
without the underscore (`@use 'variables'` looks for `src/_variables.scss`). A model that
writes an entry point of four `@use`s and none of the four files leaves the project without
styles, and the build of Vite falls with "Can't find stylesheet to import". The stage finds
the missing files on its own, names them with the path they have to be written under, and
calls the role of the styles again: the role writes the partials or drops the `@use` lines
that name them. A partial that a later step of the plan writes is not a failure of the
current step — the file is on the disk when the run comes to that step, and the step says so
in its report. A partial that nobody writes is a failure of the step, and the report names
the file that is missing.

The installer does not do the steps of the plan. The stage of the setup gives it the plan
and the list of the files the plan names — the environment has to be ready for them — but
not a step to work on: the markup, the code and the styles are written by the roles of the
steps.

The plan of the planner has to hold the work itself: a plan without steps is a plan of
intentions ("first I will study the project"), and the stages of the run have nothing to do. The
planner is asked once more when its answer holds no steps, and the stage fails when the second
answer holds none either. The second question goes to the tool channel: the model works with
the tools of the role — it measures the picture of the reference and reads the project — and
submits the plan as a call of the `plan` tool. A model that is pinned to a JSON answer
describes the work instead of doing it, and its plan is the skeleton of the schema.

The review does not only report: it repairs. The reviewer names the file, the defect and the
change that is asked for, and the role that owns that file — the role of the step of the plan
that wrote it — is asked to make the change and write the file back. The step is reviewed
again afterwards, so the verdict of the run says what the project looks like now. What the
first repair did not close is named again and repaired again: `stages.review.repairRounds`
(two rounds by default) says how many rounds the repair gets. The repair can be turned off in
the config:

```json
{
  "stages": {
    "review": { "repair": false }
  }
}
```

## The frame of the page

A reference may be an upscale of a narrower page: a picture of 2000 pixels may show a page of
1440 pixels, and the model cannot tell from the picture alone — the API resizes the picture
before the model sees it. The page therefore carries its own width, and the size of the
reference in pixels travels to the roles that look at it (`readReferences` reads the header of
the file; `src/inputs/assets.js` keeps the helper, and `src/generate/references.js` re-exports
it).

- The body is the container of the page: `container-type: size;` on the `body`, with
  `min-block-size: 100dvh;` — a body with the size containment has no height of its own.
- The canvas of the page is the element with the class `page` inside the body:
  `container-type: inline-size;` and `inline-size: var(--real-page-width, 1024px);`. The
  content of the page is laid out in the width of the design, not in the width of the window.
- The canvas is scaled into the window: `--zoom: calc(100cqi / var(--real-page-width, 1024px));`
  in the theme layer, and `zoom: var(--zoom, 1);` on the canvas. The `100cqi` is the inline
  size of the body — the nearest container of the canvas — so the canvas takes the whole width
  of the window, and the proportions of the design are kept.
- `--real-page-width` is the width the design really has, in CSS pixels, and it is a token of
  the theme layer. The architect decides it: the width of the picture is not that width — the
  same design comes at 1152 pixels and at 2304 pixels. The width comes from the text: the body
  text of a page is 16..18 CSS pixels, the measurements of the reference give its size in the
  pixels of the picture, and the width of the picture divided by that number gives the width of
  the design.
- The narrow screen is not scaled: under the breakpoint of the narrow layout — the mobile one,
  not the width of the design — the canvas becomes fluid (`inline-size: 100%; zoom: 1;`) and the
  layout of the narrow screen takes over.

The markup writes the canvas and the class, the styles give it the width and the scale, and
`src/roles/page-frame.js` holds the rules of both. The background of the page belongs to the
canvas: the body is as tall as the viewport, and the canvas is as tall as the content.

## The inputs of a run

A run reads the direction of the design from the project itself:

| Input | What it gives |
|---|---|
| `--input <file>` | The essence of the task: the notes of the author of the task. |
| `--image <file>` | The picture of the task: it is staged in the project and becomes a reference. |
| `DESIGN.md` | The intent of the design: the pages, the blocks, the tone. |
| `measurements.json` | The measurements of the reference: the frames, the gaps, the sizes. |
| `palette.json` | The colors of the design. |
| `tokens.css` | The tokens of the design: the variables of the stylesheet. |
| `AGENTS.md`, `CLAUDE.md` | The instructions of the project. |
| `.ai/refs/`, `.ai/assets/` | The pictures: the references, the crops, the assets. |
| the reference itself | The screenshot of the design, attached to the request of the roles. |

Every path of the table is a list of candidates: the root of the project comes first, and the
directory of the measurer comes second. The measurer writes its delivery into
`measurements/` — `measurements.json`, `palette.json`, `tokens.css`, `DESIGN.md` — and the run
finds it there. Without that, the run would measure the same picture again. The run asks the
contract of the project first (`.ai/manifest.json` says where every system put its work) and
only then the paths of the config, so a delivery that moved is still found. The paths live in
the config (`inputs.designMd`, `inputs.measurements`, `inputs.palette`, `inputs.tokens`), and a
path may be a list of candidates of its own:

```json
{
  "inputs": {
    "measurements": ["measurements.json", "measurements/measurements.json"]
  }
}
```

The values of `tokens.css` win over the document and over the palette. A conflict between the
sources is reported, never resolved silently.

The inputs are collected before the run and put into the context of every role, so a role does
not read them again: the sheet of the measurements is big, and reading it twice costs the
context of the run and brings nothing new. The tool `read_file` keeps the files the role has
already read: the second read of a file that did not change answers with a short note instead
of the whole file.

The essence of the task is the file of the flag `--input`: it goes into the context of every
role as the block `# The essence of the task`, before the design and the measurements, because
it says what the result has to be. The flag may be given many times, and the paths are
relative to the root of the project. A file that is not there is a warning, not an error.

A file of the essence may be a template: the placeholder `{{message}}` is replaced with the
task of the run, so the notes and the task live in one file and the file is not written twice.

```markdown
{{message}}

# What needs

The board is the inset of the hero, the badge is a sunburst.
```

The picture of the task is the file of the flag `--image`: it is staged in `.ai/refs/` (a file
outside the project is copied there, a file of the project keeps its path) and becomes a
reference of the design. The roles that look at the design see it.

The reference of the design is found by the name: a picture the task names (`landing.png`), a
picture whose name says that it is a reference (`landing`, `reference`, `screenshot`, `mockup`,
`design`), or a picture of `.ai/refs/`. `inputs.reference` in the config names it outright — a
path or a list of paths. The same picture in two formats is one picture: the better format
wins. The architect, the roles of the steps and the reviewer see that picture, so the markup
and the styles follow the image and not only the numbers of the measurements.

The bridges to the sibling CLIs add more: `ai-decompose` splits a reference into screens,
`ai-measure` measures a reference, and `ai-image` makes the pictures that the project needs.

The measurer is not only a bridge in the config: the planner, the architect and the styler have
the tool `call_ai_measure` and may measure the reference themselves when the measurements of the
project are missing or thin — `["measure", "landing.png"]` for the sizes and the positions and
`["palette", "landing.png"]` for the colours. The tool is switched off with
`tools.external_measure: false` in the config.

The direction of the design is not measured. The measurer writes it into its own working
directory, where nobody reads it; the tokens of the reference live in `measurements/DESIGN.md`,
and the roles take the styles upon themselves. A call of `["design", …]` is refused with an
answer that says where the tokens are — the measurer is not started.

The tool looks at the disk before it calls the measurer. A sheet that is already there answers
the question as well as a new run: the tool answers with the path of the sheet and the number of
its elements and regions, and the measurer is not started. The sheet has to belong to the
picture — the field `source` says which one — and it has to be newer than the picture itself, so
a changed picture is measured again. The fact goes into the context of the run, and the roles
after that one know that the picture is measured.

## Configuration

The configuration lives in `~/.ai-webdev/config.json` (`AI_WEBDEV_HOME` moves the whole home
directory). The file is optional: the CLI works on the defaults until the file appears.
`ai-webdev config init` writes the starter file once — only the fields a user is expected to edit,
everything else stays on the defaults.

```json
{
  "model": "minimax/minimax-m3.1-flash",
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
    "collect": { "enabled": true, "maxTurns": 8 },
    "review": { "enabled": true, "repair": true, "repairRounds": 2, "timeoutMs": 3600000 }
  },
  "bridges": {
    "decompose": { "enabled": true, "log": true },
    "measure": { "enabled": true, "log": true },
    "image": { "enabled": true, "log": true }
  }
}
```

The precedence is: defaults → `~/.ai-webdev/config.json` → `--config <file>` → `AI_WEBDEV_*`
environment → the flags of the command.

The `models` section holds the profile of a model: the window, the output cap, the ceiling of
the effort and the channel of the schema.

```json
{
  "models": {
    "moonshotai/kimi-k3.1-pro": { "schemaChannel": "auto" }
  }
}
```

The built-in profiles of the text models of the house are tuned by the live answers of the
gateway (RouterAI, November 2026):

| Model | Context | Output | Ceiling | Ladder |
|---|---|---|---|---|
| `minimax/minimax-m3.1-flash` | 1M tokens (4 MiB) | 524K | `xhigh` | `low`, `medium`, `high`, `xhigh` |
| `google/gemini-4-hydrogen` | 1M tokens (4 MiB) | 64K | `xhigh` | `low`, `medium`, `high`, `xhigh` |
| `moonshotai/kimi-k3.1-pro` | 1M tokens (4 MiB) | 944K | `high` | `none`, `low`, `medium`, `high` |
| `openai/gpt-6.1-sol` | 1M tokens (4 MiB) | 32K | `xhigh` | `low`, `medium`, `high`, `xhigh` |
| `openai/gpt-6.1-terra` | 512K tokens (2 MiB) | 16K | `high` | `low`, `medium`, `high` |
| `openai/gpt-6-luna` | 272K tokens | 128K | `xhigh` | `low`, `medium`, `high`, `xhigh` |

MiniMax refuses to work without reasoning ("Reasoning is mandatory for this endpoint and
cannot be disabled"), so a request for `none` is raised to `low` instead of being refused.
Kimi takes the reasoning off without a refusal and answers in a fraction of the time (about
0.8 s against about 31 s at `medium` on the same question), so `none` stays on its ladder —
`ai-webdev run "<task>" --effort none --model moonshotai/kimi-k3.1-pro` is the fast run.

Gemini 4 Hydrogen is the alternative to the Kimi: it takes the effort up to `xhigh` and its
answer is cut at 64K tokens. The card of the vendor names the four levels of its effort (`low`,
`medium`, `high`, `xhigh`) and has no `none`, so the reasoning off is raised to `low` there as
well. The Kimi stays the fallback model of the house: the `fallback.models` chain of the
configuration names it for the Gemini and for every other model.

```json
{
  "fallback": {
    "enabled": true,
    "models": {
      "google/gemini-4-hydrogen": ["moonshotai/kimi-k3.1-pro"],
      "*": ["moonshotai/kimi-k3.1-pro"]
    }
  }
}
```

### The markup is a Kimi job

One role of the house has its own model: the markup — the stage `markup` and the role `markup`
— answers on the Kimi K3.1 Pro, whatever the model of the run is. The Kimi builds the structure
of the page faster and more surely than the Gemini 4 Hydrogen, and it answers in a fraction of
the time.

The chain of the model of a role is: the pin of the role (`roles.markup.model` or the flag
`--role markup=<model>`), then the model of the house for the role, then the pin of the default
role (`roles.default.model`), then the model of the run. The pin of the role wins over
everything, so a run that wants another model for the markup says so:

```bash
ai-webdev run "<task>" --role markup=google/gemini-4-hydrogen
```

The Kimi has no levels of the effort above `medium` — the answer of the same question costs the
same seconds there — so the markup works on `medium` however deep the profile of the stages
asks. The role also answers with its tools instead of a pinned JSON answer: a model that is
pinned to a JSON answer never calls a tool, it describes the work instead of doing it.

The vector stage — the role `editor` — has no model of its own yet: nobody drew a vector
picture well with any of the models of the house, so the stage keeps the model of the run
until there is a verdict.

The effort of a run is not one number for everybody. `reasoning.effort` is the ceiling of the
run, and `reasoning.stageEffort` says what every stage asks for:

```json
{
  "reasoning": {
    "effort": "xhigh",
    "stageEffort": {
      "markup": "xhigh",
      "styler": "xhigh",
      "planner": "high",
      "architect": "high",
      "director": "high",
      "coder": "high",
      "iconifier": "high",
      "installer": "high",
      "editor": "high",
      "reviewer": "high",
      "auditor": "high",
      "learner": "high"
    }
  }
}
```

The markup and the styles carry the look of the reference: they get the deepest reasoning
(`xhigh`). Every other stage works on `high`: the code, the icons, the setup, the review and
the audit answer on a model that thinks long enough to be right, and the stages that only
decide — the plan, the architecture — pay for the seconds of the thinking on a plan that may
be thrown away. A stage never works above the ceiling of the run, and the effort of a role
set in `roles.<role>.effort` wins over the profile. `"stageEffort": null` turns the profile
off and leaves every role with the effort of the run.

A thinking model works for minutes without a word. The run says that it waits (`· thinking (60s)`)
and a failed request is shown, with its retry — the silence of the terminal is never a hang. The
request itself may stay silent for `timeoutMs` (fifteen minutes by default, half an hour at the
most): a shorter timeout does not make the model faster, it throws the whole reasoning away and
asks the same question again.

The channel of the schema says how the answer of a role reaches the code: `tool` makes the
schema a function the model calls, `format` pins the text of the answer to it, `auto` picks
`tool` when the role has other tools and `format` otherwise. The channel matters because a
model that is pinned to a JSON answer never calls a tool: it describes the work instead of
doing it. `auto` is the channel of a model that calls its tools well, `format` is the channel
of a model that needs the pin. The role moves the schema into the tool channel by itself when
the role has to write and only describes the work.

The stage of the plan does the same when the planner answers with a plan without steps: the
planner is asked again with the schema in the tool channel, so the model may measure the
picture of the reference and read the project before it decides what the steps are. A plan
without steps is an error with an action, not a dead run: the report names the model of the
config and the `ai-webdev plan <task>` command, which shows the plan on its own.

The sections of the file:

| Section | What it holds |
|---|---|
| `model`, `baseURL`, `apiKey`, `backends`, `modelsBackends`, `fallback` | The API: the model, the hosts, the pool of the fallbacks. |
| `reasoning`, `limits`, `models` | The effort, the profile of the stages, the summaries, the budgets of the run and the ceilings of the models. |
| `tools` | The tools the roles may call. |
| `browser` | The eye of the run: the engine (`auto`, `ego`, `chrome`), the path of the browser, the timeout, the frame of the picture, and the eye of the styles (`stylingVision`, `stylingVisionRounds`). |
| `stack` | The stack the generator writes for: the framework, the markup, the styles, the script, the icons. |
| `agent` | The knobs of the run: `fidelity`, `creativity`, `platform`, `kind`, `approve`, `extract`. |
| `pace` | The dials of the team: `speed`, `quality` and the per-stage dials. |
| `stages` | Every stage: `enabled`, `maxTurns` and `timeoutMs` (the budget of the stage; it wins over `limits.stageTimeoutMs`). The stage `review` also has `repair` and `repairRounds`. |
| `output` | Where the artifacts go: `dir` (`.ai/`), `work` (`.ai/tmp/`) and `assets` (`.ai/assets/`). |
| `inputs` | The names of the input files: the design, the measurements, the palette, the tokens, the files of the essence (`extra`) and the reference. |
| `pictures` | The crops of the reference that are prepared: the kinds, the command of `ai-image`, the subject, the model, the directory, the limit. |
| `memory` | The permanent memory: the file, the scope, the limit, the summaries of the files, the finished tasks. |
| `context` | The context of the run: `enabled`, `cache` and `maxBriefChars`. It lives in `<output.work>/<id>/context/` and dies with the run. |
| `map` | The map of the run: `enabled`, `depth`, `maxFiles`, `maxFileBytes`, `maxLines`. It lives in `<output.work>/<id>/map.json` and dies with the run. |
| `components` | The local registry: the directory, the index, the vendor directory. |
| `bridges` | The sibling CLIs: `decompose`, `measure`, `image` — each may be switched off, and each may keep its log to itself (`log`). |
| `roles`, `customRoles` | The roles: the model, the effort, the instructions, the tools. |
| `documentation` | The documentation of a role: `sources` (the map of the addresses) and `roles` (what every role gets: the standards of the package and the pages behind them). |
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
| `AI_WEBDEV_EFFORT` | The ceiling of the reasoning effort of the run. |
| `AI_WEBDEV_FRAMEWORK`, `AI_WEBDEV_MARKUP`, `AI_WEBDEV_STYLE`, `AI_WEBDEV_SCRIPT`, `AI_WEBDEV_ICON_SET` | The stack of the generator. |
| `AI_WEBDEV_FIDELITY`, `AI_WEBDEV_CREATIVITY`, `AI_WEBDEV_KIND` | The knobs of the generation. |
| `AI_WEBDEV_SPEED`, `AI_WEBDEV_QUALITY`, `AI_WEBDEV_PACE` | The dials of the team. |
| `AI_WEBDEV_STAGE_<STAGE>` | `0` or `false` switches one stage off. |
| `AI_WEBDEV_BRIDGE_<BRIDGE>` | `0` or `false` switches one bridge off. |
| `AI_WEBDEV_BRIDGES_LOG` | `0` or `false` silences the live log of every bridge. |
| `AI_WEBDEV_RETRIES`, `AI_WEBDEV_TIMEOUT_MS`, `AI_WEBDEV_MAX_TURNS` | The limits of one request. |
| `AI_WEBDEV_LOG_DIR` | The directory of the log of the API calls; the name of the directory turns the log on. |

The messages of the configuration validator are in Russian, as in the sibling packages
`@u2ai/images` and `@u2ai/decomposer`; every other message of the CLI is in English.

### The log of the API calls

A run that fails says only "failed" — unless the log is on. The log is a witness: one JSON file
per request, with the body that went out, the chain of the hosts, the time of every attempt, the
answer that came back and the error that broke it.

```json
{
  "at": "2026-11-15T03:41:02.113Z",
  "path": "responses",
  "model": "moonshotai/kimi-k3.1-pro",
  "attempts": [
    { "backend": "https://routerai.ru/api/v1", "ok": true, "durationMs": 181_233 }
  ],
  "durationMs": 181_233,
  "response": { "output": [ … ] }
}
```

The pictures are not written into the record: the body of an image is megabytes of base64, and it
is the same picture every time. The record says how big it was. The log is off by default — turn it
on with the directory:

```json
{ "logging": { "enabled": true, "dir": ".ai/logs/api" } }
```

or with `AI_WEBDEV_LOG_DIR=.ai/logs/api`.

## The house of the project

Every project has one directory of its own: `.ai/`. Everything a run makes that is not the
product itself lives there, and nowhere else.

```
.ai/
  tmp/<run-id>/     the state of the run: the plan, the progress, the context, the map
  assets/           the assets of the house: the pictures, the decorations, the crops
  logs/api/         the log of the API calls
  manifest.json     the contract of the project: what every system made and where it lies
```

The state of a run dies with the run: a new run never reads the state of the old one, and the
old one never gets in the way of the new one. The `output.work` of the config may move the
state elsewhere, but there is only one path, and it is computed in one place — the house.

The product stays where the user expects it. The site is in the root of the project, the
delivery of the measurer is in `measurements/`, the delivery of the decomposer is in
`decomposition/`. The house keeps the state, the assets and the contract, and it does not
move the product.

The contract is how the systems of the house find each other. Every system signs its own part
of `.ai/manifest.json` and never touches the part of another one:

```json
{
  "manifestVersion": 1,
  "updatedAt": "2026-11-15T03:41:02.113Z",
  "systems": {
    "measurer": {
      "delivery": "measurements/",
      "artifacts": {
        "measurements": "measurements/measurements.json",
        "palette": "measurements/palette.json",
        "tokens": "measurements/tokens.css"
      },
      "updatedAt": "2026-11-15T03:40:58.002Z"
    },
    "webdev": {
      "delivery": ".",
      "artifacts": { "site": "." },
      "updatedAt": "2026-11-15T03:52:11.417Z"
    }
  }
}
```

The paths are relative to the project and with forward slashes: the contract is read on another
machine and another system, and the path has to mean the same thing there. A run reads the
contract first and only then the old paths of the config, so a project made before the contract
still works.

The files of the house are written whole: the bytes go to a file next to the target and the
target is replaced by a rename. A reader never sees half of a file, and a run that dies in the
middle leaves the old file and not a broken one. The same is true of the JSON of the house: the
manifest, the state of a run, the plan, the map, the record of a job, the config and the
`package.json` of the project are written whole. A crash in the middle of a write leaves the
old file and not a half-written JSON that no one can read.

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

## The context of the run

The permanent memory is for the *project*. The context of the run is for the *run*: what this
run did, what it decided and the answers its tools already gave. The context lives in the work
directory of the run — `<output.work>/<id>/context/` — and dies with it.

```
.ai/tmp/<id>/context/
  journal.ndjson   что происходило, по одной записи на строку, в порядке событий
  state.json       что прогон знает сейчас: картинки, стадии, факты
  cache/           ответы, которые инструменты уже давали, чтобы не спрашивать дважды
  notes.md         дайджест, который читает человек
```

A new run starts with a clean head: the context of the earlier run never gets in the way of the
new one, and nothing leaks out of it into the permanent memory except the lessons the `learn`
stage writes on purpose.

The roles read the context before they work. The brief of the context names the exact paths of
the pictures of the run, the stages that are done and the files that were written, so a model
does not go looking for what the run already knows:

```
# The context of this run

The pictures of this run — these paths are exact, do not look for them anywhere else:
- `.ai/refs/landing.png` — the original picture

The stages of this run:
- plan: done — 3 steps.
- markup: done — index.html written.
```

And the roles write into it: their answers, their decisions, the plan and the lessons of the run
all land in the journal and in the state. The next stage starts from that instead of asking the
model the same thing again.

## The map of the run

The map of a run is the index of the files of the working directory: their lines, their symbols,
their size and the moment they changed. It lives in `<output.work>/<id>/map.json` and dies with
the run.

The tools read through the map: `list_files` answers from it, `read_file` is served from the
lines it holds, and `search_files` searches them. A file that changed since the map was built is
read from the disk again — the map never serves a stale file.

The search knows three scopes: `path` looks at the names of the files, `content` at their text,
`symbol` at the names the code declares, `all` at everything.

The map does not read everything: it skips `.ai`, `node_modules`, `.git` and the files with
secrets, it holds at most 2000 files, and a file longer than 400 lines or bigger than 32 KiB is
marked `partial` — for such a file the search goes to the disk.

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

The words of the search may come as a list as well: a model that passes `["navbar",
"accessibility"]` gets the guides of the navbar and of the accessibility, not the catalog of
all the guides.

The guides are read from the disk of the package: no network, no npm, no waiting. The CLI of the
upstream (`npx modern-web-guidance@latest search|retrieve`) is the fallback — for the guide that
is newer than the bundle, and for the caller that asks for the CLI (`source: "cli"`).

## The process of a run

A run may be paused and continued: the plan, the progress and the reports live on the disk, in the
directory of the run (`.ai/tmp/<id>/` by default, the id is the time).

```bash
ai-webdev run "make a landing" --stop-after plan     # pause after the plan
ai-webdev run --resume 20261113-142530                # continue it
ai-webdev jobs run -- npm run build                    # a background job of the project
ai-webdev jobs list
```

A run that was interrupted keeps its progress: the next run with `--resume <id>` continues at the
stage it has not finished.

The run names itself before the first stage — `Run 20261113-142530` — and a run that falls
prints the command of its continuation, with everything the run needs (the config, the
essence, the picture, the kind and the model):

```
Run 20261113-142530
…
Продолжить: ai-webdev run --resume 20261113-142530 --config .webdev.config.json --input what-needs.md --image landing.png --kind landing
```

The state of the run lives on the disk with it:

| File | What it holds |
|---|---|
| `progress.json` | The stages of the run, their state and the task of the run. |
| `inputs.json` | The collected inputs: the design, the measurements, the palette, the tokens. |
| `pictures.json` | The prepared pictures and their paths. |
| `plan.json` | The plan of the work. |
| `architecture.json`, `setup.json` | The structure of the project and the environment of it. |
| `steps/<id>.json` | The report of every step of the plan: the files it wrote, the checks it passed. |

A continued run reads those files back: the stages that are skipped would otherwise leave the
later ones with nothing. The task belongs to the run, so `--resume <id>` without a task of its
own works on the task of the earlier run. A run whose `inputs.json` is missing collects the
inputs again — the collection is deterministic, and the later stages need what it finds.

The reports of the steps (`steps/<id>.json`) are read back too: the review judges the work of
the steps of the plan, and a continued run that reaches the review without those reports has
nothing to judge.

A stage that is named in `--route` is asked for: it runs even when the progress of the earlier
run says that it is done. The stages that the route adds are only the way to it, and they are
skipped when their work is still on the disk. So a review that found defects and repaired them
can be run again over the same project:

```bash
ai-webdev run --resume 20261113-142530 --route review
```

A step of the plan that is already done is not done again: its report is on the disk and its
files are still there, so the run continues with the work that exists. A file that was deleted
after the step means the work is gone, and the step is done again. A file that is there, but
holds something else than the answer of the role, means the answer was lost — the step is done
again too. The run never asks a model to write the same file twice.

A stage of a continued run is skipped only when its work is still on the disk: the progress
says that the stage ran, but the answer of the role may have been lost, and a stage whose
files are gone is done again. A file that was changed after the report of the step belongs to
a later stage, and the run does not undo it.

The screenshot of the reference goes to the roles that copy the look — the markup, the styles
and the vector graphics. The scripts, the icons and the other mechanical work get the numbers,
the palette and the tokens, and no picture: a picture they do not need is uploaded, read and
paid for on every turn of the role.

The log of a run names what every call touches: the path of the file that is read or written,
the program that runs, the words of the search. The answer of a tool is a line under the call
when it is short — the content of a file is never a line of the log.

```
· read_file src/main.js
· write_file index.html
· run_command npm run build
  → Записан index.html (9346 байт)
```

A program that runs through `run_command` has to finish on its own: a server or a watcher is
refused before it starts, and the program never waits for the input — the input is closed at
once, so a program that reads it (the console of node) ends instead of holding the run until
the timeout. The dev server of vite is refused in every form (`vite`, `npx vite`, `vite dev`);
the build of vite (`vite build`) is not.

The answer of a role is the work of the step: a file that is on the disk and differs from the
answer is written, and the old file goes to the backup. A file that the role wrote with its own
tool is left alone — the file on the disk is the truth there. A file that could not be written
fails the step: a step that is not on the disk is not done.

The roles of a step read the project in one order: the entry point of the page (`index.html`),
then the script of the entry point and the modules it imports, then the stylesheet and the
partials it `@use`s. The paths come from `list_files` and `search_files`: a path that was not
seen on the disk does not exist. The roles that write code check their work with the command
of the project (`npm run build`, the test script) — the compiler sees the errors that the eye
does not.

The search is a grep and a find at the same time. By default it greps the text of the files and
answers `path:line: text`; `inContent=0` matches the paths of the files and answers the paths
themselves, and `glob` limits the files by their name (`*.scss`, `src/**/*.js`) before they are
read. `regex` reads the query as a regular expression. A role that looks for a module of the
script finds it by its name, and a role that looks for a rule of the styles finds it by its
text.

```
· search_files "card" src/styles
· search_files "main" inContent=0 glob=*.scss
```

## The icons

The icons come from the sets of the CDN: Phosphor and Lucide. The sets are big — Lucide has
more than a thousand icons, Phosphor has more than a thousand five hundred — so a role that
picks the icons by memory picks the wrong ones. The catalogue of a set is read from the CDN and
cached: the role searches the names with `search_icons` and takes the ones that are really
there.

```
· search_icons lucide "scan square"
  → Иконки набора lucide: scan-square, scan, square, scan-barcode, …
· download_icons lucide icons=["scan-square","earth","mail"] path=assets/icons
  → Скачано иконок: 3. Пути: assets/icons/scan-square.svg, assets/icons/earth.svg, assets/icons/mail.svg
```

The icons of a step are taken in one call: a role that picks ten icons of one interface should
not pay for ten turns. A name the set does not have is reported back instead of thrown — the
role then picks another one, and the stage of the icons checks that every icon the answer names
is on the disk.

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

### The log of a bridge comes live

A bridge that writes into a pipe is quiet until it is over: the terminal waits, and the silence
says nothing — the child may work, may think, may hang. The run shows the lines of the child as
they are written, so the wait becomes a log:

```
▸ pictures
· [ai-image] gpt-image-2 · 1024×1024
· [ai-image] the answer carries 1 picture(s)
✓ pictures
```

Every line of the child comes with the name of the child in front of it. The lines go to stderr:
the stdout of the run carries the answer of the run, and a line of a child is not a part of it.
The stderr of the child is yellow.

A bridge may keep its log to itself: `bridges.<name>.log: false` in the config, or
`AI_WEBDEV_BRIDGES_LOG=0` in the environment silences every bridge at once. The answer of the
bridge does not change either way — the model still gets the whole output of the child.

In the `--json` mode the line of a child is an event of the run:

```json
{"time":"2026-11-15T10:00:00.000Z","type":"bridge.log","name":"ai-image","stream":"stdout","line":"the answer carries 1 picture(s)"}
```

## The CLIs of the house

The bridges are narrow on purpose: a bridge calls one CLI of the house for one job. A role that
needs something else — the flags of a CLI, the version of a package, a command that no bridge
covers — gets a free door instead: the tool `ai_cli`.

| CLI | What it does |
|---|---|
| `ai` | The umbrella: ask, chat, run, gen, image, decompose, component, serve, mcp. |
| `ai-webdev` | This CLI: the web project itself. |
| `ai-decompose` | Splits a reference into screens and fragments. |
| `ai-measure` | Measures a reference: the frames, the gaps, the sizes, the colours. |
| `ai-image` | Makes the pictures of the project and cuts them. |

A call names the CLI and the arguments of its command line, one argument per element:

```json
{"cli": "ai-decompose", "args": ["--help"]}
{"cli": "ai-measure", "args": ["measure", "landing.png", "--out", "measurements"]}
```

The rule of the house about the flags is one line: **ask the CLI**. Every CLI of the family
answers `--help` with the whole table of its commands and its flags, and `--version` with its
version. The help is a local text — it calls no model and costs nothing, while a guessed flag
costs a failed call and a wasted turn. The manual of the family — which CLI does what, the
flags they share, the flags and the commands of every one of them — is in the tool
`ai_cli_help`.

The rules of a free call are the rules of every tool of the house:

- the command is started without a shell, so the arguments are exact;
- it runs in the working directory of the run;
- every path of the command stays inside the working directory;
- the file that is written lands in a directory the stage opened for writing;
- a command that does not finish on its own is refused (a server, a watcher);
- the config of the CLI may be named: the config of the home lives outside the working
  directory and is always allowed.

The binary of a CLI is looked up in the environment variable of the CLI (`AI_BIN`,
`AI_WEBDEV_BIN`, `AI_DECOMPOSE_BIN`, `AI_MEASURE_BIN`, `AI_IMAGE_BIN`), in the checkout of the
sibling package, in `node_modules` and in the `PATH`. The switch `tools.external_cli` turns
both tools off.

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

const listing = await access.fs.listFiles('src', { depth: 2, limit: 400 });
const copied = await access.fs.copy('src/app.js', 'lib/app.js');

const answer = await access.exec.run('node', ['--version']);
```

The rules of the paths live in one place and are never optional: a path may not leave the root —
neither through `..` nor through a symbolic link — the secret files and the secret directories are
never accessible, and the read-only directories may be read, but never written. The words of the
refusals belong to the package: `src/agent/paths.js` keeps them Russian and borrows the rules from
`src/access/paths.js`.

`listFiles` returns the tree of a path as the model reads it: the noisy folders are marked and
not opened, the dot-files are hidden unless they are asked for, the sizes are in the text, and a
path that does not exist yet answers with the nearest existing parent. `copy` copies a file or a
tree under the same rules: no secret, no symbolic link, no directory into itself, and the
destination must not exist unless `overwrite` is asked for.

An error of the filesystem is not hidden as a missing file: only `ENOENT` and `ENOTDIR` mean
"there is nothing here", and every other failure — a denied permission, a broken device — travels
to the caller. A run that meets such a failure says what happened instead of reporting an empty
directory or a file that is not there.

## Limits

- The package writes the files of the answers, but never overwrites a file that exists and never
  writes `package.json`.
- The icons are downloaded as files: a missing icon is a warning of the `iconify` stage, not a
  broken page.
- The vector graphics are SVG documents: they are written and checked as text, not redrawn.
- There is no image generator in this package: the pictures are the work of the `ai-image` bridge.
- A run that is interrupted keeps its progress on the disk and can be continued with `--resume`.
- A stage that does not come back in `limits.stageTimeoutMs` (15 minutes by default) fails with
  the name of the stage: a run that hangs says so instead of waiting for ever. A stage that needs
  more time asks for it: `stages.<id>.timeoutMs` wins over the budget of the run.
- A crash outside the command — an unhandled rejection, an uncaught exception — is printed and
  leaves the exit code of the failure: a silent death is the hardest kind of failure to read.

## Development

```bash
npm test          # the whole suite, offline
npm run check     # node --check over every file of the package
npm pack --dry-run
```

The suite needs no network and no key: the calls of the API are made by a fake client.
  The suite is also guarded: `test/offline-guard.js` refuses every address outside the
  machine, so a test that reaches the outside fails fast instead of spending money.

## License

MIT
