// src/renderer/services/userSettingsService.js
// Firestore 읽기 로직을 UI 모듈에서 분리하기 위한 서비스 레이어

/**
 * 사용자 권한(role) 확인
 * - users/{uid} 문서의 role을 반환
 * - isLocked가 true면 Error('LOCKED_ACCOUNT')를 throw
 */
export async function checkUserRole(firebase, uid) {
  const { db, doc, getDoc } = firebase;
  try {
    const userDocRef = doc(db, 'users', uid);
    const userSnap = await getDoc(userDocRef);

    if (userSnap.exists()) {
      const userData = userSnap.data();
      if (userData.isLocked) {
        throw new Error('LOCKED_ACCOUNT');
      }
      return userData.role || 'user';
    }

    return 'user';
  } catch (e) {
    // 잠긴 계정은 그대로 전파
    if (e && e.message === 'LOCKED_ACCOUNT') {
      throw e;
    }
    console.error('권한 확인 실패:', e);
    return 'user';
  }
}

/**
 * 로그인 유저의 설정값(시간, 회사명, quota) 로드
 * @returns {{ androidTargetMinutes: number, agencyName: string, quota: number } | null}
 */
export async function fetchUserInfoAndSettings(firebase, constants) {
  const { auth, db, doc, getDoc } = firebase;

  const user = auth.currentUser;
  if (!user) {
    console.log('⚠️ 로그인 정보가 없어 설정을 불러올 수 없습니다.');
    return null;
  }

  try {
    console.log(`📥 [${user.uid}] 계정의 설정값 불러오는 중...`);
    const docRef = doc(db, 'users', user.uid);
    const docSnap = await getDoc(docRef);

    if (!docSnap.exists()) {
      console.log('⚠️ 유저 문서가 존재하지 않습니다. (기본값 0분 사용)');
      return { androidTargetMinutes: 0, agencyName: '업체명 없음', quota: 0 };
    }

    const data = docSnap.data();
    const androidTargetMinutes = data.android_scan_duration || 0;
    const agencyName = data.companyName || (data.userId ? `(주) ${data.userId}` : '업체명 없음');
    const quota = data.quota !== undefined ? data.quota : 0;

    console.log(`✅ 설정 로드 완료: 안드로이드 검사 시간 [${androidTargetMinutes}분]`);

    return { androidTargetMinutes, agencyName, quota };
  } catch (error) {
    console.error('❌ 설정 불러오기 실패:', error);
    return { androidTargetMinutes: 0, agencyName: '업체명 없음', quota: 0 };
  }
}
