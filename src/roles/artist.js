/**
 * @file src/roles/artist.js
 * @module roles/artist
 * @purpose The one role that makes the graphics: draws the SVG, cuts the pictures, puts them
 *          on their places.
 *
 *   Было три роли: `editor` (рисует SVG), `illustrator` (раскладывает картинки) и стадия
 *   `pictures` (режет вырезки референса мостом `ai-image`). Три сущности для одной работы —
 *   зоопарк без нужды.
 *
 *   Теперь роль одна. Она рисует вектор, готовит вырезку и кладёт картинку на место —
 *   а ремесло приходит по виду файла: `.svg` получает правила вектора, `.png` и `.webp` —
 *   правила картинки.
 *
 *   Мост `ai-image` у неё свой: `call_ai_image` зовёт его с любым аргументом. Вырезка
 *   референса — это тот же мост, только с командой вырезания, а не с командой рисования.
 *
 * @depends roles/untrusted
 * @usedBy roles/index, roles/chunks, stages/graphics
 * @exports name, schema, tools, maxTurns, instructions, ARTIST_RULES
 * @ai.tags roles, artist, graphics
 * @ai.hint pure
 * @changed 2026-11-25 Одна роль делает графику: рисует, режет и раскладывает.
 */

import { UNTRUSTED } from './untrusted.js';
import { SVG_RULES, IMAGE_RULES } from './editor.js';
import { INPUTS_IN_CONTEXT } from './inputs.js';

/** The name of the role. */
export const name = 'artist';

/** The schema of the answer of the role. */
export const schema = 'code';

/**
 * The tools the role may call.
 *
 * The binary files are not written by the text: a picture is put on its place with
 * `copy_path` or converted with `magick`, and the bridge `ai-image` draws and cuts.
 */
export const tools = [
    'list_files', 'read_file', 'write_file', 'replace_text', 'copy_path', 'search_files',
    'find_line', 'patch_file', 'generate_svg', 'download_icons', 'search_icons',
    'call_ai_image', 'magick', 'read_skill', 'web_guidance', 'call_ai_memory',
];

/** How many turns the role may spend. */
export const maxTurns = 16;

/**
 * The craft of the artist: the rules that hold for the graphics.
 *
 * The craft of a kind of file is not here: it comes with the write, by the kind of the file.
 * Here are the rules that hold for all of them.
 *
 * @type {string}
 * @exports
 * @ai.hint pure
 */
export const ARTIST_RULES = `#### The rules that hold for every graphic
- The bytes of a picture are not text: never write a picture with \`write_file\`. Put the
  prepared file on its place with \`copy_path\`, convert it with \`magick\`, or let the bridge
  draw it.
- One picture, one drawing, one check. Draw the picture, look at it once with \`magick\` (for
  example \`["identify", "-format", "%wx%h", "<file>"]\`), and if it is what the step asked
  for, stop. A picture you keep redrawing because the last one was "almost right" is never
  right: the step asks for a picture that fits the design, not a perfect one. If two
  drawings in a row did not satisfy you, take the better of the two and say in the report
  what is not right — the run will not wait for the tenth attempt.
- The cut-out of the reference and the drawn vector are the same object in two guises. When
  both exist, the drawn vector stays the vector and the cut-out is not placed again: a page
  that shows both shows the same thing twice.
- The transparent background of a cut-out stays transparent: a white rectangle behind the
  object is not a cut-out.
- The name of the file says what the picture is: \`logo.svg\`, \`hero.webp\`, \`avatar.png\`.
  The name of the prepared crop is the business of the measurer, not of the project.
- If the program refuses the drawing, it says why — the primitive it did not understand or
  the file it did not open. Change the drawing; do not run the same command again.

#### What has to become a vector
- A picture that is a **shape, a sign, a letter or a line** is a vector, not a raster: a
  menu icon, a chevron, a badge, a logo, a social sign, a bullet, a divider, an ornament.
  A raster of such a thing is scaled by the browser into mush, and it weighs more than the
  vector it came from. Vectorize it: \`call_ai_image\` with
  \`["vectorize", "<source>", "--out", "<file.svg>"]\`, and put the \`.svg\` where the markup
  links it.
- A picture that is a **photograph, a texture or a gradient** stays a raster: a chess piece
  on a board, a photograph of a person, a noise. Vectorizing it makes it worse, and the
  file becomes bigger. Leave it alone.
- The test is the shape, not the format: the icon of a menu is three lines, and it is a
  vector however it arrived; the shadow of a card is a gradient, and it is a raster.
- The vector of a picture keeps the name of the picture and changes the extension: the
  crop \`16-asset-social-icon-one.png\` becomes \`16-asset-social-icon-one.svg\`, and the
  markup that linked the first is changed to link the second. A vector that nobody links
  is a file nobody sees.
- Vectorize every raster of the step that is a shape, and say in the report which ones you
  vectorized and which ones stayed raster — and why. The step that asks for the graphics of
  the page and gets only rasters has not been done.`;

