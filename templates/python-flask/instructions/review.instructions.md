# Review Phase Instructions

## Objective
Ensure code quality, security, and functional correctness before merging.

## Code Quality & Standards
- Check for bugs and security issues.
- Verify coding standards compliance (naming, structure, docstrings).
- Suggest performance improvements.
- Ensure documentation is complete and follows the "omnipresent docstrings" rule.

## Testing Verification
- **Existence**: Confirm that every new feature/fix has corresponding tests in `/tests`.
- **Coverage**: Check that tests cover happy paths and edge cases.
- **Pass**: Verify that tests pass (or would pass) based on the logic.

## Functional Validation (Audit)
- **Endpoints**: Verify Create, Read, Update, Delete endpoints exist for new data models.
- **Data Flow**: Trace the data path:
    - Input Validation -> Business Logic -> Persistence -> Response.
- **Error Handling**: Ensure failures are caught, logged, and returned gracefully.
- **UI/Backend Sync**: Verify frontend inputs match backend expectations.
