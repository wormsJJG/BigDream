export function createScanDeviceRuntimeHelpers({ State, androidDashboardController, document }) {
    function toggleLaser(isVisible) {
        const show = !!isVisible;
        const dashBeam = document.getElementById('dashboardScannerBeam');
        const legacyBeam = document.getElementById('scannerBeam');
        if (State.currentDeviceMode === 'android') {
            if (dashBeam)
                dashBeam.style.display = show ? 'block' : 'none';
            if (legacyBeam)
                legacyBeam.style.display = 'none';
            return;
        }
        if (legacyBeam)
            legacyBeam.style.display = show ? 'block' : 'none';
        if (dashBeam)
            dashBeam.style.display = 'none';
    }
    function startAndroidDashboardPolling() {
        androidDashboardController.start();
    }
    function stopAndroidDashboardPolling() {
        androidDashboardController.stop();
    }
    function renderAndroidDashboard(payload) {
        androidDashboardController.render(payload);
    }
    return {
        toggleLaser,
        startAndroidDashboardPolling,
        stopAndroidDashboardPolling,
        renderAndroidDashboard
    };
}
