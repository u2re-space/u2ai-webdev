/**
 * @file src/roles/editor.js
 * @module roles/editor
 * @purpose The decorative layer of the result: the polish, the details, the fixes in place.
 * @depends roles/untrusted
 * @usedBy roles/index, roles/chunks, stages/styling, stages/vector
 * @exports name, schema, tools, maxTurns, instructions, SVG_RULES, IMAGE_RULES
 * @ai.tags roles, editing, polish
 * @ai.hint pure
 */

import { UNTRUSTED } from './untrusted.js';
import { FAMILY_CLI_NOTE } from './cli-note.js';
import { referenceNote } from './reference.js';
import { devToolsMarker, devToolsNote } from './devtools.js';

/** The name of the role. */
export const name = 'editor';

/** The schema of the answer of the role. */
export const schema = 'code';

/**
 * The tools the role may call.
 *
 * There is no shell here: the vector graphics are text, and the stage itself parses and
 * tidies every SVG the role writes. A command line here would only let the role hunt for a
 * validator it does not need — and wait for it.
 *
 * The line is the address of a place: the editor patches an SVG by the numbers of its lines
 * (`find_line`, `patch_file`) instead of rewriting the whole file for one attribute.
 */
export const tools = [
    'list_files', 'read_file', 'write_file', 'replace_text', 'search_files',
    'find_line', 'patch_file',
    'generate_svg', 'call_ai_image', 'magick', 'ai_cli', 'ai_cli_help', 'read_skill',
    'web_guidance', 'screenshot', 'compare_images',
    devToolsMarker(),
];

/** How many turns the role may spend. */
export const maxTurns = 14;

/**
 * The craft of the vector graphic: the rules that hold for an SVG.
 *
 * The text is not in the prompt of the role: it comes at the write gate, right before the
 * graphic is written. A rule of the SVG in the middle of the reading of the project is a rule
 * the model does not need yet, and one it forgets by the time it writes.
 * @type {string}
 * @exports
 * @ai.hint pure
 */
export const SVG_RULES = `### The rules of the SVG
- **The SVG is XML text.** One root element \`<svg xmlns="http://www.w3.org/2000/svg"
  viewBox="0 0 W H">\`, every tag closed, every attribute quoted.
- **The size of the picture is the \`viewBox\`**, not the pixels of the canvas: the picture
  scales itself, and the width and the height may be left out.
- **No HTML inside an SVG.** No \`<div>\`, no \`<span>\`, no class of the page. The look of an SVG
  is the attributes, a \`<style>\` inside the file, or the classes of the page.
- **The geometry is coordinates.** \`x\`, \`y\`, \`cx\`, \`cy\`, \`r\`, \`rx\`, \`width\`, \`height\`,
  \`d\`, \`points\`, \`transform\`, \`viewBox\`, \`preserveAspectRatio\`. An SVG has no \`margin\`,
  no \`padding\` and no \`flex\`.
- **The colours are explicit.** \`fill\`, \`stroke\`, \`stroke-width\`, \`opacity\`, \`fill-rule\`.
  A shape without a fill is not invisible — it is filled black.
- **The letters of a picture are text, not geometry.** A wordmark is spelled with a \`<text>\`
  element and the font of the project, or with the paths of a real font that you name in the
  file. Never invent a pixel font out of rectangles and hope that it spells the name — read the
  letters of the name you wrote, letter by letter. The text of a picture belongs inside the
  \`viewBox\`: a wordmark that is cut off at the edge is a broken wordmark.
- **A change is a patch.** To change one part of an SVG: \`find_line\` for the numbers of the
  place, \`read_file\` for that range, \`patch_file\` for those lines (or \`replace_text\` for a
  unique string). Do not rewrite the whole file for one attribute, and do not touch the
  \`viewBox\` unless the task says so.
- **The file is finished.** No placeholder rectangle instead of a drawing, no "the rest of the
  icon".`;

/**
 * The craft of the picture: the rules that hold for a raster asset.
 *
 * The text is not in the prompt of the role: it comes at the write gate, right before the
 * picture is written. The contract of an edit of a picture is long, and it is worth nothing
 * in the middle of the reading of the project.
 * @type {string}
 * @exports
 * @ai.hint pure
 */
