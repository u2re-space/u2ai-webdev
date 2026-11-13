/**
 * @file src/inputs/design-md.js
 * @module inputs/design-md
 * @purpose Read `DESIGN.md`: the palette, the typography, the spacing scale, the components and
 *          the conflicts inside the document.
 *
 *   The document is written by a person or by the measurer, so it is markdown of many shapes.
 *   The parser reads the shapes that carry meaning — headings, tables, list items and the
 *   `--token: value` lines of a token block — and keeps the rest as the raw text. A token that
 *   the parser does not understand stays in the text: nothing is invented and nothing is lost.
 *
 * @depends none
 * @usedBy inputs/index, stages/collect
 * @exports DESIGN_SECTIONS, parseDesignMd, parseTokensBlock, parseColorTable, parseSpacingList,
 *          conflictsBetween, designConflicts
 * @ai.tags inputs, design, markdown
 * @ai.hint pure
 */

/** The sections the parser looks for, by the words a heading may use. */
export const DESIGN_SECTIONS = Object.freeze({
    colors: ['colour', 'colors', 'color', 'palette', 'цвет', 'палитра'],
    typography: ['typography', 'type', 'font', 'типографика', 'шрифт', 'шрифты'],
    spacing: ['spacing', 'space', 'scale', 'отступ', 'отступы', 'шкала'],
    components: ['component', 'components', 'компонент', 'компоненты'],
    layout: ['layout', 'grid', 'сетка', 'раскладка', 'композиция'],
    motion: ['motion', 'animation', 'transition', 'анимац', 'движен'],
});

/**
 * The sections of a markdown document: a heading and the text under it.
 * @param {string} text
 * @returns {Array<{ title: string, level: number, body: string }>}
 * @ai.hint pure
 */
function splitSections(text) {
    const lines = String(text ?? '').split(/\r?\n/);
    const sections = [];
    let current = { title: '', level: 0, body: [] };
    let inFence = false;
    for (const line of lines) {
        if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
        const heading = inFence ? null : line.match(/^(#{1,6})\s+(.*)$/);
        if (heading) {
            sections.push({ title: current.title, level: current.level, body: current.body.join('\n') });
            current = { title: heading[2].trim(), level: heading[1].length, body: [] };
            continue;
        }
        current.body.push(line);
    }
    sections.push({ title: current.title, level: current.level, body: current.body.join('\n') });
    return sections.filter((section) => section.title !== '' || section.body.trim() !== '');
}

/**
 * The section of a document that belongs to a group of words.
 * @param {Array<{ title: string, body: string }>} sections
 * @param {string[]} words
 * @returns {string} the body of the section, or an empty string
 * @ai.hint pure
 */
function sectionFor(sections, words) {
    for (const section of sections) {
        const title = section.title.toLowerCase();
        if (words.some((word) => title.includes(word))) return section.body;
    }
    return '';
}

/**
 * The token declarations of a markdown document.
 *
 * Three forms are read: a `--token: value` line, a table row `| `--token` | value |`, and a
 * bullet `- `--token`: value`.
 * @param {string} text
 * @returns {Array<{ name: string, value: string, group: string }>}
 * @ai.hint pure
 */
export function parseTokensBlock(text) {
    const tokens = [];
    const seen = new Set();
    const add = (name, value, group = '') => {
        const clean = String(name ?? '').trim();
        const text2 = String(value ?? '').trim().replace(/^`+|`+$/g, '').trim();
        if (!clean || !text2 || seen.has(clean)) return;
        seen.add(clean);
        tokens.push({ name: clean, value: text2, group });
    };

    for (const line of String(text ?? '').split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        // `--token: value` and `- `--token`: value`
        const inline = trimmed.match(/^[-*+]?\s*`?(--[a-zA-Z0-9_-]+)`?\s*[:=]\s*(.+?)\s*$/);
        if (inline) {
            add(inline[1], inline[2]);
            continue;
        }

        // `| `--token` | value |`
        if (trimmed.startsWith('|')) {
            const cells = trimmed.split('|').slice(1, -1).map((cell) => cell.trim());
            if (cells.length < 2) continue;
            // The separator row of a table is not a token.
            if (cells.every((cell) => /^:?-+:?$/.test(cell))) continue;
            const name = cells[0].replace(/`/g, '').trim();
            if (!/^--[a-zA-Z0-9_-]+$/.test(name)) continue;
            add(name, cells[1]);
        }
    }
    return tokens;
}

/**
 * The colours of a document: a table with a token, a value and, maybe, a name.
 * @param {string} text
 * @returns {Array<{ token: string, value: string, name: string }>}
 * @ai.hint pure
 */
export function parseColorTable(text) {
    const colors = [];
    const seen = new Set();
    for (const line of String(text ?? '').split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('|')) continue;
        const cells = trimmed.split('|').slice(1, -1).map((cell) => cell.trim());
        if (cells.length < 2) continue;
        if (/^-+$/.test(cells[0])) continue;
        const token = cells[0].replace(/`/g, '').trim();
        const value = cells[1].replace(/`/g, '').trim();
        if (!token || !value) continue;
        if (!/^(--|#|oklch|rgb|hsl|white|black)/i.test(token) && !/^(--|#|oklch|rgb|hsl)/i.test(value)) continue;
        const key = `${token}|${value}`;
        if (seen.has(key)) continue;
        seen.add(key);
        colors.push({ token, value, name: cells[2] ? cells[2].replace(/`/g, '').trim() : '' });
    }
    return colors;
}

/**
 * The spacing scale of a document: a list of steps with their sizes.
 * @param {string} text
 * @returns {Array<{ name: string, value: string }>}
 * @ai.hint pure
 */
export function parseSpacingList(text) {
    const steps = [];
    const seen = new Set();
    for (const line of String(text ?? '').split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!/^[-*+]/.test(trimmed)) continue;
        const item = trimmed.replace(/^[-*+]\s*/, '').replace(/^\*\*(.+)\*\*$/, '$1').trim();
        // The name ends at the first colon or dash; the dash is not a separator here,
        // because a name of a scale step is written `space-1`.
        const split = item.split(/\s*[:—–]\s*/);
        if (split.length < 2) continue;
        const name = split[0].trim();
        const value = split.slice(1).join(': ').trim().replace(/[;,]\s*$/, '');
        if (!name || !value || seen.has(name)) continue;
        seen.add(name);
        steps.push({ name, value });
    }
    return steps;
}

