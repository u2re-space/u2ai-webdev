/**
 * @file src/agent/tool-pointer.js
 * @module agent/tool-pointer
 * @purpose The names of the house that are tools, and not skill packs.
 *
 *   Роль путает скилл и инструмент: «ai-image» — это не пак скиллов, а соседняя программа,
 *   которую зовут через инструмент `call_ai_image`. Инструмент чтения скиллов отвечает на
 *   такое имя указателем на инструмент, а не отказом: отказ молчит, а указатель учит.
 *
 * @usedBy agent/tools
 * @exports HOUSE_TOOL_NAMES, toolForName
 * @ai.tags tools, skills
 * @ai.hint pure
 */

/**
 * Имя дома — и инструмент, который его делает.
 * @type {Readonly<Record<string, string>>}
 * @exports
 * @ai.hint pure
 */
export const HOUSE_TOOL_NAMES = Object.freeze({
    'ai-image': 'call_ai_image',
    'ai-measure': 'call_ai_measure',
    'ai-decompose': 'call_ai_decompose',
    'ai-memory': 'call_ai_memory',
    'image': 'call_ai_image',
    'measure': 'call_ai_measure',
    'decompose': 'call_ai_decompose',
    'memory': 'call_ai_memory',
    'magick': 'magick',
    'imagemagick': 'magick',
    'ai-cli': 'ai_cli',
    'ai_cli': 'ai_cli',
});

/**
 * The tool that does the work of a name of the house.
 * @param {string} name
 * @returns {string|null} the name of the tool, or null when the name is not one of them
 * @exports
 * @ai.hint pure
 */
export function toolForName(name) {
    const key = String(name ?? '').trim().toLowerCase();
    return HOUSE_TOOL_NAMES[key] ?? null;
}
