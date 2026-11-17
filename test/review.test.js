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
    markupSnapshot,
    stylePairIssues,
    reviewStage,
} from '../src/stages/review.js';
import { readAudit, auditStage, auditContext, auditListing, buildReport, AUDIT_CORRECTION } from '../src/stages/audit.js';
import { instructions as auditorInstructions } from '../src/roles/auditor.js';
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

/**
 * The prompt of the stage: the text of the request of the model.
 * @param {object} body
 * @returns {string}
 * @ai.hint pure
 */
function promptOf(body) {
    const items = Array.isArray(body?.input) ? body.input : [];
    return items
        .flatMap((item) => (Array.isArray(item?.content) ? item.content : []))
        .map((part) => String(part?.text ?? ''))
        .join('\n');
}

/**
 * The answer of the auditor: a report of the project.
 * @returns {object}
 * @ai.hint pure
 */
function auditAnswer() {
    return schemaAnswer('review', {
        verdict: 'partial',
        scores: { fidelity: 60, completeness: 70, accessibility: 50, quality: 65 },
        issues: [{ severity: 'medium', path: 'main.js', message: 'The bundle is heavy.', requestedChange: 'Split the vendor.' }],
        summary: 'The project works but is slow.',
        recommendations: ['Split the bundle.'],
    });
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

test('the request of the second repair says that the first one did not work', () => {
    const text = repairText({ id: 'code-1', files: ['src/main.js'] }, [{
        severity: 'high',
        path: 'src/main.js',
        message: 'The entry does not run.',
        requestedChange: 'Fix the import.',
    }], { again: true });

    assert.match(text, /last repair did not close the defect/i);
    assert.match(text, /Read it again/i);
});

test('the request of the repair keeps the contract with the styles', () => {
    const text = repairText({ id: 'markup-1', files: ['index.html'] }, [{
        severity: 'high',
        path: 'index.html',
        message: 'The title is wrong.',
        requestedChange: 'Fix the title.',
    }]);

    assert.match(text, /class names are a contract with the styles/i);
});

test('the classes of the markup without a rule are a defect of the styles', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-pairs-'));
    await writeFile(path.join(root, 'index.html'), '<div class="landing hero__title"></div>', 'utf8');
    await writeFile(path.join(root, 'styles.scss'), '.landing { color: red; }\n', 'utf8');

    const issues = await stylePairIssues({
        root,
        before: ['hero__title', 'landing'],
        current: ['hero__title', 'landing'],
        markup: ['index.html'],
        styles: ['styles.scss'],
    });

    assert.equal(issues.length, 1);
    assert.equal(issues[0].path, 'styles.scss');
    assert.match(issues[0].message, /hero__title/);
    assert.match(issues[0].requestedChange, /hero__title/);
});

test('the renamed classes are a defect of the markup', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-pairs-'));
    await writeFile(path.join(root, 'index.html'), '<div class="landing hero__headline"></div>', 'utf8');
    await writeFile(path.join(root, 'styles.scss'), '.landing { color: red; }\n.hero-card__title { color: red; }\n', 'utf8');

    const issues = await stylePairIssues({
        root,
        before: ['hero-card__title', 'landing'],
        current: ['hero__headline', 'landing'],
        markup: ['index.html'],
        styles: ['styles.scss'],
    });

    assert.equal(issues.length, 1);
    assert.equal(issues[0].path, 'index.html');
    assert.match(issues[0].message, /hero-card__title/);
    assert.match(issues[0].requestedChange, /hero-card__title/);
});

test('the snapshot of the markup names the classes of the project', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-pairs-'));
    await writeFile(path.join(root, 'index.html'), '<div class="landing"></div>', 'utf8');
    await writeFile(path.join(root, 'styles.scss'), '.landing { color: red; }\n', 'utf8');

    const shot = await markupSnapshot(root, null);
    assert.deepEqual(shot.classes, ['landing']);
    assert.deepEqual(shot.markup, ['index.html']);
    assert.deepEqual(shot.styles, ['styles.scss']);
});

