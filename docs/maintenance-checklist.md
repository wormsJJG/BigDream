# Maintenance Checklist

## Goal

Refactor the Electron app without losing currently shipped functionality.

## Functional Baseline

The following flows must keep working during cleanup:

- App boot and main window render
- Template loading through preload/main IPC
- Login, logout, account creation
- Remember-me credential storage
- Android device connection, scan, app detail fetch, uninstall, permission neutralize, report push
- iOS device connection, backup scan, progress updates, backup delete, PDF export
- Admin screen entry and Firestore-backed data access
- Update event delivery to the renderer

## Order Of Work

1. Freeze the runtime contract
   Acceptance:
   - `main.js` is the only main entry.
   - One preload path is the runtime source of truth.
   - Renderer entry path is explicit and documented.

2. Validate structure before edits
   Acceptance:
   - `npm run verify:structure` passes.
   - Missing referenced resources fail fast.
   - Legacy duplicate files are reported.

3. Remove boot-time side effects
   Acceptance:
   - App startup does not install Python or MVT automatically.
   - iOS prerequisites are checked only when an iOS scan starts.

4. Normalize IPC contracts
   Acceptance:
   - Main, preload, and renderer use `src/shared/ipcChannels.js`.
   - New string literal channel names are not introduced.

5. Retire dead paths
   Acceptance:
   - Unused legacy files are removed only after reference checks.
   - Wrapper files that point to invalid imports are either fixed or deleted.

6. Split large modules
   Acceptance:
   - `scanController.js` and `actionHandlers.js` are split by feature responsibility.
   - `androidService.js` and `iosService.js` keep domain logic only.

## Guardrails

- Do not delete files only because they look old. Verify active references first.
- Do not combine behavior changes with structure changes in the same patch.
- After each phase, rerun `npm run verify:structure`.
- If a feature cannot be verified locally, keep the old path in place until replacement is proven.

## Current Known Risks

- `pcap_receiver.py` is currently a packaging placeholder and should be replaced only if a real capture flow is restored.
- `src/main/bootstrap.js` loads `loading.html`, which must exist.
- Root `preload.js` is the runtime source of truth for the renderer bridge.
- Remaining dependency audit findings are concentrated in `adbkit` / `adbkit-apkreader`.
- Accepted dependency risk details are tracked in [docs/dependency-risk-register.md](/abs/path/C:/Users/김강산/Desktop/BigDream/docs/dependency-risk-register.md:1).
- Normalized renderer scan payload expectations are tracked in [docs/scan-result-contract.md](/abs/path/C:/Users/김강산/Desktop/BigDream/docs/scan-result-contract.md:1).
- Code-level shared scan payload aliases live in [src/shared/contracts/scanResultContract.js](/abs/path/C:/Users/김강산/Desktop/BigDream/src/shared/contracts/scanResultContract.js:1).
- Renderer wrapper retention and delete conditions are tracked in [docs/renderer-legacy-register.md](/abs/path/C:/Users/김강산/Desktop/BigDream/docs/renderer-legacy-register.md:1).
- Manual runtime verification order and current TS checkpoint are tracked in [docs/manual-checkpoint.md](/abs/path/C:/Users/김강산/Desktop/BigDream/docs/manual-checkpoint.md:1).
