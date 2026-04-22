export const SCREEN_IDS = Object.freeze([
  'login-screen',
  'support-screen',
  'create-scan-screen',
  'device-connection-screen',
  'open-scan-screen',
  'scan-progress-screen',
  'scan-dashboard-screen',
  'scan-info-screen',
  'scan-results-screen',
  'admin-screen',
  'admin-report-detail-screen'
] as const);

export type ScreenId = typeof SCREEN_IDS[number];

export function getScreenTemplateCandidates(screenId: ScreenId | string): string[] {
  return [
    `src/renderer/pages/${screenId}/view.html`
  ];
}
