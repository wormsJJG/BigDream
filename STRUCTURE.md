# BD-Scanner Electron Project Structure (현업형 베이스)

## 목표
- **기능은 그대로 유지**하면서, 유지보수가 쉬운 형태로 파일 구조를 정리했습니다.
- Electron 현업 권장 구조인 **Main / Preload / Renderer** 책임 분리를 강화했습니다.

## 엔트리(변경 없음)
Electron이 참조하는 엔트리 파일은 기존과 동일하게 루트에 유지됩니다.
- `main.js`  (main process)
- `preload.js` (preload entry)
- `renderer.js` (renderer entry, index.html에서 로드)

> 이유: `__dirname`, 빌드 설정, BrowserWindow preload 경로 등 런타임 의존을 건드리지 않기 위해서입니다.

## 실제 구현 위치
- `src/preload/preload.js` : preload 실제 구현
- `src/renderer/renderer.js` : renderer 실제 구현

루트의 `preload.js`, `renderer.js`는 **얇은 wrapper** 역할만 합니다.

## 다음 리팩토링 권장 순서 (기능 안 깨지게 단계적)
1. `src/shared/ipcChannels.js`로 IPC 채널 문자열 상수화
2. main의 IPC 핸들러를 `src/main/ipc/*.js`로 분리
3. renderer의 화면 로직을 `src/renderer/screens/*`로 분리 (현재 DOM id 기반 이벤트를 유지하면서 단계적으로)
4. firebase 로직은 `src/renderer/services/firebase/*`로 이동
