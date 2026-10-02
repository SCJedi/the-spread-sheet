# The Spread Sheet

AGENTS.md is the working contract for this project: architecture, data model, the invariants that must never break, and how to run, test, deploy and extend. Read it before changing code.

@AGENTS.md

## Also
- Setup steps, links and brand facts for every guide come from `docs/GUIDE-FACTS.md`. Change a fact there first, then update README.md, START-HERE.txt, public/setup-guide.html, AGENTS.md and llms.txt to match.
- `reference/` and `.review/` are local only and gitignored. They hold a real group's data and must never be committed or quoted in docs.
- The public demo runs from `wrangler.demo.toml` (`DEMO=1`). Normal installs use `wrangler.toml`.
