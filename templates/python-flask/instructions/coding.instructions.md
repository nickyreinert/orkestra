# Coding Phase Instructions

## Naming
- Func: descriptive_snake_case
- Files: snake_case.py / kebab-case.js
- Tests: test_[module].py

## Code
- Group similar funcs in same file
- Prefer classes
- Func: 10–20 lines max
- Files: < 200 lines
- Spec compliance first: Follow WHATWG HTML5 spec exactly. No heuristics, no shortcuts.
- No exceptions in hot paths: Use deterministic control flow, not try/except for branching.
- No reflective probing: No hasattr, getattr, or delattr - all data structures used are deterministic.
- Minimal allocations: Reuse buffers, avoid per-token object creation in tokenizer.
- Token reuse: Create new token objects when emitting (don't reuse references).
- State machine purity: Tokenizer state transitions follow spec state machine exactly.
- No test-specific code: No references to test files in comments or code.

## Documentation
- plain English only, alphanumeric only, no special chars
- omnipresent docstrings (Google style)
- brief, bulletpoints
- infile and inline comments explain why (spec rationale), not what (code is self-documenting)
- document per file at each file's header, contains: purpose, main funcs, dependendent files
- document per function at each function's header, contains: purpose, input data, output data, process, dependendent functions and classes
- create sections between functions and classes with clear markers within files to seperate concerns, e.g.:
    - Python: `# --- UI OPS ---`
    - HTML: `<!-- --- UI OPS --- -->`

## Logging
- plain English only, alphanumeric only, no special chars
- Use utils/logger.py
- "recursive level approach": log on each "branch" of execution tree
- use indention to indicate depth
- levels:
    - 1. Level: app start/end
    - 2. Level: func entry/exit with params
    - 3. Level: before loops/conditionals
    - 4. Level: within loops/conditionals
- Levels: DEBUG, INFO
    - DEBUG 
        - logs all levels and exception errors
        - additionally logs key variable states at key points
    - INFO:
        - logs levels 1 and 2 only and exception errors
- read debug level from .env

## Error Handling
- No exceptions in hot paths: Use deterministic control flow, not try/except for branching.
- Log errors at appropriate levels (see Logging).

## Testing Requirements
- **Test-Driven Development (TDD) mindset**: Write or plan tests alongside code.
- **Framework**: Use `pytest`.
- **Structure**: Mirror source structure in `/tests` (e.g., `src/auth.py` -> `tests/test_auth.py`).
- **Coverage**: All public functions must be tested. Aim for ≥90% coverage.
- **Integration**: Maintain `/tests/full_test.py` for end-to-end flows.
- **Mocking**: Mock external APIs and heavy dependencies.
- **Execution**: Ensure `pytest` passes before marking step as complete.

## Validation & Integrity
- **Input Validation**: Validate all inputs at entry points (API, UI forms).
- **Data Flow**: Ensure data persists correctly to DB/Storage and returns to UI.
- **Error States**: Verify UI handles error responses gracefully.
- **Cross-Layer**: Trace data from UI -> API -> DB -> API -> UI to ensure consistency.

## External CLI Review (Self-Correction)
- **Check Availability**: Look at `.orkestra/config.yaml` to see if `sub_agents` (like `gemini`, `mistral`) are configured.
- **Execute Review**: If a sub-agent is available, run it against your generated code *before* marking the step as complete.
    - Example: `.orkestra/scripts/run_sub_agent.sh gemini "Review this code for bugs" .orkestra/outputs/backend.md .orkestra/outputs/review_temp.md`
- **Incorporate Feedback**: Read the temporary review output and fix any issues found.
- **Cleanup**: Remove temporary review files.- error must clearly state where and what the issue is
- use try/except blocks around risky operations

Pseudo Code Example:
```python
try:
    [...]
except SpecificError as e:
  log_message(f"Error in X: {e}", level="ERROR")
  return None
```

## Security
- Validate/sanitize all input (bleach)
- Param queries only (SQLAlchemy)
- No raw SQL
- Add rate limiting + CSRF protection
- Sanitize filenames on upload
- Use Salt and Pepper when hashing passwords (bcrypt)

## API Resp
Format: {"status": "success|error", "data": {}, "message": ""}

## Lint/Format
- Python: PEP8 (black)
- JS: ESLint + Prettier
- Enforce via pre-commit hooks

## Frontend
- Vanilla JS ES6+, small funcs
- Use modules (import/export)
- No frameworks
- Organize by feature
- plain, compact layout

## Docker & Coolify
- Works local + Docker + Coolify
- Include Docker configs
- Consider containerization in design
- Web Search required for current best practices and configuration guidelines for Docker and Coolify deployments

# Performance Mindset
- Tokenizer is hot path: minimize allocations, avoid string slicing
- Use str.find() for scanning, not regex when possible
- Reuse buffers: text_buffer, current_tag_name, etc.
- Infer state from structure (stacks, tree) instead of storing flags
