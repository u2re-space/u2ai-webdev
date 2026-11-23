/**
 * @file src/stages/pass-tasks.js
 * @module stages/pass-tasks
 * @purpose Задача прохода: что роль делает в этом заходе и чего от неё ждут.
 *
 *   Проходы нужны не для красоты: без них роль ждёт того, что появляется после неё.
 *   Кодер без стилей не знает, каких имён классов ждёт страница, и пишет свои — а
 *   стилест потом переименовывает их, и код рассыпается. Стилест без кода не знает, каких
 *   состояний ждать, и не пишет правил для них.
 *
 *   Черновик контракта решает это: сначала стилест пишет то, что должно быть общим
 *   (токены, палитра, имена, каркас), потом кодер пишет скелет по этому черновику, и
 *   только потом обе роли делают свою работу целиком — видя, что написала другая.
 *
 * @depends stages/pass
 * @usedBy stages/step, roles/coder, roles/styler
 * @exports passTask, passNote, isDraftPass
 * @ai.tags stages, passes, roles
 * @ai.hint pure
 * @changed 2026-11-24 Проходы роли: черновик контракта, потом работа целиком.
 */

import { PASSES } from './pass.js';

/**
 * Проход черновика: первый заход роли.
 * @param {string} pass
 * @returns {boolean}
 * @exports
 * @ai.hint pure
 */
export function isDraftPass(pass) {
    return String(pass ?? '').trim().toLowerCase() === 'draft';
}

/**
 * Задача прохода — текст, который роль получает вместо обычного описания шага.
 *
 * @param {string} role
 * @param {string} pass
 * @param {{ step?: object, hasStyles?: boolean, hasCode?: boolean }} [context]
 * @returns {string}
 * @exports
 * @ai.hint pure
 */
export function passTask(role, pass, context = {}) {
    const who = String(role ?? '').trim().toLowerCase();
    const name = String(pass ?? '').trim().toLowerCase() || 'full';
    const step = context.step ?? {};
    // Роль без проходов работает как раньше: задачи прохода у неё нет.
    if (!PASSES[who]) return '';

    if (who === 'styler') {
        if (isDraftPass(name)) {
            return [
                `## This pass is the draft of the contract, not the styles of the page`,
                '',
                `The step \`${step.id ?? ''}\` names the stylesheets of the project. In this pass you`,
                'write **only the contract** that the rest of the run will be written against:',
                '',
                '- the custom properties (the tokens): the colours, the spacing scale, the radii,',
                '  the shadows, the type scale, the z-index layers. Give every token a name that',
                '  says what it is, not how it looks: `--color-surface`, not `--grey-500`.',
                '- the names of the classes of the markup, as they will be dressed by the rules:',
                '  the class names that the page needs, given as a short list with a word about',
                '  what each one is for.',
                '- the skeleton of the layout: the regions of the page and their order — the',
                '  header, the main area, the sidebar, the footer — and the grid or the flex that',
                '  holds them.',
                '- the rules of the states that the brief of the architect names, with the selectors',
                '  exactly as they are named there.',
                '',
                'Write the tokens and the skeleton into the file the step names. You may write a',
                'short comment above a rule that says what it is for. You do **not** write the',
                'full styles of the components yet, and you do not write the fine tuning: the next',
                'pass does that, and it will see what the code has become.',
                '',
                'The code is written against what you write here, and it is written next — so a',
                'token that is missing here is a token the code will not use, and a class name you',
                'invent that the markup does not have is a class nobody wears.',
            ].join('\n');
        }
        return [
            `## This pass is the styles of the page`,
            '',
            `The step \`${step.id ?? ''}\` names the stylesheets of the project. The draft of the`,
            'contract is on the disk: the tokens, the names of the classes and the skeleton of the',
            'layout are already written. The code of the project is written against that draft and',
            'is on the disk too.',
            '',
            'Now write the styles of the page: the rules of the components, the states, the',
            'responsive behaviour, the fine tuning. Keep the tokens of the draft and the names it',
            'gives: the code is already written against them, and a name that changes under the',
            'written code breaks the page.',
            '',
            'If the code needs a state that the draft does not name, add it **to the draft** — a',
            'state that only the styles know about is a state the page never shows.',
        ].join('\n');
    }

    if (who === 'coder') {
        if (isDraftPass(name)) {
            const styles = context.hasStyles
                ? [
                    'The draft of the contract of the styles is on the disk: the tokens, the names of',
                    'the classes and the skeleton of the layout. **Read it first.** The names of your',
                    'classes are the names of that draft and of the markup — not names of your own.',
                    'The tokens you use are the tokens of that draft — not tokens of your own.',
                ]
                : [
                    'The stylesheets of the project are not written yet. Take the names of the classes',
                    'from the markup and the tokens from the brief of the architect, and write them',
                    'down as the contract of your code — the code and the styles will be written',
                    'against the same names.',
                ];
            return [
                `## This pass is the skeleton of the code, not the code`,
                '',
                `The step \`${step.id ?? ''}\` names the files of the code of the project. In this pass`,
                'you write **only the shape** of the code — the skeleton that the rest of the work',
                'is written against:',
                '',
                '- the modules the step names, each with its exports and its imports, and the',
                '  functions the other parts of the project will call, with their arguments and',
                '  what they return.',
                '- the states of the interface, exactly as the brief of the architect names them,',
                '  with exactly those selectors: a state the list does not name is a class the',
                '  styles will never dress, and a state of the list that you skip is a state the',
                '  page never shows.',
                '- the data that flows between the modules: the shape of the objects, the events,',
                '  the names of the fields.',
                '',
                styles.join('\n'),
                '',
                'Do not write the whole behaviour of the modules yet, and do not polish: the next',
                'pass does that, and it will see the styles that were written against your skeleton.',
                'A skeleton that names things wrongly is worse than no skeleton — the next pass will',
                'build on the wrong names.',
            ].join('\n');
        }
        return [
            `## This pass is the code of the page`,
            '',
            `The step \`${step.id ?? ''}\` names the files of the code of the project. The skeleton of`,
            'the code is on the disk, and so are the styles of the page: the styles were written',
            'against your skeleton, and they use the names it gives.',
            '',
            'Now write the code: the behaviour of the modules, the logic, the commands, the error',
            'handling. Keep the names of the skeleton and the names of the stylesheets — the styles',
            'are already written against them, and a name that changes under the written styles',
            'breaks the page.',
            '',
            'If the styles need a state that your skeleton does not have, add it to the skeleton —',
            'a state that only the code knows about is a state the page never shows.',
        ].join('\n');
    }

    return '';
}

/**
 * Блок о проходе для отчёта и для подсказки роли.
 * @param {string} role
 * @param {string} pass
 * @returns {string}
 * @exports
 * @ai.hint pure
 */
export function passNote(role, pass) {
    const who = String(role ?? '').trim().toLowerCase();
    const name = String(pass ?? '').trim().toLowerCase() || 'full';
    // Роль без проходов работает как раньше: заметки о проходе у неё нет.
    if (!PASSES[who]) return '';
    if (!isDraftPass(name)) return '';
    if (who === 'styler') return 'черновик контракта стилей';
    if (who === 'coder') return 'черновик контракта кода';
    return 'черновик контракта';
}