test('the repair that renames the classes is caught and the names are restored', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-rename-'));
    await writeFile(path.join(root, 'index.html'), '<div class="hero-card__title">A</div>', 'utf8');
    await writeFile(path.join(root, 'styles.scss'), '.hero-card__title { color: red; }\n', 'utf8');
    const plan = {
        summary: 'A landing.',
        steps: [
            { id: 'markup-1', title: 'Markup', role: 'markup', dependsOn: [], files: ['index.html'], criteria: ['opens'] },
        ],
    };
    const markupAnswer = (content) => schemaAnswer('markup', {
        summary: 'The markup is written.',
        files: [{ path: 'index.html', content, language: 'html' }],
        landmarks: [],
        accessibility: [],
        notes: '',
    });
    const asked = [];
    const client = fakeClient([
        // The review of the step finds a defect.
        schemaAnswer('review', {
            verdict: 'fail',
            scores: { fidelity: 40, completeness: 50, accessibility: 30, quality: 40 },
            issues: [{
                severity: 'high',
                path: 'index.html',
                message: 'The title is not a heading.',
                requestedChange: 'Make it an h1.',
            }],
            summary: 'The title is wrong.',
            recommendations: [],
        }),
        // The repair rewrites the file and renames the class on the way.
        (body) => {
            asked.push(body);
            return markupAnswer('<h1 class="hero__headline">A</h1>');
        },
        // The step is judged again and the defect is gone.
        schemaAnswer('review', {
            verdict: 'pass',
            scores: { fidelity: 90, completeness: 100, accessibility: 80, quality: 85 },
            issues: [],
            summary: 'The title is a heading now.',
            recommendations: [],
        }),
        // The second round: the check of the names asks the markup to restore them.
        (body) => {
            asked.push(body);
            return markupAnswer('<h1 class="hero-card__title">A</h1>');
        },
        schemaAnswer('review', {
            verdict: 'pass',
            scores: { fidelity: 90, completeness: 100, accessibility: 80, quality: 85 },
            issues: [],
            summary: 'The names are the same as the styles.',
            recommendations: [],
        }),
    ]);

    const result = await reviewStage({
        client,
        config: { output: { work: './.tmp' } },
        root,
        task: 'Make a landing.',
        plan,
        runId: 'run-1',
    });

    // The names of the styles are back on the disk.
    assert.match(await readFile(path.join(root, 'index.html'), 'utf8'), /hero-card__title/);
    // The second repair was told which names to bring back.
    assert.match(JSON.stringify(asked[1].input), /hero-card__title/);
    assert.equal(result.repair.repaired.length, 2);
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
    // The role is told to change the broken lines with a patch, not to rewrite the file.
    assert.match(asked.instructions, /find the place of the defect with/i);
    assert.match(asked.instructions, /patch_file/i);
    // The verdict is the verdict of the second pass.
    assert.equal(result.verdict, 'pass');
    assert.equal(result.ok, true);
    assert.deepEqual(result.issues, []);
    assert.equal(result.repair.repaired.length, 1);
    assert.equal(result.repair.repaired[0].role, 'coder');
});

test('the findings are on the disk before the repair starts', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-repair-disk-'));
    await mkdir(path.join(root, 'src'), { recursive: true });
    await writeFile(path.join(root, 'src', 'main.js'), 'export const x = 1;\n', 'utf8');
    const one = {
        summary: 'A landing.',
        steps: [
            { id: 'code-1', title: 'Code', role: 'coder', dependsOn: [], files: ['src/main.js'], criteria: ['runs'] },
        ],
    };
    let onDisk = null;
    const client = fakeClient([
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
        async () => {
            // The repair has not started yet: the findings are already on the disk.
            onDisk = JSON.parse(await readFile(path.join(root, '.tmp', 'run-1', 'review.json'), 'utf8'));
            return schemaAnswer('code', {
                summary: 'The import is fixed.',
                files: [{ path: 'src/main.js', content: "import './styles.scss';\n", language: 'javascript' }],
                commands: [],
                notes: '',
            });
        },
        schemaAnswer('review', {
            verdict: 'pass',
            scores: { fidelity: 90, completeness: 100, accessibility: 80, quality: 85 },
            issues: [],
            summary: 'The code works now.',
            recommendations: [],
        }),
    ]);

    await reviewStage({
        client,
        config: { output: { work: './.tmp' } },
        root,
        task: 'Make a landing.',
        plan: one,
        runId: 'run-1',
    });

    assert.equal(onDisk.verdict, 'fail');
    assert.equal(onDisk.issues.length, 1);
    assert.equal(onDisk.issues[0].path, 'src/main.js');
});

