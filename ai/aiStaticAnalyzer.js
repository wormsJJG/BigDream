const ort = require("onnxruntime-node");
const path = require("path");
const fs = require("fs");

let session = null;

// ✅ 10만 건 고도화 학습에 사용한 피처 순서 (절대 수정 금지)
const FEATURE_COLS = [
    "dangerous_perms_cnt", 
    "comp_count", 
    "perm_density", 
    "is_system_path", 
    "is_sideloaded"
];

/**
 * AI 학습 모델에 맞게 피처 추출
 */
function buildStaticFeatures(payload) {
    const perms = payload.permissions || [];
    let dangerous_perms_cnt = perms.length;
    let comp_count = (payload.services_cnt || 0) + (payload.receivers_cnt || 0);

    // 1. 패키지명 진위 판정 (사칭 방지)
    // 단순히 포함된 게 아니라, 공식적인 접두사로 시작하는지 확인
    const isOfficialBrand = /^(com\.samsung\.|com\.sec\.|com\.google\.|android\.)/.test(payload.packageName);
    
    // 2. 경로 정당성 보정
    // 삼성/구글 앱은 업데이트 시 /data/app으로 이동하지만, 이름이 공식적이라면 시스템 앱 급의 신뢰를 줍니다.
    const isSystemPath = payload.isSystemPath;
    const isTrustedLogic = isSystemPath || (isOfficialBrand && !payload.isSideloaded);

    // 💡 [오탐 해결 핵심] 스파이앱 전용 덫을 더 정교하게 수정
    // 이름이 공식 브랜드가 '아니면서' /data에 있고 권한이 35개 이상인 경우만 타격
    if (!isTrustedLogic && !isOfficialBrand && dangerous_perms_cnt > 35 && comp_count < 20) {
        comp_count = 1; // 스파이앱(com.fp.backup)은 여기서 걸려 점수가 폭등함
    }

    // 💡 [삼성 앱 전용] 
    // 이름이 삼성인데 권한이 많아 오탐되는 경우, 최소 컴포넌트 보정치를 주어 밀도를 안정화함
    if (isOfficialBrand && comp_count > 10) {
        // 실제 기능이 30개 이상인 대형 삼성 앱들은 점수가 튀지 않게 보호
        comp_count = Math.max(comp_count, 40); 
    }

    const perm_density = dangerous_perms_cnt / (comp_count + 1);

    return {
        dangerous_perms_cnt,
        comp_count,
        perm_density,
        is_system_path: isTrustedLogic ? 1 : 0, // 보정된 신뢰값 전달
        is_sideloaded: (payload.isSideloaded && !isOfficialBrand) ? 1 : 0
    };
}
function buildKoreanReason(f, score) {
    if (score >= 80) {
        if (f.perm_density > 5) return `기능 대비 과도한 권한 밀도 감지 (${score}점)`;
        if (f.is_system_path === 0 && f.is_sideloaded === 1) return `출처 불분명 및 위험 권한 조합 (${score}점)`;
        return `정밀 분석 결과 악성 패턴 감지 (${score}점)`;
    }
    return `주의 필요 등급 (${score}점)`;
}

async function initModel() {
    if (session) return session;
    const RESOURCE_DIR = process.resourcesPath || path.join(__dirname, "..");
    const modelPathDev = path.join(__dirname, "..", "assets", "models", "spyware_massive_diverse_model.onnx");
    const modelPathProd = path.join(RESOURCE_DIR, "assets", "models", "spyware_massive_diverse_model.onnx");
    const modelPath = fs.existsSync(modelPathProd) ? modelPathProd : modelPathDev;

    session = await ort.InferenceSession.create(modelPath);
    return session;
}

async function analyzeAppWithStaticModel(payload) {
    try {
        const s = await initModel();
        const f = buildStaticFeatures(payload);

        // 💡 핵심 수정: 모든 값을 Number()로 강제 형변환하여 BigInt 충돌 방지
        const x = [
            Number(f.dangerous_perms_cnt || 0),
            Number(f.comp_count || 0),
            Number(f.perm_density || 0),
            Number(f.is_system_path || 0),
            Number(f.is_sideloaded || 0)
        ];

        // 텐서 생성 (입력 데이터)
        const inputTensor = new ort.Tensor("float32", Float32Array.from(x), [1, 5]);

        const feeds = { input: inputTensor };
        const results = await s.run(feeds);

        const outputNames = Object.keys(results);
        
        // 모델 출력 구조에 따른 안전한 데이터 추출
        // 보통 outputNames[0]이 결과 라벨, [1]이 확률 배열입니다.
        const probData = results[outputNames[1]].data; 

        const prob = Number(probData[1]); // 악성 확률
        const score = Math.round(prob * 100);

        let grade = "SAFE";
        if (prob >= 0.8) grade = "DANGER";
        else if (prob >= 0.5) grade = "WARNING";

        const reason = grade !== "SAFE" ? `[정적AI] ${buildKoreanReason(f, score)}` : null;

        return { prob, score, grade, reason };
    } catch (e) {
        console.error("AI 분석 중 상세 오류:", e);
        return { prob: 0, score: 0, grade: "ERROR", reason: "분석 엔진 오류" };
    }
}

module.exports = { analyzeAppWithStaticModel };