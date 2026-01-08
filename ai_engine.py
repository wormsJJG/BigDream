import sys
import json
import os
import joblib
import pandas as pd

# 모델 및 특징 리스트 로드
MODEL_PATH = os.path.join(os.path.dirname(__file__), 'models', 'threat_model.pkl')
FEATURE_PATH = os.path.join(os.path.dirname(__file__), 'models', 'feature_list.pkl')

model = None
feature_list = []

if os.path.exists(MODEL_PATH) and os.path.exists(FEATURE_PATH):
    model = joblib.load(MODEL_PATH)
    feature_list = joblib.load(FEATURE_PATH)

def analyze_app(app_info):
    if model is None:
        return {"score": 0, "grade": "ERROR", "reason": "모델 파일 없음"}

    pkg = app_info.get('packageName', '').lower()
    
    # 1. 🔥 [물리적 화이트리스트] 시스템 앱은 AI 계산 전 즉시 통과
    # 단, 위장(masquerading) 신호가 꺼져 있을 때만 통과시킴
    WHITE_LIST = ['com.samsung.', 'com.sec.', 'com.android.', 'com.google.', 'com.qualcomm.', 'com.qti.', 'android', 'com.skms.']
    
    is_trusted_name = any(pkg.startswith(prefix) for prefix in WHITE_LIST)
    
    if is_trusted_name and not app_info.get('isMasquerading'):
        return {"score": 0, "grade": "SAFE", "reason": "시스템 보호 영역"}

    if app_info.get('isSystemApp') == True: # 경로가 /system인 경우
        return {"score": 0, "grade": "SAFE", "reason": "시스템 필수 파일"}

    try:
        # 2. 특징 매핑
        input_data = {}
        app_perms = set(app_info.get('permissions', []))

        for feature in feature_list:
            if feature == 'is_sideloaded':
                input_data[feature] = 1 if app_info.get('isSideloaded') else 0
            elif feature == 'is_bg_run':
                input_data[feature] = 1 if app_info.get('isRunningBg') else 0
            elif feature == 'is_system_app':
                input_data[feature] = 1 if app_info.get('isSystemApp') else 0
            elif feature == 'is_masquerading':
                input_data[feature] = 1 if app_info.get('isMasquerading') else 0
            else:
                input_data[feature] = 1 if feature in app_perms else 0
        
        # 3. AI 판정
        df = pd.DataFrame([input_data])
        malware_prob = model.predict_proba(df)[0][1]
        score = int(malware_prob * 100)

        # 4. 등급 결정 (민감 권한 보유 여부에 따라 사유 디테일화)
        grade = "SAFE"
        reason = "정상"

        if score >= 80:
            grade = "DANGER"
            reason = "시스템 사칭 및 정보 탈취 위험" if app_info.get('isMasquerading') else "스파이앱(도청/감시) 패턴 감지"
        elif score >= 50:
            grade = "WARNING"
            reason = "출처 불분명 및 민감 권한 요구"
        
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
                print(json.dumps({
                    "type": "SCAN_RESULT", 
                    "packageName": request['payload']['packageName'], 
                    "result": result
                }), flush=True)
        except Exception:
            pass

if __name__ == "__main__":
    main()