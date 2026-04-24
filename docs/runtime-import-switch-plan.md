# Runtime Import Switch Plan

## Goal

Move from `JS runtime + TS shadow` to actual TypeScript-backed runtime imports without losing Electron functionality.

## Current Constraint

The app currently runs source files directly:

- `main.js -> src/main/bootstrap.js`
- `preload.js`
- `renderer.js -> src/renderer/renderer.js`

That means `.ts` files cannot be used as live runtime entry files until a compile step exists.

## Safe Transition Rule

Never switch runtime imports directly from `.js` to `.ts` in this repository without an explicit TS build output path.

## Required Bridge Before Runtime Switch

1. Keep source of truth in `src/**/*.ts`
2. Compile TS preview output to a separate directory
   - target: `.ts-build-preview/`
3. Compare preview output structure with current JS runtime structure
4. Only then replace live runtime entry paths or add generated JS output into the packaging flow

## First Runtime Switch Candidates

These are the safest first targets because they are low-risk and already have TS shadows:

1. `src/shared/contracts/scanResultContract`
2. `src/shared/ipc/ipcChannels`
3. `src/shared/services/authService`
4. `src/shared/services/firestoreService`
5. `src/shared/services/userSettingsService`
6. `src/renderer/app/screenPaths`
7. `src/renderer/app/templateLoader`
8. `src/renderer/app/viewManager`

## Second Wave

1. `src/renderer/app/screenPaths.js`
2. `src/renderer/app/templateLoader.js`
3. `src/renderer/app/viewManager.js`
4. sync command: `npm run ts:sync:renderer-app-first-wave`
5. `src/renderer/features/auth/*`
6. `src/renderer/features/device/*`
7. first feature sync command: `npm run ts:sync:renderer-auth-device`
8. `src/renderer/features/app-detail/*`
9. `src/renderer/features/actions/*`
10. second feature sync command: `npm run ts:sync:renderer-appdetail-actions`
11. `src/renderer/features/scan/scanInfo.js`
12. `src/renderer/features/scan/androidDashboardController.js`
13. `src/renderer/features/scan/mvtAnalysis.js`
14. small scan sync command: `npm run ts:sync:renderer-scan-small`
15. `src/renderer/features/scan/deviceSecurityStatus.js`
16. `src/renderer/features/scan/resultPanels.js`
17. `src/renderer/features/scan/appCollections.js`
18. `src/renderer/features/scan/iosInstalledApps.js`
19. `src/renderer/features/scan/iosCoreAreas.js`
20. `src/renderer/features/scan/androidAppListController.js`
21. medium scan sync command: `npm run ts:sync:renderer-scan-medium`
22. `src/renderer/features/scan/resultsRenderer.js`
23. split renderer sync command: `npm run ts:sync:renderer-scan-results-renderer`

## Last Wave

1. `src/renderer/features/scan/initScanController`
2. `src/main/services/androidService`
3. `src/main/services/iosService`
4. `src/main/ipc/*`
5. `src/main/bootstrap`

## Acceptance Checks For Each Runtime Switch

- Entry path unchanged unless the build path is intentionally introduced
- Preload bridge methods unchanged
- IPC channel names unchanged
- Existing Android / iOS / admin manual flows still work
- `npm test` remains green

## Immediate Next Step

Introduce a TypeScript compile path for preview only.

- Use `tsconfig.typecheck.json` for type-only checks
- Use `tsconfig.runtime-preview.json` for emitted preview output
- Use `npm run ts:verify` to confirm first switch candidates were emitted correctly
- Do not point Electron runtime to preview output until the emitted tree is inspected

## First Safe Runtime Adoption Pattern

For very small, low-risk modules:

1. keep the live runtime import path unchanged
2. compile the `.ts` source into preview output
3. verify the preview output
4. sync the emitted JS back into the existing live `.js` file

Current first target:

- `src/shared/contracts/scanResultContract.js`
- `src/shared/ipc/ipcChannels.js`
- `src/shared/services/authService.js`
- `src/shared/services/firestoreService.js`
- `src/shared/services/userSettingsService.js`
- sync command: `npm run ts:sync:shared-first-wave`

Current renderer scan targets:

- small wave:
  - `src/renderer/features/scan/scanInfo.js`
  - `src/renderer/features/scan/androidDashboardController.js`
  - `src/renderer/features/scan/mvtAnalysis.js`
  - sync command: `npm run ts:sync:renderer-scan-small`
