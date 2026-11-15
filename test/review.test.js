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
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';

import {
    reviewVerdict,
    worstVerdict,
    readScreenshots,
    readReview,
    issueOwner,
    repairText,
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
        config: { output: { work: './.tmp' }, stages: { review: { repair: false } } },
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

test('the owner of a file of an issue is the step that wrote it', () => {
    const owner = issueOwner(PLAN, { path: 'src/main.js', message: 'x', requestedChange: 'y' });
    assert.equal(owner.step.id, 'code-1');
    assert.equal(owner.role, 'coder');

    const markup = issueOwner(PLAN, { path: 'index.html', message: 'x', requestedChange: 'y' });
    assert.equal(markup.role, 'markup');

    // A file that no step names is guessed by its extension.
    const unknown = issueOwner({ steps: [] }, { path: 'src/styles.scss', message: 'x', requestedChange: 'y' });
    assert.equal(unknown.role, 'styler');
});

test('the request of the repair names the file, the defect and the change', () => {
    const text = repairText({ id: 'code-1', files: ['src/main.js'] }, [{
        severity: 'high',
        path: 'src/main.js',
        message: 'The entry does not run.',
        requestedChange: 'Fix the import.',
    }]);

    assert.match(text, /src\/main\.js/);
    assert.match(text, /The entry does not run\./);
    assert.match(text, /Fix the import\./);
    assert.match(text, /write the\s+file back under the same path/i);
});

test('the review repairs what it found and judges the result again', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-repair-'));
    await mkdir(path.join(root, 'src'), { recursive: true });
    await writeFile(path.join(root, 'src', 'main.js'), 'export const x = 1;\n', 'utf8');
    const one = {
        summary: 'A landing.',
        steps: [
            { id: 'code-1', title: 'Code', role: 'coder', dependsOn: [], files: ['src/main.js'], criteria: ['runs'] },
        ],
    };
    let asked = null;
    const client = fakeClient([
        // The first pass: the review finds the defect.
        schemaAnswer('review', {
            verdict: 'fail',
            scores: { fidelity: 40, completeness: 50, accessibility: 30, quality: 40 },
            issues: [{
                severity: 'high',
                path: 'src/main.js',
                message: 'The entry does not run.',
                requestedChange: 'Fix the import.',
            }],
            summary: 'The code does not work.',
            recommendations: [],
        }),
        // The repair: the role of the file writes it back.
        (body) => {
            asked = body;
            return schemaAnswer('code', {
                summary: 'The import is fixed.',
                files: [{ path: 'src/main.js', content: "import './styles.scss';\n", language: 'javascript' }],
                commands: [],
                notes: '',
            });
        },
        // The second pass: the step is judged again.
        schemaAnswer('review', {
            verdict: 'pass',
            scores: { fidelity: 90, completeness: 100, accessibility: 80, quality: 85 },
            issues: [],
            summary: 'The code works now.',
            recommendations: [],
        }),
    ]);

    const result = await reviewStage({
        client,
        config: { output: { work: './.tmp' } },
        root,
        task: 'Make a landing.',
        plan: one,
        runId: 'run-1',
    });

    // The file of the defect is on the disk with the change that was asked for.
    assert.match(await readFile(path.join(root, 'src', 'main.js'), 'utf8'), /import '\.\/styles\.scss'/);
    // The role that owns the file was the one that was asked.
    assert.match(asked.instructions, /You are the coder/);
    assert.match(asked.instructions, /read the file, make the change, write the/i);
    // The verdict is the verdict of the second pass.
    assert.equal(result.verdict, 'pass');
    assert.equal(result.ok, true);
    assert.deepEqual(result.issues, []);
    assert.equal(result.repair.repaired.length, 1);
    assert.equal(result.repair.repaired[0].role, 'coder');
});

test('the repair is off when the config says so', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-repair-off-'));
    const client = fakeClient([schemaAnswer('review', {
        verdict: 'fail',
        scores: { fidelity: 40, completeness: 50, accessibility: 30, quality: 40 },
        issues: [{ severity: 'high', path: 'src/main.js', message: 'The entry does not run.', requestedChange: 'Fix it.' }],
        summary: 'The code does not work.',
        recommendations: [],
    })]);

    const result = await reviewStage({
        client,
        config: { output: { work: './.tmp' }, stages: { review: { repair: false } } },
        root,
        task: 'Make a landing.',
        plan: PLAN,
        runId: 'run-1',
    });

    assert.equal(result.verdict, 'fail');
    assert.equal(result.repair, null);
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
