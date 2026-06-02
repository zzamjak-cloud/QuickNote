# Conventions

- Responses and error explanations to the user are in Korean.
- Code identifiers remain English.
- Code comments, docs, and commit messages should be Korean unless an existing local convention clearly differs.
- Use existing repo patterns and helper APIs before adding new abstractions.
- For popovers/dropdowns/menus, avoid viewport clipping. Prefer `src/hooks/useAnchoredPopover.ts` or equivalent flip/clamp behavior and body portals.
- Do not revert unrelated user changes in a dirty worktree.
- Use `apply_patch` or Serena edit tools for manual code edits; avoid shell write tricks.
- For new syncable fields, update the full contract: app state, GraphQL serialization/query shape, remote apply, schema, resolver normalization, and tests.
- If `infra/`, AppSync schema, or resolver/Lambda changes exist, assume CDK deployment may be required before release/push workflows are considered complete.
