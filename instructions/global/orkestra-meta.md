# Orkestra meta — how this project is wired

This project was scaffolded by **Orkestra**. Read this before changing
any guidance file.

## What is generated vs. authored

The following files in this repo are **rendered output** and should not
be edited by hand. They carry a marker like:

```
<!-- orkestra:generated source=<source-id> adapter=<adapter> -->
```

Typical generated targets:

- `.github/copilot-instructions.md`, `.github/instructions/*.md`
- `CLAUDE.md`, `.claude/**`
- `AGENTS.md`
- `.orkestra/instructions/**` (raw mirror of the sources)

The **sources** live in the Orkestra distribution
(`~/.orkestra/instructions/` and `~/.orkestra/templates/<name>/`). Edit
those, then re-render with `orkestra render`.

## Flow when the user asks "/orkestra update X"

1. Identify which **source** owns the guidance the user wants to change
   (look up the `source=` attribute in the generated marker, or check
   `.orkestra/manifest.yaml`).
2. Edit the source file in `~/.orkestra/...`.
3. Run `orkestra render` from the project root. Verify by re-reading
   the generated targets.
4. Do **not** edit the generated files directly — they will be
   overwritten on the next render.

## Flow when the user asks "/orkestra suggest <url>"

1. Fetch the URL (a markdown file, gist, or instruction snippet).
2. Decide which existing source it most closely relates to. Ask the
   user if ambiguous; do not guess silently.
3. Produce a unified diff against that source. Do not apply it
   automatically.
4. Show the diff, summarize what would change, and wait for the user
   to run `orkestra suggest <url> --apply` (or to say "apply it").

## Manifest

`.orkestra/manifest.yaml` lists every source that contributed to the
current render plus its `sha256`. Use it to detect drift between the
distribution and the project, and to know which adapters are active.

## Hard rules

- Never bypass the render pipeline by writing directly to a generated
  target.
- Never delete `.orkestra/manifest.yaml`; it is the contract between
  the project and the distribution.
- When uncertain which file is source vs. generated, ask.
