# Global Instructions

## Core Principles
- **Language:** Python 3.10+
- **Style:** PEP 8 compliant.
- **Type Hinting:** Use strict type hints (`typing` module) for all function signatures.
- **Documentation:** Google-style docstrings for all functions and classes.
- **Error Handling:** Graceful error handling. Print user-friendly error messages to `stderr` and exit with non-zero status codes on failure. Avoid printing stack traces to end-users unless `--debug` is enabled.

## Project Structure
```
project/
├── src/
│   ├── __init__.py
│   ├── main.py          # Entry point
│   ├── cli.py           # Argument parsing (argparse/click/typer)
│   ├── core.py          # Business logic
│   └── utils.py         # Helper functions
├── tests/
│   ├── __init__.py
│   └── test_cli.py
├── requirements.txt
├── README.md
└── .gitignore
```

## CLI Guidelines
- Use `argparse` (standard lib) or `click`/`typer` (if external deps allowed) for argument parsing.
- Support standard flags: `--help`, `--version`, `--verbose`/`--debug`.
- Use standard streams: `stdout` for normal output, `stderr` for errors/logs.
- Keep the CLI layer thin; delegate logic to `core.py`.
