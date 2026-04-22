type ScanLogQuotaHelpers = {
  startLogTransaction: (deviceMode: string) => Promise<{ ok: boolean; logId: string | null }>;
  endLogTransaction: (logId: string | null, status: string, errorMessage?: string | null) => Promise<string | null>;
};

export function createScanLogSessionHelpers({ scanLogQuota }: { scanLogQuota: ScanLogQuotaHelpers }) {
  let currentLogId: string | null = null;

  async function startLogTransaction(deviceMode: string) {
    const result = await scanLogQuota.startLogTransaction(deviceMode);
    currentLogId = result.logId;
    return result.ok;
  }

  async function endLogTransaction(status: string, errorMessage: string | null = null) {
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
