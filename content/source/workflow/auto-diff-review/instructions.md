# Auto Diff Review

- Before proposing a commit, run `bin/review-diff.sh`.
- Review the staged diff for leaked secrets, unintended files, broken tests, and missing error handling.
- Fix actionable findings before asking the user to commit.
- Report the command result concisely with the proposed commit.
