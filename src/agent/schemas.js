/**
 * @file src/agent/schemas.js
 * @module agent/schemas
 * @purpose The schemas of the answers of the roles.
 *
 *   Every role answers with JSON, and the schema of that JSON is strict: every field is
 *   required, no field is left over, and no field is optional. A strict schema is the contract
 *   between the role and the code that reads the answer — the code may count on the field being
 *   there, and the model may not add a field of its own.
 *
 *   The schemas are built by a helper that sets the strictness, so a new field cannot be added
 *   to one object and forgotten in another.
 *
 * @depends none
 * @usedBy roles/index, stages/index
 * @exports SCHEMAS, SCHEMA_NAMES, strictObject, schemaFor, schemaNameFor, assertStrictSchema,
 *          schemaProblems, schemaText
 * @ai.tags schemas, json, strict
 * @ai.hint pure
 */

/**
 * A string field.
 * @param {string} description
 * @returns {object}
 * @ai.hint pure
 */
export const str = (description) => ({ type: 'string', description });

/**
 * An integer field.
 * @param {string} description
 * @returns {object}
 * @ai.hint pure
 */
export const int = (description) => ({ type: 'integer', description });

/**
 * A boolean field.
 * @param {string} description
 * @returns {object}
 * @ai.hint pure
 */
export const bool = (description) => ({ type: 'boolean', description });

/**
 * An array field.
 * @param {object} items
 * @param {string} [description]
 * @returns {object}
 * @ai.hint pure
 */
export const arr = (items, description = '') => (description
    ? { type: 'array', description, items }
    : { type: 'array', items });

/**
 * A strict object: every field is required and nothing else is allowed.
 * @param {Record<string, object>} properties
 * @returns {object}
 * @ai.hint pure
 */
export function strictObject(properties) {
    return {
        type: 'object',
        properties,
        required: Object.keys(properties),
        additionalProperties: false,
    };
}

/** One file the role writes. */
const fileSchema = strictObject({
    path: str('The path of the file, relative to the root of the project.'),
    content: str('The whole text of the file.'),
    language: str('The language of the file: html, css, scss, js, ts, jsx, tsx, json, md.'),
});

/** One command the role runs. */
const commandSchema = strictObject({
    command: str('The program to run, without a shell.'),
    args: arr(str('An argument of the program.'), 'The arguments of the program.'),
    purpose: str('What the command does and why it is needed.'),
});

/** One issue the reviewer reports. */
const issueSchema = strictObject({
    severity: str('One of: high, medium, low.'),
    path: str('The path of the file with the problem, or an empty string when it is not in one file.'),
    message: str('What is wrong.'),
    requestedChange: str('What to do about it.'),
});

/**
 * The schemas of the answers of the roles.
 * @type {Readonly<Record<string, object>>}
 */
