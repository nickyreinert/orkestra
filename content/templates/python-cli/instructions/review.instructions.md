# Step 3: Review & Test

## Goal
Verify the implementation, run static analysis, and ensure the code meets quality standards.

## Instructions
1. **Static Analysis:**
   - Run `mypy src/` to check for type consistency.
   - Run `black --check src/` to verify formatting.
   - Fix any issues reported by these tools.

2. **Testing:**
   - Create basic unit tests in `tests/` using `unittest` or `pytest`.
   - Test the core logic functions in isolation.
   - Test the CLI argument parsing (e.g., using `subprocess` or internal API calls).

3. **Manual Verification:**
   - Execute the tool against the test cases defined in the plan.
   - Verify error messages are user-friendly (not raw stack traces).

4. **Final Polish:**
   - Ensure `README.md` documents how to install and run the tool.
   - Ensure `requirements.txt` is complete.
