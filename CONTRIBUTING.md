# Working agreement

1. `main` is stable; use `feat/<feature>` or `fix/<bug>` branches.
2. Keep frontend and API changes coordinated in the same PR when they form one user flow.
3. Inspect files, branch, commits and current diff before editing; never overwrite unrelated work.
4. Use descriptive commit messages and a PR that explains behaviour and risk.
5. Run `npm test` and `npm run build` before a normal release. If build is intentionally skipped, say so plainly; never claim it passed.
6. Never commit secrets, `.env` files, personal data, database dumps or payment credentials.
7. Update `PROJECT_STATUS.md` with branch, commit SHA, features, test results, known bugs and exact next step.
8. Do not merge code with known failing tests or unresolved payment/security issues just to make the branch green.
