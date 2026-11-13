/**
 * @file src/generate/component.js
 * @module generate/component
 * @purpose The contract of a component: `.ai/component.json`, its names, the manifest of the
 *          custom elements and the README of the API.
 *
 *   One contract drives everything: the tag of the element, the class, the package name, the
 *   attributes, the events, the parts and the states. The registry, the install command and the
 *   model read the same file, so a component cannot say one thing and be another.
 *
 * @depends node:path
 * @usedBy generate/brief, generate/scaffold, registry, cli
 * @exports COMPONENT_CONTRACT_VERSION, COMPONENT_CONTRACT_PATH, RESERVED_TAGS,
 *          componentTagName, componentClassName, componentPackageName,
 *          normalizeComponentContract, parseComponentContract, renderComponentContract,
 *          customElementsManifest, renderComponentReadme, draftComponentContract,
 *          contractBriefLines
 * @ai.tags generate, component
 * @ai.hint pure
 * @ai.hint legacy-0.2
 * @changed 2026-11-13 Ported from the monolith: the contract drives the docs, the registry and the install.
 */

import path from 'node:path';

/** The version stamped into every written contract. */
export const COMPONENT_CONTRACT_VERSION = '1';

/** The names the platform owns; a custom element may never claim them. */
export const RESERVED_TAGS = Object.freeze([
    'annotation-xml', 'color-profile', 'font-face', 'font-face-src', 'font-face-uri',
    'font-face-format', 'font-face-name', 'missing-glyph', 'html', 'body', 'head',
    'script', 'style', 'link', 'meta', 'title', 'slot', 'template',
]);

/** The prefix added when a name has no hyphen: a custom element name must contain one. */
const TAG_PREFIX = 'ai';

/** The path of the contract, relative to the root of a project. */
export const COMPONENT_CONTRACT_PATH = path.posix.join('.ai', 'component.json');

/**
 * A slug of a name: lowercase letters, digits and hyphens.
 * @param {string} value
 * @returns {string}
 * @ai.hint pure
 */
const slug = (value) => String(value ?? '').trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/**
 * A valid custom element name: lowercase, with a hyphen, not reserved.
 *
 * `calendar` becomes `ai-calendar`; `@acme/ui-cal` becomes `ui-cal`.
 * @param {string} name the name, the tag or the package name of the component
 * @returns {string}
 * @exports
 * @ai.hint pure
 */
export function componentTagName(name) {
    const base = slug(String(name ?? '').split('/').pop()?.replace(/^@/, ''));
    if (!base) return `${TAG_PREFIX}-component`;
    const tag = base.includes('-') ? base : `${TAG_PREFIX}-${base}`;
    return RESERVED_TAGS.includes(tag) ? `${TAG_PREFIX}-${tag}` : tag;
}

/**
 * The class name of a tag: `ui-calendar` to `UiCalendar`.
 * @param {string} tag
 * @returns {string}
 * @exports
 * @ai.hint pure
 */
export function componentClassName(tag) {
    const parts = slug(tag).split('-').filter(Boolean);
    if (!parts.length) return 'AiComponent';
    return parts.map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join('');
}

/**
 * The package name of a component, for `package.json` and for a `file:` dependency.
 *
 * A scoped name is kept; a bare name gains the `@ai/` scope, so a local component can never
 * collide with a public package of npm.
 * @param {{ name?: string|null, tag?: string|null }} input
 * @returns {string}
 * @exports
 * @ai.hint pure
 */
export function componentPackageName({ name = null, tag = null } = {}) {
    const given = String(name ?? '').trim();
    if (given.startsWith('@')) {
        const [scope, pkg] = given.split('/');
        // slug() drops the leading "@", so it is put back: a scope of npm needs it.
        if (scope && pkg) return `@${slug(scope)}/${slug(pkg)}`;
    }
    const bare = slug(given || slug(tag) || 'component');
    return `@ai/${bare}`;
}

/**
 * A string out of anything the model wrote. A malformed answer never breaks the registry.
 * @param {*} value
 * @returns {string}
 * @ai.hint pure
 */
