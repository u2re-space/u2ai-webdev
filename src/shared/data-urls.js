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
 * @exports DATA_URL_PATTERN, scrubDataUrls, scrubItems, assetPart, assetNote, dataUrlExtension,
 *          sniffType, isTextBytes
 * @ai.tags data-urls, images, requests
 * @ai.hint pure
 */

/**
 * The pattern of a data URL: the type of the file, the parameters, the mark of the base64
 * and the payload.
 *
 * The mark of the base64 comes last (`data:text/plain;charset=utf-8;base64,…`), and the
 * parameters must not swallow it: the payload of a base64 data URL is binary, and the
 * payload of a plain one is text.
 */
export const DATA_URL_PATTERN = /data:([a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]+)?((?:;(?!base64\b)[\w.-]+(?:=[^;,]*)?)*)(;base64)?,([^\s"'`<>)\]}]{1,})/gi;

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
 *
 * When the name of the caller and the content differ, both are named: the model knows that
 * the file that came as `application/octet-stream` is a picture.
 * @param {{ kind: string, mime: string, bytes: number, claimed?: string }} asset
 * @returns {string}
 * @exports
 * @ai.hint pure
 */
export function assetNote(asset) {
    const kind = asset?.kind === 'image' ? 'picture' : asset?.kind === 'text' ? 'text' : 'file';
    const claimed = String(asset?.claimed ?? '');
    const type = asset?.mime ?? 'unknown';
    const name = claimed && claimed !== type ? `${claimed} → ${type}` : type;
    return `[${kind} attached: ${name}, ${sayBytes(asset?.bytes ?? 0)}]`;
}

/**
 * The formats the house knows by their first bytes.
 *
 * The name of the type in a data URL is a claim, not a fact: a caller that sends
 * `application/octet-stream` with a picture inside it is common, and so is a `text/plain`
 * with a binary inside it. The house looks at the bytes.
 */
const SIGNATURES = Object.freeze([
    { mime: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
    { mime: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
    { mime: 'image/gif', bytes: [0x47, 0x49, 0x46, 0x38] },
    { mime: 'image/bmp', bytes: [0x42, 0x4d] },
    { mime: 'image/x-icon', bytes: [0x00, 0x00, 0x01, 0x00] },
    { mime: 'image/tiff', bytes: [0x49, 0x49, 0x2a, 0x00] },
    { mime: 'image/qoi', bytes: [0x71, 0x6f, 0x69, 0x66] },
    { mime: 'application/pdf', bytes: [0x25, 0x50, 0x44, 0x46, 0x2d] },
    { mime: 'application/zip', bytes: [0x50, 0x4b, 0x03, 0x04] },
    { mime: 'application/gzip', bytes: [0x1f, 0x8b] },
    { mime: 'application/x-7z-compressed', bytes: [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c] },
    { mime: 'application/vnd.rar', bytes: [0x52, 0x61, 0x72, 0x21] },
    { mime: 'application/x-executable', bytes: [0x7f, 0x45, 0x4c, 0x46] },
    { mime: 'application/vnd.microsoft.portable-executable', bytes: [0x4d, 0x5a] },
    { mime: 'application/wasm', bytes: [0x00, 0x61, 0x73, 0x6d] },
    { mime: 'application/ogg', bytes: [0x4f, 0x67, 0x67, 0x53] },
]);

/** The pictures the API of the model takes as a picture. */
const PICTURE_MIMES = Object.freeze(new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']));

/**
 * Whether the bytes begin with the signature.
 * @param {Buffer} bytes
 * @param {number[]} signature
 * @returns {boolean}
 * @ai.hint pure
 */
function startsWith(bytes, signature) {
    if (!bytes || bytes.length < signature.length) return false;
    for (let index = 0; index < signature.length; index++) {
        if (bytes[index] !== signature[index]) return false;
    }
    return true;
}

/**
 * Whether the bytes are text: no zero bytes and almost no control characters.
 * @param {Buffer} bytes
 * @returns {boolean}
 * @ai.hint pure
 */
function looksLikeText(bytes) {
    if (!bytes?.length) return false;
    let control = 0;
    const sample = bytes.length > 4096 ? bytes.subarray(0, 4096) : bytes;
    for (const byte of sample) {
        if (byte === 0) return false;
        if (byte < 0x09 || (byte > 0x0d && byte < 0x20)) control += 1;
    }
    return control / sample.length < 0.02;
}

/**
 * Do the bytes hold text?
 *
 * The bytes of a picture are not lines: a file that is not text is not read as text.
 * @param {Buffer} bytes
 * @returns {boolean}
 * @exports
 * @ai.hint pure
 */
export function isTextBytes(bytes) {
    return looksLikeText(Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes ?? []));
}

/**
 * What the bytes really are.
 *
 * The name in the data URL is only a hint: the house looks at the content and says what it
 * is. A picture that came as `application/octet-stream` is a picture, and a binary that came
 * as `text/plain` is a file.
 * @param {Buffer} bytes
 * @param {string} [declared] the type the caller named
 * @returns {{ mime: string, kind: 'image'|'text'|'file', text: string|null }}
 * @exports
 * @ai.hint pure
 */
export function sniffType(bytes, declared = '') {
    const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes ?? []);
    const claimed = String(declared ?? '').toLowerCase();
    for (const signature of SIGNATURES) {
        if (!startsWith(buffer, signature.bytes)) continue;
        if (signature.mime === 'image/tiff' && !startsWith(buffer, [0x49, 0x49, 0x2a, 0x00])) continue;
        return {
            mime: signature.mime,
            kind: PICTURE_MIMES.has(signature.mime) ? 'image' : 'file',
            text: null,
        };
    }
    // RIFF: the picture and the sound live in it, and the name of the format is at the
    // eighth byte.
    if (startsWith(buffer, [0x52, 0x49, 0x46, 0x46])) {
        const brand = buffer.subarray(8, 12).toString('ascii');
        if (brand === 'WEBP') return { mime: 'image/webp', kind: 'image', text: null };
        if (brand === 'WAVE') return { mime: 'audio/wav', kind: 'file', text: null };
        if (brand === 'AVI ') return { mime: 'video/x-msvideo', kind: 'file', text: null };
    }
    // The container of the video and of the picture of the new formats: the brand is there.
    if (buffer.length > 12 && buffer.subarray(4, 8).toString('ascii') === 'ftyp') {
        const brand = buffer.subarray(8, 12).toString('ascii').toLowerCase();
        if (brand.startsWith('avif') || brand === 'avis') return { mime: 'image/avif', kind: 'file', text: null };
        if (brand.startsWith('hei') || brand === 'mif1' || brand === 'msf1') {
            return { mime: 'image/heic', kind: 'file', text: null };
        }
        if (brand.startsWith('mp4')) return { mime: 'video/mp4', kind: 'file', text: null };
    }
    if (looksLikeText(buffer)) {
        const text = buffer.toString('utf8');
        const head = text.trimStart().slice(0, 64).toLowerCase();
        if (head.startsWith('<svg') || (head.startsWith('<?xml') && text.includes('<svg'))) {
            return { mime: 'image/svg+xml', kind: 'file', text };
        }
        if (head.startsWith('<!doctype html') || head.startsWith('<html')) {
            return { mime: 'text/html', kind: 'text', text };
        }
        if ((head.startsWith('{') || head.startsWith('[')) && (() => {
            try { JSON.parse(text); return true; } catch { return false; }
        })()) {
            return { mime: 'application/json', kind: 'text', text };
        }
        // The text that says it is a text stays a text, whatever the caller called it.
        return { mime: claimed.startsWith('text/') ? claimed : 'text/plain', kind: 'text', text };
    }
    // The binary that nobody named: the name of the caller is the best that is left.
    return {
        mime: claimed || 'application/octet-stream',
        kind: 'file',
        text: null,
    };
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
        const claimed = String(mime || 'text/plain').toLowerCase();
        const saysBase64 = Boolean(base64);
        let bytes = Buffer.alloc(0);
        let isBase64 = false;
        if (saysBase64) {
            const cleaned = payload.replace(/\s+/g, '');
            bytes = Buffer.from(cleaned, 'base64');
            // The base64 must survive the round trip: otherwise the payload is text that
            // pretends to be a picture.
            const round = bytes.toString('base64').replace(/=+$/, '');
            isBase64 = round === cleaned.replace(/=+$/, '');
            if (!isBase64) bytes = Buffer.from(decodeURIComponent(payload), 'utf8');
        } else {
            try {
                bytes = Buffer.from(decodeURIComponent(payload), 'utf8');
            } catch {
                bytes = Buffer.from(payload, 'utf8');
            }
        }
        // The name of the caller is a claim; the bytes are the fact.
        const sniffed = sniffType(bytes, claimed);
        const kind = sniffed.kind;
        const asset = {
            kind,
            mime: sniffed.mime,
            claimed,
            bytes: bytes.length,
            base64: isBase64 ? payload.replace(/\s+/g, '') : bytes.toString('base64'),
            text: kind === 'text' ? sniffed.text : null,
            name: `data-${assets.length + 1}.${dataUrlExtension(sniffed.mime)}`,
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
