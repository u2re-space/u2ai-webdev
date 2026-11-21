/**
 * @file src/roles/web-development.js
 * @module roles/web-development
 * @purpose The standard of the frontend work: the rules the markup, the code and the styles
 *          have to follow.
 *
 *   The standard came from the monolith, where one text went into the prompt of the coder
 *   and of the styler. Here it is one module with three parts: the rules that hold for every
 *   file, the rules of the markup and the rules of the styles. A role gets the parts that
 *   concern its craft and not the whole book.
 *
 *   The text is the standard of today and not the standard of the day before yesterday: the
 *   cascade is held by the layers and not by the specificity, the rules of a block live in a
 *   nesting and not in a flat list of selectors, the reset names the elements and not `*`,
 *   and the component asks the space it is given with a container query and not with the
 *   width of the window.
 *
 * @depends none
 * @usedBy roles/markup, roles/coder, roles/styler
 * @exports CORE, HTML, CSS, WEB_DEVELOPMENT, webDevelopment
 * @ai.tags roles, html, css, standard
 * @ai.hint pure
 * @changed 2026-11-15 Ported from the monolith and brought up to date: layers, nesting.
 * @changed 2026-11-21 The parts of the standard are exported: the craft of a role takes the
 *                       part that concerns it and brings it at the write gate.
 */

/** The rules that hold for every file of the frontend. */
export const CORE = `### The rules that hold for every file
1. **The file is finished.** No \`<!-- add more items here -->\`, no \`/* rest of the styles */\`,
   no function that only says what its comment says. A file that cannot be finished is not
   written: say in the report what is missing and what is left to do.
2. **The files are separate.** The markup, the styles and the scripts live in their own files,
   and the page links them: \`<link rel="stylesheet" href="...">\` in the head and
   \`<script type="module" src="...">\` in the body. One file is right only when the project
   is one file.
3. **No framework that was not asked for.** No CSS framework (Tailwind, Bootstrap) and no
   icon library of your own: the icons come from the set the project chose, or they are an
   inline SVG.
4. **The names say what the thing is.** The class names, the variables and the functions name
   the part they describe (\`card__title\`, not \`blue-text\`). The comments say why, not what.
5. **The platform of today, not the draft of tomorrow.** The features that the browsers of the
   project run by default are allowed: the native nesting, the cascade layers, \`:has()\`, the
   container queries, the subgrid, \`color-mix()\`, \`oklch()\`, \`light-dark()\`, the view
   transitions, the \`popover\`, the \`dialog\`, \`text-wrap: balance\` and the dynamic viewport
   units. The features that are behind a flag, behind an origin trial or only in a draft are
   not used: the documentation of the platform describes those experiments too, and an
   experiment is not a feature. When the support of a feature is in doubt, look it up with the
   \`web_guidance\` tool before you rely on it.

### Before writing
Plan it silently, and then write the whole file at once:
1. the visual hierarchy, the palette and the type scale;
2. the semantic structure of the document;
3. the grid of the page and the breakpoints;
4. the states of the controls: hover, focus-visible, active, disabled;
5. the layer and the file that every rule goes into.`;

/** The rules of the markup. */
export const HTML = `### The rules of the markup
- **Semantic HTML5.** \`<header>\`, \`<nav>\`, \`<main>\`, \`<section>\`, \`<article>\`, \`<aside>\`,
  \`<footer>\` — one \`<main>\` per page, and no \`<div>\` where an element carries the
  meaning.
- **The boilerplate of the document.** \`<!DOCTYPE html>\`, \`<html lang="...">\`,
  \`<meta charset="UTF-8">\`, \`<meta name="viewport" content="width=device-width, initial-scale=1.0">\`.
- **The headings** form one tree, from \`<h1>\` down, without a skipped level.
- **Accessibility (WCAG AA).** An \`alt\` on every image (an empty one for a decorative picture),
  a \`<label for>\` on every field, an \`aria-label\` on a control without a visible name,
  \`aria-expanded\` on a disclosure, \`aria-current\` on the active item of a menu. ARIA fills a
  gap that the elements cannot fill; it is not a habit.
- **The focus is visible.** \`:focus-visible\` with an outline of 2px and an offset. Never
  \`outline: none\`.
- **The class names are a contract with the styles.** A class that the stylesheet describes
  keeps its name: the markup is not renamed under the styles.`;

