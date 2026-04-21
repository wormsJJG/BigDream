# Dependency Risk Register

## Current State

Last checked: 2026-04-21

- `npm test`: pass
- `npm audit`: `4 total`
- Breakdown: `2 high`, `2 low`, `0 critical`

## Resolved In This Cleanup

The following direct dependencies were updated to reduce audit exposure without changing app behavior:

- `electron` `39.2.7 -> 39.8.8`
- `electron-builder` `26.0.12 -> 26.8.1`
- `axios` `1.13.2 -> 1.15.1`
- `electron-updater` `6.6.2 -> 6.8.3`
- `firebase` `12.6.0 -> 12.12.1`

Audit count changed from:

- Before: `55`
- After: `4`

## Remaining Risks

### 1. `adbkit` -> `node-forge`

- Severity: `high`
- Package path: `adbkit@2.11.1`
- Current audit fix path: downgrade to `adbkit@2.0.17`
- Status: accepted for now

Why this is not auto-fixed:

- `npm audit` only proposes a semver-breaking change.
- The proposed version is older, not newer.
- This package is part of the Android device communication path, so changing it without behavior verification is risky.

Where it is used:

- Main bootstrap client creation: [src/main/bootstrap.js](/abs/path/C:/Users/김강산/Desktop/BigDream/src/main/bootstrap.js:26)
- Android device/service flows: [src/main/services/androidService.js](/abs/path/C:/Users/김강산/Desktop/BigDream/src/main/services/androidService.js:1)

Runtime impact assessment:

- This is not a public web server exposure.
- Risk is concentrated in local desktop execution and ADB-connected device handling.
- Real risk depends on hostile input reaching `adbkit` / `node-forge` parsing paths.

Operational guardrails:

- Keep ADB tool path controlled by bundled `platform-tools`.
- Do not accept arbitrary remote ADB endpoints.
- Prefer trusted devices and internal operator workflow only.

Follow-up options:

- Verify whether `adbkit` can be replaced with a maintained alternative.
- Build a focused compatibility test plan before any `adbkit` version change.
- If Android feature scope narrows later, isolate or reduce `adbkit` surface further.

### 2. `adbkit-apkreader` -> `debug`

- Severity: `low`
- Package path: `adbkit-apkreader@3.2.0`
- Current audit fix path: downgrade to `adbkit-apkreader@3.1.2`
- Status: accepted for now

Why this is not auto-fixed:

- `npm audit` again proposes a breaking downgrade.
- This package is part of APK metadata parsing, so behavior regression is possible.

Where it is used:

- APK reader bootstrap wiring: [src/main/bootstrap.js](/abs/path/C:/Users/김강산/Desktop/BigDream/src/main/bootstrap.js:31)
- APK manifest parsing: [src/main/services/androidService.js](/abs/path/C:/Users/김강산/Desktop/BigDream/src/main/services/androidService.js:1204)

Runtime impact assessment:

- Audit severity is low.
- Exposure is limited to local APK inspection workflow.

Follow-up options:

- Replace APK metadata parsing with a better-maintained parser if Android file inspection remains important.
- Re-evaluate when Android dependency work is scheduled.

## Recommended Policy

Short term:

- Keep current versions.
- Treat remaining findings as known accepted risk.
- Do not use `npm audit fix --force` on Android dependencies without a compatibility pass.

Medium term:

- Add an Android dependency review task specifically for `adbkit` and APK parsing.
- Create a manual regression checklist covering:
  - device detection
  - app listing
  - uninstall
  - permission neutralize
  - APK manifest extraction

## Verification Commands

- `npm test`
- `npm audit --json`
- `npm ls --depth=0`
