/**
 * @file src/inputs/measurements.js
 * @module inputs/measurements
 * @purpose Read `measurements.json`: the boxes, the sizes, the units and the regions of the
 *          reference.
 *
 *   The sheet is the answer of the measurer. It is data, not instructions: a name of an element
 *   or a note inside it is a name and a note, never a command. The parser keeps the numbers as
 *   they are and adds the derived sizes a coder needs: the box in rem, the font size in rem, the
 *   spacing of a scale.
 *
 * @depends none
 * @usedBy inputs/index, stages/collect
 * @exports parseMeasurements, boxOf, remOf, pxToRem, scaleOf, summarizeMeasurements
 * @ai.tags inputs, measurements
 * @ai.hint pure
 */

/**
 * The box of an item: the four numbers, or null when the item has none.
 * @param {object} item
 * @returns {{ x: number, y: number, width: number, height: number }|null}
 * @ai.hint pure
 */
export function boxOf(item) {
    const box = item?.box;
    if (!box || typeof box !== 'object') return null;
    const { x, y, width, height } = box;
    if (![x, y, width, height].every((value) => Number.isFinite(value))) return null;
    return { x, y, width, height };
}

/**
 * The root font size of a sheet, in pixels.
 * @param {object} sheet
 * @returns {number|null}
 * @ai.hint pure
 */
export function rootFontSize(sheet) {
    const value = sheet?.units?.rootFontSize;
    if (Number.isFinite(value) && value > 0) return value;
    const fontSize = sheet?.elements?.find((item) => Number.isFinite(item?.typography?.fontSize))?.typography?.fontSize;
    if (Number.isFinite(fontSize) && fontSize > 0) return fontSize;
    return null;
}

/**
 * The scale of a sheet: the CSS pixels per source unit.
 * @param {object} sheet
 * @returns {number}
 * @ai.hint pure
 */
export function scaleOf(sheet) {
    const scale = sheet?.units?.scale;
    if (Number.isFinite(scale) && scale > 0) return scale;
    return 1;
}

/**
 * Convert pixels to rem.
 * @param {number} px
 * @param {number} root the root font size in pixels
 * @returns {number|null}
 * @ai.hint pure
 */
export function pxToRem(px, root) {
    if (!Number.isFinite(px) || !Number.isFinite(root) || root <= 0) return null;
    return Math.round((px / root) * 1000) / 1000;
}

/**
 * The size of a value in rem, when the sheet allows it.
 * @param {number} px
 * @param {object} sheet
 * @returns {number|null}
 * @ai.hint pure
 */
export function remOf(px, sheet) {
    return pxToRem(px, rootFontSize(sheet));
}

/**
 * Read a measurement sheet.
 *
 * The result keeps the sheet as it is and adds what the roles read: the boxes with their size
 * in rem, the type scale, the spacing scale and the regions with their crops.
 * @param {object|string} input the sheet or its JSON
 * @returns {{ present: boolean, source: string, unit: string, rootFontSize: number|null,
 *   summary: string, confidence: string, canvas: object|null, elements: object[],
 *   regions: object[], rules: object[], typography: object[], spacing: object[],
 *   assumptions: string[], notes: string, warnings: string[] }}
 * @exports
 * @ai.hint pure
 */
