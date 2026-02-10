/**
 * src/main/services/updateService.js
 * Responsibilities:
 * - Fetch latest version info (currently from Firestore: updates/latest)
 * - Compare versions safely (semver-ish)
 */
function createUpdateService({ firestoreService }) {
  if (!firestoreService) throw new Error('createUpdateService: firestoreService is required');

  function normalizeVersion(v) {
    return String(v || '').trim();
  }

  function compareVersions(a, b) {
    // Returns: -1 if a<b, 0 if a==b, 1 if a>b
    const pa = normalizeVersion(a).split('.').map(x => parseInt(x, 10));
    const pb = normalizeVersion(b).split('.').map(x => parseInt(x, 10));
    const len = Math.max(pa.length, pb.length);
    for (let i = 0; i < len; i++) {
      const na = Number.isFinite(pa[i]) ? pa[i] : 0;
      const nb = Number.isFinite(pb[i]) ? pb[i] : 0;
      if (na < nb) return -1;
      if (na > nb) return 1;
    }
    return 0;
  }

  async function checkForUpdate(currentVersion) {
    const current = normalizeVersion(currentVersion);
    // Update check should work even before login if rules allow public read.
    const res = await firestoreService.getDocPublic(['updates', 'latest']);

    if (!res.exists) {
      return { available: false, message: '업데이트 정보 없음' };
    }

    const latestInfo = res.data || {};
    const latestVersion = normalizeVersion(latestInfo.version);

    if (!latestVersion) {
      return { available: false, message: '업데이트 버전 정보 없음' };
    }

    const isNew = compareVersions(current, latestVersion) < 0;

    if (isNew) {
      return {
        available: true,
        latestVersion,
        downloadUrl: latestInfo.url || null,
        message: `${latestVersion} 버전이 출시되었습니다. 수동 업데이트가 필요합니다.`
      };
    }
    return { available: false, message: '최신 버전을 사용 중입니다.' };
  }

  return { checkForUpdate };
}

module.exports = { createUpdateService };