function text(value) {
    if (value == null) return '';
    if (typeof value === 'string') return value.trim();
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    return '';
}

/**
 * One entry of a list of the contract, as an object with a name.
 *
 * The short form `"header"` and the object form `{ name: "header", ... }` are both accepted.
 * @param {*} value
 * @param {string[]} keys the fields of the entry
 * @returns {object|null}
 * @ai.hint pure
 */
function named(value, keys) {
    if (typeof value === 'string' || typeof value === 'number') return { name: text(value) };
    if (!value || typeof value !== 'object') return null;
    const out = { name: text(value.name ?? value.attribute ?? value.part ?? value.slot ?? value.state ?? value.property) };
    if (!out.name) return null;
    for (const key of keys) {
        if (value[key] === undefined) continue;
        if (key === 'values') {
            out[key] = Array.isArray(value[key])
                ? value[key].map(text).filter(Boolean)
                : text(value[key]).split(/[|,]/).map((part) => part.trim()).filter(Boolean);
        } else if (key === 'reflect' || key === 'bubbles' || key === 'cancelable') {
            out[key] = Boolean(value[key]);
        } else {
            out[key] = text(value[key]);
        }
    }
    return out;
}

/**
 * A list of the contract, with every entry normalized.
 * @param {*} value
 * @param {string[]} keys
 * @returns {object[]}
 * @ai.hint pure
 */
function list(value, keys) {
    const items = Array.isArray(value) ? value : (value == null ? [] : [value]);
    return items.map((item) => named(item, keys)).filter((item) => item && item.name);
}

/**
 * Clean any object into the shape of the contract.
 *
 * Only a tag that cannot be derived is an error: every other field has a usable default.
 * @param {object} raw
 * @returns {object}
 * @exports
 * @ai.hint pure
 */
export function normalizeComponentContract(raw = {}) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const tag = componentTagName(source.tag ?? source.name ?? source.tagName);
    const framework = text(source.framework) || 'vanilla';
    const typed = framework === 'solid' || framework === 'angular';
    return {
        schemaVersion: COMPONENT_CONTRACT_VERSION,
        tag,
        className: text(source.className) || componentClassName(tag),
        name: componentPackageName({ name: source.name, tag }),
        version: /^\d+\.\d+\.\d+/.test(text(source.version)) ? text(source.version) : '0.1.0',
        kind: text(source.kind) || 'web-component',
        framework,
        scriptLanguage: text(source.scriptLanguage) || (typed ? 'typescript' : 'javascript'),
        styleLanguage: text(source.styleLanguage) || 'scss',
        summary: text(source.summary),
        entry: text(source.entry) || 'index.js',
        styles: text(source.styles),
        demo: text(source.demo) || 'index.html',
        attrs: list(source.attrs ?? source.attributes, ['type', 'default', 'values', 'reflect', 'description']),
        props: list(source.props ?? source.properties, ['type', 'default', 'description']),
        events: list(source.events, ['detail', 'bubbles', 'cancelable', 'description']),
        slots: list(source.slots, ['description']),
        parts: list(source.parts, ['description']),
        states: list(source.states, ['description']),
        cssVars: list(source.cssVars ?? source.cssVariables, ['default', 'description']),
        deps: Array.isArray(source.deps)
            ? source.deps.filter((item) => typeof item === 'string' && item.trim()).map(text)
            : [],
        a11y: text(source.a11y),
        sources: Array.isArray(source.sources)
            ? source.sources.filter((item) => typeof item === 'string' && item.trim()).map(text)
            : [],
    };
}

/**
 * Parse a contract file. The error names the file, so the CLI can point at it.
 * @param {string} source
 * @param {string} [file]
 * @returns {object}
 * @exports
 * @ai.hint pure
 */
export function parseComponentContract(source, file = COMPONENT_CONTRACT_PATH) {
    let raw;
    try {
        raw = JSON.parse(source);
    } catch (error) {
        throw new Error(`${file}: некорректный JSON: ${error.message}`);
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`${file}: ожидался объект`);
    return normalizeComponentContract(raw);
}

