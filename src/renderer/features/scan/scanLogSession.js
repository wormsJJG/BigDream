export function createScanLogSessionHelpers({ scanLogQuota }) {
    let currentLogId = null;
    async function startLogTransaction(deviceMode) {
        const result = await scanLogQuota.startLogTransaction(deviceMode);
        currentLogId = result.logId;
        return result.ok;
    }
    async function endLogTransaction(status, errorMessage = null) {
        currentLogId = await scanLogQuota.endLogTransaction(currentLogId, status, errorMessage);
    }
    function getCurrentLogId() {
        return currentLogId;
    }
    return {
        startLogTransaction,
        endLogTransaction,
        getCurrentLogId
    };
}
