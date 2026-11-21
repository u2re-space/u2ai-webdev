/**
 * @file src/vector/svg.js
 * @module vector/svg
 * @purpose The vector graphics as code: the check of an SVG and its tidying.
 *
 *   This package has no picture generator and no raster editor: the vector graphics are
 *   edited as text. That means the code must be able to tell a broken SVG from a good one
 *   and to bring a good one to a clean state — without a raster step and without a library.
 *
 *   The checks are the ones a browser cares about: the root tag, the namespace, the view box,
 *   the balanced tags, the scripts and the external references.
 *
 * @depends none
 * @usedBy stages/vector, stages/iconify
 * @exports SVG_TAGS, svgFileName, parseSvg, validateSvg, optimizeSvg, svgSummary
 * @ai.tags vector, svg
 * @ai.hint pure
 * @ai.hint legacy-0.2
 * @changed 2026-11-13 Ported from the monolith: the vector graphics are checked as code.
 */

/** The elements that carry the drawing. */
export const SVG_TAGS = Object.freeze([
    'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon',
    'g', 'defs', 'use', 'symbol', 'title', 'desc', 'text', 'tspan',
]);

/**
 * The file name of an icon or of a picture: a kebab-case name with the `.svg` extension.
 * @param {string} name
 * @returns {string}
 * @exports
 * @ai.hint pure
 */
export function svgFileName(name) {
    const text = String(name ?? '').trim().toLowerCase();
    const kebab = text
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    return `${kebab || 'graphic'}.svg`;
}

/**
 * The elements of a markup, in the order they appear.
 * @param {string} text
 * @returns {{ name: string, closing: boolean, selfClosing: boolean }[]}
 * @ai.hint pure
 */
function elementsOf(text) {
    const out = [];
    const re = /<\s*(\/?)\s*([a-zA-Z][\w:-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)\s*>/g;
    let match = re.exec(text);
    while (match) {
        const closing = match[1] === '/';
        const selfClosing = match[4] === '/';
        const name = match[2];
        if (!closing && name.toLowerCase() === '!doctype') {
            match = re.exec(text);
            continue;
        }
        out.push({ name, closing, selfClosing });
        match = re.exec(text);
    }
    return out;
}

/**
 * The text without the comments and the CDATA sections.
 *
 * The comment is prose, not markup: an element name inside it — a `<use>` in a
 * sentence about `<use>` — is not an element of the drawing. The stack of the tags
 * sees only the real ones.
 * @param {string} text
 * @returns {string}
 * @ai.hint pure
 */
function withoutComments(text) {
    return String(text ?? '')
        .replace(/<!--[\s\S]*?-->/g, ' ')
        .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, ' ');
}

/**
 * Read the parts of an SVG that matter: the root tag, its attributes and the elements.
 * @param {string} text
 * @returns {{ ok: boolean, root: string|null, attributes: Record<string, string>,
 *   viewBox: string|null, width: string|null, height: string|null, elements: object[],
 *   errors: string[] }}
 * @exports
 * @ai.hint pure
 */
export function parseSvg(text) {
    const source = String(text ?? '');
    const errors = [];
    const rootMatch = source.match(/<svg\b([^>]*)>/i);
    if (!rootMatch) {
        return {
            ok: false,
            root: null,
            attributes: {},
            viewBox: null,
            width: null,
            height: null,
            elements: [],
            errors: ['The root tag <svg> was not found.'],
        };
    }

    const attributes = {};
    const re = /([\w:-]+)\s*=\s*"([^"]*)"|([\w:-]+)\s*=\s*'([^']*)'/g;
    let match = re.exec(rootMatch[1]);
    while (match) {
        const name = match[1] ?? match[3];
        const value = match[2] ?? match[4] ?? '';
        attributes[name] = value;
        match = re.exec(rootMatch[1]);
    }

    const elements = elementsOf(withoutComments(source));
    const stack = [];
    for (const element of elements) {
        const name = element.name.toLowerCase();
        if (name === '!doctype' || name === '?xml') continue;
        if (element.closing) {
            const open = stack.pop();
            if (!open) errors.push(`The tag </${element.name}> has no opening tag.`);
            else if (open !== name) errors.push(`The tag </${element.name}> closes <${open}>.`);
            continue;
        }
        if (!element.selfClosing) stack.push(name);
    }
    for (const open of stack) errors.push(`The tag <${open}> is not closed.`);

    return {
        ok: errors.length === 0,
        root: 'svg',
        attributes,
        viewBox: attributes.viewBox ?? null,
        width: attributes.width ?? null,
        height: attributes.height ?? null,
        elements,
        errors,
    };
}

