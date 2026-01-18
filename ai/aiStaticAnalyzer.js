const ort = require("onnxruntime-node");
const path = require("path");
const fs = require("fs");

let session = null;

// ⚠️ 학습에 사용한 feature 순서가 중요함
// train_static.py가 저장한 feature_cols와 동일해야 함.
// 가장 안전한 방법: feature_cols를 JSON으로 같이 저장해서 읽는 것.
// 우선은 우리가 만든 정적 데이터셋 컬럼 기준으로 고정.
const FEATURE_COLS = [
  "perm_sms", "perm_contacts", "perm_location", "perm_microphone", "perm_camera",
  "perm_accessibility", "perm_overlay", "perm_boot_completed", "perm_screen_capture",
  "has_launcher_icon", "has_settings_page",
  "installer_is_play_store", "installer_is_other_store", "is_sideloaded",
  "exported_components_cnt", "receivers_cnt", "services_cnt",
  "has_screen_on_receiver", "has_user_present_receiver", "has_sms_receiver",
  "dangerous_perms_cnt"
];

function hasAnyPermission(perms, targets) {
  if (!Array.isArray(perms)) return false;
  const set = new Set(perms);
  return targets.some(p => set.has(p));
}

/**
 * payload 예시 (너희 run-scan에서 이미 만들고 있는 것 기반):
 * {
 *   packageName,
 *   permissions: [...],
 *   isSideloaded: boolean,
 *   isSystemApp: boolean,
 *   isMasquerading: boolean
 *   // + (추후) overlayAllowed, accessibilityEnabled, hasLauncherIcon 등 추가 가능
 * }
 */
function buildStaticFeatures(payload) {
  const perms = payload.permissions || [];

  // 너희가 아직 ADB로 구조(receiver/service/exported count)를 안 뽑는 상태라면 0으로 시작
  // 나중에 dumpsys package 파싱 붙이면 여기 채우면 됨.
  const exported_components_cnt = payload.exported_components_cnt ?? 0;
  const receivers_cnt = payload.receivers_cnt ?? 0;
  const services_cnt = payload.services_cnt ?? 0;
  const has_screen_on_receiver = payload.has_screen_on_receiver ? 1 : 0;
  const has_user_present_receiver = payload.has_user_present_receiver ? 1 : 0;
  const has_sms_receiver = payload.has_sms_receiver ? 1 : 0;

  // 접근성/오버레이도 지금은 추출 안 하면 0(보수적)
  // 추후 appops/settings 기반으로 채우면 탐지력이 크게 올라감.
  const perm_accessibility = payload.perm_accessibility ? 1 : 0;
  const perm_overlay = payload.perm_overlay ? 1 : 0;

  // 런처/설정 페이지도 지금 값이 없다면 기본 1로 두는 게 오탐을 줄임(보수적 정상 가정)
  const has_launcher_icon = (payload.has_launcher_icon ?? 1) ? 1 : 0;
  const has_settings_page = (payload.has_settings_page ?? 1) ? 1 : 0;

  // 설치 출처: 너희는 현재 isSideloaded가 있음 → 그대로 사용
  // Play/other store 구분은 get-install-source-info 붙이면 채울 수 있음.
  const is_sideloaded = payload.isSideloaded ? 1 : 0;
  const installer_is_play_store = payload.installer_is_play_store ? 1 : 0;
  const installer_is_other_store = payload.installer_is_other_store ? 1 : 0;

  // 권한 기반
  const features = {
    perm_sms: hasAnyPermission(perms, [
      "android.permission.READ_SMS",
      "android.permission.RECEIVE_SMS",
      "android.permission.SEND_SMS"
    ]) ? 1 : 0,
    perm_contacts: hasAnyPermission(perms, [
      "android.permission.READ_CONTACTS",
      "android.permission.WRITE_CONTACTS"
    ]) ? 1 : 0,
    perm_location: hasAnyPermission(perms, [
      "android.permission.ACCESS_FINE_LOCATION",
      "android.permission.ACCESS_COARSE_LOCATION"
    ]) ? 1 : 0,
    perm_microphone: hasAnyPermission(perms, [
      "android.permission.RECORD_AUDIO"
    ]) ? 1 : 0,
    perm_camera: hasAnyPermission(perms, [
      "android.permission.CAMERA"
    ]) ? 1 : 0,

    // 아래는 “정적 전용 1차”에서 특히 중요
    perm_accessibility,
    perm_overlay,
    perm_boot_completed: hasAnyPermission(perms, [
      "android.permission.RECEIVE_BOOT_COMPLETED"
    ]) ? 1 : 0,

    // 스크린 캡처는 ADB만으로 정확히 어려워서 기본 0
    // 추후 MediaProjection/포그라운드서비스 단서 잡으면 1로 올리면 됨.
    perm_screen_capture: payload.perm_screen_capture ? 1 : 0,

    has_launcher_icon,
    has_settings_page,

    installer_is_play_store,
    installer_is_other_store,
    is_sideloaded,

    exported_components_cnt,
    receivers_cnt,
    services_cnt,
    has_screen_on_receiver,
    has_user_present_receiver,
    has_sms_receiver,

    // 위험 권한 개수: 지금은 permissions 길이로 근사
    dangerous_perms_cnt: Array.isArray(perms) ? perms.length : 0
  };

  return features;
}

