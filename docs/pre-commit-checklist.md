# Pre-Commit Checklist

## Goal

Freeze the current refactor / TypeScript-prep state into a commit without accidentally including cache files, preview output, or unsafe runtime targets.

## Required Checks

Run these before committing:

- `npm run typecheck`
- `npm test`
- `npm run verify:runtime-sync`

Run this when the checkpoint included a meaningful runtime boundary change:

- `npm start`

## Commit Include Groups

Include the current work in these groups:

- `package.json`
- `package-lock.json`
- `tsconfig.json`
- `tsconfig.typecheck.json`
- `tsconfig.runtime-preview.json`
- `.gitignore`

- `docs/`
  - maintenance / migration / runtime switch / manual checkpoint docs

- `scripts/`
  - preview sync scripts
  - structure verification
  - runtime sync safety verification

- `src/shared/`
  - contracts
  - ipc
  - constants
  - services

- `src/preload/`
  - TS candidates / bridge typing

- `src/types/`
  - preload / scan / renderer context typing

- `src/renderer/`
  - `app/`
  - `pages/`
  - `features/`
  - `shared/`
  - `services/`
  - `styles/`

- `src/main/`
  - `config/`
  - `ipc/`
  - `services/`
  - `window/`
  - `updater/`
  - `bootstrap.ts`

- runtime placeholder/static files that are intentionally tracked
  - `loading.html`
  - `pcap_receiver.py`

## Commit Exclude Groups

Do not include these:

- `node_modules/`
- `.npm-cache/`
- `.electron-cache/`
- `.ts-build-preview/`
- other cache / temp folders already covered by `.gitignore`

## Held Runtime Targets

There are currently no remaining held runtime targets.

Current caution is different:

- `main.js`
- `preload.js`
- `renderer.js`

These are intentional JS entry shells and should not be removed or renamed as part of routine cleanup.

## Safe Commit Message Scope

This checkpoint is one logical scope:

- renderer/main structure cleanup
- helper extraction
- TS candidate tightening
- safe runtime sync waves already landed
- verification / guardrail scripts
- current type-layer cleanup

If you want to split commits later, split by:

- `renderer + shared`
- `main helpers + ipc/bootstrap typing`
- `docs + scripts`

## Notes

- If `git` is unavailable in PATH, use this document as the manual staging baseline.
- If a blank window ever reappears, inspect recently runtime-synced JS before staging additional files.
