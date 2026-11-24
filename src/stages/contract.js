/**
 * @file src/stages/contract.js
 * @module stages/contract
 * @purpose Контракт фазы: что роль берёт у соседней фазы, и чего она не ждёт.
 *
 *   Старая болезнь прогона: роль ждала чужую работу. Кодеру нужны были стили, чтобы
 *   знать имена классов; стилелю нужен был код, чтобы знать состояния. Роль доходила до
 *   конца своих шагов, не находя чужой работы, и уходила дальше — или останавливалась,
 *   и прогон стоял.
 *
 *   Порядок фаз решает это наполовину: скелет кода идёт сразу после разметки, черновик
 *   стилей — после скелета. Но порядок сам по себе не помогает, если роль внутри своей
 *   фазы решит, что ей чего-то не хватает. Вот это и случалось: стилест видел на диске
 *   разметку без правил и решал, что «кода ещё нет, подожду».
 *
 *   Здесь — правило, которое говорит роль прямо: **контракт, а не ожидание**. У соседней
 *   фазы есть контракт — набор имён, состояний и токенов, о котором обе стороны знают
 *   заранее. Роль берёт контракт и работает по нему, даже если полная работа соседа ещё
 *   не написана. Ждать нечего: сосед напишет своё по этому же контракту.
 *
 * @depends stages/pass
 * @usedBy stages/step, roles/coder, roles/styler, stages/index
 * @exports CONTRACTS, contractOf, contractNote, isWaiting, WAITING_WORDS
 * @ai.tags stages, contract, deadlock
 * @ai.hint pure
 * @changed 2026-11-24 Контракт фазы вместо ожидания соседней работы.
 */

/**
 * Контракты соседних фаз: роль — и что она берёт у соседа.
 *
 * `styles` — контракт стилей (токены, имена классов, состояния), `code` — контракт
 * кода (модули, состояния, поток данных). Оба пишутся **до** той работы, которая по
 * ним пишется, и обе стороны знают их заранее.
 * @type {Readonly<Record<string, ReadonlyArray<string>>>}
 * @exports
 */
export const CONTRACTS = Object.freeze({
    coder: Object.freeze(['styles']),
    styler: Object.freeze(['code']),
    animator: Object.freeze(['styles']),
    iconifier: Object.freeze(['styles']),
});

/**
 * Контракты роли.
 * @param {string} role
 * @returns {string[]}
 * @exports
 * @ai.hint pure
 */
export function contractOf(role) {
    const key = String(role ?? '').trim().toLowerCase();
    return [...(CONTRACTS[key] ?? [])];
}

/**
 * Слова, по которым видно, что роль ждёт чужую работу.
 *
 * Роль, которая говорит «стилей ещё нет» или «код появится позже», не делает работу —
 * она ждёт. Прогон должен сказать ей: ждать нечего, вот контракт.
 *
 * Слова выбраны узко: «missing» или «later» сами по себе ничего не значат — файл может
 * отсутствовать по своей причине, а «после» — обычное слово о порядке. Ловится только
 * явное ожидание: «жду», «подожду», «появится позже», «когда будет готов».
 * @type {RegExp}
 * @exports
 */
export const WAITING_WORDS = /(?:wait(?:s|ing|ed)?\b|i(?:'ll| will) wait\b|подожду|жду|появ(?:ится|ился) позже|когда будет|ещ[её] нет|не готов(?:ы|о)?|не написан(?:ы|о)?|пока нет|once (?:the|it)\b|when (?:the|it) is (?:ready|written|there)\b)/i;

/**
 * Ждёт ли роль чужую работу?
 *
 * @param {string} text текст ответа роли
 * @returns {boolean}
 * @exports
 * @ai.hint pure
 */
export function isWaiting(text) {
    const value = String(text ?? '');
    if (!value.trim()) return false;
    return WAITING_WORDS.test(value);
}

/**
 * Правило контракта для роли: текст, который говорит, что ждать нечего.
 *
 * @param {string} role
 * @param {{ hasStyles?: boolean, hasCode?: boolean }} [context]
 * @returns {string}
 * @exports
 * @ai.hint pure
 */
export function contractNote(role, context = {}) {
    const key = String(role ?? '').trim().toLowerCase();
    const list = contractOf(key);
    if (!list.length) return '';
    const blocks = [];

    if (list.includes('styles')) {
        blocks.push(context.hasStyles
            ? `The contract of the styles is on the disk: read it and work against its tokens and its
names. That contract is the whole agreement between the styles and the code — the other side
writes against it too, whether or not the full styles are written yet.`
            : `The contract of the styles is the list of tokens, the names of the classes and the
states that the architect named. The other side writes against exactly that list. Work against
it: take the tokens and the class names from the brief and from the markup, and write your code
with them.`);
    }
    if (list.includes('code')) {
        blocks.push(context.hasCode
            ? `The contract of the code is on the disk: read it and work against its modules and its
states. That contract is the whole agreement between the code and the styles — the other side
writes against it too, whether or not the full code is written yet.`
            : `The contract of the code is the list of modules, the states of the interface and the
data that flows between them. The other side writes against exactly that list. Work against it:
take the states from the brief of the architect, and write the rules for them.`);
    }

    if (!blocks.length) return '';
    return [
        '## Nothing to wait for',
        ...blocks,
        '',
        '**Do not wait for the work of another role, and do not stop because it is not there.**',
        'The other role writes its part against the same contract, and it will arrive later —',
        'your part does not depend on it being finished. A step that ends with a word is better',
        'than a step that never ends: if you cannot do all of it, do what the contract names and',
        'say in the report what is not done.',
    ].join('\n');
}