function buildKoreanReason(payload, f, prob) {
  const reasons = [];

  if (f.is_sideloaded === 1) reasons.push("외부 설치(사이드로드) 앱");
  if (f.perm_accessibility === 1) reasons.push("접근성 사용");
  if (f.perm_overlay === 1) reasons.push("오버레이(화면 위 표시) 가능");
  if (f.perm_boot_completed === 1) reasons.push("부팅 후 자동 실행 가능");
  if (f.has_launcher_icon === 0) reasons.push("런처 아이콘 숨김");
  if (f.has_settings_page === 0) reasons.push("설정 화면 부재");
  if (payload.isMasquerading) reasons.push("시스템 앱 위장 의심");

  if (reasons.length === 0) {
    return prob >= 0.5
      ? "정적 신호가 일부 의심스러워 주의가 필요합니다."
      : "현재 정적 신호 기준으로 뚜렷한 위험 징후가 약합니다.";
  }
  return reasons.join(" / ");
}

async function initModel() {
  if (session) return session;

  // 개발/배포 모두 대응: 모델 파일을 resources/assets 쪽에 둔다 가정
  const modelPathDev = path.join(__dirname, "..", "assets", "models", "spyware_static_model.onnx");
  const modelPathProd = path.join(process.resourcesPath, "assets", "models", "spyware_static_model.onnx");
  const modelPath = fs.existsSync(modelPathProd) ? modelPathProd : modelPathDev;

  session = await ort.InferenceSession.create(modelPath);
  return session;
}

/**
 * return: { score, grade, reason, prob }
 */
async function analyzeAppWithStaticModel(payload, threshold = 0.16) {
  const s = await initModel();
  const f = buildStaticFeatures(payload);

  // feature vector in correct order
  const x = FEATURE_COLS.map(k => Number(f[k] ?? 0));
  const input = new ort.Tensor("float32", Float32Array.from(x), [1, x.length]);

  // 입력/출력 이름은 ONNX 내에 따라 다를 수 있음.
  // convert_sklearn 기본은 input 이름이 'input'인 경우가 많음.
  const feeds = { input };
  const results = await s.run(feeds);

  // 출력 텐서 키가 'probabilities' 또는 'output_probability' 등으로 다를 수 있음.
  // 가장 안전: 첫 번째 텐서를 사용
  const firstKey = Object.keys(results)[0];
  const out = results[firstKey].data;

  // 로지스틱 파이프라인이면 보통 [p0, p1] 형태거나 p1만 나올 수도 있음
  let p1;
  if (out.length >= 2) p1 = out[out.length - 1];
  else p1 = out[0];

  const prob = Number(p1);
  const score = Math.round(prob * 100);

  let grade;
  if (prob >= 0.8) grade = "DANGER";
  else if (prob >= 0.5) grade = "WARNING";
  else grade = "SAFE";

  // threshold는 “필터링용”으로 사용(너희 로직에 맞게)
  const reason = grade !== "SAFE"
    ? `[정적AI] ${buildKoreanReason(payload, f, prob)} (${score}점)`
    : null;

  return { prob, score, grade, reason };
}

module.exports = {
  analyzeAppWithStaticModel,
  buildStaticFeatures,
  FEATURE_COLS,
};
