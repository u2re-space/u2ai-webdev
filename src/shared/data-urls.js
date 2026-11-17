/**
 * @file src/shared/data-urls.js
 * @module shared/data-urls
 * @purpose The data URLs of a message: they are cut out of the text and put into the request
 *          as what they are — a picture or a file.
 *
 *   A message that carries a picture as text carries it twice: once as the base64 and once
 *   as the words around it. The base64 is read by nobody — the model sees a wall of
 *   characters, the request grows by a third of the picture for nothing, and some gateways
 *   refuse such a message altogether.
 *
 *   So the house cuts the data URL out of the text, puts a short note in its place, and
 *   gives the payload to the request as what it is: a picture goes as a picture, a file goes
 *   as a file, a text goes as text. The model sees the same thing, the text stays text, and
 *   the request stays small.
 *
 *   The file is the same in every package of the house: when it changes, it changes
 *   everywhere.
 *
 * @depends none
 * @usedBy openai/responses, roles/index, openai/chat
 * @exports DATA_URL_PATTERN, scrubDataUrls, scrubItems, assetPart, assetNote, dataUrlExtension
 * @ai.tags data-urls, images, requests
 * @ai.hint pure
 */

/**
 * The pattern of a data URL: the type of the file, the parameters, the mark of the base64
 * and the payload.
 */
export const DATA_URL_PATTERN = /data:([a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]+)?((?:;[a-z0-9!#$&^_.+-]+(?:=[^;,]*)?)*)(;base64)?,([^\s"'`<>)\]}]{1,})/gi;

/** The extensions of the files by their type. */
const EXTENSIONS = Object.freeze({
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'image/svg+xml': 'svg',
    'image/avif': 'avif',
    'image/bmp': 'bmp',
    'image/x-icon': 'ico',
    'application/pdf': 'pdf',
    'application/json': 'json',
    'application/zip': 'zip',
    'application/gzip': 'gz',
    'application/octet-stream': 'bin',
    'text/plain': 'txt',
    'text/html': 'html',
    'text/css': 'css',
    'text/csv': 'csv',
    'text/markdown': 'md',
    'text/javascript': 'js',
    'application/javascript': 'js',
});

/**
 * The extension of a file by its type.
 * @param {string} mime
 * @returns {string}
 * @exports
 * @ai.hint pure
 */
export function dataUrlExtension(mime) {
    const type = String(mime ?? '').toLowerCase();
    if (EXTENSIONS[type]) return EXTENSIONS[type];
    // The name of the subtype is the extension: `image/svg+xml` is an svg, and the vendor
    // prefix (`x-whatever`) is not a part of it.
    const name = (type.split('/')[1] ?? '').replace(/^x-/, '').replace(/\+.*$/, '');
    return name.replace(/[^a-z0-9]+/gi, '').slice(0, 8) || 'bin';
}

/**
 * The size of a file in the words of a human.
 * @param {number} bytes
 * @returns {string}
 * @exports
 * @ai.hint pure
 */
function sayBytes(bytes) {
    const size = Number(bytes) || 0;
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * The note that replaces a data URL in the text.
 * @param {{ kind: string, mime: string, bytes: number }} asset
 * @returns {string}
 * @exports
 * @ai.hint pure
 */
export function assetNote(asset) {
    const kind = asset?.kind === 'image' ? 'picture' : asset?.kind === 'text' ? 'text' : 'file';
    return `[${kind} attached: ${asset?.mime ?? 'unknown'}, ${sayBytes(asset?.bytes ?? 0)}]`;
}

/**
 * Cut the data URLs out of a text.
 *
 * The text that is left carries a short note instead of every data URL, and the payloads
 * come back as the assets: a picture, a file or a text.
 * @param {string} text
 * @param {{ minLength?: number }} [options] the shortest data URL that is worth cutting
 * @returns {{ text: string, assets: object[] }}
 * @exports
 * @ai.hint pure
 */
export function scrubDataUrls(text, { minLength = 0 } = {}) {
    const body = String(text ?? '');
    if (!body.includes('data:')) return { text: body, assets: [] };
    const assets = [];
    const pattern = new RegExp(DATA_URL_PATTERN.source, 'gi');
    const out = body.replace(pattern, (match, mime, params, base64, payload) => {
        if (match.length < Math.max(0, Number(minLength) || 0)) return match;
        const type = String(mime || 'text/plain').toLowerCase();
        const isBase64 = Boolean(base64);
        let bytes = Buffer.alloc(0);
        try {
            bytes = isBase64
                ? Buffer.from(payload, 'base64')
                : Buffer.from(decodeURIComponent(payload), 'utf8');
        } catch {
            bytes = Buffer.alloc(0);
        }
        const isText = type.startsWith('text/') && !isBase64;
        const asset = {
            kind: type.startsWith('image/') ? 'image' : isText ? 'text' : 'file',
            mime: type,
            bytes: bytes.length,
            base64: isBase64 ? payload : bytes.toString('base64'),
            text: isText ? bytes.toString('utf8') : null,
            name: `data-${assets.length + 1}.${dataUrlExtension(type)}`,
        };
        assets.push(asset);
        return assetNote(asset);
    });
    return { text: out, assets };
}

/**
 * The part of a request that carries an asset.
 * @param {object} asset the asset of `scrubDataUrls`
 * @returns {object|null}
 * @exports
 * @ai.hint pure
 */
export function assetPart(asset) {
    if (!asset) return null;
    if (asset.kind === 'image') {
        return { type: 'input_image', image_url: `data:${asset.mime};base64,${asset.base64}` };
    }
    if (asset.kind === 'text') {
        return { type: 'input_text', text: String(asset.text ?? '') };
    }
    return { type: 'input_file', filename: asset.name, file_data: asset.base64 };
}

/**
 * Cut the data URLs out of the items of a conversation.
 *
 * The items are the conversation of the role: the answer of a tool, the text of a message.
 * The assets come back, and the caller puts them into the request as the parts they are.
 * @param {object[]} items
 * @param {{ minLength?: number }} [options]
 * @returns {{ items: object[], assets: object[] }}
 * @exports
 * @ai.hint pure
 */
export function scrubItems(items, { minLength = 0 } = {}) {
    const assets = [];
    const out = [];
    const take = (text) => {
        const scrubbed = scrubDataUrls(text, { minLength });
        for (const asset of scrubbed.assets) assets.push(asset);
        return scrubbed.text;
    };
    for (const item of Array.isArray(items) ? items : []) {
        if (!item || typeof item !== 'object') {
            out.push(item);
            continue;
        }
        if (typeof item.output === 'string') {
            out.push({ ...item, output: take(item.output) });
            continue;
        }
        if (Array.isArray(item.content)) {
            const content = [];
            for (const part of item.content) {
                const isText = part && ['input_text', 'output_text', 'text'].includes(part.type);
                content.push(isText ? { ...part, text: take(part.text) } : part);
            }
            out.push({ ...item, content });
            continue;
        }
        if (typeof item.content === 'string') {
            out.push({ ...item, content: take(item.content) });
            continue;
        }
        out.push(item);
    }
    return { items: out, assets };
}