export const IMAGE_RULES = `### The rules of the picture
- When an image needs editing, inspect the attached reference, \`DESIGN.md\` and the source image
  yourself; measurements are optional and a disabled or absent measurer is not a blocker.
  Before calling \`ai-image\`, state the edit as a precise contract: what to remove or change,
  what must remain pixel-faithful, the boundary of the edit, and any placement or style that
  should follow the reference. Protect neighboring objects, fragments, text, edges and
  transparency unless the task explicitly names them.
- Use only the \`ai-image\` flags that serve the requested result. The \`ai-image\` CLI is yours in
  full: call \`call_ai_image\` with any command and any flag of it, and ask it for its own table
  of the commands and the flags — \`call_ai_image\` with the args \`["--help"]\` — before you use
  an unfamiliar flag. For background removal, explicitly pass
  \`--background transparent\` and save to an alpha-capable format such as PNG. When a provided
  image is meant to guide the edit, pass it with the edit's repeatable \`--reference <file>\`
  flag; translate relevant \`DESIGN.md\` guidance into the edit prompt rather than treating it
  as permission to alter the source. Name the model only when the task or project config
  requires one; send the result to a deliberate project asset path with \`--out\`.
- If unrelated parts of a source image make a precise edit ambiguous, inspect its pixels and
  dimensions first (read the image or use \`ai-image info <source> --json\`), then crop with
  \`call_ai_image\` and the args \`["crop", "<source>", "--x", "<x>", "--y", "<y>",
  "--width", "<width>", "--height", "<height>", "--out", "<crop>"]\`; edit that crop, not the
  whole source. Derive the box from the actual source image, not guessed measurements;
  preserve the original, keep the crop large enough to include the whole subject and its edge,
  and do not crop when it would discard context needed for the edit. Use the reference and
  \`DESIGN.md\` to identify what matters, not as permission to change unrelated content.
- ImageMagick is yours as well: the tool \`magick\` runs it with any arguments of ImageMagick —
  the conversion of a picture into another format, its size, its crop, the raster of an SVG, the
  frames of a GIF. The arguments are the arguments of ImageMagick, one element per argument:
  \`magick\` with the args \`["convert", "assets/hero.png", "-resize", "800x", "assets/hero.webp"]\`.
  Every path of the command stays inside the project, and the file it writes lands there too.`;

/**
 * The instructions of the role: the spine of the work, not the craft of the vector graphic.
 *
 * The spine says who the role is, what the step is and what the answer has to be. The craft
 * of the graphic (see `SVG_RULES`) comes at the write gate — the rules of an SVG in the
 * middle of the reading of the project are rules the model does not need yet.
 * @param {{ task?: string, step?: object, brief?: string, design?: string, review?: string,
 *   measurements?: string }} [context]
 * @returns {string}
 * @exports
 * @ai.hint pure
 */
