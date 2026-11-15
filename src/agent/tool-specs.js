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
        description: 'Read a text file of the working directory. A line range may be given to read a part of a big file.',
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
        description: 'Call the external `ai-measure` CLI to measure a picture or to produce a design direction. '
            + 'This CLI has no measurer of its own: the work is delegated to @u2ai/measurer. '
            + 'The args are the arguments of the CLI as strings, e.g. ["measure", "landing.png"] for the '
            + 'measurements of a reference, ["design", "landing.png"] for the design direction, '
            + '["palette", "landing.png"] for the colours.',
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
