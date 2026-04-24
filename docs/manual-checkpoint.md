# Manual Checkpoint

## Goal

Freeze a practical manual verification baseline before any future runtime import switch or large TS adoption step.

## Current Safe Commands

- `npm start`
- `npm run typecheck`
- `npm test`
- `npm run ts:preview`
- `npm run verify:runtime-sync`
- `npm run ts:preview:main-bootstrap`
- `npm run ts:verify:main-bootstrap`

See also: [Pre-Commit Checklist](./pre-commit-checklist.md)
See also: [Held Target Switch Plan](./held-target-switch-plan.md)
See also: [TS Conversion Status](./ts-conversion-status.md)

## Runtime Stability Baseline

The following must remain true after each meaningful migration step:

- Login screen renders on app boot
- Renderer bridge loads through root `preload.js`
- Android scan can start and enter results
- iOS scan can start and enter results
- Saved scan results can be reopened
- Admin detail screen loads user reports / logs / history

## Manual Verification Order

1. App boot
   - Run `npm start`
   - Confirm the main window opens
   - Confirm the login screen renders instead of a blank window

2. Android flow
   - Connect Android device
   - Confirm device detection
   - Start Android scan
   - Confirm scan progress moves
   - Confirm result screen opens
   - Confirm these sections render:
     - installed apps
     - background apps
     - APK files
     - privacy threat
     - device security status
   - Open an app detail
   - Confirm uninstall / neutralize actions still open and respond

3. iOS flow
   - Connect iPhone
   - Confirm device detection
   - Start iOS scan
   - Confirm trust / backup / MVT progress messages move
   - Confirm result screen opens
   - Confirm these sections render:
     - suspicious / spyware findings
     - privacy threat
     - installed apps
     - 5 core MVT areas

4. Saved result reopen
   - Open saved Android result
   - Open saved iOS result
   - Confirm privacy threat and detailed sections still render

5. Admin flow
   - Open admin screen
   - Open company detail from company list
   - Confirm:
     - submitted reports
     - quota history
     - scan logs
   - Confirm scan log date filter works
   - Confirm report detail opens

## Current TS Runtime Adoption State

The following groups are already on `TS source -> preview -> runtime JS sync`:

- shared first wave
- renderer app first wave
- renderer auth/device
- renderer app-detail/actions
- renderer scan small / medium / split / orchestration waves
- main testing wave
- main shell light wave
- main core light wave
- main service light wave
- main helper first / second / third / fourth / final waves
- main ipc auth / firestore / app / ios / android
- main held services
  - `androidService.js`
  - `iosService.js`

There are currently no remaining held runtime targets.

## Current Type-Tightening Focus

The current work is no longer focused on risky runtime switches.

It is mainly focused on:

- `src/types/*` contract consistency
- renderer scan candidate internals
- main service candidate payload narrowing
- commit-sized stabilization after each small type-only batch

Current estimate:

- overall TS migration progress is roughly `95%`
- current work is mostly final contract tightening rather than runtime migration

This means small changes should usually require:

- `npm run typecheck`
- `npm test`
- `npm run verify:runtime-sync`

and should not require full Android/iOS manual scans unless runtime logic changes.

## Current Checkpoint Read

The repository is currently in a good state for another checkpoint commit:

- runtime-held targets are cleared
- structure verification is green
- runtime sync safety is green
- current work is mostly type-tightening, not runtime behavior change

## Guardrails

- Do not batch `ts:preview` and runtime sync commands in parallel.
- Always run preview first, then sync, then `npm run typecheck`, then `npm test`.
- If a blank window appears, check recent runtime-synced JS first before touching unrelated files.
- Do not runtime-sync large orchestrators before a manual checkpoint pass succeeds.
- `npm run verify:runtime-sync` must stay green after every sync wave.
- `src/main/**` runtime JS is still CJS-driven. Any `import ... from` or `export ...` that lands there is a regression.
- `src/main/bootstrap.js` was the final hold target. Keep `ts:preview:main-bootstrap` and `ts:verify:main-bootstrap` green before any future bootstrap re-sync.
- `main.js`, `preload.js`, `renderer.js` are currently intentional JS entry shells. Do not remove or rename them as part of routine TS cleanup.
