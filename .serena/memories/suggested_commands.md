# Suggested Commands

- Check worktree: `git status --short --branch`.
- Search files/content on Windows PowerShell: use `rg` and `rg --files` first.
- Frontend dev server: `npm run dev`.
- Frontend tests: `npm run test:run`.
- Targeted frontend tests: `npm run test:run -- <test paths>`.
- TypeScript check: `npm run typecheck`.
- Frontend build: `npm run build`.
- Lint: `npm run lint`.
- Tauri dev/build: `npm run tauri:dev`, `npm run tauri:build`.
- Infra tests: `cd infra && npm test`.
- Infra build: `cd infra && npm run build`.
- Infra deploy: from `infra`, set `CDK_DEFAULT_ACCOUNT` and `CDK_DEFAULT_REGION`, then run `npm run deploy -- --require-approval never`.
- Verify AWS before deploy: `aws sts get-caller-identity`, `aws configure get region`.
- Vercel status fallback when global CLI is missing: `npx --yes vercel ls`.
- Serena memory integrity: `serena memories check`.
- Serena memory stricter scan: `serena memories check --include-unmarked`.
