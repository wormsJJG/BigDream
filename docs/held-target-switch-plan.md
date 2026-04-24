# Held Target Switch Plan

## Goal

Record the final high-risk runtime-switch strategy that was used for the remaining targets.

## Why These Are Held

The following file was held because it sat on the most runtime-critical boundary:

- `src/main/bootstrap.js`
  - main entry wiring
  - owns process boot and service registration

## Required Preconditions

Do not touch held targets until all of these are true:

1. `npm run typecheck` is green
2. `npm test` is green
3. `npm run verify:runtime-sync` is green
4. current manual checkpoint still passes
5. no recently synced runtime JS is under investigation

## Recommended Final Order

Completed:

1. Main bootstrap
   - `bootstrap.js`
   Reason:
   all other held targets had already been released; this was the only final boundary left.
   Preparation used:
   - `npm run ts:preview:main-bootstrap`
   - `npm run ts:verify:main-bootstrap`
   - `npm run ts:sync:main-held-bootstrap`

## Per-Target Acceptance

For each held-target switch:

- run `npm run ts:preview`
- run only the target-specific sync step
- run `npm run typecheck`
- run `npm test`
- run `npm run verify:runtime-sync`

Then do the smallest relevant manual check:

- bootstrap target:
  - app boot
  - login
  - Android or iOS scan entry
  - if all green, run the full manual checkpoint

## Stop Conditions

Stop immediately and revert the candidate switch if any of these appear:

- blank window
- app boot crash
- `require is not defined in ES module scope`
- self-wrapper detection
- Android/iOS result sections disappear
- admin detail flow stops loading

## Notes

- `main/ipc` required an explicit CJS-safe strategy and is complete.
- `bootstrap.js` was synced last and should still never be batched with another risky runtime change.
