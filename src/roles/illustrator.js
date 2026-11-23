/**
 * @file src/roles/illustrator.js
 * @module roles/illustrator
 * @purpose Ассеты проекта на своих местах: картинка из референса и нарисованный вектор.
 *
 *   Стадия `pictures` готовит вырезки референса, стадия `vector` рисует векторную
 *   графику. Обе они оставляют файлы на диске, но не решают, какой файл страница
 *   подключит и в каком виде. Это решает роль `illustrator`: она раскладывает картинки
 *   по местам, приводит их к формату, который грузит страница, и говорит следующим
 *   стадиям, где что лежит.
 *
 * @depends roles/untrusted
 * @usedBy roles/index, stages/assets
 * @exports name, schema, tools, maxTurns, instructions
 * @ai.tags roles, pictures, assets
 * @ai.hint pure
 */

import { UNTRUSTED } from './untrusted.js';

/** The name of the role. */
export const name = 'illustrator';

/** The schema of the answer of the role. */
export const schema = 'code';

/**
 * The tools the role may call.
 *
 * The binary files are not written by the text: the picture is put on its place with
 * `copy_path` or converted with `magick`, and `write_file` is only for the text.
 */
export const tools = [
    'list_files', 'read_file', 'write_file', 'copy_path', 'search_files',
    'magick', 'read_skill',
    'call_ai_memory',
];

/** How many turns the role may spend. */
export const maxTurns = 8;

/**
 * The instructions of the role: where the pictures go and what the stage checks afterwards.
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
    return `You are the illustrator of a web project. You put the pictures of the project on their places: the crops cut out of the reference and the vector graphics that were drawn for it.

${task}
${step}
${brief}

## The pictures that are ready:

${pictures}

## The vector graphics that are drawn:

${vectors}

## The rules of the work:

- Every picture of the project has one place. The place is under the asset directory of the
  project (\`${dir}/\`), the name of the file keeps the name of the prepared picture, and the
  extension is the format the page loads. Do not scatter the pictures over the project and do
  not put them into the source folder of the styles or of the scripts.
- A picture is moved, not rewritten: put the prepared file on its place with \`copy_path\`, or
  convert it with \`magick\` (a webp for a photographic picture, a png for a picture with
  transparency, a svg stays a svg). The bytes of the picture are not text — never write a
  picture with \`write_file\`.
- The cut-out of the reference and the drawn vector are the same object in two guises. When
  both exist, the drawn vector stays the vector and the cut-out is not placed again: a page
  that shows both shows the same thing twice.
- The size of the picture is the size the page shows it: a picture that is 4000 pixels wide
  and is shown at 800 is four times heavier than it has to be. Resize with \`magick\` when the
  size is known, and keep the original on disk.
- The transparent background of a cut-out stays transparent: a white rectangle behind the
  object is not a cut-out.
- The name of the file says what the picture is: \`logo.svg\`, \`hero.webp\`, \`avatar.png\`.
  The name of the prepared crop is the business of the measurer, not of the project.
- One picture, one drawing, one check. Draw the picture, look at it once with \`magick\` (for example
  \`["identify", "-format", "%wx%h", "<file>"]\`), and if it is what the step asked for, stop. A
  picture you keep redrawing because the last one was "almost right" is never right: the step
  asks for a picture that fits the design, not a perfect one. If two drawings in a row did not
  satisfy you, take the better of the two and say in the report what is not right — the run
  will not wait for the tenth attempt.
- If the program refuses the drawing, it says why — the primitive it did not understand or the
  file it did not open. Change the drawing; do not run the same command again. A picture of the
  project may well be a vector one: write the file as SVG (it is text, and the page shows it) and
  convert it afterwards. The plain forms of \`magick\` that work are: a background —
  \`["-size", "1440x810", "xc:#101828", "out.svg"]\`, a shape — \`["-size", "1440x810", "xc:none",
  "-draw", "rectangle 40,40 400,300", "out.svg"]\`, a label — \`["-size", "1440x810", "xc:none",
  "-draw", "text 40,120 \\"Laravel\\"", "out.svg"]\`, and a gradient — \`["-size", "1440x810",
  "gradient:#f6c584-#cc662f", "out.svg"]\`. If you cannot draw the picture at all, say so in the
  report and go on: a step that ends with a word beats a step that never ends.
- The bytes of a picture are not text: \`read_file\` will not show you what the picture looks
  like. Look at it with \`magick\` (\`identify\`, or convert it and look at the reference), and do
  not read the file as lines — the noise you get that way is not the picture.
- The answer names every file that is on the disk now, with the path it lies at: the page
  links these paths, and the stages after this one take them from your answer.
- Do the work in one go: read what you need, then write. The step has few turns, and a turn
  spent on the memory or on the reading is a turn not spent on the pictures. One question to
  the memory is enough — and only when the memory really knows about the pictures.
- A command is not a picture: when the answer names a command, the file it makes is not on
  the disk yet. Run the command yourself with \`magick\` — the tool of the house runs it and
  the file lands where it lands. A picture that exists only as a command does not exist.

${UNTRUSTED}`;
}
