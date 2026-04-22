export function createScanLogQuotaHelpers({ State, CustomUI, authService, getDoc, doc, updateDoc, collection, addDoc, serverTimestamp, increment }) {
  async function startLogTransaction(deviceMode) {
    const user = authService.getCurrentUser?.();
    if (!user) return { ok: false, logId: null };

    try {
      const userRef = doc(null, 'users', user.uid);
      const userSnap = await getDoc(userRef);
      const userData = userSnap.exists() ? userSnap.data() : {};
      const companyName = userData.companyName || userData.email || 'Unknown Company';

      const newLogRef = await addDoc(collection(null, 'scan_logs'), {
        userId: user.uid,
        companyName,
        deviceMode,
        startTime: serverTimestamp(),
        endTime: null,
        status: 'started',
        resultSummary: null
      });

      return { ok: true, logId: newLogRef.id };
    } catch (error) {
      console.error('로그 생성 또는 차감 실패:', error);
      return { ok: false, logId: null };
    }
  }

  async function endLogTransaction(logId, status, errorMessage = null) {
    if (!logId) return null;

    try {
      const logRef = doc(null, 'scan_logs', logId);
      await updateDoc(logRef, {
        status,
        endTime: serverTimestamp(),
        errorMessage
      });
      return null;
    } catch (error) {
      console.error('로그 마무리에 실패했습니다:', error);
      return logId;
    }
  }

  async function checkQuota() {
    if (State.userRole === 'admin') return true;

    try {
      const user = authService.getCurrentUser?.();
      if (!user) return false;

      const userDoc = await getDoc(doc(null, 'users', user.uid));
      if (userDoc.exists()) {
        const userData = userDoc.data();
        const currentQuota = userData.quota || 0;
        if (currentQuota <= 0) {
          await CustomUI.alert('🚫 잔여 검사 횟수가 부족합니다.\n관리자에게 충전을 문의하세요.');
          return false;
        }
      }

      return true;
    } catch (error) {
      console.error('횟수 조회 실패:', error);
      await CustomUI.alert('서버 통신 오류로 횟수를 확인할 수 없습니다.');
      return false;
    }
  }

  return {
    startLogTransaction,
    endLogTransaction,
    checkQuota
  };
}
