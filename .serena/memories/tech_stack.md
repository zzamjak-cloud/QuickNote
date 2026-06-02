# Tech Stack

- Frontend: React 19, TypeScript 5.9, Vite 7, Tailwind CSS 3.4, Zustand, TipTap/ProseMirror, dnd-kit, react-rnd, lucide-react.
- Tests: Vitest 3, Testing Library, jsdom.
- Desktop: Tauri 2, Tauri SQL plugin, SQLite migrations under `src-tauri/migrations/`.
- Storage/cache: web uses IndexedDB/localStorage fallback; native uses Tauri/SQLite key-value storage.
- Sync/backend: AWS Amplify client, AppSync GraphQL, Lambda Node/TypeScript handlers, DynamoDB tables, CDK v2.
- Infra package: `infra/` uses TypeScript 5.5, Vitest 2, AWS SDK v3, aws-cdk-lib 2.170.
- Node engine in root: `>=20 <25`.
- Package manager commands use npm in this repo.
