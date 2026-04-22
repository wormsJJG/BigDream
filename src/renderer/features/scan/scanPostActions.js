export function createScanPostActions({ CustomUI }) {
  function scheduleAndroidCleanupNotice() {
    setTimeout(async () => {
      try {
        await CustomUI.alert(`✅ 검사 수집 데이터 삭제 완료
검사에 사용된 안드로이드 수집 데이터가 안전하게 삭제되었습니다.`);
      } catch (_e) {}
    }, 10000);
  }

  function scheduleIosBackupCleanup(finishedUdid) {
    setTimeout(async () => {
      try {
        const res = await window.electronAPI.deleteIosBackup(finishedUdid);

        if (res?.success && res?.deleted) {
          await CustomUI.alert(`✅ 임시 백업 데이터 삭제 완료
검사에 사용된 iPhone 임시 백업 데이터가 안전하게 삭제되었습니다.`);
          return;
        }

        if (res?.success && !res?.deleted) {
          return;
        }

        await CustomUI.alert(`⚠️ 임시 백업 데이터 자동 삭제 확인 필요

이번 검사에 사용된 로컬 임시 백업 파일을
자동으로 삭제하지 못했습니다.

개인정보 보호를 위해 백업 폴더 상태를 확인해주세요.
오류: ${res?.error || '알 수 없는 오류'}`);
      } catch (err) {
        await CustomUI.alert(`⚠️ 임시 백업 데이터 자동 삭제 확인 필요

이번 검사에 사용된 로컬 임시 백업 파일 삭제 중
오류가 발생했습니다.

개인정보 보호를 위해 백업 폴더 상태를 확인해주세요.
오류: ${err?.message || err}`);
      }
    }, 10000);
  }

  return {
    scheduleAndroidCleanupNotice,
    scheduleIosBackupCleanup
  };
}
