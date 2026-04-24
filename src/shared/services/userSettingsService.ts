import type {
  AuthService,
  FirestoreDocSnapshot,
  FirestoreService,
  RendererServicesBag,
} from '../../types/renderer-context';

type ServicesOrFirebase = RendererServicesBag | FirestoreService | AuthService;

interface UserSettingsDocData {
  role?: string;
  isLocked?: boolean;
  android_scan_duration?: number;
  ios_progress_mode?: string;
  companyName?: string;
  userId?: string;
  quota?: unknown;
}

function getFirestore(servicesOrFirebase: ServicesOrFirebase): FirestoreService {
  return (servicesOrFirebase as RendererServicesBag)?.firestore ?? (servicesOrFirebase as FirestoreService);
}

function getAuth(servicesOrFirebase: ServicesOrFirebase): AuthService | null {
  return (servicesOrFirebase as RendererServicesBag)?.auth ?? (servicesOrFirebase as AuthService) ?? null;
}

function resolveCurrentUser(auth: AuthService | null) {
  if (!auth) return null;
  if (typeof auth.getCurrentUser === 'function') return auth.getCurrentUser();
  return null;
}

export async function checkUserRole(servicesOrFirebase: ServicesOrFirebase, uid?: string) {
  const firestore = getFirestore(servicesOrFirebase);
  const { doc, getDoc } = firestore || {};

  if (!uid) return 'user';
  if (typeof doc !== 'function' || typeof getDoc !== 'function') {
    console.error('checkUserRole: firestore 함수(doc/getDoc)를 찾을 수 없습니다.');
    return 'user';
  }

  try {
    const userDocRef = doc(null, 'users', uid);
    const userSnap = await getDoc<UserSettingsDocData>(userDocRef);

    if (userSnap && typeof userSnap.exists === 'function' && userSnap.exists()) {
      const userData = (userSnap.data ? userSnap.data() : {}) as UserSettingsDocData;
      if (userData?.isLocked) {
        throw new Error('LOCKED_ACCOUNT');
      }
      return userData?.role || 'user';
    }

    return 'user';
  } catch (e) {
    if (e instanceof Error && e.message === 'LOCKED_ACCOUNT') {
      throw e;
    }
    console.error('권한 확인 실패:', e);
    return 'user';
  }
}

export async function fetchUserInfoAndSettings(
  servicesOrFirebase: ServicesOrFirebase,
  _constants: { ID_DOMAIN?: string },
  uidOverride?: string
) {
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
    const docSnap = await getDoc<UserSettingsDocData>(docRef) as FirestoreDocSnapshot<UserSettingsDocData>;

    if (!docSnap || (typeof docSnap.exists === 'function' && !docSnap.exists())) {
      console.log('⚠️ 유저 문서가 존재하지 않습니다. (기본값 0분 사용)');
      return { androidTargetMinutes: 0, iosProgressMode: 'real', agencyName: '업체명 없음', quota: 0 };
    }

    const data = (docSnap.data ? docSnap.data() : {}) as UserSettingsDocData;
    const androidTargetMinutes = data.android_scan_duration || 0;
    const rawIosProgressMode = String(data.ios_progress_mode || 'real').trim().toLowerCase();
    const iosProgressMode = rawIosProgressMode === 'random_20_30' ? 'random_20_30' : 'real';
    const agencyName = data.companyName || (data.userId ? `(주) ${data.userId}` : '업체명 없음');

    let quota = (data.quota !== undefined) ? data.quota : 0;
    if (quota && typeof quota === 'object') {
      console.warn('⚠️ quota 값이 객체로 저장되어 있어 0으로 보정합니다:', quota);
      quota = 0;
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