/**
 * The text of the contract for the disk, with a trailing newline.
 * @param {object} contract
 * @returns {string}
 * @exports
 * @ai.hint pure
 */
export function renderComponentContract(contract) {
    return `${JSON.stringify(normalizeComponentContract(contract), null, 2)}\n`;
}

/**
 * The manifest of the custom elements (custom-element-manifest 1.0.0).
 *
 * An editor reads this file for the completion of the tags, so the tag and the names of the
 * attributes must match the contract exactly.
 * @param {object} contract
 * @returns {object}
 * @exports
 * @ai.hint pure
 */
export function customElementsManifest(contract) {
    const c = normalizeComponentContract(contract);
    return {
        schemaVersion: '1.0.0',
        readMe: 'README.md',
        modules: [{
            kind: 'javascript-module',
            path: c.entry,
            declarations: [{
                kind: 'class',
                name: c.className,
                customElement: true,
                tagName: c.tag,
                summary: c.summary,
                attributes: c.attrs.map((a) => ({
                    fieldName: `#${a.name}`,
                    name: a.name,
                    type: a.type ? { text: a.type } : undefined,
                    default: a.default,
                    reflect: Boolean(a.reflect),
                    description: a.description || '',
                })),
                members: c.props.map((p) => ({
                    kind: 'field',
                    name: p.name,
                    type: p.type ? { text: p.type } : undefined,
                    default: p.default,
                    description: p.description || '',
                })),
                events: c.events.map((e) => ({
                    name: e.name,
                    type: e.detail ? { text: e.detail } : undefined,
                    description: e.description || '',
                })),
                slots: c.slots.map((s) => ({ name: s.name, description: s.description || '' })),
                cssParts: c.parts.map((p) => ({ name: p.name, description: p.description || '' })),
                cssProperties: c.cssVars.map((v) => ({
                    name: v.name,
                    default: v.default,
                    description: v.description || '',
                })),
            }],
            exports: [{ kind: 'custom-element-definition', name: c.tag, declaration: { name: c.className } }],
        }],
    };
}

/**
 * A markdown table, or a note when the table is empty.
 * @param {Array<Array<string>>} rows
 * @param {string[]} header
 * @returns {string[]}
 * @ai.hint pure
 */
function table(rows, header) {
    if (!rows.length) return ['_None._'];
    return [
        `| ${header.join(' | ')}`,
        `| ${header.map(() => '---').join(' | ')}`,
        ...rows.map((row) => `| ${row.map((cell) => String(cell ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ').trim() || '—').join(' | ')}`),
    ];
}

/**
 * The README of a component, with the API as tables.
 *
 * It doubles as the checklist of the review: a reviewer sees which part, state and CSS
 * variable the demo has to cover.
 * @param {object} contract
 * @returns {string}
 * @exports
 * @ai.hint pure
 */