- medium wave:
  - `src/renderer/features/scan/deviceSecurityStatus.js`
  - `src/renderer/features/scan/resultPanels.js`
  - `src/renderer/features/scan/appCollections.js`
  - `src/renderer/features/scan/iosInstalledApps.js`
  - `src/renderer/features/scan/iosCoreAreas.js`
  - `src/renderer/features/scan/androidAppListController.js`
  - sync command: `npm run ts:sync:renderer-scan-medium`
- split renderer:
  - `src/renderer/features/scan/resultsRenderer.js`
  - sync command: `npm run ts:sync:renderer-scan-results-renderer`
- orchestration split:
  - `src/renderer/features/scan/androidScanProgress.js`
  - `src/renderer/features/scan/iosScanProgress.js`
  - `src/renderer/features/scan/scanLifecycle.js`
  - `src/renderer/features/scan/scanLogQuota.js`
  - `src/renderer/features/scan/scanPostActions.js`
  - `src/renderer/features/scan/scanStartUi.js`
  - `src/renderer/features/scan/iosScanProgressBinding.js`
  - `src/renderer/features/scan/androidScanRunner.js`
  - `src/renderer/features/scan/iosScanRunner.js`
  - `src/renderer/features/scan/scanDeviceRuntime.js`
  - `src/renderer/features/scan/scanLogSession.js`
  - `src/renderer/features/scan/scanEntryBindings.js`
  - `src/renderer/features/scan/scanLayoutRuntime.js`
  - `src/renderer/features/scan/scanMenuLifecycle.js`
  - `src/renderer/features/scan/scanBootstrapHelpers.js`
  - sync command: `npm run ts:sync:renderer-scan-orchestration`
- final held targets:
  - `src/renderer/features/scan/initScanController.js`
  - 이유: runtime JS는 안정화됐지만, TS 원본이 아직 일부 wrapper 형태라 지금 바로 sync하면 self-import 회귀가 다시 날 수 있음
- held release step:
  - `src/renderer/features/scan/scanControllerMethods.js`
  - sync command: `npm run ts:sync:renderer-scan-held-methods`
  - `src/renderer/features/scan/scanControllerCore.js`
  - sync command: `npm run ts:sync:renderer-scan-held-core`
  - `src/renderer/features/scan/scanInitRuntime.js`
  - sync command: `npm run ts:sync:renderer-scan-held-init-runtime`
  - `src/renderer/features/scan/initScanController.js`
  - sync command: `npm run ts:sync:renderer-scan-held-init-controller`

Current main helper targets:

- testing wave:
  - `src/main/testing/mockData.js`
  - sync command: `npm run ts:sync:main-testing-wave`
- shell light wave:
  - `src/main/window/createMainWindow.js`
  - `src/main/updater/initializeAutoUpdater.js`
  - sync command: `npm run ts:sync:main-shell-light-wave`
- core light wave:
  - `src/main/config/createConfig.js`
  - `src/main/services/createMainUtils.js`
  - sync command: `npm run ts:sync:main-core-light-wave`
- light wave:
  - `src/main/services/loginStorage.js`
  - `src/main/services/firestoreService.js`
  - sync command: `npm run ts:sync:main-service-light-wave`

- first wave:
  - `src/main/services/iosPairing.js`
  - `src/main/services/androidScanPreparation.js`
  - sync command: `npm run ts:sync:main-helper-first-wave`
- second wave:
  - `src/main/services/iosBackupCache.js`
  - `src/main/services/androidScanAnalysis.js`
  - sync command: `npm run ts:sync:main-helper-second-wave`
- third wave:
  - `src/main/services/iosBackupProgress.js`
  - `src/main/services/iosMvtParser.js`
  - sync command: `npm run ts:sync:main-helper-third-wave`
- fourth wave:
  - `src/main/services/iosMvtExecution.js`
  - sync command: `npm run ts:sync:main-helper-fourth-wave`
- final wave:
  - `src/main/services/androidDeviceSecurity.js`
  - `src/main/services/androidAppInventory.js`
  - sync command: `npm run ts:sync:main-helper-final-wave`

Current main ipc targets:

- completed held release:
  - `src/main/ipc/authHandlers.js`
  - `src/main/ipc/firestoreHandlers.js`
  - `src/main/ipc/appHandlers.js`
  - `src/main/ipc/iosHandlers.js`
  - `src/main/ipc/androidHandlers.js`
  - preparation route that made this safe:
    - `npm run ts:preview:main-ipc`
    - `npm run ts:verify:main-ipc`

Current final held target:

- `src/main/bootstrap.js`
  - status: released
  - CJS-safe preview route:
    - `npm run ts:preview:main-bootstrap`
    - `npm run ts:verify:main-bootstrap`
  - release step used:
    - `npm run ts:sync:main-held-bootstrap`

See also: `docs/held-target-switch-plan.md`
