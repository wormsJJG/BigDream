# BD-Scanner Stage 3 구조 (현업형)

## 목표
- **기능 유지**를 최우선으로 하면서, 유지보수 가능한 형태로 **Main / Preload / Renderer** 책임을 분리합니다.
- Renderer의 거대한 단일 파일을 단계적으로 쪼개기 위해, 기존 코드를 **모듈(섹션 단위)** 로 분리했습니다.

## 폴더 구조
- `main.js` : 엔트리 (안정성 위해 유지)
- `preload.js` : 엔트리 (안정성 위해 유지)
- `renderer.js` : 엔트리 (안정성 위해 유지)

- `src/main/` : main 로직(창 생성/업데이트 등)
- `src/preload/` : contextBridge API
- `src/shared/` : IPC 채널/공용 상수
- `src/renderer/` : UI(렌더러) 로직
  - `core/` : 뷰 매니저 등 공용 코어
  - `modules/` : 기존 거대 renderer.js를 **섹션 단위**로 분리한 모듈
    - `authSettings.js` : 로그인/권한/설정
    - `clientDevice.js` : 고객정보/기기 연결/감지
    - `scanController.js` : 검사 실행/진행 UI
    - `appDetail.js` : 앱 상세 화면
    - `actionHandlers.js` : 삭제/무력화/인쇄
  - `screens/` : 화면 단위 엔트리(현재는 modules로 위임하는 래퍼)

## 다음 리팩토링 포인트(추천)
- `modules/*` 내부에서 **화면별로 사용되는 함수/DOM 접근을 `screens/<screenId>/index.js`로 옮기기**
- Firebase 관련 로직을 `src/renderer/services/firebaseService.js` 로 묶고, 화면에서는 서비스만 호출하도록 변경
- IPC를 `src/main/ipc/`와 `src/preload/api/`로 나눠 계약(타입/validation)을 명확히
