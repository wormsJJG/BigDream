# TypeScript Migration Plan

## Goal

Migrate to TypeScript without losing shipped functionality.

## Guardrails

- Do not combine runtime behavior changes with type migration.
- Convert stable entry paths first.
- Keep preload and shared contracts typed before widening feature conversion.
- Each phase must keep `npm test` green.
- Do not switch runtime imports from `.js` to `.ts` until a compile/output path exists.

## Current Stable Runtime Paths

- `src/main/*`
- `src/preload` runtime source is still root `preload.js`
- `src/shared/contracts/*`
- `src/shared/ipc/*`
- `src/renderer/app/*`
- `src/renderer/pages/*`
- `src/renderer/features/*`
- `src/renderer/shared/*`
- `src/renderer/services/*`

## Recommended Conversion Order

1. Type boundary files
   - `src/types/preload-api.d.ts`
   - `src/types/scan-result.d.ts`
   - `src/types/renderer-context.d.ts`
   - `src/shared/contracts/*`
   - `src/shared/risk/*`
   - `src/shared/spyware/*`

2. Renderer bootstrap and service edges
   - `src/renderer/app/bootstrap.js`
   - `src/renderer/app/templateLoader.js`
   - `src/renderer/app/viewManager.js`
   - `src/shared/services/*`
   - During migration, `.ts` shadow files may coexist with runtime `.js` until the runtime import path is switched safely
   - Start with low-risk app/service edges before touching feature files

3. Preload typing and extraction
   - keep runtime behavior identical
   - type the exposed API surface first

4. Feature-by-feature conversion
   - `features/auth`
   - `features/device`
   - `features/actions`
   - `features/app-detail`
   - `features/scan`

5. Main process conversion
   - config
   - ipc
   - service factories
   - extracted service helpers before large orchestrators
   - large orchestrators can be added as TS candidates before any runtime sync
   - large services last

6. Runtime import switching
   - use compiled output, not raw `.ts` source
   - start with `shared` and low-risk renderer services
   - leave `scan` and large main services for the end
   - current stable decision: keep `main.js`, `preload.js`, `renderer.js` as JS entry shells

## Minimum Acceptance Per Phase

- No broken imports
- No removed runtime bridge methods
- No changed IPC channel names
- Existing manual Android / iOS / admin flows still work
- `npm test` passes

## Runtime Switch Reference

- See `docs/runtime-import-switch-plan.md`
