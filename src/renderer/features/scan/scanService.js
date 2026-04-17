// Scan Service: wraps electronAPI calls so scanController focuses on flow/UI.
// Keeps behavior identical but improves separability and testability.

export async function openScanFile(electronAPI) {
  if (!electronAPI?.openScanFile) throw new Error('electronAPI.openScanFile is not available');
  return electronAPI.openScanFile();
}

export async function runAndroidScan(electronAPI) {
  if (!electronAPI?.runScan) throw new Error('electronAPI.runScan is not available');
  return electronAPI.runScan();
}

export async function runIosScan(electronAPI, udid, options) {
  if (!electronAPI?.runIosScan) throw new Error('electronAPI.runIosScan is not available');
  return electronAPI.runIosScan(udid, options);
}

export async function deleteIosBackup(electronAPI, udid) {
  if (!electronAPI?.deleteIosBackup) return { success: false, error: 'electronAPI.deleteIosBackup is not available' };
  return electronAPI.deleteIosBackup(udid);
}

export async function getAndroidDashboardData(electronAPI) {
  // Optional API
  if (!electronAPI?.getAndroidDashboardData) return null;
  return electronAPI.getAndroidDashboardData();
}

export async function getAppData(electronAPI, packageName) {
  if (!electronAPI?.getAppData) throw new Error('electronAPI.getAppData is not available');
  return electronAPI.getAppData(packageName);
}
