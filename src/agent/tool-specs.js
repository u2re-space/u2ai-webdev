/**
 * @file src/agent/tool-specs.js
 * @module agent/tool-specs
 * @purpose The catalogue of the tools the roles may call: their names, their parameters and the
 *          config switch that turns each of them off.
 *
 *   The catalogue lives apart from the executor on purpose. The executor knows what a file write
 *   does; the catalogue knows what the model is told about it. The description the model reads is
 *   part of the behaviour of a tool: a vague description makes the model guess the arguments, and
 *   the guess is paid for in a failed call and a wasted turn.
 *
 *   The config switches are named after the domain (`external_image`), not after the wire name
 *   (`call_ai_image`), because the switches describe what a user turns off, and a user thinks in
 *   domains. The mapping lives here, in one place.
 *
 * @exports TOOL_SPECS, TOOL_NAMES, CONFIG_KEYS, toolSpecs, enabledToolNames, configKeyFor, toolEnabled
 * @ai.tags tools, specs, config
 * @ai.hint keep
 * @changed 2026-11-15 Мост измерителя не предлагает направление дизайна: команда `design`
 *                       пишет его в рабочий каталог измерителя, откуда его никто не читает.
 * @changed 2026-11-16 Свободная дверь к CLI семейства: `ai_cli` зовёт любой CLI дома с любым
 *                       флагом, `ai_cli_help` даёт руководство по нему.
 */

const str = (description) => ({ type: 'string', description });
const int = (description) => ({ type: 'integer', description });
const bool = (description) => ({ type: 'boolean', description });

/**
 * Every tool the webdev knows, with the schema of its arguments.
 *
 * `configKey` is the switch in `config.tools` that disables the tool; `roles` lists the roles the
 * tool belongs to (an empty list means every role may use it).
 * @type {Readonly<Record<string, {configKey: string, description: string, parameters: object, required: string[], roles: string[]}>>}
 */