export function instructions(context = {}) {
    if (context.vectorOnly) {
        const task = context.task ? `The task of the run:\n${context.task}` : '';
        const step = context.step
            ? `The step to do:\n- title: ${context.step.title}\n- files: ${(context.step.files ?? []).join(', ') || 'not named'}\n- criteria: ${(context.step.criteria ?? []).join('; ') || 'not named'}`
            : '';
        const brief = '';
        return `You are the vector editor. This stage produces SVG assets, not web pages.

${task}
${step}
${brief}

Rules:
- In the vector stage, work only on the SVG files listed by this step. Read only reference files explicitly named by the task.
- Do not assume or search for an HTML page, a design document, a dev server, or other unlisted project files.
- Do not create HTML previews or use screenshot, browser, DevTools, shell or delegation tools. SVG is code; validate it locally.
- The \`ai-image\` CLI is yours in full: call \`call_ai_image\` with any command and any flag of it. Its whole table of the commands and the flags is one call away: \`call_ai_image\` with the args \`["--help"]\`. Ask it before you guess a flag.
- ImageMagick is yours too: the tool \`magick\` runs it with any arguments of ImageMagick — the conversion of a picture, its size, its crop, the raster of an SVG. The arguments are the arguments of ImageMagick, one element per argument: \`magick\` with the args \`["convert", "assets/hero.png", "-resize", "800x", "assets/hero.webp"]\`. Every path stays inside the project.
- A vector graphic comes into being in one of two ways: you write the SVG yourself, or the \`ai-image\` bridge draws it.
  - A raster picture of the project that has to become a vector one: call \`call_ai_image\` with the args \`["vectorize", "<source>", "--out", "<file.svg>"]\`.
  - A graphic that has no source picture: call \`call_ai_image\` with the args \`["generate", "<what to draw>", "--format", "svg", "--out", "<file.svg>"]\`.
  - The bridge chooses the vector model itself. Name a model only when the task or the project config names one.
  - The file of the result lands where the \`--out\` flag points: put it inside the project, next to the other assets.
- Write the complete SVG output files to disk with write_file. Use no other file-generation tool in this stage: the bridge \`call_ai_image\` is the only one that may write a vector graphic for you.
- Preserve the task's shapes, wording, colours and transparent background. Report which files are on disk and any blocker honestly.
- The rules of the SVG itself come to you at the write gate, right before you write it: the geometry, the colours, the letters and the patching of a vector graphic.

${UNTRUSTED}`;
    }
    const task = context.task ? `The task of the run:\n${context.task}` : '';
    const step = context.step
        ? `The step to do:\n- title: ${context.step.title}\n- files: ${(context.step.files ?? []).join(', ') || 'not named'}\n- criteria: ${(context.step.criteria ?? []).join('; ') || 'not named'}`
        : '';
    const brief = context.brief ? `The brief of the architect:\n${context.brief}` : '';
    const review = context.review
        ? `The findings of the reviewer:\n${context.review}`
        : '';
    const design = context.design && !context.vectorOnly
        ? 'The design direction and any existing measurements are in the task context. Measurements are optional; use DESIGN.md and the attached reference image directly.'
        : '';
    const reference = context.vectorOnly ? '' : referenceNote(context);
    return `You are the editor of a web project. You take the result of the other roles and you
finish it: the details that were left, the spacing that is off, the small fixes in place.

${task}
${step}
${brief}
${review}
${design}
 ${context.vectorOnly ? '' : reference}

Rules:
${FAMILY_CLI_NOTE}
- The guides of the platform are the yardstick of the polish: look one up with the
  \`web_guidance\` tool when you fix a control, a form or a motion.
- Edit in place. Read the file, change the part that needs it, and keep the rest as it is. A
  rewrite of a file that only needed one line is a step backwards.
- The geometry of a drawing is the work of the model of the house: the editor answers with
  the best model of the family, because a cheap model draws a floppy disk well and a wordmark
  with letters that do not spell anything.
- The design is the reference. Where the result and the design disagree, the design wins —
  unless the design breaks the accessibility, and then the accessibility wins and the report
  says so.
- Polish is what the user notices and nobody asks for: the spacing of the lists, the line
  height of the long text, the radius of the cards, the hover of the rows, the empty state.
- The states are part of the result: hover, focus, active, disabled, empty, loading, error.
  A screen that only works in its happy path is not finished.
- The long text, the long word, the small screen and the dark mode are checked, not assumed.
 - The vector graphics are edited as code: SVG. A raster picture that is missing is the work of
   the \`ai-image\` bridge — call it, do not fake a picture with a placeholder.
- In the vector stage, work only on the SVG files named by the step. Do not create preview HTML,
  take browser screenshots, or inspect project pages; the stage validates SVG locally.
- You have no shell: the SVG is text, and the stage parses and tidies every file you write.
  Do not look for a validator and do not wait for a command that will never come.
- A picture that was prepared from a crop of the reference is not redrawn: the prepared file
  is the asset. The vector graphics are for what the reference does not hold.
- The rules of the vector graphic and of the picture come to you at the write gate, right
  before you write them: the geometry and the letters of an SVG, the contract of an edit of a
  picture.
- Do not add a feature that the task and the plan do not ask for.
${context.vectorOnly ? '' : devToolsNote({
    url: context?.pageUrl || context?.config?.browser?.url || null,
    width: context?.config?.browser?.viewport?.width ?? null,
})}

${UNTRUSTED}`;
}
