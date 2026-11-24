/**
 * @file src/stages/pass-tasks.js
 * @module stages/pass-tasks
 * @purpose Задача прохода: что роль делает в этом заходе и чего от неё ждут.
 *
 *   Проходы нужны не для красоты: без них роль ждёт того, что появляется после неё.
 *   Кодер без контракта не знает, каких имён классов ждёт страница, и пишет свои — а
 *   стилест потом переименовывает их, и код рассыпается. Стилест без скелета кода не
 *   знает, каких состояний ждать, и не пишет правил для них.
 *
 *   Порядок решает это: сначала кодер пишет скелет по разметке и брифу архитектора —
 *   модули, состояния, поток данных, — потом стилест пишет контракт стилей по этому
 *   скелету, и только потом обе роли делают свою работу целиком — видя, что написала
 *   другая.
 *
 * @depends stages/pass
 * @usedBy stages/step, roles/coder, roles/styler
 * @exports passTask, passNote, isDraftPass
 * @ai.tags stages, passes, roles
 * @ai.hint pure
 * @changed 2026-11-24 Проходы роли: скелет кода, потом контракт стилей, потом работа целиком.
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
                `## This pass is the contract of the styles — write it whole`,
                '',
                `The step \`${step.id ?? ''}\` names the stylesheets of the project. In this pass you`,
                'write the **contract** that the rest of the run is written against. The skeleton of',
                'the code is already on the disk: the modules, the states of the interface and the',
                'data that flows between them. You dress exactly what it names. The next pass of',
                'this role is the second pass over the same file, and it runs on a cheaper model:',
                'the work that is not done here will be done there, and it will be done worse.',
                '',
                'Write **all of it**, in this order:',
                '',
                '1. **The tokens.** Every custom property the page needs: the colours (the',
                '   surface, the text, the borders, the accents, the states of them), the spacing',
                '   scale, the radii, the shadows, the type scale, the z-index layers. Give every',
                '   token a name that says what it is, not how it looks: `--color-surface`, not',
                '   `--grey-500`. The tokens are the contract between the styles and the code.',
                '2. **The names of the classes.** The class names the markup has, as they will be',
                '   dressed by the rules, and the ones the skeleton of the code will add. A short',
                '   list with a word about what each one is for.',
                '3. **The skeleton of the layout.** The regions of the page and their order — the',
                '   header, the main area, the sidebar, the footer — and the grid or the flex that',
                '   holds them.',
                '4. **The rules of the components.** Every component of the page, with its rules:',
                '   the card, the button, the field, the list, the panel, the dialog, whatever the',
                '   design asks for. The rule of a component is written here, and the next pass',
                '   only polishes it.',
                '5. **The rules of the states.** Every state the brief of the architect and the',
                '   skeleton of the code name, with the selectors exactly as they are named there,',
                '   and the pseudo-classes that belong to a control: `:hover`, `:focus-visible`,',
                '   `:active`, `:disabled`.',
                '6. **The responsive behaviour.** The breakpoints and what changes at each of',
                '   them: the columns that fold, the navigation that collapses, the text that',
                '   reflows.',
                '',
                'The next pass polishes this file on a cheaper model. Everything you leave out',
                'here will be written from scratch there — and it will be written against the',
                'names you chose here, or against other names, and the two will not agree.',
                '',
                'Write the file the step names, whole. Do not write a description of the styles:',
                'write the styles.',
            ].join('\n');
        }
        return [
            `## This pass is the polish of the styles`,
            '',
            `The step \`${step.id ?? ''}\` names the stylesheets of the project. The contract of the`,
            'styles is already on the disk: the tokens, the names of the classes, the skeleton of',
            'the layout, the rules of the components and the rules of the states. It was written',
            'by the model that is good at this, and it is whole.',
            '',
            'Now go over it once and make it right:',
            '',
            '- the rules that the code needs and the contract does not have — add them, keeping',
            '  the names and the tokens that are already there.',
            '- the rules that do not match the markup or the code — fix them.',
            '- the fine tuning: the spacing that is off, the contrast that is low, the line',
            '  height, the focus ring, the scrollbar, the narrow screen.',
            '- the states of the interface that the brief of the architect and the skeleton of',
            '  the code name, with the selectors exactly as they are named there.',
            '',
            'Keep the tokens and the names of the contract: the code is already written against',
            'them, and a name that changes under the written code breaks the page. Do not start',
            'the styles over — they are written, and this pass is the second look at them.',
            '',
            'If you cannot finish, finish what matters most: the tokens, the names and the rules',
            'of the states. Say in the report what is not done.',
        ].join('\n');
    }

    if (who === 'coder') {
        if (isDraftPass(name)) {
            const styles = context.hasStyles
                ? [
                    'The contract of the styles is on the disk: the tokens, the names of the classes,',
                    'the skeleton of the layout, the rules of the components and the rules of the',
                    'states. **Read it first.** The names of your classes are the names of that',
                    'contract and of the markup — not names of your own. The tokens you use are the',
                    'tokens of that contract — not tokens of your own.',
                ]
                : [
                    'The stylesheets of the project are not written yet — they are written after you,',
                    'against the contract you write here. Take the names of the classes from the',
                    'markup and the tokens from the brief of the architect, and write them down as',
                    'the contract of your code — the styles will be written against exactly these',
                    'names.',
                ];
            return [
                `## This pass is the contract of the code — write it whole`,
                '',
                `The step \`${step.id ?? ''}\` names the files of the code of the project. In this pass`,
                'you write the **contract** that the rest of the run is written against. The markup',
                'of the page is already on the disk: your skeleton grows out of it. The next pass',
                'of this role is the second pass over the same files, and it runs on a cheaper',
                'model: the work that is not done here will be done there, and it will be done',
                'worse.',
                '',
                'Write **all of it**:',
                '',
                '1. **The modules.** Every module the step names, with its imports, its exports',
                '   and the functions the other parts of the project will call — with their',
                '   arguments, what they return and what they may throw.',
                '2. **The states of the interface.** Exactly as the brief of the architect names',
                '   them, with exactly those selectors: a state the list does not name is a class',
                '   the styles will never dress, and a state of the list that you skip is a state',
                '   the page never shows.',
                '3. **The data.** The shape of the objects that flow between the modules, the',
                '   events, the names of the fields — and the tokens of the styles that the values',
                '   of the interface will wear.',
                '4. **The behaviour.** The logic of each module, the commands, the error handling,',
                '   the lifecycle — written as it will be, not as a stub.',
                '',
                styles.join('\n'),
                '',
                'The next pass polishes these files on a cheaper model. Everything you leave out',
                'here will be written from scratch there — against the names you chose here, or',
                'against other names, and the two will not agree.',
                '',
                'A contract that names things wrongly is worse than no contract: the next pass',
                'builds on the wrong names.',
            ].join('\n');
        }
        return [
            `## This pass is the code of the page`,
            '',
            `The step \`${step.id ?? ''}\` names the files of the code of the project. The contract of`,
            'the code is already on the disk: the modules, the exports, the states of the',
            'interface, the data and the behaviour. It was written by the model that is good at',
            'this, and it is whole. The styles of the page are on the disk too: they were written',
            'against that contract, and they use the names it gives.',
            '',
            'Now go over it once and make it right:',
            '',
            '- the logic that does not do what the step asks, and the errors that are not handled.',
            '- the states the brief of the architect names, with exactly those selectors.',
            '- the fine tuning: the long text, the empty list, the slow connection, the keyboard,',
            '  the lifecycle of the page.',
            '',
            'Keep the names of the contract and the names of the stylesheets: the styles are',
            'already written against them, and a name that changes under the written styles breaks',
            'the page. Do not start the code over — it is written, and this pass is the second',
            'look at it.',
            '',
            'If you cannot finish, finish what matters most: the states, the data and the main',
            'path. Say in the report what is not done.',
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
    if (who === 'styler') return 'контракт стилей';
    if (who === 'coder') return 'контракт кода';
    return 'контракт';
}
