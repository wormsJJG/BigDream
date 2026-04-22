# Renderer Legacy Register

## Goal

Track which legacy renderer paths are still intentional wrappers during the structure migration, and which paths can be deleted once the remaining dependencies are removed.

## Current Runtime Source Of Truth

- `src/renderer/app/*`
- `src/renderer/pages/*`
- `src/renderer/features/*`
- `src/renderer/shared/*`
- `src/renderer/services/*`
- `src/renderer/styles/*`

## Removed Legacy Layers

The following migration layers have already been removed from the codebase:

- `src/renderer/modules/*`
- `src/renderer/core/*`

## Next Cleanup Targets

1. Delete stale comments that still mention old `core/modules/screens` paths
2. Start TypeScript migration on stable runtime paths

## Rule

Do not delete a legacy path just because it is now thin.
Delete only after:

- no runtime import references remain
- no file-path based loader fallback depends on it
- no manual/operator workflow depends on that path