/**
 * Check an SVG: the things that make a browser refuse it or show it wrong.
 * @param {string} text
 * @returns {{ ok: boolean, errors: string[], warnings: string[] }}
 * @exports
 * @ai.hint pure
 */
export function validateSvg(text) {
    const source = String(text ?? '');
    const errors = [];
    const warnings = [];
    const parsed = parseSvg(source);

    errors.push(...parsed.errors);
    if (!parsed.root) return { ok: false, errors, warnings };

    if (!parsed.attributes.xmlns) errors.push('The namespace xmlns is missing.');
    if (!parsed.viewBox) {
        if (!parsed.width || !parsed.height) errors.push('Neither the viewBox nor the width and the height are given.');
        else warnings.push('The viewBox is missing: the picture does not scale.');
    }
    if (/<script\b/i.test(source)) errors.push('The SVG has a script: a picture on the web does not need one.');
    if (/xlink:href\s*=\s*["']\s*(?:https?:)?\/\//i.test(source) || /\shref\s*=\s*["']\s*(?:https?:)?\/\//i.test(source)) {
        warnings.push('The SVG refers to an outside resource: it will not work offline.');
    }
    const fixed = /\s(?:width|height)\s*=\s*["']\d+["']/.test(source.match(/<svg\b[^>]*>/i)?.[0] ?? '');
    if (fixed) {
        warnings.push('The SVG has a fixed width and height: the size should come from the stylesheet.');
    }

    const drawings = parsed.elements.filter((element) => SVG_TAGS.includes(element.name.toLowerCase())).length;
    if (!drawings) errors.push('The SVG has nothing to draw.');

    return { ok: errors.length === 0, errors, warnings };
}

/**
 * Bring an SVG to a clean state: no comments, no metadata, no empty groups, no spaces
 * between the tags.
 *
 * The drawing is not touched: the paths, the coordinates and the attributes stay as they are.
 * @param {string} text
 * @param {{ collapse?: boolean }} [options]
 * @returns {string}
 * @exports
 * @ai.hint pure
 */
export function optimizeSvg(text, { collapse = true } = {}) {
    let out = String(text ?? '');
    out = out.replace(/<\?xml[\s\S]*?\?>/gi, '');
    out = out.replace(/<!--[\s\S]*?-->/g, '');
    out = out.replace(/<metadata\b[^>]*>[\s\S]*?<\/metadata>/gi, '');
    out = out.replace(/<metadata\b[^>]*\/>/gi, '');
    out = out.replace(/<g\b([^>]*)\>\s*<\/g>/gi, '<g$1/>');
    if (collapse) out = out.replace(/>\s+</g, '><');
    out = out.replace(/\s{2,}/g, ' ').trim();
    return out;
}

/**
 * A short report of an SVG: the size, the view box and the number of the elements.
 * @param {string} text
 * @returns {{ ok: boolean, bytes: number, viewBox: string|null, elements: number,
 *   errors: string[], warnings: string[] }}
 * @exports
 * @ai.hint pure
 */
export function svgSummary(text) {
    const parsed = parseSvg(text);
    const check = validateSvg(text);
    return {
        ok: check.ok,
        bytes: Buffer.byteLength(String(text ?? ''), 'utf8'),
        viewBox: parsed.viewBox,
        elements: parsed.elements.length,
        errors: check.errors,
        warnings: check.warnings,
    };
}
