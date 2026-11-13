/**
 * @file src/inputs/tokens.js
 * @module inputs/tokens
 * @purpose Read `tokens.css`: the custom properties of the project and the rules around them.
 *
 *   The stylesheet of the tokens wins over the document and over the palette when they disagree:
 *   it is the file the project actually loads. The conflicts are not hidden — they are reported,
 *   and the stylesheet value is the one that is kept.
 *
 * @depends none
 * @usedBy inputs/index, stages/collect
 * @exports parseTokensCss, tokenValue, tokensToCss, cssConflicts
 * @ai.tags inputs, css, tokens
 * @ai.hint pure
 */

/**
 * Read the custom properties of a stylesheet.
 * @param {string} text
 * @returns {{ present: boolean, tokens: object[], selectors: object[], warnings: string[] }}
 * @exports
 * @ai.hint pure
 */
export function parseTokensCss(text) {
    const raw = String(text ?? '');
    if (!raw.trim()) return { present: false, tokens: [], selectors: [], warnings: [] };

    const warnings = [];
    const tokens = [];
    const selectors = [];
    const seen = new Set();

    // The declarations of a rule: `--name: value;` and the ordinary ones.
    const blockRe = /([^{}]+)\{([^{}]*)\}/g;
    let match = blockRe.exec(raw);
    while (match) {
        const selector = match[1].trim().replace(/\s+/g, ' ');
        const body = match[2];
        const properties = [];
        const declRe = /(--[a-zA-Z0-9_-]+|[a-zA-Z][a-zA-Z0-9-]*)\s*:\s*([^;]+);?/g;
        let decl = declRe.exec(body);
        while (decl) {
            properties.push({ name: decl[1], value: decl[2].trim(), custom: decl[1].startsWith('--') });
            decl = declRe.exec(body);
        }
        if (selector === ':root' || selector === 'html' || selector === ':root, html') {
            for (const property of properties) {
                if (!property.custom) continue;
                if (!seen.has(property.name)) {
                    seen.add(property.name);
                    tokens.push({ name: property.name, value: property.value, selector });
                } else {
                    const known = tokens.find((token) => token.name === property.name);
                    if (known && known.value !== property.value) {
                        warnings.push(`The token ${property.name} is declared twice: ${known.value} and ${property.value}.`);
                    }
                }
            }
        } else if (properties.length) {
            selectors.push({ selector, properties });
        }
        match = blockRe.exec(raw);
    }

    return { present: true, tokens, selectors, warnings };
}

/**
 * The value of one token.
 * @param {Array<{ name: string, value: string }>} tokens
 * @param {string} name
 * @returns {string|null}
 * @ai.hint pure
 */
export function tokenValue(tokens, name) {
    const found = (tokens ?? []).find((token) => token.name === name);
    return found?.value ?? null;
}

/**
 * The conflicts between the tokens of a stylesheet and another set of tokens.
 * @param {Array<{ name: string, value: string }>} tokens
 * @param {Array<{ name: string, value: string }>} other
 * @returns {Array<{ name: string, first: string, second: string }>}
 * @ai.hint pure
 */
export function cssConflicts(tokens, other) {
    const map = new Map();
    for (const token of tokens ?? []) map.set(token.name, token.value);
    const conflicts = [];
    for (const token of other ?? []) {
        const value = map.get(token.name);
        if (value === undefined) continue;
        if (String(value).trim() === String(token.value).trim()) continue;
        conflicts.push({ name: token.name, first: value, second: token.value });
    }
    return conflicts;
}

/**
 * Build a stylesheet of tokens.
 * @param {Array<{ name: string, value: string }>} tokens
 * @returns {string}
 * @exports
 * @ai.hint pure
 */
export function tokensToCss(tokens = []) {
    const lines = (tokens ?? [])
        .filter((token) => token?.name && token?.value)
        .map((token) => `  ${token.name}: ${token.value};`);
    return [':root {', ...lines, '}', ''].join('\n');
}
