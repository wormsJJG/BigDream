import sys
import json
import subprocess
import os

# 💡 ADB 경로 설정 (platform-tools 폴더 내의 adb.exe 경로)
# 현재 파이썬 파일 위치 기준으로 경로를 잡거나, 절대 경로를 입력합니다.
current_dir = os.path.dirname(os.path.abspath(__file__))
ADB_PATH = os.path.join(current_dir, "platform-tools", "adb.exe")

# 만약 platform-tools가 상위 폴더나 다른 곳에 있다면 경로를 수정하세요.
# 예: ADB_PATH = r"C:\Users\USER\Desktop\BigDream\platform-tools\adb.exe"

def run_adb(command):
    """ADB 명령어를 실행하고 결과를 반환하는 래퍼 함수"""
    # 명령어를 'adb shell ...' 대신 '절대경로/adb.exe shell ...'로 실행합니다.
    full_command = f'"{ADB_PATH}" {command}'
    return subprocess.getoutput(full_command).strip()

def get_vulnerabilities():
    items = [
        {"name": "USB 디버깅", "key": "adb_enabled", "type": "global"},
        {"name": "출처를 알 수 없는 앱", "key": "install_non_market_apps", "type": "secure"},
        {"name": "화면 잠금 상태", "key": "lockscreen.disabled", "type": "system"}
    ]
    
    results = []
    for item in items:
        # 💡 수정된 run_adb 함수 사용
        val = run_adb(f"shell settings get {item['type']} {item['key']}")
        
        status = "위험" if val == "1" or val == "null" else "안전"
        results.append({
            "feature": item['name'],
            "status": status,
            "current_value": val,
            "fix_command": f'"{ADB_PATH}" shell settings put {item["type"]} {item["key"]} 0'
        })
    return results


def get_signatures():
    """설치된 모든 앱의 패키지명과 실제 서명(SHA-256) 추출"""
    # 3사 앱(-3) 리스트 가져오기
    packages_raw = run_adb("shell pm list packages -3").split('\n')
    
    apps = []
    # 너무 많으면 시간이 걸리므로 상위 10개 정도로 제한 (필요시 조절)
    target_packages = [line.replace("package:", "").strip() for line in packages_raw if line.strip()]

    for pkg in target_packages[:10]:
        # 💡 전문적 접근: dumpsys를 통해 해당 패키지의 상세 정보(서명 포함) 추출
        package_info = run_adb(f"shell dumpsys package {pkg}")
        
        # 서명(signatures) 정보가 있는 라인 찾기 (보통 'signatures=' 뒤에 해시값이 옴)
        signature_value = "추출 실패"
        for line in package_info.split('\n'):
            if "signatures=[" in line or "signatures=" in line:
                signature_value = line.split('=')[-1].strip(' []')
                break
        
        # 공식 앱 여부 판단 (패키지명 기준)
        is_official = any(telecom in pkg.lower() for telecom in ['skt', 'kt', 'lguplus', 'uplus', 'telecom'])

        apps.append({
            "package": pkg,
            "signature": signature_value if len(signature_value) > 10 else "N/A (시스템 보호됨)",
            "verified": "Official" if is_official else "Unknown",
            "risk_level": "보통" if is_official else "주의 필요"
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