/**
 * @file src/roles/reference.js
 * @module roles/reference
 * @purpose The line that tells a role that the screenshot of the reference is attached.
 *
 *   The measurements say how wide a block is; the picture says how the page looks. A role
 *   that sees the reference writes the markup and the styles closer to the design.
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
 * An empty string when there is no reference: a role without a picture is not told about
 * a picture it cannot see.
 * @param {{ reference?: string[] }} [context]
 * @returns {string}
 * @exports
 * @ai.hint pure
 */
export function referenceNote(context = {}) {
    const names = (Array.isArray(context?.reference) ? context.reference : [])
        .map((item) => String(item ?? '').trim())
        .filter(Boolean);
    if (!names.length) return '';
    return [
        `The screenshot of the reference is attached to the request: ${names.join(', ')}.`,
        'Look at it before you write: the regions, the proportions, the colours and the',
        'spacing of the result come from that picture, not only from the measurements.',
    ].join(' ');
}