export const TOOL_SPECS = Object.freeze({
    list_files: {
        configKey: 'list',
        description: 'List the files of a directory of the working directory.',
        parameters: {
            type: 'object',
            properties: {
                path: str('Directory to list. Empty = the working directory.'),
                depth: int('How deep to descend. Default 2.'),
                includeHidden: bool('1 to include the files and directories whose name starts with a dot.'),
            },
            required: [],
            additionalProperties: false,
        },
        required: [],
        roles: [],
    },
    read_file: {
        configKey: 'read',
        description: 'Read a text file of the working directory. A line range may be given to read a part of a big file — the answer names the lines it has read, so the next read does not repeat them.',
        parameters: {
            type: 'object',
            properties: {
                path: str('Path of the file, relative to the working directory.'),
                startLine: int('First line to read, 1-based.'),
                endLine: int('Last line to read, inclusive.'),
            },
            required: ['path'],
            additionalProperties: false,
        },
        required: ['path'],
        roles: [],
    },
    find_line: {
        configKey: 'read',
        description: 'Find the lines of a file that hold a piece of text and return their numbers. The number '
            + 'is the address of a place in the file: read that place alone with `read_file` and change it '
            + 'alone with `patch_file`. Much cheaper than reading and rewriting the whole file.',
        parameters: {
            type: 'object',
            properties: {
                path: str('Path of the file, relative to the working directory.'),
                text: str('The piece of text to look for.'),
                regex: bool('1 to read the text as a regular expression.'),
                startLine: int('First line of the search, 1-based.'),
                endLine: int('Last line of the search, inclusive.'),
                limit: int('How many matches to return. Default 40.'),
            },
            required: ['path', 'text'],
            additionalProperties: false,
        },
        required: ['path', 'text'],
        roles: [],
    },
    patch_file: {
        configKey: 'write',
        description: 'Change the lines of a file by their numbers. The patch carries only the lines that change — '
            + 'the whole file is not sent and not rewritten. The edits go from the bottom of the file up, so the '
            + 'numbers of the other lines stay the numbers they were.',
        parameters: {
            type: 'object',
            properties: {
                path: str('Path of the file, relative to the working directory.'),
                edits: {
                    type: 'array',
                    description: 'The changes: the range of the lines and the new text of them.',
                    items: {
                        type: 'object',
                        properties: {
                            startLine: int('The first line of the range, 1-based.'),
                            endLine: int('The last line of the range, inclusive. The same as startLine for one line.'),
                            text: str('The new text of the range. An empty text deletes the lines.'),
                        },
                        required: ['startLine', 'text'],
                        additionalProperties: false,
                    },
                },
            },
            required: ['path', 'edits'],
            additionalProperties: false,
        },
        required: ['path', 'edits'],
        roles: [],
    },
    batch: {
        configKey: 'write',
        description: 'Run several actions of this catalogue in one call: a list of reads, searches, writes and '
            + 'patches. One call instead of many — the context and the turns of the run are saved. The answer '
            + 'is the answer of every action, in order.',
        parameters: {
            type: 'object',
            properties: {
                actions: {
                    type: 'array',
                    description: 'The actions, in order. Each one names its tool and its arguments.',
                    items: {
                        type: 'object',
                        properties: {
                            tool: str('The tool of the action: list_files, read_file, find_line, search_files, '
                                + 'write_file, replace_text, patch_file, delete_file, make_dir, copy_path.'),
                            args: { type: 'object', description: 'The arguments of that tool.' },
                        },
                        required: ['tool'],
                        additionalProperties: false,
                    },
                },
            },
            required: ['actions'],
            additionalProperties: false,
        },
        required: ['actions'],
        roles: [],
    },
    write_file: {
        configKey: 'write',
        description: 'Write a text file into the working directory. The content replaces the file.',
        parameters: {
            type: 'object',
            properties: {
                path: str('Path of the file, relative to the working directory.'),
                content: str('The whole text of the file.'),
            },
            required: ['path', 'content'],
            additionalProperties: false,
        },
        required: ['path', 'content'],
        roles: [],
    },
    replace_text: {
        configKey: 'write',
        description: 'Replace a text inside a file. The search text must be unique unless all is set.',
        parameters: {
            type: 'object',
            properties: {
                path: str('Path of the file, relative to the working directory.'),
                search: str('The text to find.'),
                replacement: str('The text to put in its place.'),
                all: bool('1 to replace every occurrence, 0 to replace the first one.'),
            },
            required: ['path', 'search', 'replacement'],
            additionalProperties: false,
        },
        required: ['path', 'search', 'replacement'],
        roles: [],
    },
    delete_file: {
        configKey: 'write',
        description: 'Delete a file of the working directory. The old content is kept as a backup.',
        parameters: {
            type: 'object',
            properties: {
                path: str('Path of the file, relative to the working directory.'),
            },
            required: ['path'],
            additionalProperties: false,
        },
        required: ['path'],
        roles: [],
    },
    make_dir: {
        configKey: 'write',
        description: 'Create a directory of the working directory, with every missing parent.',
        parameters: {
            type: 'object',
            properties: {
                path: str('Path of the directory, relative to the working directory.'),
            },
            required: ['path'],
            additionalProperties: false,
        },
        required: ['path'],
        roles: [],
    },
    copy_path: {
        configKey: 'write',
        description: 'Copy a file or a directory inside the working directory.',
        parameters: {
            type: 'object',
            properties: {
                source: str('Path of the source, relative to the working directory.'),
                destination: str('Path of the copy, relative to the working directory.'),
            },
            required: ['source', 'destination'],
            additionalProperties: false,
        },
        required: ['source', 'destination'],
        roles: [],
    },
    search_files: {
        configKey: 'search',
        description: 'Find the files of the working directory. The scope says what is searched: '
            + '`path` looks at the names of the files, `content` at their text, `symbol` at the names the code '
            + 'declares, `all` at everything. With inContent=1 (the default) it greps the text '
            + 'files and answers "path:line: text"; with inContent=0 it matches the paths of the files and '
            + 'answers the paths. The glob limits the files by their name.',
        parameters: {
            type: 'object',
            properties: {
                query: str('The text to look for.'),
                path: str('Directory to search in. Empty = the working directory.'),
                scope: str('What to search: `path`, `content`, `symbol` or `all`. Default = `content`.'),
                regex: bool('1 to treat the query as a regular expression.'),
                inContent: bool('1 to search the content, 0 to search the names only.'),
                glob: str('The names of the files to search in, like `*.scss` or `src/**/*.js`. Empty = every file.'),
            },
            required: ['query'],
            additionalProperties: false,
        },
        required: ['query'],
        roles: [],
    },
    list_backups: {
        configKey: 'read',
        description: 'List the snapshots of the files the tool wrote before. A snapshot can be restored.',
        parameters: {
            type: 'object',
            properties: {
                path: str('Path of the file, relative to the working directory. Empty = every file.'),
                limit: int('How many snapshots to show. Default 20.'),
            },
            required: [],
            additionalProperties: false,
        },
        required: [],
        roles: [],
    },
    restore_backup: {
        configKey: 'write',
        description: 'Restore a file from one of its snapshots.',
        parameters: {
            type: 'object',
            properties: {
                id: str('Id of the snapshot.'),
                path: str('Path of the file, relative to the working directory.'),
            },
            required: ['id'],
            additionalProperties: false,
        },
        required: ['id'],
        roles: [],
    },
    run_command: {
        configKey: 'command',
        description: 'Run a program in the working directory. The program is started without a shell, so the arguments are exact. The program has to finish on its own: a server or a watcher is refused.',
        parameters: {
            type: 'object',
            properties: {
                command: str('The program to run, for example npm.'),
                args: str('JSON array of the arguments, as strings.'),
                timeoutMs: int('How long the program may run. Default 60000.'),
            },
            required: ['command'],
            additionalProperties: false,
        },
        required: ['command'],
        roles: ['installer', 'reviewer', 'auditor', 'coder', 'styler', 'editor'],
    },
    run_script: {
        configKey: 'script',
        description: 'Run a JavaScript file of the working directory with Node.',
        parameters: {
            type: 'object',
            properties: {
                path: str('Path of the script, relative to the working directory.'),
                args: str('JSON array of the arguments, as strings.'),
                timeoutMs: int('How long the script may run. Default 120000.'),
            },
            required: ['path'],
            additionalProperties: false,
        },
        required: ['path'],
        roles: ['installer'],
    },
    read_skill: {
        configKey: 'skill',
        description: 'Read a skill pack: the markdown that describes a task, its standards and its steps.',
        parameters: {
            type: 'object',
            properties: {
                name: str('The name of the skill pack, for example `ego-browser`.'),
            },
            required: ['name'],
            additionalProperties: false,
        },
        required: ['name'],
        roles: [],
    },
    run_skill: {
        configKey: 'skill',
        description: 'Run the command a skill pack declares. The pack must name the command in its frontmatter.',
        parameters: {
            type: 'object',
            properties: {
                name: str('The name of the skill pack.'),
                args: str('JSON array of the arguments of the command, as strings.'),
                timeoutMs: int('How long the command may run. Default 120000.'),
            },
            required: ['name'],
            additionalProperties: false,
        },
        required: ['name'],
        roles: [],
    },
    web_guidance: {
        configKey: 'guidance',
        description: 'The guides of the modern web platform: the standards of the platform of today '
            + '(dialogs, forms, layout, animation, accessibility, performance). '
            + 'Search them with `query` and read the ones that fit with `ids`; the guides ship with '
            + 'the CLI, so the answer is immediate.',
        parameters: {
            type: 'object',
            properties: {
                query: str('The words of the search, for example `light dismiss dialog`. '
                    + 'Empty = the catalog of all the guides.'),
                ids: str('JSON array of the ids of the guides to read, for example ["dialog"].'),
                limit: int('How many guides the search returns. Default 8.'),
                source: str('Where the guides come from: `bundled` (the ones of the package) or '
                    + '`cli` (the CLI of the upstream pack, through npx). Default `bundled`.'),
            },
            required: [],
            additionalProperties: false,
        },
        required: [],
        roles: [],
    },
    fetch_url: {
        configKey: 'fetch',
        description: 'Fetch a page of the internet and read its text. The answer is cut to a size that fits the context.',
        parameters: {
            type: 'object',
            properties: {
                url: str('The address of the page, with http:// or https://.'),
                maxBytes: int('How much text to take. Default 65536.'),
            },
            required: ['url'],
            additionalProperties: false,
        },
        required: ['url'],
        roles: ['learner', 'architect', 'reviewer'],
    },
    screenshot: {
        configKey: 'browser',
        description: 'Take a screenshot of the page of the project in a real browser (Ego Lite when it is '
            + 'installed, otherwise headless Chrome/Edge) and read the picture. Use it to see the result of '
            + 'your own work: a layout that compiles may still be broken. The page of the project is served '
            + 'locally, so the call needs no running server. The answer names the file of the picture — read '
            + 'it with the tool of the pictures to look at it.',
        parameters: {
            type: 'object',
            properties: {
                path: str('The page to shoot, relative to the working directory (for example `index.html`). '
                    + 'Empty = the entry point of the project.'),
                output: str('Where to write the picture, relative to the working directory. '
                    + 'Empty = .ai/shots/shot-<time>.png.'),
                width: int('Width of the picture in pixels. Default 1440.'),
                height: int('Height of the picture in pixels. Default 900.'),
                fullPage: bool('1 to shoot the whole page, not only the first screen.'),
            },
            required: [],
            additionalProperties: false,
        },
        required: [],
        roles: [],
    },
    compare_images: {
        configKey: 'compare',
        description: 'Compare two pictures of the project: the picture of the page and the reference of the '
            + 'design. The pictures are brought to the same size first — the possible PPI of the reference are '
            + 'tried one after another (1x, 1.5x, 2x, 3x), so a picture of 2880 pixels is read as a page of 1440 '
            + 'pixels at 2x. The answer names the PPI, the numbers of the difference and the file of the picture '
            + 'of the difference: the red places of it are the places where the page does not match the reference.',
        parameters: {
            type: 'object',
            properties: {
                reference: str('The reference of the design, relative to the working directory (for example '
                    + '`landing.png`).'),
                result: str('The picture of the page, relative to the working directory (for example '
                    + '`.ai/shots/page-abc.png`).'),
                width: int('The width the page was built for, in CSS pixels. It decides which PPI of the '
                    + 'reference is the right one. Default: the width of the browser of the config.'),
            },
            required: ['reference', 'result'],
            additionalProperties: false,
        },
        required: ['reference', 'result'],
        roles: [],
    },
    delegate_role: {
        configKey: 'delegate',
        description: 'Hand one task to another role: the markup, the styler, the coder, the editor or the '
            + 'iconifier. The role that receives the work starts a separate session — a clean conversation, '
            + 'its own tools and its own budget of turns — and does not see this one. Use it when the work '
            + 'is not yours: the structure is wrong, the rules are wrong, the behaviour is wrong. The answer '
            + 'is the report of that role and the files it wrote.',
        parameters: {
            type: 'object',
            properties: {
                role: str('The role that receives the work: markup | styler | coder | editor | iconifier.'),
                task: str('What that role has to do, in full: the file, what is wrong and what the result '
                    + 'has to be. The role does not see this conversation.'),
                reason: str('One sentence: why the work goes to that role.'),
            },
            required: ['role', 'task'],
            additionalProperties: false,
        },
        required: ['role', 'task'],
        roles: [],
    },
    generate_svg: {
        configKey: 'svg',
        description: 'Write an SVG file. The prompt may be SVG markup; a plain text becomes a labelled frame. '
            + 'Vector graphics are edited as code, never as a picture.',
        parameters: {
            type: 'object',
            properties: {
                prompt: str('The SVG markup, or the text to draw.'),
                width: int('Width of the picture in pixels. Default 512.'),
                height: int('Height of the picture in pixels. Default 512.'),
                path: str('Path of the written file, relative to the working directory. Empty = assets/svg-<time>.svg.'),
            },
            required: ['prompt'],
            additionalProperties: false,
        },
        required: ['prompt'],
        roles: ['iconifier', 'editor'],
    },
    download_font: {
        configKey: 'fonts',
        description: 'Download a font from Google Fonts, or from a direct URL, into the project.',
        parameters: {
            type: 'object',
            properties: {
                name: str('Family of the font, for example Inter.'),
                style: str('Style of the font: Regular, Bold, Italic, or a weight like 700.'),
                url: str('Direct URL of the font file. When it is set, the name is ignored.'),
                path: str('Path of the written file, relative to the working directory.'),
            },
            required: [],
            additionalProperties: false,
        },
        required: [],
        roles: ['iconifier', 'styler'],
    },
    download_icons: {
        configKey: 'icons',
        description: 'Download icons of a set (phosphor or lucide) into the project. '
            + 'The names may be given one by one or all at once in "icons"; a name the set '
            + 'does not have is reported back.',
        parameters: {
            type: 'object',
            properties: {
                name: str('The set: phosphor or lucide.'),
                icon: str('Name of one icon, for example house.'),
                icons: str('JSON array of the names of the icons, for example ["house","x"].'),
                variant: str('Variant of the icon: regular, bold, duotone, ... (phosphor only).'),
                path: str('Directory the icons are written to, relative to the working directory.'),
            },
            required: ['name'],
            additionalProperties: false,
        },
        required: ['name'],
        roles: ['iconifier'],
    },
    search_icons: {
        configKey: 'icons',
        description: 'Search the names of the icons of a set (phosphor or lucide). The sets name '
            + 'their icons after the thing they draw, so the word of the thing is the word of '
            + 'the name. Use it before downloading: a name the set does not have is a broken icon.',
        parameters: {
            type: 'object',
            properties: {
                name: str('The set: phosphor or lucide.'),
                query: str('The words to look for, for example "mail envelope".'),
                limit: int('How many names to return. Default 40.'),
            },
            required: ['name'],
            additionalProperties: false,
        },
        required: ['name'],
        roles: ['iconifier'],
    },
    call_ai_decompose: {
        configKey: 'external_decompose',
        description: 'Call the external `ai-decompose` CLI to split a picture into flat screen references. '
            + 'This CLI has no decomposer of its own: the work is delegated to @u2ai/decomposer.',
        parameters: {
            type: 'object',
            properties: {
                args: str('JSON array of the arguments of `ai-decompose`, as strings.'),
            },
            required: ['args'],
            additionalProperties: false,
        },
        required: ['args'],
        roles: ['planner', 'architect'],
    },
    call_ai_measure: {
        configKey: 'external_measure',
        description: 'Call the external `ai-measure` CLI to measure a picture or to read its colours. '
            + 'This CLI has no measurer of its own: the work is delegated to @u2ai/measurer. '
            + 'The args are the arguments of the CLI as strings, e.g. ["measure", "landing.png"] for the '
            + 'measurements of a reference, ["palette", "landing.png"] for the colours. '
            + 'If the picture is already measured, the tool answers with the sheet that is on the disk '
            + 'and does not run the measurer again. '
            + 'The direction of the design is not measured: the roles take the tokens of the reference '
            + 'from measurements/DESIGN.md and decide about the styles themselves.',
        parameters: {
            type: 'object',
            properties: {
                args: str('JSON array of the arguments of `ai-measure`, as strings.'),
            },
            required: ['args'],
            additionalProperties: false,
        },
        required: ['args'],
        roles: ['planner', 'architect', 'styler'],
    },
    call_ai_image: {
        configKey: 'external_image',
        description: 'Call the external `ai-image` CLI to generate or edit a picture. '
            + 'This CLI has no image generator of its own: the work is delegated to @u2ai/images.',
        parameters: {
            type: 'object',
            properties: {
                args: str('JSON array of the arguments of `ai-image`, as strings.'),
            },
            required: ['args'],
            additionalProperties: false,
        },
        required: ['args'],
        roles: ['editor'],
    },
    ai_cli: {
        configKey: 'external_cli',
        description: 'Call one of the CLIs of the house — ai, ai-webdev, ai-decompose, ai-measure, '
            + 'ai-image — with the flags of its own command line. The arguments are exact: one '
            + 'argument per element, without a shell. Ask the CLI for its flags instead of guessing '
            + 'them: ["--help"] prints the whole table of the commands and the flags of the CLI, '
            + '["--version"] prints the version, and both cost nothing. Every path of the command '
            + 'stays inside the working directory, and the file that is written lands in the '
            + 'directory the task names. Call ai_cli_help for the manual of the family.',
        parameters: {
            type: 'object',
            properties: {
                cli: str('The name of the CLI: ai, ai-webdev, ai-decompose, ai-measure or ai-image.'),
                args: str('JSON array of the arguments of the CLI, as strings. '
                    + 'For example ["--help"] or ["measure", "landing.png"].'),
                timeoutMs: int('How long the CLI may run. Default 120000.'),
            },
            required: ['cli'],
            additionalProperties: false,
        },
        required: ['cli'],
        roles: ['planner', 'architect', 'editor', 'reviewer', 'auditor', 'installer'],
    },
    ai_cli_help: {
        configKey: 'external_cli',
        description: 'The manual of the CLIs of the house: which CLI does what, the flags they '
            + 'share, the flags of every one of them and the commands of every one of them.',
        parameters: {
            type: 'object',
            properties: {
                topic: {
                    type: 'string',
                    enum: ['family', 'flags', 'commands', 'all'],
                    description: 'The part of the manual.',
                },
            },
            required: ['topic'],
            additionalProperties: false,
        },
        required: ['topic'],
        roles: ['planner', 'architect', 'editor', 'reviewer', 'auditor', 'installer'],
    },
});