/** The rules of the styles. */
export const CSS = `### The rules of the styles

#### The cascade is held by the layers, not by the specificity
- The stylesheet declares its layers once, at the top, in the order of the priority:
  \`@layer reset, base, theme, layout, components, utilities;\`. A rule of a later layer wins
  over a rule of an earlier one whatever the specificity is — the specificity stops being the
  tool that decides the winner.
- Every rule belongs to a layer: the reset, the base (the elements), the theme (the tokens),
  the layout, the components, the utilities. A rule outside a layer lands in the last layer
  and wins everything; that is a bug, not a shortcut.
- The tokens live in \`@layer theme\` on \`:root\`: the colours, the type scale, the spacing,
  the radii, the shadows, the durations. A rule names a token, never a raw value. A shade of
  a token comes from \`color-mix(in oklch, ...)\`, not from a second hex.
- A default that has to lose uses \`:where()\`: \`:where(.button)\` has no specificity, so any
  rule of the component beats it.

#### The rules of a block live in a nesting
- The native nesting groups the rules that belong to each other: the states of a control live
  inside the rule of the control (\`&:hover\`, \`&:focus-visible\`), the parts of a block live
  inside the block (\`&__title\`).
- The nesting is not a way to shorten a selector: the name of the parent stays in the
  selector, and the nesting goes deeper only where the relation is real.

#### The selector says the intent
- \`:not(:last-child)\` instead of a rule that cancels the rule before it.
- \`:is()\` and \`:where()\` instead of a rule that is written twice for a fallback.
- \`@scope\` when the nearest ancestor has to win and not the outermost one.

#### The reset names the elements
- The reset lives in \`@layer reset\` and names the elements: \`html\`, \`body\`, \`h1\`, \`p\`,
  \`ul\`. A reset on \`*\` cannot be beaten by a web component and does not yield to a lower
  layer — \`*, *::before, *::after\` is not the way.

#### The layout
- Logical properties instead of the physical ones: \`margin-inline-start\`, \`padding-block\`,
  \`inset-inline\`, \`inline-size\`. A space that has to flip in a right-to-left page does flip.
- Grid for the page and the areas, flex for the rows. \`grid-template-areas\` names the regions
  of the page. A row of cards is \`repeat(auto-fit, minmax(240px, 1fr))\`. A grid that has to
  line up with the grid of its parent is \`subgrid\`.
- The component answers to the space it is given and not to the width of the window: the
  container is named (\`container: card / inline-size\`) and the rules of the component ask
  \`@container card (inline-size > 400px)\`. The media queries stay for the page and for the
  preferences of the user.
- Every length has an explicit unit: \`rem\` for the type and the spacing, \`px\` for the
  hairlines and the small radii, \`clamp()\` for the fluid type, \`dvh\` for the height of the
  mobile viewport.

#### The motion and the contrast
- The motion is short: 120..200ms for a hover, 200..300ms for a panel. Animate \`transform\`,
  \`opacity\` and \`color\`, and name the properties in the transition: \`transition: all\` animates
  the properties you did not mean to animate.
- Every animation has a branch for \`prefers-reduced-motion: reduce\`, and the element keeps
  its final state when the motion is off.
- The contrast of the text is 4.5:1 and the contrast of the border of a control is 3:1. When
  the design cannot pass the threshold, say so in the report instead of hiding it.`;

/** The whole standard: every part of it. */
export const WEB_DEVELOPMENT = [CORE, HTML, CSS].join('\n\n');

/**
 * The parts of the standard that concern a role.
 *
 * The styler writes the styles and gets the rules of the styles; the markup and the coder
 * write the pages and get the rules of the markup. Every role of the frontend gets the rules
 * that hold for every file.
 *
 * The standard is not carried by the prompt of a role any more: every role takes the part
 * that concerns its craft and brings it at the write gate (`roles/chunks`). This function
 * stays for whoever wants the whole standard of a craft in one text.
 * @param {string} [role]
 * @returns {string}
 * @exports
 * @ai.hint pure
 */
export function webDevelopment(role = 'coder') {
    const key = String(role ?? '').trim().toLowerCase();
    const parts = key === 'styler' ? [CORE, CSS] : [CORE, HTML];
    return `## The standard of the frontend work\n\n${parts.join('\n\n')}`;
}
