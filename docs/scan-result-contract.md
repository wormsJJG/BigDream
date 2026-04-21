# Scan Result Contract

## Goal

Keep renderer rendering logic stable by normalizing loaded scan results into one predictable shape.

## Device Mode

- `deviceMode`: `android` or `ios`
- The renderer resolves mode from:
  - `deviceInfo.os`
  - `deviceInfo.osMode`
  - `osMode`
  - `deviceMode`

## Shared Fields

- `meta`
  - `savedAt`
  - `clientName`
  - `clientPhone`
- `deviceInfo`
  - `model`
  - `serial`
  - `phoneNumber`
  - `os`
  - `isRooted`

## Android Shape

After `normalizeLoadedScanData(payload, osMode)` runs, Android results should be read from:

- `allApps: Array<AppResult>`
- `apkFiles: Array<ApkResult>`
- `runningCount: number`

Supported legacy input aliases that are normalized into `allApps`:

- `apps`
- `applications`
- `installedApps`
- `appList`
- `targetApps`
- `results.allApps`
- `results.apps`

Supported legacy input aliases that are normalized into `apkFiles`:

- `apks`
- `apkList`
- `foundApks`
- `results.apkFiles`
- `results.apks`

Supported legacy input aliases that are used to infer `isRunningBg`:

- `runningApps`
- `backgroundApps`
- `bgApps`
- `runningPackages`
- `bgPackages`
- `results.runningApps`
- `results.backgroundApps`

## iOS Shape

iOS rendering should read from:

- `allApps` when present
- otherwise one of the normalized app aliases used by `getNormalizedScanApps(payload)`
- `mvtResults`
- `privacyThreatApps`
- `suspiciousApps`

## Runtime Cleanup

When older saved reports are loaded, the renderer strips legacy runtime-only fields before rendering:

- `__bd_el`
- `__bd_fetchPromise`
- `__bd_index`
- `__bd_cached`

These fields are not part of the persisted contract and must not be reintroduced into saved data.

## Renderer Rule

- New rendering code should prefer `getNormalizedScanApps(payload)` instead of ad-hoc fallback chains.
- New Android rendering code should assume `normalizeLoadedScanData()` has already normalized `allApps`, `apkFiles`, and `runningCount`.
- If a new saved result format is introduced, update this document and `src/renderer/features/scan/scanInfo.js` together.