/** The names of every tool, in catalogue order. */
export const TOOL_NAMES = Object.freeze(Object.keys(TOOL_SPECS));

/** The config switches of the tools, in catalogue order. */
export const CONFIG_KEYS = Object.freeze(TOOL_NAMES.map((name) => TOOL_SPECS[name].configKey));

/**
 * The config switch that belongs to a tool.
 * @param {string} name tool name
 * @returns {string|null}
 * @exports
 * @ai.hint pure
 */
export function configKeyFor(name) {
    return TOOL_SPECS[name]?.configKey ?? null;
}

/**
 * Whether a tool is switched on in the config.
 *
 * A tool that is not mentioned in `config.tools` is on: the config lists the exceptions, not the
 * permissions.
 * @param {object} tools the `tools` section of the config
 * @param {string} name tool name
 * @returns {boolean}
 * @exports
 * @ai.hint pure
 */
export function toolEnabled(tools, name) {
    const key = configKeyFor(name);
    if (!key) return false;
    return tools?.[key] !== false;
}

/**
 * Build the tool definitions in the Responses API shape.
 * @param {object} [tools] the `tools` section of the config; a false value switches the tool off
 * @param {{ names?: string[]|null, role?: string|null }} [options]
 *   `names` limits the list to these tools, `role` limits it to the tools of that role.
 * @returns {object[]}
 * @exports
 * @ai.hint pure
 */
export function toolSpecs(tools = {}, { names = null, role = null } = {}) {
    const wanted = new Set(names ?? TOOL_NAMES);
    const out = [];
    for (const [name, spec] of Object.entries(TOOL_SPECS)) {
        if (!wanted.has(name)) continue;
        if (!toolEnabled(tools, name)) continue;
        if (spec.roles.length && role && !spec.roles.includes(role)) continue;
        out.push({
            type: 'function',
            name,
            description: spec.description,
            parameters: spec.parameters,
        });
    }
    return out;
}

/**
 * The names of the tools that are switched on for a role.
 * @param {object} tools the `tools` section of the config
 * @param {{ role?: string|null }} [options]
 * @returns {string[]}
 * @exports
 * @ai.hint pure
 */
export function enabledToolNames(tools = {}, { role = null } = {}) {
    return toolSpecs(tools, { role }).map((spec) => spec.name);
}
