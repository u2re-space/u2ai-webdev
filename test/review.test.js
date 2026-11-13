/**
 * @file test/review.test.js
 * @module test/review
 * @purpose The tests of the review, the audit and the lessons: the last stages of a run.
 * @depends node:test, node:path, node:fs/promises, stages/review, stages/audit, stages/learn
 * @ai.tags test, stages, review
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';

import {
    reviewVerdict,
    worstVerdict,
    readScreenshots,
    readReview,
    reviewStage,
} from '../src/stages/review.js';
import { readAudit, auditStage } from '../src/stages/audit.js';
import { parseLessons, readLessons, learnStage } from '../src/stages/learn.js';

/**
 * A client that answers with the ready answers, one per call.
 * @param {object[]} answers
 * @returns {object}
 * @ai.hint pure
 */
function fakeClient(answers = []) {
    let index = 0;
    return {
        responses: {
            /**
             * @param {object} body
             * @returns {Promise<object>}
             */
            async create(body) {
                const answer = answers[index++];
                if (typeof answer === 'function') return await answer(body);
                return answer ?? { output: [], output_text: '' };
            },
        },
    };
}

/**
 * A raw answer of the model: the call of the schema with its arguments.
 * @param {string} name the name of the schema
 * @param {object} args
 * @returns {object}
 * @ai.hint pure
 */
function schemaAnswer(name, args) {
    return {
        id: 'resp-1',
        status: 'completed',
        model: 'test-model',
        output: [{
            type: 'function_call',
            id: 'fc-1',
            call_id: `c-${Math.random().toString(36).slice(2)}`,
            name,
            arguments: JSON.stringify(args),
        }],
    };
}

/**
 * An answer of a role without a schema: the plain text.
 * @param {string} text
 * @returns {object}
 * @ai.hint pure
 */
function textAnswer(text) {
    return {
        id: 'resp-1',
        status: 'completed',
        model: 'test-model',
        output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] }],
        output_text: text,
    };
}

const PLAN = {
    summary: 'A landing.',
    steps: [
        { id: 'markup-1', title: 'Markup', role: 'markup', dependsOn: [], files: ['index.html'], criteria: ['opens'] },
        { id: 'code-1', title: 'Code', role: 'coder', dependsOn: ['markup-1'], files: ['src/main.js'], criteria: ['runs'] },
    ],
};

test('the verdict of an answer is one of the three', () => {
    assert.equal(reviewVerdict('pass'), 'pass');
    assert.equal(reviewVerdict('FAIL'), 'fail');
    assert.equal(reviewVerdict('unknown'), 'partial');
    assert.equal(reviewVerdict(null), 'partial');
});

test('the worst verdict of a list wins', () => {
    assert.equal(worstVerdict(['pass', 'pass']), 'pass');
    assert.equal(worstVerdict(['pass', 'partial']), 'partial');
    assert.equal(worstVerdict(['partial', 'fail']), 'fail');
    assert.equal(worstVerdict([]), 'pass');
});

test('the screenshots are read as the pictures of the request', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-shots-'));
    await writeFile(path.join(root, 'shot.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]), 'utf8');
    const shots = await readScreenshots(root, ['shot.png', 'missing.png']);
    assert.equal(shots.parts.length, 1);
    assert.deepEqual(shots.names, ['shot.png']);
    assert.match(shots.parts[0].image_url, /^data:image\/png;base64,/);
    assert.equal(shots.warnings.length, 1);
});

test('the stage of the review judges every step and takes the worst verdict', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-review-'));
    const client = fakeClient([
        schemaAnswer('review', {
            verdict: 'pass',
            scores: { fidelity: 90, completeness: 100, accessibility: 80, quality: 85 },
            issues: [],
            summary: 'The markup is fine.',
            recommendations: [],
        }),
        schemaAnswer('review', {
            verdict: 'fail',
            scores: { fidelity: 40, completeness: 50, accessibility: 30, quality: 40 },
            issues: [{ severity: 'high', path: 'src/main.js', message: 'The entry does not run.', requestedChange: 'Fix the import.' }],
            summary: 'The code does not work.',
            recommendations: ['Fix the entry.'],
        }),
    ]);

    const result = await reviewStage({
        client,
        config: { output: { work: './.tmp' } },
        root,
        task: 'Make a landing.',
        plan: PLAN,
        runId: 'run-1',
    });

    assert.equal(result.verdict, 'fail');
    assert.equal(result.ok, false);
    assert.equal(result.reviews.length, 2);
    assert.equal(result.issues.length, 1);
    assert.match(result.file, /review\.json$/);

    const saved = await readReview(root, { output: { work: './.tmp' } }, 'run-1');
    assert.equal(saved.verdict, 'fail');
    assert.equal(saved.issues[0].path, 'src/main.js');
});

