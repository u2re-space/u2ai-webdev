/**
 * @file test/craft.test.js
 * @module test/craft
 * @purpose Tests of the craft of the roles: the effort follows the kind of the file, the
 *          schema follows it too, and the frame of the page reaches the role that writes
 *          the styles.
 *
 *   These are the things that broke when the roles `markup`, `styler`, `coder` and
 *   `animator` became one role `builder`: вид файла перестал доходить до роли, и стили
 *   писались на чужом усилии, по чужой схеме и без контракта кадра.
 *
 * @depends node:test, roles/index, roles/chunks, roles/page-frame, stages/roles
 * @ai.tags test, roles, craft, effort
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveRole, roleSchemaForKind } from '../src/roles/index.js';
import { chunksFor, PHASES } from '../src/roles/chunks.js';
import { pageFrameContractFor } from '../src/roles/page-frame.js';
import { planRole, roleForFiles, kindsOfFiles } from '../src/stages/roles.js';
import { defaults } from '../src/config.js';

test('the effort of the role follows the kind of the file', () => {
    // Таблица стилей требует больше мысли, чем скрипт.
    const style = resolveRole('builder', defaults, { stage: 'write', phase: 'work', kind: 'style' });
    const code = resolveRole('builder', defaults, { stage: 'write', phase: 'work', kind: 'code' });
    assert.equal(style.effort, 'high');
    assert.equal(code.effort, 'medium');
});

test('the schema of the answer follows the kind of the file', () => {
    // Шаг со стилями отвечает схемой стилей: токены — часть его ответа.
    const style = roleSchemaForKind('builder', 'style');
    assert.ok(style.properties.tokens, 'the answer of the styles names its tokens');
    assert.ok(style.properties.files);
    // Шаг со скриптом отвечает схемой кода: команды и файлы.
    const code = roleSchemaForKind('builder', 'code');
    assert.ok(code.properties.commands);
    assert.equal(code.properties.tokens, undefined);
});

test('the role that writes the styles knows the craft of the styles', () => {
    const chunks = chunksFor({ role: 'builder', phase: PHASES.WRITE, files: ['styles.scss'] });
    assert.ok(chunks.some((chunk) => chunk.id === 'styles'), 'the rules of the styles come to the writer');
});

test('the role that writes the styles knows the frame of the page', () => {
    // Контракт кадра — это соглашение разметки и стилей: без него страница остаётся
    // без `--zoom` и без `container-type`.
    const frame = pageFrameContractFor('builder');
    assert.ok(frame.length > 0, 'the builder carries the frame of the page');
    assert.match(frame, /--real-page-width/);
    assert.match(frame, /--zoom/);
});

test('a raster belongs to the artist', () => {
    // Растр — работа художника: он его готовит, векторизует и кладёт на место.
    assert.equal(roleForFiles(['assets/icon.png']), 'artist');
    assert.equal(roleForFiles(['assets/logo.svg']), 'artist');
    assert.equal(roleForFiles(['assets/photo.webp']), 'artist');
});

test('a step of the graphics is not lost and not given to the markup', () => {
    // Шаг `assets` называет разметку и кропы: работа его — в кропах.
    const files = [
        'index.html',
        'measurements/crops/02-asset-chess-piece.png',
        'measurements/crops/03-asset-numbered-board.png',
        'measurements/crops/05-asset-award-badge.png',
    ];
    const kinds = kindsOfFiles(files);
    assert.ok(kinds.has('artist'));
    assert.ok(kinds.has('markup'));

    const resolved = planRole('markup', files, { id: 'assets', title: 'The graphics of the page' });
    assert.equal(resolved.role, 'artist');
    assert.equal(resolved.dropped, false);
    assert.match(resolved.warning, /artist/);
});

test('the named role wins a tie of the kinds of the files', () => {
    // Шаг, что называет поровну разметку и стили, остаётся у того, кто его назвал.
    const resolved = planRole('styler', ['index.html', 'styles.scss'], { id: 'work', title: 'The work' });
    assert.equal(resolved.role, 'styler');
});

test('the artist is told what has to become a vector', () => {
    const rules = chunksFor({ role: 'artist', phase: PHASES.WRITE, files: ['assets/icon.png'] })
        .map((chunk) => chunk.text).join('\n');
    assert.match(rules, /What has to become a vector/);
    assert.match(rules, /vectorize/);
});
