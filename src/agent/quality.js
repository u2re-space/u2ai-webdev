/**
 * @file src/agent/quality.js
 * @module agent/quality
 * @purpose Judge a finished piece of work: turn the answers of a model into one verdict.
 *
 * The verdicts are three, not two: `pass`, `partial` and `fail`. A result that is close to the
 * task but not complete is worth its own verdict, because the caller may repair it instead of
 * throwing it away.
 *
 * The schema of the answer belongs to the caller: this module knows how to read a verdict, not
 * what a verdict must contain.
 *
 * @depends openai/responses
 * @usedBy stages/review, stages/audit, roles/reviewer
 * @exports VERDICTS, normalizeVerdict, verdictFromScores, assessQuality
 * @ai.tags quality, review
 * @ai.hint io
 */

import { parseResponse } from '../openai/responses.js';

/** The verdicts of a review. */
export const VERDICTS = Object.freeze(['pass', 'partial', 'fail']);

/** The spellings of a verdict that other packages use. */
const VERDICT_ALIASES = Object.freeze({
    pass: 'pass', accept: 'pass', accepted: 'pass', ok: 'pass', good: 'pass',
    partial: 'partial', revise: 'partial', retry: 'partial', mixed: 'partial',
    fail: 'fail', failed: 'fail', reject: 'fail', rejected: 'fail', bad: 'fail',
});

/**
 * The canonical verdict of an answer.
 * @param {unknown} value
 * @returns {'pass'|'partial'|'fail'|null} null when the answer names no verdict
 * @exports
 * @ai.hint pure
 */
export function normalizeVerdict(value) {
    if (typeof value !== 'string') return null;
    return VERDICT_ALIASES[value.trim().toLowerCase()] ?? null;
}

/**
 * Turn the scores of an answer into a verdict.
 *
 * The scores are numbers from 0 to 1. The mean of the scores decides: at `passAt` and above the
 * work passes, below `failAt` it fails, in between it is partial. A missing score is not a
 * failure — it is a score nobody took, and the mean is taken over the scores that are there.
 * @param {Record<string, number>} scores
 * @param {{ passAt?: number, failAt?: number }} [thresholds]
 * @returns {{ verdict: 'pass'|'partial'|'fail', mean: number|null, count: number }}
 * @exports
 * @ai.hint pure
 */
export function verdictFromScores(scores, { passAt = 0.7, failAt = 0.4 } = {}) {
    const values = Object.values(scores ?? {})
        .map((value) => (typeof value === 'number' && Number.isFinite(value) ? value : null))
        .filter((value) => value !== null);
    if (!values.length) return { verdict: 'partial', mean: null, count: 0 };
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    const verdict = mean >= passAt ? 'pass' : mean < failAt ? 'fail' : 'partial';
    return { verdict, mean, count: values.length };
}

/**
 * Ask a model to judge the result and read its verdict.
 *
 * The caller gives the schema of the answer and the text to judge. A model that answers nothing
 * usable is not a reason to fail the run: the answer comes back as a partial verdict with the
 * reason in it.
 * @param {{ client: object, model: string, instructions?: string, input?: string|object[],
 *   parts?: object[], schema?: object, schemaName?: string, effort?: string|null,
 *   signal?: AbortSignal|null, notify?: (event: object) => void }} request
 * @returns {Promise<{ verdict: 'pass'|'partial'|'fail', scores: object, issues: object[],
 *   summary: string, model: string, usage: object|null }>}
 * @exports
 * @ai.hint io
 */
export async function assessQuality({
    client,
    model,
    instructions = null,
    input = null,
    parts = null,
    schema = null,
    schemaName = 'assessment',
    effort = null,
    signal = null,
    notify = () => {},
}) {
    if (!client?.responses) throw new Error('Клиент API не передан.');
    if (typeof model !== 'string' || !model.trim()) throw new Error('Модель оценки не указана.');

    const raw = await client.responses.create({
        model,
        instructions,
        input,
        parts,
        schema,
        schemaName,
        effort,
        signal,
    });

    const parsed = parseResponse(raw);
    // A strict schema may come back as a function call instead of text.
    const answer = parsed.data ?? callArguments(parsed.toolCalls, schemaName);
    const scores = {};
    const issues = [];
    let verdict = null;

    if (answer && typeof answer === 'object') {
        verdict = normalizeVerdict(answer.verdict);
        for (const [name, value] of Object.entries(answer.scores ?? {})) {
            if (typeof value === 'number' && Number.isFinite(value)) scores[name] = value;
        }
        for (const issue of Array.isArray(answer.issues) ? answer.issues : []) {
            if (!issue || typeof issue !== 'object') continue;
            issues.push({
                severity: String(issue.severity ?? 'medium'),
                path: issue.path ?? null,
                message: String(issue.message ?? ''),
                requestedChange: issue.requestedChange ?? null,
            });
        }
    }

    if (!verdict) {
        const scored = verdictFromScores(scores);
        // The model named no verdict: the scores speak for it, and without scores the work is
        // only partially checked.
        verdict = scored.count ? scored.verdict : 'partial';
        if (!scored.count) {
            issues.push({
                severity: 'medium',
                path: null,
                message: 'Модель не дала вердикт и не дала оценок.',
                requestedChange: 'Повторить проверку с более узким критерием.',
            });
        }
    }

    const summary = typeof answer?.summary === 'string' && answer.summary.trim()
        ? answer.summary.trim()
        : `вердикт: ${verdict}`;

    notify({ type: 'quality.assessed', verdict, scores, issues: issues.length });

    return {
        verdict,
        scores,
        issues,
        summary,
        model: parsed.model ?? model,
        usage: parsed.usage ?? null,
    };
}

/**
 * The arguments of the tool call named `schemaName`, parsed as JSON.
 * @param {object[]} toolCalls
 * @param {string} schemaName
 * @returns {object|null}
 * @ai.hint pure
 */
function callArguments(toolCalls, schemaName) {
    const call = (toolCalls ?? []).find((item) => item?.name === schemaName) ?? (toolCalls ?? [])[0];
    const args = call?.arguments;
    if (args && typeof args === 'object') return args;
    if (typeof args !== 'string') return null;
    try {
        const parsed = JSON.parse(args);
        return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
        return null;
    }
}
