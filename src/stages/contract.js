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
 * @changed 2026-11-25 У слова «wait» появилась граница слева: `await` — это код, а не
 *                       ожидание роли.
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
 *
 * У слова «wait» есть **граница слева**: без неё ловится `await` — ключевое слово
 * JavaScript, а не ожидание роли. Детектор читает ответ вместе с текстом написанных
 * ролью файлов, и модуль с `await fetch(url)` объявлял роль «ждущей чужую работу».
 *
 * «Пока нет» и «ещё нет» говорят об ожидании только рядом с тем, **кого** ждут:
 * «стилей пока нет», «код ещё не написан». Факт о проекте — «проектных тестов пока
 * нет» — это не ожидание чужой работы, и роль, честно сказавшая о нём, не должна
 * быть отправлена переписывать своё.
 *
 * **Отрицание — не ожидание.** Роль, что сказала «не ждёт стилей» или «does not wait
 * for CSS readiness», ждать не ждёт: она сделала работу и сказала, что она
 * независима. Без этого детектора прогон ругал на шаг, который явно сказал, что не
 * ждёт, — и прогонял его переписывать.
 * @type {RegExp}
 * @exports
 */
export const WAITING_WORDS = new RegExp([
    // Ожидание словами.
    String.raw`\bwait(?:s|ing|ed)?\b`,
    String.raw`i(?:'ll| will) wait\b`,
    String.raw`подожду`,
    String.raw`жду`,
    String.raw`появ(?:ится|ился) позже`,
    String.raw`когда будет`,
    // «Стилей пока нет», «код ещё не написан» — ожидание **соседней роли**.
    // Название работы пишется по-русски, поэтому `\w` не годится: в JavaScript он
    // не берёт кириллицу.
    String.raw`(?:стил[а-яё]*|код[а-яё]*|файл[а-яё]*)\s*(?:пока|ещё|еще)?\s*(?:нет|не\s+написан[а-яё]*|не\s+готов[а-яё]*)`,
    String.raw`(?:нет|не\s+написан[а-яё]*|не\s+готов[а-яё]*)\s*(?:пока|ещё|еще)?\s*(?:стил[а-яё]*|код[а-яё]*|файл[а-яё]*)`,
].join('|'), 'i');

/**
 * Слова отрицания, что ждёт.
 *
 * «не ждёт», «does not wait», «без ожидания», «no need to wait» — роль сказала, что
 * она **не** ждёт, и детектор не должен считать её ожидающей.
 *
 * @type {RegExp}
 * @exports
 */
export const NOT_WAITING_WORDS = new RegExp([
    // «не ждёт», «не нужно ждать», «не требует ожидания»
    String.raw`(?:не\s+нужно\s+)?не\s+(?:жду|ждёт|ждут|ожида[а-яё]*|подожд[а-яё]*)`,
    String.raw`без\s+ожидания`,
    // «does not wait», \"doesn't wait\", \"no need to wait\", \"without waiting\"
    String.raw`\b(?:does\s+not|doesn't|do\s+not|don't)\s+wait\b`,
    String.raw`\bno\s+need\s+to\s+wait\b`,
    String.raw`\bwithout\s+waiting\b`,
    // «не дожидается», «не блокируется»
    String.raw`не\s+дожида[а-яё]*`,
    String.raw`не\s+блокиру[а-яё]*`,
].join('|'), 'i');

/**
 * Ждёт ли роль чужую работу?
 *
 * Отрицание снимает ожидание: «не ждёт стилей» и «does not wait for CSS readiness» —
 * это работа, которая сделана и сказала, что она независима.
 *
 * @param {string} text текст ответа роли
 * @returns {boolean}
 * @exports
 * @ai.hint pure
 */
export function isWaiting(text) {
    const value = String(text ?? '');
    if (!value.trim()) return false;
    if (!WAITING_WORDS.test(value)) return false;
    // Отрицание рядом со словом ожидания снимает его: «не ждёт», «does not wait».
    return !NOT_WAITING_WORDS.test(value);
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