export const SCHEMAS = Object.freeze({
    scan: strictObject({
        summary: str('What the project is and what state it is in, in two or three sentences.'),
        project: str('The kind of the project: what it is and what it is made of.'),
        stack: strictObject({
            framework: str('The framework the project uses now, or an empty string.'),
            markup: str('The markup language the project uses now, or an empty string.'),
            style: str('The style language the project uses now, or an empty string.'),
            script: str('The script language the project uses now, or an empty string.'),
        }),
        files: arr(strictObject({
            path: str('The path of the file, relative to the root of the project.'),
            role: str('What the task does with the file: edit, read or keep.'),
            reason: str('Why the file matters for the task.'),
        }), 'The files that matter for the task.'),
        conventions: arr(str('A rule of the project and where it comes from.'), 'The conventions of the project.'),
        risks: arr(str('A fact that may break the work, and what to do about it.'), 'The risks of the work.'),
        questions: arr(str('A question the project cannot answer by itself.'), 'The questions for the user.'),
        notes: str('What the reader of the survey needs to know and the rest of the report does not say.'),
    }),

    plan: strictObject({
        summary: str('What the task is, in two or three sentences.'),
        steps: arr(strictObject({
            id: str('The id of the step, unique inside the plan.'),
            title: str('What the step does, in one line.'),
            role: str('The role that does the step: markup, coder, styler, animator, editor, illustrator, iconifier.'),
            dependsOn: arr(str('The id of a step that must be done before this one.'), 'The ids of the steps this one waits for.'),
            files: arr(str('The path of a file the step touches.'), 'The files the step touches.'),
            criteria: arr(str('A criterion of readiness, written so that it can be checked.'), 'How one knows that the step is done.'),
        }), 'The steps of the work. At least two steps: the work to do, not the intentions.'),
        risks: arr(str('A risk of the plan and what to do about it.'), 'The risks of the plan.'),
        questions: arr(str('A question the plan cannot answer without the user.'), 'The questions for the user.'),
    }),

    architecture: strictObject({
        summary: str('The shape of the project, in two or three sentences.'),
        stack: strictObject({
            framework: str('The framework: vanilla, react, vue, svelte, next, astro, vite, lure, ssre.'),
            markup: str('The markup language: html, jsx, tsx, vue, svelte.'),
            style: str('The style language: css, scss, less.'),
            script: str('The script language: javascript, typescript.'),
            iconSet: str('The icon set: auto, phosphor, lucide.'),
        }),
        modules: arr(strictObject({
            name: str('The name of the module.'),
            path: str('The path of the file of the module, relative to the root of the project.'),
            purpose: str('What the module is responsible for.'),
            exports: arr(str('The name of an export of the module.'), 'What the module gives to the others.'),
            dependsOn: arr(str('The path of a module this one needs.'), 'The modules this one needs.'),
        })),
        tokens: arr(strictObject({
            name: str('The name of the token, without the leading dashes.'),
            value: str('The value of the token.'),
            kind: str('One of: color, size, font, space, radius, shadow, duration.'),
        }), 'The design tokens the project needs.'),
        notes: str('The decisions that the modules do not show, and why they were made.'),
    }),

    code: strictObject({
        summary: str('What was written, in two or three sentences.'),
        files: arr(fileSchema, 'The files of this step.'),
        commands: arr(commandSchema, 'The commands that have to run for the step to work.'),
        notes: str('The decisions the reader needs to know about the code.'),
    }),

    style: strictObject({
        summary: str('What was styled, in two or three sentences.'),
        tokens: arr(strictObject({
            name: str('The name of the token, without the leading dashes.'),
            value: str('The value of the token.'),
        }), 'The tokens the stylesheet declares.'),
        files: arr(fileSchema, 'The stylesheets of this step.'),
        notes: str('The decisions the reader needs to know about the styles.'),
    }),

    markup: strictObject({
        summary: str('What was marked up, in two or three sentences.'),
        files: arr(fileSchema, 'The files of markup of this step.'),
        landmarks: arr(str('A landmark of the page: header, nav, main, aside, footer.'), 'The landmarks of the page.'),
        accessibility: arr(str('An accessibility decision of the markup.'), 'What was done for the keyboard, the screen reader and the contrast.'),
        notes: str('The decisions the reader needs to know about the markup.'),
    }),

    icon: strictObject({
        summary: str('Which icons were picked and why, in two or three sentences.'),
        set: str('The set of the icons: phosphor, lucide.'),
        icons: arr(strictObject({
            name: str('The name of the icon in the set, for example house.'),
            purpose: str('What the icon stands for in the interface.'),
            size: int('The size of the icon in pixels.'),
            file: str('The path of the file of the icon, relative to the root of the project.'),
        })),
        files: arr(fileSchema, 'The files of the icons that were written.'),
        notes: str('The decisions the reader needs to know about the icons.'),
    }),

    setup: strictObject({
        summary: str('What the environment looks like now, in two or three sentences.'),
        packageManager: str('The package manager of the project: npm, pnpm, yarn, bun, or none.'),
        dependencies: arr(strictObject({
            name: str('The name of the package.'),
            version: str('The version of the package.'),
            dev: bool('1 when the package is needed only for the development.'),
        })),
        scripts: arr(strictObject({
            name: str('The name of the script.'),
            command: str('The command of the script.'),
        })),
        files: arr(fileSchema, 'The files of the setup: the package manifest, the config of the bundler.'),
        commands: arr(commandSchema, 'The commands that have to run to prepare the environment.'),
        notes: str('The decisions the reader needs to know about the setup.'),
    }),

    review: strictObject({
        verdict: str('One of: pass, partial, fail.'),
        scores: strictObject({
            fidelity: int('How close the result is to the reference, from 0 to 100.'),
            completeness: int('How much of the task is done, from 0 to 100.'),
            accessibility: int('How well the result follows the accessibility rules, from 0 to 100.'),
            quality: int('How good the result is, from 0 to 100.'),
        }),
        issues: arr(issueSchema, 'The problems that were found.'),
        summary: str('The verdict in two or three sentences.'),
        recommendations: arr(str('What to do next.'), 'What has to happen next.'),
    }),
});

/** The names of the schemas. */
export const SCHEMA_NAMES = Object.freeze(Object.keys(SCHEMAS));

/**
 * The schema of a role.
 * @param {string} role
 * @returns {object|null}
 * @exports
 * @ai.hint pure
 */
export function schemaFor(role) {
    return SCHEMAS[String(role ?? '').toLowerCase()] ?? null;
}

/**
 * The name of the schema of a role.
 * @param {string} role
 * @returns {string|null}
 * @exports
 * @ai.hint pure
 */
