// src/renderer/services/userSettingsService.js
// Firestore 읽기 로직을 UI 모듈에서 분리하기 위한 서비스 레이어
//
// NOTE: 역할 분리 과정에서 firebase(pass-through)와 services 주입이 혼재할 수 있어
// 두 형태 모두를 수용하도록 작성합니다.

function getFirestore(servicesOrFirebase) {
  return servicesOrFirebase?.firestore ?? servicesOrFirebase;
}

function getAuth(servicesOrFirebase) {
  return servicesOrFirebase?.auth ?? servicesOrFirebase;
}

function resolveCurrentUser(auth) {
  if (!auth) return null;
  if (typeof auth.getCurrentUser === 'function') return auth.getCurrentUser();
  return auth.currentUser ?? null;
}

/**
 * 사용자 권한(role) 확인
 * - users/{uid} 문서의 role을 반환
 * - isLocked가 true면 Error('LOCKED_ACCOUNT')를 throw
 */
export async function checkUserRole(servicesOrFirebase, uid) {
  const firestore = getFirestore(servicesOrFirebase);
  const { doc, getDoc } = firestore || {};

  if (!uid) return 'user';
  if (typeof doc !== 'function' || typeof getDoc !== 'function') {
    console.error('checkUserRole: firestore 함수(doc/getDoc)를 찾을 수 없습니다.');
    return 'user';
  }

  try {
    // firestoreProxy는 첫 인자(db)를 무시하므로 null로 통일
    const userDocRef = doc(null, 'users', uid);
    const userSnap = await getDoc(userDocRef);

    if (userSnap && typeof userSnap.exists === 'function' && userSnap.exists()) {
      const userData = userSnap.data ? userSnap.data() : {};
      if (userData?.isLocked) {
        throw new Error('LOCKED_ACCOUNT');
      }
      return userData?.role || 'user';
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
 * @returns {{ androidTargetMinutes: number, iosProgressMode: string, agencyName: string, quota: number } | null}
 */
export async function fetchUserInfoAndSettings(servicesOrFirebase, constants, uidOverride) {
  const auth = getAuth(servicesOrFirebase);
  const firestore = getFirestore(servicesOrFirebase);
  const { doc, getDoc, updateDoc } = firestore || {};

  const user = uidOverride ? { uid: uidOverride } : resolveCurrentUser(auth);
  if (!user || !user.uid) {
    console.log('⚠️ 로그인 정보가 없어 설정을 불러올 수 없습니다.');
    return null;
  }

  if (typeof doc !== 'function' || typeof getDoc !== 'function') {
    console.error('fetchUserInfoAndSettings: firestore 함수(doc/getDoc)를 찾을 수 없습니다.');
    return { androidTargetMinutes: 0, iosProgressMode: 'real', agencyName: '업체명 없음', quota: 0 };
  }

  try {
    console.log(`📥 [${user.uid}] 계정의 설정값 불러오는 중...`);
    const docRef = doc(null, 'users', user.uid);
    const docSnap = await getDoc(docRef);

    if (!docSnap || (typeof docSnap.exists === 'function' && !docSnap.exists())) {
      console.log('⚠️ 유저 문서가 존재하지 않습니다. (기본값 0분 사용)');
      return { androidTargetMinutes: 0, iosProgressMode: 'real', agencyName: '업체명 없음', quota: 0 };
    }

    const data = docSnap.data ? docSnap.data() : {};
    const androidTargetMinutes = data.android_scan_duration || 0;
    const rawIosProgressMode = String(data.ios_progress_mode || 'real').trim().toLowerCase();
    const iosProgressMode = rawIosProgressMode === 'random_20_30' ? 'random_20_30' : 'real';
    const agencyName = data.companyName || (data.userId ? `(주) ${data.userId}` : '업체명 없음');

    // quota는 number가 정상값. 과거 버그로 객체(map)일 수 있어 방어
    let quota = (data.quota !== undefined) ? data.quota : 0;
    if (quota && typeof quota === 'object') {
      console.warn('⚠️ quota 값이 객체로 저장되어 있어 0으로 보정합니다:', quota);
      quota = 0;
      // 가능하면 DB도 정리
      try {
        if (typeof updateDoc === 'function') {
          await updateDoc(docRef, { quota: 0 });
        }
      } catch (e) {
        console.warn('quota 자동 정리 실패(무시 가능):', e);
      }
    }

    console.log(`✅ 설정 로드 완료: 안드로이드 검사 시간 [${androidTargetMinutes}분]`);
    return { androidTargetMinutes, iosProgressMode, agencyName, quota };
  } catch (error) {
    console.error('❌ 설정 불러오기 실패:', error);
    return { androidTargetMinutes: 0, iosProgressMode: 'real', agencyName: '업체명 없음', quota: 0 };
  }
}
