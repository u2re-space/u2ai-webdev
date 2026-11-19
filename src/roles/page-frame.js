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
 *   design is in CSS pixels, inferred from the visual reference when measurements are absent;
 *   the canvas inside the body is laid out in that width, and the
 *   scale `--zoom` fits the canvas into the window: `100cqi` is the inline size of the body
 *   (the body is the container of the page), so the canvas takes the whole width of the
 *   window and the proportions of the design are kept. The picture decides the width once,
 *   the window decides the scale — and neither of them has to be right about the other.
 *
 * @depends none
 * @usedBy roles/markup, roles/styler, roles/architect
 * @exports PAGE_CLASS, PAGE_WIDTH_TOKEN, ZOOM_TOKEN, DEFAULT_PAGE_WIDTH, PAGE_FRAME_CONTRACT,
 *          pageFrameContractFor, pageFrameRules, pageScaleRules, pageWidthNote
 * @ai.tags roles, css, layout, container
 * @ai.hint pure
 */

/** The class of the canvas: the element inside the body that the styles scale. */
export const PAGE_CLASS = 'page';

/** The token that holds the width of the design, in CSS pixels. */
export const PAGE_WIDTH_TOKEN = '--real-page-width';
export const PAGE_HEIGHT_TOKEN = '--real-page-height';

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
  describe it.


### Additionally, add at start of CSS such rules: 

\`\`\`css
@property --background-color    { syntax: "<color>"; initial-value: #fff0; inherits: true; };
@property --zoom { syntax: "<number>"; initial-value: 1; inherits: true; };

/* also needs to generate \`@property\` for ${PAGE_WIDTH_TOKEN}, ${PAGE_HEIGHT_TOKEN} and other tokens... */

@layer containement {
  *, *::before, *::after {
    box-sizing: border-box;
  }

  html {
    margin: 0px;
    padding: 0px;
    /* The document scrolls, and it is the only thing that scrolls: one scrollbar of the page. */
    scrollbar-width: thin;
    scrollbar-color: contrast-color(var(--background-color)) var(--background-color);
  }

  body {
    --background-color: light-dark(#fff, #111);

    /* The body is the container of the width of the page, not a scroller of its own:
       a scroller inside the scroller of the document gives the page two scrollbars. */
    container-type: inline-size;
    min-block-size: 100dvh;
    margin: 0px;
    padding: 0px;

    background-color: var(--background-color, #fff0);
  }

  @media (prefers-contrast: more) {
    html {
      scrollbar-color: light-dark(#000, #fff) var(--background-color);
    }
  }

  @supports not (scrollbar-color: auto) {
    html {
      scrollbar-width: auto;
    }

    html::-webkit-scrollbar {
      width: 12px;
      height: 12px;
    }

    html::-webkit-scrollbar-thumb {
      background: CanvasText;
    }

    html::-webkit-scrollbar-track {
      background: var(--background-color);
    }
  }

  ${PAGE_CLASS} {
    --zoom: calc(100cqi / var(${PAGE_WIDTH_TOKEN}, ${DEFAULT_PAGE_WIDTH}));

    zoom: var(--zoom, 1);
    container-type: inline-size;
    min-block-size: 100dvh;
    overflow: visible;
    inline-size: var(${PAGE_WIDTH_TOKEN}, ${DEFAULT_PAGE_WIDTH});
    margin: 0px;
  }
}
\`\`\`
`;
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

