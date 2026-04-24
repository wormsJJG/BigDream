# JS Bridge Classification

## Goal

Classify the remaining `.js` files that still matter in the repository after the current TS conversion waves.

This document is not about every `.js` file in the repo.
It only tracks the remaining runtime or compatibility bridges that still matter for final cleanup decisions.

## Group A: Keep As JS For Now

These should stay as `.js` unless the Electron runtime entry strategy itself changes.

### Electron entry edges

- `main.js`
- `preload.js`
- `renderer.js`

Reason:
- they are the live runtime entry points
- changing them is not just a TS rename, it changes boot strategy

Current decision:
- keep these files as JS runtime shells for the current migration finish line
- do not treat them as cleanup candidates

### Runtime compatibility re-export bridges

- none currently tracked

Reason:
- no remaining shared compatibility re-export bridge is active in runtime code

## Group B: Runtime JS That Already Follows TS Source

These still exist as live `.js` files, but they are already managed under the current
`TS source -> preview -> runtime JS sync` pattern.

Representative groups:

- `src/main/config/*`
- `src/main/ipc/*`
- `src/main/services/*`
- `src/main/testing/*`
- `src/main/window/*`
- `src/main/updater/*`
- `src/main/bootstrap.js`
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

Meaning:
- the live runtime `.js` still exists
- but the logical source-of-truth is already mostly the `.ts` source or the current TS conversion workflow

## Group C: Final Cleanup Candidates

These are the files most likely to be removable or replaceable later, after the team decides the final entry/build strategy.

- none currently tracked outside the Electron entry edges

Condition before removal:
- all consumers use the canonical paths
- runtime preview/build path is stable

## Group D: Do Not Treat As Cleanup Targets Yet

These are not “leftover JS” in the usual sense, even though they still exist.

- `src/main/bootstrap.js`
- `src/main/services/androidService.js`
- `src/main/services/iosService.js`
- `src/main/ipc/*.js`
- `src/renderer/features/scan/*.js`

Reason:
- these are live runtime files
- they were already high-risk switch targets
- deleting or renaming them is a runtime architecture change, not a simple cleanup

## Practical Interpretation

At the current stage:

- most remaining `.js` files are no longer a sign that TS conversion is “not done”
- the real remaining work is:
  - type tightening
  - deciding final entry/build policy
  - deciding whether entry bridges remain JS permanently

## Suggested Final Order

1. Finish remaining type tightening in `src/types/*`
2. Freeze current runtime-safe state
3. Decide whether entry edges remain JS permanently
4. Keep Electron entry bridges as stable JS shells unless a separate build-output migration project starts
