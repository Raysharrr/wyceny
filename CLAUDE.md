# CLAUDE.md — wyceny-app

This is the wyceny app code. Knowledge, PRD, ADRs, and decisions live in the WIKI repo `make-it-simple-rayshar/wyceny` (locally `~/Development/wyceny`) — follow them. Reference PRD/ADR/fitness-function IDs in code, commits, and tests.

## CodeGraph

This repo is indexed by CodeGraph (`.codegraph/`, auto-synced by a file watcher). To understand or locate code, reach for it BEFORE grep/find or reading files: MCP tool `codegraph_explore` (one call: relevant symbols' verbatim source + call paths), or shell `codegraph explore "<symbols or question>"` — same output. Name a file or symbol in the query to get its line-numbered source. Trust results without re-verifying via grep.