test('the review repairs again what the first repair did not fix', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-repair-again-'));
    await mkdir(path.join(root, 'src'), { recursive: true });
    await writeFile(path.join(root, 'src', 'main.js'), 'export const x = 1;\n', 'utf8');
    const one = {
        summary: 'A landing.',
        steps: [
            { id: 'code-1', title: 'Code', role: 'coder', dependsOn: [], files: ['src/main.js'], criteria: ['runs'] },
        ],
    };
    const issue = {
        severity: 'high',
        path: 'src/main.js',
        message: 'The entry does not run.',
        requestedChange: 'Fix the import.',
    };
    const found = schemaAnswer('review', {
        verdict: 'fail',
        scores: { fidelity: 40, completeness: 50, accessibility: 30, quality: 40 },
        issues: [issue],
        summary: 'The code does not work.',
        recommendations: [],
    });
    const repair = () => schemaAnswer('code', {
        summary: 'The import is fixed.',
        files: [{ path: 'src/main.js', content: "import './styles.scss';\n", language: 'javascript' }],
        commands: [],
        notes: '',
    });
    let repairs = 0;
    const client = fakeClient([
        found,
        () => { repairs++; return repair(); },
        // The step is judged again and the defect is still there.
        found,
        () => { repairs++; return repair(); },
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

    // The role that owns the file was asked twice: the first repair did not close the defect.
    assert.equal(repairs, 2);
    assert.equal(result.verdict, 'pass');
    assert.equal(result.repair.repaired.length, 2);
});

test('the repair stops when the rounds are over', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-repair-rounds-'));
    await mkdir(path.join(root, 'src'), { recursive: true });
    await writeFile(path.join(root, 'src', 'main.js'), 'export const x = 1;\n', 'utf8');
    const one = {
        summary: 'A landing.',
        steps: [
            { id: 'code-1', title: 'Code', role: 'coder', dependsOn: [], files: ['src/main.js'], criteria: ['runs'] },
        ],
    };
    const found = schemaAnswer('review', {
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
    });
    let repairs = 0;
    const client = fakeClient([
        found,
        () => {
            repairs++;
            return schemaAnswer('code', {
                summary: 'The import is fixed.',
                files: [{ path: 'src/main.js', content: "import './styles.scss';\n", language: 'javascript' }],
                commands: [],
                notes: '',
            });
        },
        found,
    ]);

    const result = await reviewStage({
        client,
        config: { output: { work: './.tmp' }, stages: { review: { repairRounds: 1 } } },
        root,
        task: 'Make a landing.',
        plan: one,
        runId: 'run-1',
    });

    // One round, one repair: the defect that is still there is named in the verdict.
    assert.equal(repairs, 1);
    assert.equal(result.verdict, 'fail');
    assert.equal(result.issues.length, 1);
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

test('the audit sees the files that are on the disk', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-audit2-'));
    await writeFile(path.join(root, 'package.json'), '{"name":"landing"}', 'utf8');
    await writeFile(path.join(root, 'vite.config.js'), 'export default {};', 'utf8');
    await writeFile(path.join(root, 'main.js'), 'console.log(1);', 'utf8');
    await mkdir(path.join(root, 'src'), { recursive: true });
    await writeFile(path.join(root, 'src', 'main.js'), 'console.log(2);', 'utf8');

    const bodies = [];
    const client = fakeClient([(body) => {
        bodies.push(body);
        return auditAnswer();
    }]);

    const result = await auditStage({
        client,
        // The model is pinned to a JSON answer: it never calls a tool, and the truth has to
        // be in the context.
        config: { output: { work: './.tmp' }, model: 'minimax/minimax-m3.1-flash' },
        root,
        task: 'Make a landing.',
        plan: PLAN,
        runId: 'run-1',
    });

    assert.equal(result.ok, true);
    assert.equal(bodies.length, 1);

    const prompt = promptOf(bodies[0]);
    assert.match(prompt, /The project on the disk/);
    assert.match(prompt, /package\.json/);
    assert.match(prompt, /vite\.config\.js/);
    assert.match(prompt, /src\/main\.js/);

    // The report says what the auditor saw.
    assert.equal(result.audit.seen.files > 0, true);
    assert.equal(result.audit.seen.tools, 0);
    assert.ok(result.warnings.some((item) => /не вызывает инструменты/.test(item)));
});

test('the audit knows the build of the project and the design of the task', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-audit3-'));
    const bodies = [];
    const client = fakeClient([(body) => {
        bodies.push(body);
        return auditAnswer();
    }]);

    await auditStage({
        client,
        config: { output: { work: './.tmp' }, model: 'minimax/minimax-m3.1-flash' },
        root,
        task: 'Make a landing.',
        plan: PLAN,
        inputs: {
            task: 'Make a landing.',
            design: { present: true, tokens: [{ name: '--color-bg', value: '#ffffff' }], typography: [], spacing: [], components: [], layout: [] },
            palette: { present: true, colors: [{ token: '--color-bg', hex: '#ffffff' }] },
        },
        build: {
            markup: 'index.html',
            script: 'main.js',
            vite: true,
            entry: 'styles.scss',
            styles: ['styles.scss'],
            links: ['styles.css'],
            errors: [],
            missing: [],
        },
        runId: 'run-1',
    });

    const prompt = promptOf(bodies[0]);
    assert.match(prompt, /The build of the project/);
    assert.match(prompt, /index\.html/);
    assert.match(prompt, /main\.js/);
    assert.match(prompt, /# The design of the task/);
    assert.match(prompt, /--color-bg/);
});

test('the auditor that read nothing is asked again', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-audit4-'));
    const bodies = [];
    const client = fakeClient([
        (body) => {
            bodies.push(body);
            return auditAnswer();
        },
        (body) => {
            bodies.push(body);
            return auditAnswer();
        },
    ]);

    const result = await auditStage({
        client,
        config: { output: { work: './.tmp' } },
        root,
        task: 'Make a landing.',
        plan: PLAN,
        runId: 'run-1',
    });

    // The model may call the tools: it is asked once more, and the schema moves into the
    // channel of the tools.
    assert.equal(bodies.length, 2);
    assert.match(promptOf(bodies[1]), /You have not looked at the project/);
    assert.ok(result.warnings.some((item) => /был спрошен ещё раз/.test(item)));
});

