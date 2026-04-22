// Synced from TypeScript preview output. Source of truth: screenPaths.ts
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
]);
export function getScreenTemplateCandidates(screenId) {
    return [
        `src/renderer/pages/${screenId}/view.html`
    ];
}