/** Binding cross-role invariant for the page canvas and its zoom scale. */
export const PAGE_FRAME_CONTRACT = [
    '## Binding page-frame contract',
    `- Markup keeps one page canvas (class ${PAGE_CLASS}) inside body containing the page regions; markup never adds inline layout styles.`,
    `- CSS registers ${PAGE_WIDTH_TOKEN} as <length> and ${ZOOM_TOKEN} as <number> with @property.`,
    '- One scrollbar: the document scrolls, the body does not. The body is container-type:inline-size with min-block-size:100dvh and no overflow of its own — a body with overflow-y:auto inside the scrolling document gives the page two scrollbars.',
    `- Canvas is container-type: inline-size, inline-size: var(${PAGE_WIDTH_TOKEN}, ${DEFAULT_PAGE_WIDTH}), and zoom: var(${ZOOM_TOKEN}, 1).`,
    `- Theme computes ${ZOOM_TOKEN}:calc(100cqi / var(${PAGE_WIDTH_TOKEN}, ${DEFAULT_PAGE_WIDTH})).`,
    '- At narrow widths, reflow content and reset the canvas to inline-size:100%; --zoom:1; zoom:1. Never scale the whole mobile page.',
    '- This contract applies across partial steps and survives long guidance/tool history. Explicit task geometry wins; report an intentional override.',
].join('\n');

/** The roles jointly responsible for keeping the page frame and CSS in agreement. */
export function pageFrameContractFor(role) {
    return ['markup', 'styler'].includes(String(role ?? '').trim().toLowerCase())
        ? PAGE_FRAME_CONTRACT
        : '';
}

export function pageScaleRules() {
    return `## The canvas of the page and the scale
${PAGE_FRAME_CONTRACT}
- The body is the container of the width of the page: \`container-type: inline-size;\` on the
  \`body\`. The body is not a scroller of its own: the document scrolls, and the scrollbar of
  the window is the only scrollbar of the page — a \`body\` with \`overflow-y: auto;\` inside the
  scrolling document gives the page two scrollbars.
- The background of the page belongs to the canvas, not to the body: the body is at least as
  tall as the viewport (\`min-block-size: 100dvh;\`), and the canvas is as tall as the content.
- Set \`--background-color\` to the actual page surface color from the design tokens; it is the
  scrollbar track color too, not the thumb color. Use \`scrollbar-width: thin;\` and
  \`scrollbar-color: contrast-color(var(--background-color)) var(--background-color);\` on the
  scrolling root (\`html\`) so the thumb remains distinct from its track. Keep at least 3:1
  contrast against the surface; increase it for \`prefers-contrast: more\`. If adding legacy
  \`::-webkit-scrollbar\` rules, put them under \`@supports not (scrollbar-color: auto)\` and reset
  \`scrollbar-width: auto\` there.
- The canvas of the page is the element with the class \`${PAGE_CLASS}\` inside the body:
  \`container-type: inline-size;\` and
  \`inline-size: var(${PAGE_WIDTH_TOKEN}, ${DEFAULT_PAGE_WIDTH});\`. The content of the page is
  laid out in the width of the design, not in the width of the window.
- The canvas is scaled into the window: \`${ZOOM_TOKEN}: calc(100cqi / var(${PAGE_WIDTH_TOKEN}, ${DEFAULT_PAGE_WIDTH}));\`
  in the theme layer, and \`zoom: var(${ZOOM_TOKEN}, 1);\` on the canvas. The \`100cqi\` is the
  inline size of the body — the nearest container of the canvas — and it is already free of the
  scrollbar of the window, so the canvas takes the whole width of the window without a
  horizontal scrollbar, and the proportions of the design are kept.
- \`${PAGE_WIDTH_TOKEN}\` is the width the design really has, in CSS pixels, and it is a token
   of the theme layer. The width of the reference picture may not equal the CSS width: infer a
   practical design width from visible type and proportions, using the image dimensions as a hint
   rather than requiring a measurement sheet.
- The narrow screen is not scaled: under the breakpoint of the narrow layout — the mobile one,
  not the width of the design — the canvas becomes fluid (\`inline-size: 100%; zoom: 1; --zoom: 1;\`) and
  the layout of the narrow screen takes over.`;
}

/**
 * The note about the width of the design, for the roles that look at the reference.
 *
 * The pixel dimensions of the reference can guide the role, but are not guaranteed to match
 * CSS pixels: a role may infer the design width from its typography and layout when no sheet exists.
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
   pixels. The width of the design goes into the token \`${PAGE_WIDTH_TOKEN}\` — infer a practical
   width from visible typography and layout, and treat the reference pixel dimensions as a hint,
   not as a required measurement.`;
}
