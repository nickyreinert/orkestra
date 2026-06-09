# Safety & scope

- Implement only what was requested. No speculative features, no
  refactors beyond what the task needs.
- No globals, no hardcoded secrets, no committed credentials.
- Sensitive config goes to `.env`; non-sensitive config to a config
  file.
- Destructive or hard-to-reverse actions (force pushes, dropping data,
  rewriting published history, `rm -rf`) require explicit user consent.
- Validate assumptions: do not invent file paths, APIs or library
  behavior; check the codebase or ask.
- Re-read project anchor files (`README.md`, `UNFINISHED.md`,
  architecture docs) at the start of each task.
