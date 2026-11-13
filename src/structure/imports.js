/**
 * @file src/structure/imports.js
 * @module structure/imports
 * @purpose Sort the leading import block of a module and the names inside each import.
 *
 *   The order of the groups is the one of a real project: the directives first, then the
 *   side effects, then the packages, then the own modules, then the relative paths, and the
 *   re-exports at the end. A file without imports is returned unchanged.
 *
 * @depends none
 * @usedBy structure/structure
 * @exports DEFAULT_IMPORT_ORDER, sortImports
 * @ai.tags structure, imports
 * @ai.hint pure
 * @ai.hint legacy-0.2
 * @changed 2026-11-13 Ported from the monolith: the sort of the import block.
 */

/** The groups of the imports, in the order they appear in the file. */
export const DEFAULT_IMPORT_ORDER = Object.freeze(['directive', 'side-effect', 'external', 'internal', 'relative', 'export']);

/**
 * Sort the named specifiers inside one brace list. The marker `type` stays on its specifier.
 * @param {string} list the text between the braces
 * @returns {string}
 * @ai.hint pure
 */
function sortSpecifiers(list) {
    const parts = list.split(',').map((part) => part.trim()).filter(Boolean);
    const key = (part) => (part.replace(/^type\s+/, '').split(/\s+as\s+/i).pop() ?? part).trim();
    parts.sort((a, b) => key(a).localeCompare(key(b)));
    return parts.join(', ');
}

/**
 * Classify one import or re-export and sort its named specifiers.
 * @param {string} statement one statement that ends at the semicolon
 * @param {string[]} internalPrefixes the module prefixes treated as internal, such as `@/`
 * @returns {{ group: string, text: string, comment: string }}
 * @ai.hint pure
 */
function classifyStatement(statement, internalPrefixes) {
    const commentLines = [];
    const codeLines = [];
    for (const line of statement.split('\n')) {
        if (/^\s*\/\//.test(line) && codeLines.length === 0) commentLines.push(line.trimEnd());
        else codeLines.push(line);
    }
    let code = codeLines.join('\n').trim();
    code = code.replace(/\{([^}]*)\}/, (_, list) => `{ ${sortSpecifiers(list)} }`);
    if (!code.endsWith(';')) code += ';';
    const from = code.match(/from\s+['"]([^'"]+)['"]/);
    const side = code.match(/^import\s+['"]([^'"]+)['"]/);
    const specifier = from?.[1] ?? side?.[1] ?? '';
    let group = 'external';
    if (/^export\s/.test(code)) group = 'export';
    else if (side && !from) group = 'side-effect';
    else if (specifier.startsWith('.') || specifier.startsWith('/')) group = 'relative';
    else if (internalPrefixes.some((prefix) => specifier.startsWith(prefix))) group = 'internal';
    return { group, text: code, comment: commentLines.join('\n') };
}

/**
 * True when the line opens an import or a re-export. A value export does not.
 * @param {string} line
 * @returns {boolean}
 * @ai.hint pure
 */
function startsImport(line) {
    const trimmed = line.trim();
    return /^import\b/.test(trimmed) || /^export\s+(?:\*|\{|type\s+\{)/.test(trimmed);
}

/**
 * Sort the leading import block. The shebang and the directives stay above it.
 * @param {string} text the source text
 * @param {{ importOrder?: string[], internalPrefixes?: string[] }} [rules]
 * @returns {string}
 * @exports
 * @ai.hint pure
 */
export function sortImports(text, rules = {}) {
    const newline = text.includes('\r\n') ? '\r\n' : '\n';
    const lines = text.split(/\r?\n/);
    let index = 0;
    const head = [];
    if (lines[0]?.startsWith('#!')) head.push(lines[index++]);
    while (index < lines.length && /^\s*['"]use (client|strict|server)['"];?\s*$/.test(lines[index])) head.push(lines[index++]);
    const block = [];
    let seenImport = false;
    let open = false;
    while (index < lines.length) {
        const line = lines[index];
        const trimmed = line.trim();
        if (open) {
            block.push(line);
            index++;
            if (/;\s*$/.test(trimmed)) open = false;
            continue;
        }
        if (trimmed === '' || trimmed.startsWith('//') || trimmed.startsWith('/*')) {
            const next = lines.slice(index + 1).find((item) => item.trim());
            if (seenImport && next && (startsImport(next) || next.trim().startsWith('//') || next.trim().startsWith('/*'))) {
                block.push(line);
                index++;
                continue;
            }
            break;
        }
        if (!startsImport(line)) break;
        seenImport = true;
        block.push(line);
        index++;
        if (!/;\s*$/.test(trimmed)) open = true;
    }
    if (!seenImport) return text;

    const statements = [];
    let pending = [];
    const flush = () => {
        const raw = pending.join('\n').trim();
        pending = [];
        if (!raw || raw.split('\n').every((line) => /^\s*\/\//.test(line) || !line.trim())) return;
        statements.push(raw);
    };
    for (const line of block) {
        pending.push(line);
        if (/;\s*$/.test(line) || (/^\s*import\s+['"]/.test(line) && /['"]\s*;?\s*$/.test(line))) flush();
    }
    flush();

    const prefixes = rules.internalPrefixes ?? ['@/', '~/'];
    const order = rules.importOrder ?? DEFAULT_IMPORT_ORDER;
    const ranked = statements.map((statement) => classifyStatement(statement, prefixes));
    ranked.sort((a, b) => {
        const group = order.indexOf(a.group) - order.indexOf(b.group);
        if (group) return group;
        return a.text.localeCompare(b.text);
    });

    const printed = [];
    let lastGroup = '';
    for (const item of ranked) {
        if (printed.length && item.group !== lastGroup) printed.push('');
        if (item.comment) printed.push(item.comment);
        printed.push(item.text);
        lastGroup = item.group;
    }

    const rest = lines.slice(index);
    // The blank line between the block and the code below it is added only when there is code.
    const separator = rest.some((line) => line.trim()) ? [''] : [];
    const body = [
        ...head,
        ...(head.length && printed.length ? [''] : []),
        ...printed,
        ...separator,
        ...rest,
    ];
    return body.join(newline).replace(/\n{3,}/g, '\n\n');
}
