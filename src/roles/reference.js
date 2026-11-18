/**
 * @file src/roles/reference.js
 * @module roles/reference
 * @purpose The line that tells a role that the screenshot of the reference is attached.
 *
 *   The measurements may say how wide a block is; the picture says how the page looks. A role
 *   can work from the screenshot directly when no measurement sheet exists.
 *
 * @usedBy roles/markup, roles/styler, roles/coder, roles/iconifier, roles/editor,
 *         roles/reviewer
 * @exports referenceNote
 * @ai.tags roles, reference
 * @ai.hint pure
 */

/**
 * The note about the attached reference.
 *
 * The size of the picture in pixels comes with it: the model sees the picture the API has
 * resized, and the numbers are what tells it how wide the reference is.
 *
 * An empty string when there is no reference: a role without a picture is not told about
 * a picture it cannot see.
 * @param {{ reference?: string[], referenceSizes?: Array<{ path: string, width: number|null, height: number|null }> }} [context]
 * @returns {string}
 * @exports
 * @ai.hint pure
 */
export function referenceNote(context = {}) {
    const names = (Array.isArray(context?.reference) ? context.reference : [])
        .map((item) => String(item ?? '').trim())
        .filter(Boolean);
    if (!names.length) return '';
    const sizes = new Map((Array.isArray(context?.referenceSizes) ? context.referenceSizes : [])
        .map((item) => [String(item?.path ?? '').trim(), item]));
    const list = names.map((name) => {
        const size = sizes.get(name);
        const dim = size?.width && size?.height ? ` (${size.width}×${size.height} pixels)` : '';
        return `${name}${dim}`;
    });
    return [
        `The screenshot of the reference is attached to the request: ${list.join(', ')}.`,
        'Look at it before you write: the regions, the proportions, the colours and the',
        'spacing of the result come from that picture. Measurements are optional: infer what is',
        'needed from the visual reference and DESIGN.md.',
    ].join(' ');
}
