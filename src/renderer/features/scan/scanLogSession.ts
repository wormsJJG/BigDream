export interface ScanLogSessionHelpers {
  startLogTransaction(deviceMode: string | null): Promise<boolean>;
  endLogTransaction(status: string, errorMessage?: string | null): Promise<void>;
  getCurrentLogId(): string | null;
}

export function createScanLogSessionHelpers({
  scanLogQuota
}: {
  scanLogQuota: {
    startLogTransaction: (deviceMode: string) => Promise<{ ok: boolean; logId: string | null }>;
    endLogTransaction: (logId: string | null, status: string, errorMessage?: string | null) => Promise<string | null>;
  };
}): ScanLogSessionHelpers {
  let currentLogId: string | null = null;

  async function startLogTransaction(deviceMode: string | null) {
    const result = await scanLogQuota.startLogTransaction(deviceMode || 'unknown');
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