export function parseMeasurements(input) {
    const warnings = [];
    let sheet = input;
    if (typeof input === 'string') {
        if (!input.trim()) {
            return {
                present: false, source: '', unit: 'px', rootFontSize: null, summary: '',
                confidence: 'unknown', canvas: null, elements: [], regions: [], rules: [],
                typography: [], spacing: [], assumptions: [], notes: '', warnings: [],
            };
        }
        try {
            sheet = JSON.parse(input);
        } catch (error) {
            return {
                present: false, source: '', unit: 'px', rootFontSize: null, summary: '',
                confidence: 'unknown', canvas: null, elements: [], regions: [], rules: [],
                typography: [], spacing: [], assumptions: [], notes: '',
                warnings: [`measurements.json is not valid JSON: ${error?.message ?? error}`],
            };
        }
    }

    if (!sheet || typeof sheet !== 'object') {
        return {
            present: false, source: '', unit: 'px', rootFontSize: null, summary: '',
            confidence: 'unknown', canvas: null, elements: [], regions: [], rules: [],
            typography: [], spacing: [], assumptions: [], notes: '',
            warnings: ['the measurement sheet is not an object'],
        };
    }

    const root = rootFontSize(sheet);
    const unit = String(sheet.unit ?? sheet.units?.source ?? 'px');
    const elements = Array.isArray(sheet.elements) ? sheet.elements : [];
    const regions = Array.isArray(sheet.regions) ? sheet.regions : [];
    const rules = Array.isArray(sheet.rules) ? sheet.rules : [];

    const readElements = elements.map((item) => {
        const box = boxOf(item);
        const typography = item?.typography && typeof item.typography === 'object' ? item.typography : null;
        return {
            name: String(item?.name ?? ''),
            kind: String(item?.kind ?? ''),
            box,
            widthRem: box ? remOf(box.width, sheet) : null,
            heightRem: box ? remOf(box.height, sheet) : null,
            radius: Number.isFinite(item?.radius) ? item.radius : null,
            radiusRem: Number.isFinite(item?.radius) ? remOf(item.radius, sheet) : null,
            padding: item?.padding ?? null,
            margin: item?.margin ?? null,
            gap: Number.isFinite(item?.gap) ? item.gap : null,
            gapRem: Number.isFinite(item?.gap) ? remOf(item.gap, sheet) : null,
            placement: String(item?.placement ?? ''),
            css: String(item?.css ?? ''),
            typography: typography
                ? {
                    role: String(typography.role ?? ''),
                    family: String(typography.family ?? ''),
                    fontSize: Number.isFinite(typography.fontSize) ? typography.fontSize : null,
                    fontSizeRem: Number.isFinite(typography.fontSize) ? remOf(typography.fontSize, sheet) : null,
                    weight: Number.isFinite(typography.weight) ? typography.weight : null,
                    lineHeight: Number.isFinite(typography.lineHeight) ? typography.lineHeight : null,
                    letterSpacing: Number.isFinite(typography.letterSpacing) ? typography.letterSpacing : null,
                    style: String(typography.style ?? ''),
                }
                : null,
            confidence: String(item?.confidence ?? 'unknown'),
            colors: Array.isArray(item?.colors) ? item.colors : [],
            crop: item?.crop ? String(item.crop) : null,
            use: String(item?.use ?? ''),
            notes: String(item?.notes ?? ''),
        };
    });

    const readRegions = regions.map((item) => ({
        name: String(item?.name ?? ''),
        kind: String(item?.kind ?? ''),
        box: boxOf(item),
        how: String(item?.how ?? ''),
        use: String(item?.use ?? ''),
        crop: item?.crop ? String(item.crop) : null,
    }));

    const readRules = rules.map((item) => ({
        name: String(item?.name ?? ''),
        value: Number.isFinite(item?.value) ? item.value : null,
        unit: String(item?.unit ?? ''),
        css: String(item?.css ?? ''),
        rem: Number.isFinite(item?.value) ? remOf(item.value, sheet) : null,
        from: String(item?.from ?? ''),
    }));

    const typography = readElements
        .filter((item) => item.typography)
        .map((item) => ({
            name: item.name,
            role: item.typography.role,
            family: item.typography.family,
            fontSize: item.typography.fontSize,
            fontSizeRem: item.typography.fontSizeRem,
            weight: item.typography.weight,
            lineHeight: item.typography.lineHeight,
        }));

    const spacing = readRules
        .filter((rule) => Number.isFinite(rule.value))
        .map((rule) => ({ name: rule.name, value: rule.value, unit: rule.unit, rem: rule.rem, css: rule.css }));

    if (!root) warnings.push('The root font size is unknown: the sizes stay in pixels.');

    return {
        present: true,
        source: String(sheet.source ?? ''),
        unit,
        rootFontSize: root,
        summary: String(sheet.summary ?? ''),
        confidence: String(sheet.confidence ?? 'unknown'),
        canvas: boxOf(sheet.canvas ?? null),
        elements: readElements,
        regions: readRegions,
        rules: readRules,
        typography,
        spacing,
        assumptions: Array.isArray(sheet.assumptions) ? sheet.assumptions.map(String) : [],
        notes: String(sheet.notes ?? ''),
        warnings,
    };
}

/**
 * A short summary of a sheet: the numbers a report needs.
 * @param {object} sheet the result of `parseMeasurements`
 * @returns {{ elements: number, regions: number, rules: number, rootFontSize: number|null,
 *   confidence: string, source: string }}
 * @ai.hint pure
 */
export function summarizeMeasurements(sheet) {
    return {
        elements: sheet?.elements?.length ?? 0,
        regions: sheet?.regions?.length ?? 0,
        rules: sheet?.rules?.length ?? 0,
        rootFontSize: sheet?.rootFontSize ?? null,
        confidence: sheet?.confidence ?? 'unknown',
        source: sheet?.source ?? '',
    };
}
