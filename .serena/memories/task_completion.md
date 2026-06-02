# Task Completion

- Always inspect final diff and worktree: `git diff --stat`, `git diff --check`, `git status --short --branch`.
- For narrow frontend logic/UI fixes, run targeted tests for the touched area plus `npm run typecheck`.
- For shared frontend behavior or broad changes, run `npm run test:run`, `npm run typecheck`, and `npm run build`.
- For infra/schema/resolver changes, run `cd infra && npm test` and `cd infra && npm run build`; deploy CDK when the user asks for deploy/push or when runtime schema/resolver changes must reach AWS.
- If pushing to `main`, verify remote ref after push. If Vercel is expected, verify latest deployment status is Ready.
- GitHub Actions can be checked with GitHub API if `gh` CLI is unavailable.
- Mention any non-fatal existing warnings separately from failures.
