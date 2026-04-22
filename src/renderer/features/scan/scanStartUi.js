export function createScanStartUiHelpers({ State, document }) {
    function resetScanResultState() {
        State.lastScanData = null;
        State.lastScanData = null;
    }
    function prepareAndroidScanStart({ toggleLaser, resetSmartphoneUI, startAndroidDashboardPolling, resetAndroidDashboardUI }) {
        resetAndroidDashboardUI();
        resetScanResultState();
        toggleLaser(true);
        const particles = document.querySelectorAll('.data-particle');
        particles.forEach((particle) => {
            const element = particle;
            element.style.display = 'block';
            element.style.opacity = '1';
        });
        const alertText = document.getElementById('phoneStatusAlert');
        if (alertText) {
            alertText.textContent = 'SYSTEM SCANNING';
            alertText.classList.add('sc-preline');
            alertText.style.color = '#00d2ff';
        }
        resetSmartphoneUI();
        startAndroidDashboardPolling();
    }
    function prepareIosScanStart({ toggleLaser }) {
        resetScanResultState();
        toggleLaser(true);
    }
    return {
        prepareAndroidScanStart,
        prepareIosScanStart,
        resetScanResultState
    };
}
