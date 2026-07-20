# Project Guardrails

<!--
  Team-shared instructions. Committed to Git. Loaded at the start of every session.
  Keep this SHORT — focus on preventing mistakes, not describing the codebase.
  Let Claude read files/append rules for itself after errors.
-->

## Rules for writing

- Keep instructions short and imperative; describe outcomes, not narration.
- When a mistake happens, add a rule here instead of repeating the correction.
- Avoid verbose prose. One line per rule where possible.

## Development workflow

<!-- Real build/test/run commands. Claude uses these to verify its own work. -->

```bash
# install
# <your install command>

# run
# <your run command>

# test (verification-first: Claude should run this before claiming done)
# <your test command>

# lint / typecheck
# <your lint command>
```

## Code style conventions

- <language/framework conventions>
- <naming, formatting, import order>
- <error-handling expectations — only validate at system boundaries>

## Architecture overview

- <top-level modules and what they own>
- <where to add new features vs. where NOT to touch>

## Gotchas

<!-- Real traps that have burned people. This section grows over time. -->

- <known footgun 1>
- <known footgun 2>