export function schemaNameFor(role) {
    return schemaFor(role) ? String(role).toLowerCase() : null;
}

/**
 * Check that a schema is strict: every object lists all of its fields as required and forbids
 * the fields it does not know.
 * @param {object} schema
 * @param {string} [where] the path of the schema, for the message
 * @returns {string[]} the problems; empty when the schema is strict
 * @exports
 * @ai.hint pure
 */
export function assertStrictSchema(schema, where = 'schema') {
    const problems = [];
    /** Walk one node of the schema. */
    const walk = (node, at) => {
        if (!node || typeof node !== 'object') return;
        if (node.type === 'object') {
            const keys = Object.keys(node.properties ?? {});
            const required = Array.isArray(node.required) ? node.required : [];
            for (const key of keys) {
                if (!required.includes(key)) problems.push(`${at}: поле "${key}" не обязательно`);
            }
            for (const key of required) {
                if (!keys.includes(key)) problems.push(`${at}: обязательное поле "${key}" не описано`);
            }
            if (node.additionalProperties !== false) problems.push(`${at}: additionalProperties не запрещены`);
            for (const [key, child] of Object.entries(node.properties ?? {})) walk(child, `${at}.${key}`);
        }
        if (node.type === 'array') walk(node.items, `${at}[]`);
    };
    walk(schema, where);
    return problems;
}

/**
 * Check a value against the JSON-schema subset used by this package's role contracts.
 * @param {unknown} value
 * @param {object} schema
 * @param {string} [where]
 * @returns {string[]}
 * @exports
 * @ai.hint pure
 */
export function schemaProblems(value, schema, where = '$') {
    const problems = [];
    const check = (item, rule, at) => {
        if (!rule || typeof rule !== 'object') return;
        if (rule.type === 'object') {
            if (!item || typeof item !== 'object' || Array.isArray(item)) {
                problems.push(`${at}: ожидался объект`);
                return;
            }
            for (const key of rule.required ?? []) {
                if (!Object.hasOwn(item, key)) problems.push(`${at}.${key}: поле отсутствует`);
            }
            for (const [key, child] of Object.entries(item)) {
                if (!Object.hasOwn(rule.properties ?? {}, key)) {
                    if (rule.additionalProperties === false) problems.push(`${at}.${key}: лишнее поле`);
                    continue;
                }
                check(child, rule.properties[key], `${at}.${key}`);
            }
            return;
        }
        if (rule.type === 'array') {
            if (!Array.isArray(item)) {
                problems.push(`${at}: ожидался массив`);
                return;
            }
            item.forEach((child, index) => check(child, rule.items, `${at}[${index}]`));
            return;
        }
        const valid = rule.type === 'string'
            ? typeof item === 'string'
            : rule.type === 'integer'
                ? Number.isSafeInteger(item)
                : rule.type === 'boolean'
                    ? typeof item === 'boolean'
                    : true;
        if (!valid) problems.push(`${at}: ожидался ${rule.type}`);
    };
    check(value, schema, where);
    return problems;
}

/**
 * The schema of an answer, as text for the prompt.
 *
 * The gateway may ignore the `text.format.json_schema` rule of the Responses API: the model
 * answers with its own form then, and the fields of the answer have names nobody expects.
 * The names of the fields travel in the prompt as well, so the model knows the contract of
 * the answer even when the rule of the API is ignored.
 * @param {object|null} schema the JSON schema of the answer
 * @returns {string} the text of the block; empty when there is no schema
 * @exports
 * @ai.hint pure
 */
export function schemaText(schema) {
    if (!schema || typeof schema !== 'object') return '';
    const lines = [];
    /**
     * The lines of one node of the schema.
     * @param {object} node
     * @param {string} prefix
     */
    const walk = (node, prefix) => {
        for (const [key, child] of Object.entries(node?.properties ?? {})) {
            const at = prefix ? `${prefix}.${key}` : key;
            if (child?.type === 'object') {
                const names = Object.keys(child.properties ?? {});
                lines.push(`- ${at}: object with the fields ${names.join(', ') || '(none)'}`);
                walk(child, at);
            } else if (child?.type === 'array') {
                const item = child?.items ?? {};
                const names = item?.type === 'object' ? Object.keys(item.properties ?? {}) : [];
                lines.push(`- ${at}: array${names.length ? ` of objects with the fields ${names.join(', ')}` : ''}`);
                if (item?.type === 'object') walk(item, at);
            } else {
                lines.push(`- ${at}: ${child?.type ?? 'value'}`);
            }
        }
    };
    walk(schema, '');
    if (!lines.length) return '';
    return `The answer of the role is an object with these fields:\n${lines.join('\n')}\nEvery field is required, and the answer holds no other field.`;
}
