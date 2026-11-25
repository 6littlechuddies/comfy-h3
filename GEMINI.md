# For coding agents

Read `docs/HANDOFF.md` first: who you're working for, the lines already decided, how the pieces fit, how to check your
work without a GPU, and what's unfinished. Then `docs/HOW_IT_WORKS.md` for the whole setup, `scripts/claude/CLAUDE.md`
for working on a live rental, and `docs/site/` for the urgf.ai site (Factory API, Burak's chat spec, the card fix pack).

Short version of the rules: plain-English answers for a non-developer owner; adults 21+ only and stop anything sexual on
any hint of a minor; characters answer honestly when sincerely asked if they're an AI; no secrets in the repo; check with
`npx tsc --noEmit -p .`, `npx vite build` (in `studio/`) and a Python `ast.parse` of `scripts/studio_server.py` before
pushing to `main`.
