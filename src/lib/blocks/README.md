# Block Registry

The block registry is the stable place for block-level metadata.

It should answer questions that used to be scattered across editor UI files:

- which ProseMirror node types belong to a product-level block
- whether a block can move into columns or tabs
- whether a block is a container
- which slash menu entries create or expose the block

Slash commands still live in `src/lib/tiptapExtensions/slashMenu/menuEntries.ts`.
Move command implementations gradually: first add metadata here, then migrate command factories once behavior is covered by tests.

When adding a new block:

1. Add its `BlockDefinition`.
2. Include all related node types.
3. Declare its drag/drop policy.
4. Link slash titles if the block appears in the slash menu.
5. Add or update registry tests.
