# Manual Checkpoint

## Goal

Freeze a practical manual verification baseline before any future runtime import switch or large TS adoption step.

## Current Safe Commands

- `npm start`
- `npm run typecheck`
- `npm test`
- `npm run ts:preview`
- `npm run verify:runtime-sync`

See also: [Pre-Commit Checklist](./pre-commit-checklist.md)

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
- main helper first / second / third / fourth / final waves

The following are still candidate-only and must not be runtime-synced yet:

- `src/renderer/features/scan/scanControllerMethods.js`
- `src/renderer/features/scan/scanControllerCore.js`
- `src/renderer/features/scan/scanInitRuntime.js`
- `src/renderer/features/scan/initScanController.js`
- `src/main/services/androidService.js`
- `src/main/services/iosService.js`
- `src/main/bootstrap.js`

## Guardrails

- Do not batch `ts:preview` and runtime sync commands in parallel.
- Always run preview first, then sync, then `npm run typecheck`, then `npm test`.
- If a blank window appears, check recent runtime-synced JS first before touching unrelated files.
- Do not runtime-sync large orchestrators before a manual checkpoint pass succeeds.
- `npm run verify:runtime-sync` must stay green after every sync wave.
