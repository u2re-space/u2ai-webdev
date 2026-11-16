/**
 * @file src/roles/page-frame.js
 * @module roles/page-frame
 * @purpose The frame of the page: the canvas inside the body, the width of the design and the
 *          scale that fits the canvas into the window.
 *
 *   A reference may be an upscale of a narrower page, and the model cannot tell from the
 *   picture alone how wide the design really is: the API resizes the picture before the model
 *   sees it, and a picture of 2304 pixels may be a page of 1152 pixels blown up twice.
 *
 *   The page therefore carries its own width. The token `--real-page-width` says how wide the
 *   design is in CSS pixels, the canvas inside the body is laid out in that width, and the
 *   scale `--zoom` fits the canvas into the window: `100cqi` is the inline size of the body
 *   (the body is the container of the page), so the canvas takes the whole width of the
 *   window and the proportions of the design are kept. The picture decides the width once,
 *   the window decides the scale — and neither of them has to be right about the other.
 *
 * @depends none
 * @usedBy roles/markup, roles/styler, roles/architect
 * @exports PAGE_CLASS, PAGE_WIDTH_TOKEN, ZOOM_TOKEN, DEFAULT_PAGE_WIDTH, pageFrameRules,
 *          pageScaleRules, pageWidthNote
 * @ai.tags roles, css, layout, container
 * @ai.hint pure
 */

/** The class of the canvas: the element inside the body that the styles scale. */
export const PAGE_CLASS = 'page';

/** The token that holds the width of the design, in CSS pixels. */
export const PAGE_WIDTH_TOKEN = '--real-page-width';

/** The token that holds the scale of the canvas. */
export const ZOOM_TOKEN = '--zoom';

/** The width of the design when nobody decided it. */
export const DEFAULT_PAGE_WIDTH = '1024px';

/**
 * The rules of the frame of the page for the role that writes the markup.
 *
 * The markup carries the element and the class; the styles carry the width and the scale.
 * @returns {string}
 * @exports
 * @ai.hint pure
 */
export function pageFrameRules() {
    return `## The frame of the page
- The body holds one canvas element with the class \`${PAGE_CLASS}\`, and the whole page is
  inside it: the header, the main and the footer are its children. Nothing else is a child of
  the body but the script of the page.
- The canvas is the element the styles give the width of the design to
  (\`container-type: inline-size;\` and \`inline-size: var(${PAGE_WIDTH_TOKEN}, ${DEFAULT_PAGE_WIDTH});\`)
  and the scale that fits it into the window (\`zoom: var(${ZOOM_TOKEN}, 1);\`). The markup does
  not repeat these properties in a style attribute: it carries the element and the class the
  styles describe.
- The class \`${PAGE_CLASS}\` is a contract with the styles: it keeps its name, and the styles
  describe it.`;
}

/**
 * The rules of the frame of the page for the role that writes the styles.
 *
 * The body is the container of the page, the canvas is the width of the design, and the
 * scale is what fits the one into the other.
 * @returns {string}
 * @exports
 * @ai.hint pure
 */
export function pageScaleRules() {
    return `## The canvas of the page and the scale
- The body is the container of the page: \`container-type: size;\` on the \`body\`. A body with
  the size containment has no height of its own — it is given one:
  \`min-block-size: 100dvh;\`.
- The background of the page belongs to the canvas, not to the body: the body is as tall as
  the viewport, and the canvas is as tall as the content.
- The canvas of the page is the element with the class \`${PAGE_CLASS}\` inside the body:
  \`container-type: inline-size;\` and
  \`inline-size: var(${PAGE_WIDTH_TOKEN}, ${DEFAULT_PAGE_WIDTH});\`. The content of the page is
  laid out in the width of the design, not in the width of the window.
- The canvas is scaled into the window: \`${ZOOM_TOKEN}: calc(100cqi / var(${PAGE_WIDTH_TOKEN}, ${DEFAULT_PAGE_WIDTH}));\`
  in the theme layer, and \`zoom: var(${ZOOM_TOKEN}, 1);\` on the canvas. The \`100cqi\` is the
  inline size of the body — the nearest container of the canvas — so the canvas takes the
  whole width of the window, and the proportions of the design are kept.
- \`${PAGE_WIDTH_TOKEN}\` is the width the design really has, in CSS pixels, and it is a token
  of the theme layer. The width of the reference picture is not that width: the same design
  comes at 1152 pixels and at 2304 pixels. The width comes from the text — the body text of a
  page is 16..18 CSS pixels, the measurements of the reference give its size in the pixels of
  the picture, and the width of the picture divided by that number gives the width of the
  design.
- The narrow screen is not scaled: under the breakpoint of the narrow layout — the mobile one,
  not the width of the design — the canvas becomes fluid (\`inline-size: 100%; zoom: 1;\`) and
  the layout of the narrow screen takes over.`;
}

/**
 * The note about the width of the design, for the roles that look at the reference.
 *
 * The sizes of the reference are the numbers the model cannot see: the API has resized the
 * picture before it reached the model. An empty string when the sizes are not known — a role
 * without a picture is not told about a picture it cannot see.
 * @param {{ referenceSizes?: Array<{ path: string, width: number|null, height: number|null }> }} [context]
 * @returns {string}
 * @exports
 * @ai.hint pure
 */
export function pageWidthNote(context = {}) {
    const sizes = (Array.isArray(context?.referenceSizes) ? context.referenceSizes : [])
        .filter((item) => Number.isFinite(item?.width) && Number.isFinite(item?.height));
    if (!sizes.length) return '';
    return `The width of the design is not the width of the picture: a picture of 2000 pixels may
be an upscale of a page of 1440 pixels, and the same design comes at 1152 pixels and at 2304
pixels. The width of the design goes into the token \`${PAGE_WIDTH_TOKEN}\` — take it from the
text: the body text of a page is 16..18 CSS pixels, the measurements of the reference give its
size in the pixels of the picture, and the width of the picture divided by that number gives the
width of the design (a picture of 2304 pixels with a text of 32 pixels shows a page of about
1150 pixels).`;
}
