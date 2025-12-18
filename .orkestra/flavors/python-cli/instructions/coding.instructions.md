# Step 2: Implementation

## Goal
Implement the Python CLI application based on the approved plan.

## Instructions
1. **Setup Project:**
   - Create the directory structure defined in `global.instructions.md`.
   - Create `requirements.txt` with necessary dependencies.
   - Create a `.gitignore` for Python (venv, __pycache__, .DS_Store).

2. **Implement Core Logic (`src/core.py`):**
   - Write the business logic functions first.
   - Ensure functions are pure where possible and easy to test.
   - Add type hints and docstrings.

3. **Implement CLI Interface (`src/cli.py`):**
   - Implement argument parsing.
   - Wire up the arguments to the `core.py` functions.
   - Implement error handling (try/except blocks) to catch exceptions and print clean error messages.

4. **Entry Point (`src/main.py`):**
   - Create a minimal entry point that calls the main CLI function.
   - Ensure it handles `KeyboardInterrupt` gracefully.

5. **Verification:**
   - Run the tool with `--help` to verify argument parsing.
   - Run a basic command to verify the happy path.