test('the review without a step to look at fails honestly', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-review2-'));
    const result = await reviewStage({
        client: fakeClient([]),
        config: {},
        root,
        task: 'Make a landing.',
        plan: { steps: [] },
        runId: 'run-1',
    });
    assert.equal(result.ok, false);
    assert.equal(result.verdict, 'fail');
    assert.ok(result.warnings.length);
});

test('the audit looks at the project as a whole', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-audit-'));
    const client = fakeClient([schemaAnswer('review', {
        verdict: 'partial',
        scores: { fidelity: 60, completeness: 70, accessibility: 50, quality: 65 },
        issues: [{ severity: 'medium', path: '', message: 'The bundle is heavy.', requestedChange: 'Split the vendor.' }],
        summary: 'The project works but is slow.',
        recommendations: ['Split the bundle.'],
    })]);

    const result = await auditStage({
        client,
        config: { output: { work: './.tmp' } },
        root,
        task: 'Make a landing.',
        plan: PLAN,
        runId: 'run-1',
    });

    assert.equal(result.ok, true);
    assert.equal(result.verdict, 'partial');
    assert.equal(result.issues.length, 1);
    assert.match(result.file, /audit\.json$/);

    const saved = await readAudit(root, { output: { work: './.tmp' } }, 'run-1');
    assert.equal(saved.verdict, 'partial');
});

test('the lessons of the learner are parsed out of the text', () => {
    const lessons = parseLessons([
        '- [fact] The project uses Vite.',
        '- The tokens live in tokens.css.',
        '1. [pitfall] The build fails without the fonts.',
        '* [unknown-kind] The kind is not known.',
        'Just a line without a dash.',
        '- [fact] The project uses Vite.',
    ].join('\n'));

    assert.equal(lessons.length, 4);
    assert.equal(lessons[0].kind, 'fact');
    assert.equal(lessons[1].kind, 'note');
    assert.equal(lessons[2].kind, 'pitfall');
    assert.equal(lessons[3].kind, 'note');
    // The repeated lesson is dropped: the same fact is written once.
    assert.ok(lessons.every((lesson) => lesson.text !== 'The project uses Vite.' || lessons.filter((item) => item.text === lesson.text).length === 1));
});

test('the stage of the lessons writes the list into the run', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-learn-'));
    const client = fakeClient([textAnswer('- [fact] The project uses Vite.\n- [decision] The tokens live in tokens.css.')]);

    const result = await learnStage({
        client,
        config: { output: { work: './.tmp' } },
        root,
        task: 'Make a landing.',
        plan: PLAN,
        review: { issues: [{ severity: 'low', path: 'index.html', message: 'No meta viewport.', requestedChange: 'Add it.' }] },
        runId: 'run-1',
    });

    assert.equal(result.ok, true);
    assert.equal(result.lessons.length, 2);
    assert.equal(result.lessons[0].kind, 'fact');
    assert.match(result.file, /lessons\.json$/);

    const saved = await readLessons(root, { output: { work: './.tmp' } }, 'run-1');
    assert.equal(saved.length, 2);
    assert.match(await readFile(result.file, 'utf8'), /tokens\.css/);
});

test('a run without lessons gives an empty list', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-learn2-'));
    assert.deepEqual(await readLessons(root, { output: { work: './.tmp' } }, 'run-1'), []);
});