/**
 * The conflicts between two sets of tokens: the same name with a different value.
 * @param {Array<{ name: string, value: string }>} first
 * @param {Array<{ name: string, value: string }>} second
 * @returns {Array<{ name: string, first: string, second: string }>}
 * @ai.hint pure
 */
export function conflictsBetween(first = [], second = []) {
    const map = new Map();
    for (const token of first) map.set(token.name, token.value);
    const conflicts = [];
    for (const token of second) {
        const other = map.get(token.name);
        if (other === undefined) continue;
        if (String(other).trim() === String(token.value).trim()) continue;
        conflicts.push({ name: token.name, first: other, second: token.value });
    }
    return conflicts;
}

/**
 * Read `DESIGN.md`: the tokens, the palette, the type scale, the components and the conflicts.
 * @param {string} text the text of the document
 * @returns {{ present: boolean, raw: string, tokens: object[], colors: object[],
 *   typography: object[], spacing: object[], components: string[], layout: string[],
 *   sections: object[], conflicts: object[] }}
 * @exports
 * @ai.hint pure
 */
export function parseDesignMd(text) {
    const raw = String(text ?? '');
    if (!raw.trim()) {
        return {
            present: false,
            raw: '',
            tokens: [],
            colors: [],
            typography: [],
            spacing: [],
            components: [],
            layout: [],
            sections: [],
            conflicts: [],
        };
    }

    const sections = splitSections(raw);
    const colorsBody = sectionFor(sections, DESIGN_SECTIONS.colors);
    const typographyBody = sectionFor(sections, DESIGN_SECTIONS.typography);
    const spacingBody = sectionFor(sections, DESIGN_SECTIONS.spacing);
    const componentsBody = sectionFor(sections, DESIGN_SECTIONS.components);
    const layoutBody = sectionFor(sections, DESIGN_SECTIONS.layout);

    const tokens = parseTokensBlock(raw);
    const colors = parseColorTable(colorsBody || raw);
    const spacing = parseSpacingList(spacingBody || raw);

    const typography = [];
    for (const line of typographyBody.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('-') && !trimmed.startsWith('|')) continue;
        let name = '';
        let value = '';
        if (trimmed.startsWith('|')) {
            const cells = trimmed.split('|').slice(1, -1).map((cell) => cell.trim());
            if (cells.every((cell) => /^:?-+:?$/.test(cell))) continue;
            name = (cells[0] ?? '').replace(/[`*]/g, '').trim();
            value = (cells[1] ?? '').replace(/[`*]/g, '').trim();
        } else {
            // A bullet of the type `- Heading: 32px / 1.2`.
            const item = trimmed.replace(/^[-*+]\s*/, '').replace(/^\*\*(.+)\*\*$/, '$1').trim();
            const split = item.split(/\s*[:—–]\s*/);
            if (split.length < 2) continue;
            name = split[0].replace(/[`*]/g, '').trim();
            value = split.slice(1).join(': ').replace(/[`*]/g, '').trim();
        }
        if (!name || !value) continue;
        typography.push({ name, value });
    }

    const components = [];
    for (const line of componentsBody.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!/^[-*+]/.test(trimmed)) continue;
        const name = trimmed.replace(/^[-*+]\s*/, '').replace(/[`*]/g, '').trim();
        if (name) components.push(name);
    }

    const layout = [];
    for (const line of layoutBody.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!/^[-*+]/.test(trimmed)) continue;
        const name = trimmed.replace(/^[-*+]\s*/, '').replace(/[`*]/g, '').trim();
        if (name) layout.push(name);
    }

    // The same token twice with a different value is a conflict inside the document itself.
    const byName = new Map();
    const conflicts = [];
    for (const token of tokens) {
        const previous = byName.get(token.name);
        if (previous !== undefined && previous !== token.value) {
            conflicts.push({ name: token.name, first: previous, second: token.value });
        }
        byName.set(token.name, token.value);
    }

    return {
        present: true,
        raw,
        tokens,
        colors,
        typography,
        spacing,
        components,
        layout,
        sections: sections
            .filter((section) => section.title)
            .map((section) => ({ title: section.title, level: section.level })),
        conflicts,
    };
}

/**
 * The conflicts of the document with the tokens of a stylesheet.
 * @param {object} design the result of `parseDesignMd`
 * @param {Array<{ name: string, value: string }>} tokens the tokens of the stylesheet
 * @returns {Array<{ name: string, first: string, second: string }>}
 * @ai.hint pure
 */
export function designConflicts(design, tokens = []) {
    if (!design?.present) return [];
    return conflictsBetween(design.tokens, tokens);
}