export function renderComponentReadme(contract) {
    const c = normalizeComponentContract(contract);
    const lines = [
        `# \`${c.tag}\``,
        '',
        c.summary || 'No summary yet.',
        '',
        '## Install',
        '',
        '```sh',
        `ai-webdev install ${c.tag}`,
        '```',
        '',
        'Or register the sources as a local package:',
        '',
        '```json',
        JSON.stringify({ dependencies: { [c.name]: 'file:./vendor/components/' + c.tag } }, null, 2),
        '```',
        '',
        '## Usage',
        '',
        '```html',
        `<script type="module">import '${c.name}';</script>`,
        `<${c.tag}></${c.tag}>`,
        '```',
        '',
        '## Attributes',
        ...table(c.attrs.map((a) => [`\`${a.name}\``, a.type, a.default, a.values?.length ? a.values.map((v) => `\`${v}\``).join(' ') : '', a.description]), ['Name', 'Type', 'Default', 'Values', 'Description']),
        '',
        '## Properties',
        ...table(c.props.map((p) => [`\`${p.name}\``, p.type, p.default, p.description]), ['Name', 'Type', 'Default', 'Description']),
        '',
        '## Events',
        ...table(c.events.map((e) => [`\`${e.name}\``, e.detail, e.bubbles === false ? 'no' : 'yes', e.description]), ['Name', 'Detail', 'Bubbles', 'Description']),
        '',
        '## Slots',
        ...table(c.slots.map((s) => [`\`${s.name || '(default)'}\``, s.description]), ['Slot', 'Description']),
        '',
        '## CSS parts',
        'Style the component from outside through these hooks. Never reach into the shadow tree.',
        ...table(c.parts.map((p) => [`\`::part(${p.name})\``, p.description]), ['Part', 'Description']),
        '',
        '## CSS custom properties',
        ...table(c.cssVars.map((v) => [`\`${v.name}\``, v.default, v.description]), ['Property', 'Default', 'Description']),
        '',
        '## States',
        'The component reports these through `ElementInternals`, so a host can match them with `:state(...)`.',
        ...table(c.states.map((s) => [`\`state(${s.name})\``, s.description]), ['State', 'Description']),
        '',
        '## Accessibility',
        '',
        c.a11y || 'Not documented yet.',
        '',
        '## Build',
        '',
        '```sh',
        'npm install',
        'npm run build',
        '```',
        '',
    ];
    return lines.join('\n').replace(/\n{3,}/g, '\n\n');
}

/**
 * The contract of a component before any generation.
 *
 * The tag, the package name and the class are fixed here, so `package.json`, the demo and the
 * registry agree from the first step; the model then fills the sections of the API.
 * @param {{ name?: string, tag?: string|null, prompt?: string, framework?: string|null,
 *   scriptLanguage?: string|null, styleLanguage?: string|null }} input
 * @returns {object}
 * @exports
 * @ai.hint pure
 */
export function draftComponentContract({
    name = 'app',
    tag = null,
    prompt = '',
    framework = null,
    scriptLanguage = null,
    styleLanguage = null,
} = {}) {
    // `ui-calendar@1.2.0` carries a version the way an npm spec does.
    const raw = String(tag || name || '').trim();
    const at = raw.lastIndexOf('@');
    const version = at > 0 ? raw.slice(at + 1) : null;
    const chosen = at > 0 ? raw.slice(0, at) : raw;
    const summary = String(prompt ?? '').replace(/\s+/g, ' ').trim().slice(0, 180);
    return normalizeComponentContract({
        tag: componentTagName(chosen),
        name: componentPackageName({ tag: componentTagName(chosen) }),
        ...(version ? { version } : {}),
        summary,
        framework: framework || 'vanilla',
        scriptLanguage,
        styleLanguage,
    });
}

/**
 * The paragraph of the contract for the brief of the generation.
 *
 * It tells the model to fill the contract first and to keep every other file equal to it.
 * @param {object} contract
 * @returns {string[]}
 * @exports
 * @ai.hint pure
 */
export function contractBriefLines(contract) {
    const c = normalizeComponentContract(contract);
    const names = (items) => items.map((item) => item.name).join(', ');
    return [
        `Component contract: tag "${c.tag}", class "${c.className}", package "${c.name}", version ${c.version}.`,
        '.ai/component.json is the source of truth. When the public API changes, edit the contract in the same step as the code.',
        c.attrs.length ? `Attributes to implement: ${names(c.attrs)}.` : 'Attributes: none yet. Add one to the contract when the design needs it.',
        c.props.length ? `Properties: ${names(c.props)}.` : '',
        c.events.length ? `Events to dispatch: ${names(c.events)}.` : '',
        c.slots.length ? `Slots: ${names(c.slots)}.` : '',
        c.parts.length ? `CSS parts to expose: ${names(c.parts)}.` : 'CSS parts: expose at least one so the host can style the component.',
        c.cssVars.length ? `CSS custom properties: ${names(c.cssVars)}.` : '',
        c.states.length ? `Custom states through ElementInternals: ${names(c.states)}.` : '',
        c.a11y ? `Accessibility: ${c.a11y}` : '',
    ].filter(Boolean);
}
