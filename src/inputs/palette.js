/**
 * @file src/inputs/palette.js
 * @module inputs/palette
 * @purpose Read `palette.json`: the colours of the reference with their hex, their OKLCH and
 *          their notes.
 *
 *   The palette is what the measurer read off the pixels. A colour that was only perceived is
 *   marked as such, and the confidence travels with the colour: a role that picks a token knows
 *   how sure the value is.
 *
 * @depends none
 * @usedBy inputs/index, stages/collect
 * @exports parsePalette, paletteTokens, contrastOf, relativeLuminance, contrastRatio
 * @ai.tags inputs, palette, colours
 * @ai.hint pure
 */

/**
 * The relative luminance of a hex colour, by the WCAG formula.
 * @param {string} hex
 * @returns {number|null} 0..1, or null when the colour cannot be read
 * @ai.hint pure
 */
export function relativeLuminance(hex) {
    const match = String(hex ?? '').match(/^#?([0-9a-fA-F]{6})$/);
    if (!match) return null;
    const value = Number.parseInt(match[1], 16);
    const channel = (byte) => {
        const part = byte / 255;
        return part <= 0.03928 ? part / 12.92 : ((part + 0.055) / 1.055) ** 2.4;
    };
    const red = channel((value >> 16) & 0xff);
    const green = channel((value >> 8) & 0xff);
    const blue = channel(value & 0xff);
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

/**
 * The contrast ratio of two hex colours.
 * @param {string} first
 * @param {string} second
 * @returns {number|null} 1..21, or null when one of the colours cannot be read
 * @ai.hint pure
 */
export function contrastRatio(first, second) {
    const a = relativeLuminance(first);
    const b = relativeLuminance(second);
    if (a === null || b === null) return null;
    const light = Math.max(a, b);
    const dark = Math.min(a, b);
    return Math.round(((light + 0.05) / (dark + 0.05)) * 100) / 100;
}

/**
 * The contrast of a colour with the background of the palette.
 * @param {object} palette
 * @param {object} color
 * @returns {number|null}
 * @ai.hint pure
 */
export function contrastOf(palette, color) {
    const background = palette?.background ?? color?.background ?? null;
    if (!background || !color?.hex) return null;
    return contrastRatio(background, color.hex);
}

/**
 * Read a palette file.
 * @param {object|string} input the palette or its JSON
 * @returns {{ present: boolean, name: string, source: string, background: string|null,
 *   text: string|null, accent: string|null, colors: object[], notes: string, warnings: string[] }}
 * @exports
 * @ai.hint pure
 */
export function parsePalette(input) {
    const warnings = [];
    let palette = input;
    if (typeof input === 'string') {
        if (!input.trim()) {
            return {
                present: false, name: '', source: '', background: null, text: null, accent: null,
                colors: [], notes: '', warnings: [],
            };
        }
        try {
            palette = JSON.parse(input);
        } catch (error) {
            return {
                present: false, name: '', source: '', background: null, text: null, accent: null,
                colors: [], notes: '',
                warnings: [`palette.json is not valid JSON: ${error?.message ?? error}`],
            };
        }
    }
    if (!palette || typeof palette !== 'object') {
        return {
            present: false, name: '', source: '', background: null, text: null, accent: null,
            colors: [], notes: '', warnings: ['the palette is not an object'],
        };
    }

    const list = Array.isArray(palette.colors) ? palette.colors : [];
    const background = palette.background ?? null;
    const colors = list.map((item) => {
        const hex = String(item?.hex ?? '');
        const contrast = contrastRatio(background, hex);
        if (hex && contrast !== null && contrast < 3) {
            warnings.push(`The colour ${item?.token ?? item?.name ?? hex} has a contrast of ${contrast}:1 on the background.`);
        }
        return {
            name: String(item?.name ?? ''),
            token: String(item?.token ?? ''),
            hex,
            oklch: String(item?.oklch ?? ''),
            hsl: String(item?.hsl ?? ''),
            rgb: String(item?.rgb ?? ''),
            luminance: Number.isFinite(item?.luminance) ? item.luminance : null,
            share: Number.isFinite(item?.share) ? item.share : null,
            method: String(item?.method ?? ''),
            confidence: String(item?.confidence ?? 'unknown'),
            source: item?.source ?? null,
            notes: String(item?.notes ?? ''),
            contrast,
        };
    });

    return {
        present: true,
        name: String(palette.name ?? ''),
        source: String(palette.source ?? ''),
        background: background ? String(background) : null,
        text: palette.text ? String(palette.text) : null,
        accent: palette.accent ? String(palette.accent) : null,
        colors,
        notes: String(palette.notes ?? ''),
        warnings,
    };
}

/**
 * The CSS custom properties of a palette.
 * @param {object} palette the result of `parsePalette`
 * @returns {Array<{ name: string, value: string }>}
 * @exports
 * @ai.hint pure
 */
export function paletteTokens(palette) {
    const tokens = [];
    const seen = new Set();
    const add = (name, value) => {
        const clean = String(name ?? '').trim();
        const text = String(value ?? '').trim();
        if (!clean || !text || seen.has(clean)) return;
        seen.add(clean);
        tokens.push({ name: clean, value: text });
    };
    for (const color of palette?.colors ?? []) {
        if (!color.hex) continue;
        add(color.token || `--color-${(color.name || 'color').toLowerCase().replace(/\s+/g, '-')}`, color.hex);
    }
    if (palette?.background) add('--color-background', palette.background);
    if (palette?.text) add('--color-text', palette.text);
    if (palette?.accent) add('--color-accent', palette.accent);
    return tokens;
}