test('the report of the build says what the build did', () => {
    const text = buildReport({
        markup: 'index.html',
        script: 'main.js',
        vite: true,
        entry: 'styles.scss',
        styles: ['styles.scss'],
        links: ['styles.css'],
        errors: [{ file: 'styles.scss', message: 'Expected "}"' }],
        missing: ['styles.css'],
    });
    assert.match(text, /The build of the project/);
    assert.match(text, /styles\.scss: Expected "\}"/);
    assert.match(text, /styles\.css/);
    assert.equal(buildReport(null), '');
});

test('the context of the audit holds the listing, the build and the design', () => {
    const text = auditContext({
        listing: { text: 'index.html  (8.7 KB)', count: 1, truncated: false },
        build: { markup: 'index.html', styles: ['styles.scss'], links: [], errors: [] },
        design: '# Task\nMake a landing.',
    });
    assert.match(text, /The project on the disk/);
    assert.match(text, /index\.html  \(8\.7 KB\)/);
    assert.match(text, /The build of the project/);
    assert.match(text, /# The design of the task/);
});

test('the listing of the audit does not fall over an empty project', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-webdev-audit5-'));
    const listing = await auditListing(root);
    assert.equal(listing.count, 0);
    assert.ok(listing.text.length > 0);
});

test('the auditor is told to read the project before the verdict', () => {
    const prompt = auditorInstructions({ task: 'Make a landing.', design: '# Task' });
    assert.match(prompt, /Read the project before the verdict/);
    assert.match(prompt, /run_command/);
    assert.match(prompt, /The design of the task is in the task context/);
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