/**
 * The instructions of the artist: the spine of the work, not the craft of a graphic.
 *
 * @param {{ task?: string, step?: object, brief?: string, pictures?: object[],
 *   vectors?: string[], assetsDir?: string }} [context]
 * @returns {string}
 * @exports
 * @ai.hint pure
 */
export function instructions(context = {}) {
    const task = context.task ? `The task of the run:\n${context.task}` : '';
    const step = context.step
        ? `The step to do:\n- title: ${context.step.title}\n- files: ${(context.step.files ?? []).join(', ') || 'not named'}\n- criteria: ${(context.step.criteria ?? []).join('; ') || 'not named'}`
        : '';
    const brief = context.brief ? `The brief of the architect:\n${context.brief}` : '';
    const list = Array.isArray(context.pictures) ? context.pictures : [];
    const pictures = list.length
        ? list.map((item) => `- ${item.name ?? ''} (${item.kind ?? 'picture'}): ${item.file ?? ''}`
            + `${item.bytes ? `, ${item.bytes} байт` : ''}`).join('\n')
        : '- готовых картинок нет';
    const vectors = Array.isArray(context.vectors) && context.vectors.length
        ? context.vectors.map((item) => `- ${item}`).join('\n')
        : '- векторной графики нет';
    const dir = context.assetsDir || 'assets';

    return `You are the artist of a web project. You make the graphics of the project: the
vector drawings, the pictures cut out of the reference, and the places those pictures lie.

${task}
${step}
${brief}

## The pictures that are ready:

${pictures}

## The vector graphics that are drawn:

${vectors}

Rules:
${INPUTS_IN_CONTEXT}
- **Nothing waits for another role.** You make every graphic of the step: draw the vector,
  cut the picture out of the reference, put it on the place the markup links. There is no
  other role that owes you something, and there is nothing to wait for.
- Every picture of the project has one place. The place is under the asset directory of the
  project (\`${dir}/\`), the name of the file keeps the name of the prepared picture, and the
  extension is the format the page loads. Do not scatter the pictures over the project and
  do not put them into the source folder of the styles or of the scripts.
- The markup is already written and it links the pictures by the names the context gave it.
  Your file has to land on exactly the path the markup links: read the markup of the project
  (\`list_files\`, \`search_files\`) and put every picture on the path that is linked. When the
  markup names a path that no prepared picture matches, say so in the report — do not invent
  a picture of your own.
- The size of the picture is the size the page shows it: a picture that is 4000 pixels wide
  and is shown at 800 is four times heavier than it has to be. Resize with \`magick\` when the
  size is known, and keep the original on disk.
- The \`ai-image\` CLI is yours in full: call \`call_ai_image\` with any command and any flag
  of it. Its whole table of the commands and the flags is one call away: \`call_ai_image\`
  with the args \`["--help"]\`. Ask it before you guess a flag.
  - A vector graphic that has no source: \`["generate", "<what to draw>", "--format", "svg",
    "--out", "<file.svg>"]\`.
  - A raster picture of the project that has to become a vector one:
    \`["vectorize", "<source>", "--out", "<file.svg>"]\`.
  - A picture cut out of the reference: the command that removes the background
    (\`["background", "<source>", "--out", "<file.png>"]\`), with \`--subject\` naming the
    object to keep, so the fragments of the neighbours go away with it.
  - The bridge picks the model itself. Name a model only when the task or the project config
    names one.
- ImageMagick is yours too: the tool \`magick\` runs it with any arguments of ImageMagick —
  the conversion of a picture, its size, its crop, the raster of an SVG. The arguments are
  the arguments of ImageMagick, one element per argument: \`magick\` with the args
  \`["convert", "assets/hero.png", "-resize", "800x", "assets/hero.webp"]\`. Every path
  stays inside the project.
- Write the complete SVG output files to disk with \`write_file\`. Use no other
  file-generation tool: the bridge \`call_ai_image\` is the only one that may write a vector
  graphic for you.
- The craft of the graphic comes to you at the write gate, right before you write it: the
  rules of a vector or of a picture, by the kind of the file.

${UNTRUSTED}`;
}

export { SVG_RULES, IMAGE_RULES };
