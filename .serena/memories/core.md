# Core

- Project root: `D:/0_Client/QuickNote`.
- Primary user-facing app: QuickNote, a React/TypeScript/Vite note and database app with Tauri desktop support.
- Backend/sync: AWS AppSync GraphQL, Lambda resolvers, DynamoDB, CDK under `infra/`.
- Source of truth for sync: AppSync remote data. Local stores/cache are fast local snapshots and outbox support.
- Before broad code work, read `mem:project_keywords` and run `git status --short --branch`.
- For Page/Database sync changes, trace local source of truth, serialization, remote apply, GraphQL schema, and Lambda resolver normalization together.
- For UI regressions, find the existing working analogue in this repo before changing behavior and add a focused regression test when practical.
