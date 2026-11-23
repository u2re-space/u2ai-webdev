# NOTICE — the copy of the pack `file-search`

This directory is a vendored copy of the skill pack `file-search` of
<https://github.com/netresearch/file-search-skill> (version 1.8.5).

- The texts of `SKILL.md` and of `references/*.md` are copied without changes, except for one
  block at the top of `SKILL.md`: the note "In this harness" that tells the role which of its
  own tools answers each line of the table of the pack.
- The licenses of the upstream pack travel with it: `LICENSE-MIT` and
  `LICENSE-CC-BY-SA-4.0`, Copyright (c) 2025-2026 Netresearch DTT GmbH.
- The copy is the last of the skill directories the run looks at: the copy of the project
  wins over the copy of the home, and both win over this one.

## What this harness adds

The pack describes the command line tools of the search (`rg`, `fd`, `sg`, `rga`, `tokei`,
`scc`, `semgrep`). The roles of `@u2ai/webdev` have their own tools, and the pack is read
next to them:

| What the pack says | What the run does |
|---|---|
| `rg` for the text of the files | the tool `search_files` (`path`, `content`, `symbol`, `all`; `glob`, `exclude`, `context`, `caseSensitive`, `maxResults`) |
| `fd` for the names of the files | `search_files` with `scope: path` and `inContent: 0`, and the tool `list_files` |
| `sg` for the structural search | `search_files` with `regex: true` over the names of the declared symbols (`scope: symbol`) |
| `Grep` and `Glob` | `search_files` and `list_files` |
| `Bash(rg:*)` | the tool `run_command` — only the roles that have a shell; the styler and the roles of the vector stage have none |

The references of the pack (`references/*.md`) are read with the `read_skill` tool and the
`file` parameter: `read_skill` with the name `file-search` and the file
`references/ripgrep-patterns.md`.
