/**
 * @file src/agent/docs.js
 * @module agent/docs
 * @purpose The standards a role may be given as documentation.
 *
 *   The coder writes the markup, the styler writes the CSS, the iconifier picks the icons. Each
 *   of them needs the rules of its own craft: the units, the shapes, the semantics, the
 *   accessibility thresholds, the icon sets. The texts live in the package: they are short,
 *   stable and part of the behaviour of the roles, not something a user has to download.
 *
 *   The config decides which of them a role gets: `documentation.roles.coder` and the other
 *   lists name the sources.
 *
 * @depends config/constants
 * @usedBy roles/index, stages/collect
 * @exports DOCUMENTATION, documentationFor, documentationNames, documentationForRole
 * @ai.tags documentation, css, standards
 * @ai.hint pure
 */

import { ENUMS } from '../config/constants.js';

/**
 * The texts of the standards, by the name the config uses.
 * @type {Readonly<Record<string, string>>}
 */
export const DOCUMENTATION = Object.freeze({
    cssUnits: `# CSS units

Absolute: \`px\` (CSS pixels), \`in\`, \`cm\`, \`mm\`, \`q\`, \`pt\`, \`pc\`. 1in = 96px, 1pt = 1.333px.

Font-relative: \`rem\` = the root font size, \`em\` = the font size of the element itself,
\`ch\` = the width of the "0" glyph, \`ex\` = the height of the x-height.

Viewport-relative: \`vw\`, \`vh\`, \`vmin\`, \`vmax\` = 1% of the viewport size.

Container-relative: \`cqw\`, \`cqh\`, \`cqi\`, \`cqb\` = 1% of the container size.

Percentage: \`%\` — relative to the containing block for sizes, to the line box for line-height.

Rules for writing:
- give every length an explicit unit, never mix two units inside one value;
- prefer \`rem\` for the type and the spacing, \`clamp()\` for the fluid type;
- keep \`px\` for the hairlines, the borders and the small radii;
- set the root font size once and let everything else follow it.`,

    cssShapes: `# CSS shapes

Border radius: \`border-radius: <radius>\` — one value for all corners, four values for
top-left / top-right / bottom-right / bottom-left, or a shorthand with a slash: \`8px / 16px\`.

Circles: a square box with \`border-radius: 50%\`. Pills: a box with \`border-radius: 999px\`.

Clip paths: \`clip-path: polygon(...)\` for straight edges, \`circle()\`, \`ellipse()\`,
\`inset()\`, \`path()\` for an SVG path. Masks: \`mask-image\`, \`mask-size\`, \`mask-position\`,
\`mask-repeat\`, \`mask-composite\`.

Dividers: a 1px line is a border (\`border-bottom: 1px solid\`) or a \`::after\` with
\`height: 1px\` — never a shadow that fakes it.

The radius of a card comes from the design: one radius per project, not a radius per corner.`,

    cssGrid: `# CSS grid

\`display: grid\` with \`grid-template-columns\` (\`repeat(3, 1fr)\`, \`minmax(240px, 1fr)\`,
\`200px 1fr\`) and \`grid-template-rows\`. The gap is \`gap: <row> <column>\` (one value = both).
Items are placed by \`grid-column\`, \`grid-row\`, \`grid-area\`, or automatically by the flow.

Use grid for the page and for the card interiors; do not nest more than two grids deep.
\`minmax()\` keeps a column readable when the viewport is narrow; \`repeat(auto-fit, minmax(240px, 1fr))\`
is the usual answer for a responsive row of cards.`,

    cssFlex: `# CSS flexbox

\`display: flex\` (\`inline-flex\` for an inline box). The main axis is the row by default, the
cross axis is the column; \`flex-direction\` changes that.

\`flex: <grow> <shrink> <basis>\`, \`flex-grow\`, \`flex-shrink\`, \`flex-basis\`.
\`justify-content\` places the items along the main axis, \`align-items\` along the cross axis.
\`gap\` is the space between the items; \`row-gap\` and \`column-gap\` set one of them.

Use flex for the rows: a toolbar, a button with an icon, a pair of labels. Use grid for the
columns and the areas.`,

    cssFonts: `# CSS fonts

\`font-family\` — a list of families with fallbacks. A family with spaces needs quotes.
Generic families: \`serif\`, \`sans-serif\`, \`monospace\`, \`cursive\`, \`fantasy\`, \`system-ui\`,
\`ui-monospace\`, \`emoji\`, \`math\`.

\`font-size\` — px, rem, em, % or a clamp() range. \`font-weight\` — 100..900, or normal/bold.
\`line-height\` — a unitless multiplier (1.2 = 120% of the font size) or a length.
\`letter-spacing\` — a length; 0 is normal. \`font-style\` — normal/italic.
\`font-variant\`, \`font-stretch\`, \`text-transform\` — the rest of the vocabulary.

Rules for writing:
- the type scale is a short list of rem values, and every text style takes one of them;
- a line of body text is 45..75 characters wide: that is \`max-width: 65ch\` on the text column;
- never pick a family by eye alone: take it from the design direction or from the tokens.`,

    cssColors: `# CSS colours

The colours of a project are tokens: \`--color-bg\`, \`--color-surface\`, \`--color-text\`,
\`--color-muted\`, \`--color-accent\`, \`--color-border\`. A rule names a token, never a hex value.

\`color-mix(in oklch, var(--color-accent) 80%, black)\` gives a shade of a token without a new hex.

Rules for writing:
- a colour that carries meaning appears in the token list once;
- the alpha of a decorative layer is written with \`rgb(0 0 0 / 8%)\`, not with a hex;
- the state of a control (hover, active, focus, disabled) is a token too, not an ad-hoc shade.`,

    cssMotion: `# CSS motion

Transitions: \`transition: <property> <duration> <easing> <delay>\`; the default duration is 0s.
Easings: \`linear\`, \`ease\`, \`ease-in\`, \`ease-out\`, \`ease-in-out\`, \`cubic-bezier(...)\`.

Animations: \`@keyframes\` + \`animation: <name> <duration> <easing> <delay> <iteration> <direction>\`.

Reduced motion: \`@media (prefers-reduced-motion: reduce)\` must switch the long transitions off.

Rules for writing:
- animate \`transform\`, \`opacity\` and \`color\`, never \`width\`, \`height\` or \`top\`;
- the duration of a hover is 120..200ms, of a modal is 200..300ms;
- every animation has a reduced-motion branch.`,

    svg: `# SVG as code

A vector picture is written as markup: a file with the \`<svg>\` root, a \`viewBox\` and the
paths inside it.

    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
         stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="..." />
    </svg>

Rules for writing:
- the \`viewBox\` is the grid of the icon: 24×24 for Lucide, 256×256 for Phosphor;
- \`currentColor\` for the stroke, so the icon follows the text colour;
- \`stroke-width\` is 2 on the 24×24 grid;
- give the element \`role="img"\` and a \`<title>\` when it carries meaning, \`aria-hidden="true"\`
  when it is decorative;
- no \`width\` and \`height\` attributes in the markup of an icon: the size comes from CSS.`,

    htmlSemantics: `# HTML semantics

One \`<h1>\` per page, and the headings follow the order of the content — no level is skipped.
The landmarks: \`<header>\`, \`<nav>\`, \`<main>\`, \`<aside>\`, \`<footer>\`. A page has one \`<main>\`.

Elements before the styles: \`<button>\` for an action, \`<a href>\` for a place; a \`<div>\` with a
click handler is neither. \`<ul>\`/\`<ol>\`/\`<li>\` for a list, \`<table>\` for tabular data,
\`dl\`/\`dt\`/\`dd\` for a description, \`<figure>\`/\`<figcaption>\` for a picture with a caption.

Forms: every field has a \`<label for>\`; the placeholder is a hint, never the label; the errors
live next to the field and are linked with \`aria-describedby\`.

Images: \`<img>\` with \`alt\`; an empty \`alt=""\` for a decorative picture. A picture that carries
meaning needs an \`alt\` that says what it shows, not "picture".

The markup carries the meaning, the stylesheet carries the look: no \`<div class="title">\`
where a heading belongs.`,

    a11y: `# Accessibility

The keyboard: everything that works with the mouse works with the keyboard, in the order of the
page. \`Tab\` moves, \`Enter\` and \`Space\` press, \`Escape\` closes. A focus that cannot be seen
is a bug: keep \`:focus-visible\` visible with a 2px outline and an offset.

The semantics: the roles come from the elements, not from \`role\` attributes; ARIA only fills a
gap the elements cannot. \`aria-label\` names a control that has no visible name, \`aria-hidden\`
hides a decorative picture, \`aria-expanded\` and \`aria-controls\` describe a disclosure.

The contrast: the text 4.5:1, the large text and the borders of the controls 3:1. The state of a
control is never the colour alone: the focus ring, the underline or the icon says it too.

The motion: \`prefers-reduced-motion\` switches the long animations off.

The names: every image that carries meaning has an \`alt\`, every input has a label, every link
says where it goes ("the documentation", not "here").

The forms: the error is written next to the field, in words, and the field keeps the value.

A checklist before the review:
- every interactive element is reachable by the keyboard and shows its focus;
- every image has an alt, every form field has a label;
- the contrast of the text and of the controls passes the thresholds;
- the headings form one tree, the landmarks are in place;
- the reduced motion branch exists.`,

    wcagColors: `# WCAG colour rules

Contrast ratio: (L1 + 0.05) / (L2 + 0.05), where L is the relative luminance of the colour.
1 = identical, 21 = black on white.

The thresholds of WCAG 2.1:
- 4.5:1 — normal text (below 18pt / 24px, or below 14pt / 18.66px bold);
- 3:1 — large text (18pt / 24px and above, or 14pt / 18.66px bold and above);
- 3:1 — the contrast of a UI component and its background (the border of a button, the edge of an input);
- 3:1 — the contrast of a graphical object that carries meaning.

Rules for writing:
- the text on a surface is checked against that surface, not against the page;
- a translucent surface is checked against the colour under it;
- a colour that fails the threshold is a decision to report, not to hide.`,

    phosphorIcons: `# Phosphor icons

Phosphor (MIT): a family of 900+ icons in six weights (thin, light, regular, bold, fill, duotone)
and four styles (regular, duotone, fill). The markup is a web font or an SVG sprite.

Use the regular weight for the interface, the fill for the active state. The names are descriptive:
\`arrow-right\`, \`check-circle\`, \`magnifying-glass\`, \`gear\`.

Rules for picking:
- one set for the whole project, never two;
- the icon that names the action is the name of the thing: a trash can for the delete, a gear for
  the settings;
- an icon never stands alone where a word is needed: the icon carries the meaning, the word
  carries the doubt;
- the size of the icon is a token: 16, 20, 24 or 32, and the stroke follows the grid.`,

    lucideIcons: `# Lucide icons

Lucide (ISC): a family of 1400+ icons, all drawn on a 24×24 grid with a 2px stroke, the round
caps and the 2px corner radius.

The names are the words of the icon: \`arrow-right\`, \`check\`, \`search\`, \`settings\`,
\`circle-alert\`.

The 24×24 grid is the reference: an icon of 16px has a stroke of about 1.33px, an icon of 32px has
a stroke of about 2.67px.

Rules for picking:
- prefer the icon whose name is the plain word (\`search\`, not \`magnifier\`);
- do not draw an icon that the set already has;
- an icon that means "delete" is \`trash-2\`, an icon that means "close" is \`x\`.`,

    googleFonts: `# Google Fonts

Google Fonts (SIL Open Font License): the catalogue of the open fonts — Roboto, Open Sans,
Inter, Lora, Playfair Display, Montserrat, Source Sans 3, IBM Plex Sans, Merriweather, Poppins.

The licence lets a project self-host the font files, and self-hosting is the right choice for a
production site: the font is served from the same origin, the request does not leave the site.

Rules for writing:
- take one family for the text and one for the accents, no more;
- load the weights the design uses, in one request: \`family=Inter:wght@400;500;600\`;
- always declare the fallbacks: \`font-family: 'Inter', system-ui, sans-serif\`;
- the file of the font goes into the project, not into a request to a third party at runtime.`,
});

/**
 * The names of the documentation sources, in the order of the enum.
 * @returns {string[]}
 * @exports
 * @ai.hint pure
 */
export function documentationNames() {
    return [...ENUMS.documentationSources];
}

/**
 * The documentation of one role, as one text.
 * @param {string[]} names the names of the sources
 * @returns {string} empty when nothing was asked for
 * @exports
 * @ai.hint pure
 */
export function documentationFor(names = []) {
    const wanted = Array.isArray(names) ? names : [];
    const blocks = [];
    for (const name of wanted) {
        const text = DOCUMENTATION[name];
        if (!text) continue;
        blocks.push(text);
    }
    if (!blocks.length) return '';
    return blocks.join('\n\n');
}

/**
 * The documentation of one role, by the config.
 * @param {object} config
 * @param {string} role
 * @returns {string}
 * @exports
 * @ai.hint pure
 */
export function documentationForRole(config, role) {
    const names = config?.documentation?.roles?.[role] ?? [];
    return documentationFor(names);
}
