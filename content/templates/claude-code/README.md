# Claude Code — Boilerplate

Best-practice default scaffold for **Claude Code**, derived from the
_Claude Code: Operational Reference_.

Deploy the contents of this folder into the **root of a target project**.

## What gets deployed

| File / Dir | Scope | Commit to Git? | Purpose |
|---|---|---|---|
| `CLAUDE.md` | Project | Yes | Team guardrails, loaded every session |
| `CLAUDE.local.md` | Project | **No (git-ignore)** | Personal notes / reviewer feedback |
| `.claude/settings.json` | Project | Yes | Permissions, env, hooks |
| `.claude/skills/*/SKILL.md` | Project | Yes | Reusable expertise, invoked via slash command |
| `.claude/agents/*.md` | Project | Yes | Custom subagent definitions |
| `.claude/rules/*.md` | Project | Yes | Path-gated rules (apply only to matching paths) |

## After deployment

Add the personal driver file to the project's `.gitignore`:

```gitignore
# Claude Code personal notes (do not commit)
CLAUDE.local.md
```

## Guiding premises

- **Agent, not chatbot** — delegate tasks, let it run autonomously.
- **Verification-first** — always give Claude a way to verify its own work.
- **Compounding engineering** — every mistake/feedback becomes a written rule.
- **Workflow order** — Explore → Plan → Code (don't let it code first).
