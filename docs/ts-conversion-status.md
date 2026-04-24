# TS Conversion Status

## Current Estimate

- Overall progress: about `97%`
- Meaning:
  - structure refactor: mostly complete
  - runtime-safe TS adoption: largely complete
  - held runtime targets: cleared
- remaining work: optional cleanup of a few intentional reusable aliases, last source-of-truth polish, commit-sized stabilization

## Current Decision

- Keep the Electron entry bridges as `.js` for now.
- This means the current stable runtime entry layer remains:
  - `main.js`
  - `preload.js`
  - `renderer.js`
- Treat these as intentional runtime shell files, not unfinished migration leftovers.

## Already Stable As TS-Oriented Runtime

These areas are already running under the current TS-preview-to-runtime-sync workflow without being treated as held targets anymore.

- `src/renderer/app/*`
- `src/renderer/features/auth/*`
- `src/renderer/features/device/*`
- `src/renderer/features/app-detail/*`
- `src/renderer/features/actions/*`
- `src/renderer/features/scan/*`
- `src/shared/contracts/*`
- `src/shared/ipc/*`
- `src/shared/services/*`
- `src/shared/risk/*`
- `src/shared/spyware/*`
- `src/main/config/*`
- `src/main/window/*`
- `src/main/updater/*`
- `src/main/testing/*`
- `src/main/services/*`
- `src/main/ipc/*`
- `src/main/bootstrap.js`

## Current Source-Of-Truth Pattern

The repository currently uses three patterns.

1. Actual TS source with runtime sync
- `.ts` is the source-of-truth
- emitted preview JS is synced back into the live runtime `.js`

2. TS candidate with live JS runtime
- `.ts` reflects the intended implementation/type boundary
- runtime still safely uses the live `.js`

3. Pure runtime CJS bridge
- kept intentionally as `.js`
- mainly for Electron entry/runtime compatibility

## Remaining Mixed Zones

These are the main places where `.ts` and `.js` still intentionally coexist.

### Entry/runtime bridges

- `main.js`
- `preload.js`
- `renderer.js`

Reason:
- they are still the live Electron entry edges
- changing them directly has the highest regression risk

### Compatibility bridges

- no remaining active shared compatibility bridge
- renderer compatibility bridge already removed

## Current Type Hotspots

These are the main places where the migration is no longer about runtime safety, but still about type quality.

### Intentional reusable type leftovers

- `src/renderer/features/scan/androidAppListController.ts`
- `src/renderer/features/scan/resultPanels.ts`
- small helper/service environment aliases in `src/main/services/*`

Reason:
- most single-use aliases are already gone
- remaining aliases are intentionally reusable shapes, not risky runtime boundaries

### Main service candidate edges

- `src/main/services/androidService.ts`
- `src/main/services/iosService.ts`
- `src/main/services/firestoreService.ts`

Reason:
- service/runtime logic is stable
- remaining work is now mostly small reusable environment shapes and convenience aliases

### Type-definition layer

- `src/types/preload-api.d.ts`
- `src/types/renderer-context.d.ts`
- `src/types/scan-result.d.ts`

Reason:
- these are now the cross-layer contract files
- quality here directly affects `shared -> main -> renderer` consistency
- most gaps are now about narrowing leftover convenience aliases rather than redesigning contracts

## Suggested Final Cleanup Order

1. Reduce remaining reusable aliases in `src/main/services/*` and `src/renderer/features/scan/*`
2. Keep tightening type boundaries in `src/types/*`
3. Freeze a commit-sized checkpoint
4. Keep Electron entry bridges as JS unless a later build-output migration is explicitly planned

See also: [JS Bridge Classification](./js-bridge-classification.md)

## Things Not To Touch Casually

- Android device security runtime logic
  - recent regressions already proved this is user-visible and sensitive
- Electron boot path
  - `main.js`, `src/main/bootstrap.js`, `preload.js`, `renderer.js`

## Acceptance Before Final Cleanup

- `npm run typecheck`
- `npm test`
- `npm run verify:runtime-sync`
- manual app boot still works
- no new Android device-security regressions
