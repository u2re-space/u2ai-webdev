# The origin of this pack

This directory is a copy of the skill `modern-web-guidance` of the repository
<https://github.com/GoogleChrome/modern-web-guidance> (the branch `main`), taken on
2026-11-14.

| What | Where |
|---|---|
| The upstream | `skills/modern-web-guidance/SKILL.md` and `skills/modern-web-guidance/guides/**` |
| The license | Apache-2.0, the file `LICENSE` next to this note |
| The steward | The Google Chrome, Microsoft Edge, Mozilla Firefox and MDN teams |

The guides are the words of their authors: they are copied here as they are, and
`ai-webdev` reads them from the disk.

## What the copy adds

Three edits, and nothing else:

1. The section `## In ai-webdev` in `SKILL.md`: the tool `web_guidance` reads the guides
   of this directory, so the search and the retrieve need no network and no npm. The
   `npx` commands of the upstream stay as the fallback.
2. The two notes under the commands of the search and of the retrieve: they point at the
   tool.
3. This note and the file `LICENSE`.

The rules of the pack — the workflow, the fallbacks, the compatibility data, the
disclosure of the usage — are the rules of the upstream.

## How to update the copy

Take the upstream again and keep the three edits. The ids of the guides are the names of
the files under `guides/`, so a new guide is a new file: nothing else has to change.
