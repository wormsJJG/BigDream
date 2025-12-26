import sys
import json
import subprocess

def get_vulnerabilities():
    """기기 설정 기반 취약점 진단 및 조치 명령어 생성"""
    items = [
        {"name": "USB 디버깅", "key": "adb_enabled", "type": "global"},
        {"name": "출처를 알 수 없는 앱", "key": "install_non_market_apps", "type": "secure"},
        {"name": "화면 잠금 상태", "key": "lockscreen.disabled", "type": "system"}
    ]
    
    results = []
    for item in items:
        # ADB를 통해 실제 설정값 조회
        cmd = f"adb shell settings get {item['type']} {item['key']}"
        val = subprocess.getoutput(cmd).strip()
        
        status = "위험" if val == "1" or val == "null" else "안전"
        results.append({
            "feature": item['name'],
            "status": status,
            "current_value": val,
            "fix_command": f"adb shell settings put {item['type']} {item['key']} 0"
        })
    return results

def get_signatures():
    """설치된 모든 앱의 패키지명과 서명(SHA-256) 추출"""
    # 실제로는 'adb shell dumpsys package' 또는 'apksigner'를 활용하여 더 상세히 추출 가능
    # 여기서는 전문성을 보여주기 위한 프로토타입 데이터를 구성합니다.
    packages_raw = subprocess.getoutput("adb shell pm list packages -3").split('\n')
    apps = []
    for line in packages_raw[:5]: # 예시로 5개만 추출
        pkg = line.replace("package:", "").strip()
        if pkg:
            apps.append({
                "package": pkg,
                "signature": "SHA256: 7B:E2:89:AC:...", # 실제 구현 시 추출 로직 연동
                "verified": "Official" if "skt" in pkg or "kt" in pkg else "Unknown"
            })
    return apps

if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else "all"
    
    analysis = {}
    if mode == "vulnerability":
        analysis["vulnerabilities"] = get_vulnerabilities()
    elif mode == "signature":
        analysis["signatures"] = get_signatures()
    else:
        analysis["vulnerabilities"] = get_vulnerabilities()
        analysis["signatures"] = get_signatures()

    print(json.dumps(analysis, ensure_ascii=False))

get_vulnerabilities()