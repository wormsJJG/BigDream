import sys
import json
import os
import joblib
import pandas as pd

# 모델 경로
MODEL_PATH = os.path.join(os.path.dirname(__file__), 'models', 'threat_model.pkl')
FEATURE_PATH = os.path.join(os.path.dirname(__file__), 'models', 'feature_list.pkl')

model = None
feature_list = []

# 모델 로드
if os.path.exists(MODEL_PATH) and os.path.exists(FEATURE_PATH):
    model = joblib.load(MODEL_PATH)
    feature_list = joblib.load(FEATURE_PATH)

# [ai_engine.py 수정본]

def analyze_app(app_info):
    if model is None:
        return {"score": 0, "grade": "ERROR", "reason": "모델 파일 없음"}

    # 1. [절대 규칙] 진짜 시스템 앱(경로 검증 완료)은 검사하지 않고 즉시 통과
    # main.js에서 app.path를 통해 검증된 isSystemApp 정보를 활용합니다.
    if app_info.get('isSystemApp') == True:
        return {
            "score": 0, 
            "grade": "SAFE", 
            "reason": "시스템 보호 앱 (안전)"
        }

    try:
        # 2. 시스템 앱이 아닌 일반 앱(사용자 설치 앱)에 대해서만 AI 분석 수행
        input_data = {}
        app_perms = set(app_info.get('permissions', []))

        for feature in feature_list:
            if feature == 'is_sideloaded':
                input_data[feature] = 1 if app_info.get('isSideloaded') else 0
            elif feature == 'is_bg_run':
                input_data[feature] = 1 if app_info.get('isRunningBg') else 0
            elif feature == 'is_system_app':
                input_data[feature] = 0 # 여기서 이미 필터링했으므로 0
            elif feature == 'is_masquerading':
                input_data[feature] = 1 if app_info.get('isMasquerading') else 0
            else:
                input_data[feature] = 1 if feature in app_perms else 0
        
        df = pd.DataFrame([input_data])
        malware_prob = model.predict_proba(df)[0][1]
        score = int(malware_prob * 100)

        # 3. AI 결과에 따른 등급 부여 (위장 앱은 여기서 걸러짐)
        if score >= 85:
            grade = "DANGER"
            reason = "시스템 앱 사칭 감지" if app_info.get('isMasquerading') else "스파이앱 패턴 감지"
        elif score >= 50:
            grade = "WARNING"
            reason = "권한 과다 및 의심 활동"
        else:
            grade = "SAFE"
            reason = "정상"

        return {"score": score, "grade": grade, "reason": reason}

    except Exception as e:
        return {"score": 0, "grade": "ERROR", "reason": str(e)}
    
def main():
    while True:
        try:
            line = sys.stdin.readline()
            if not line: break
            request = json.loads(line)
            if request['type'] == 'SCAN_APP':
                result = analyze_app(request['payload'])
                print(json.dumps({"type": "SCAN_RESULT", "packageName": request['payload']['packageName'], "result": result}), flush=True)
        except Exception:
            pass

if __name__ == "__main__":
    main()