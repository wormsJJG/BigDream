import sys
import json
import socket
from scapy.all import sniff, IP, TCP, UDP, Raw

# 1. 내 PC의 IP 확인 (사용자 안내용)
def get_pc_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except:
        return socket.gethostbyname(socket.gethostname())

# 2. 감시 설정 (이 IP는 실제 핸드폰의 WiFi 설정에서 확인한 IP로 바꿔야 함)
# Electron에서 인자로 전달받게 만들면 더 전문적입니다.
MOBILE_IP = "192.168.0.5" 

print(json.dumps({
    "type": "INFO", 
    "message": f"내 PC IP: {get_pc_ip()} (핸드폰 프록시를 이 주소로 설정하세요)",
    "target_mobile": MOBILE_IP
}, ensure_ascii=False), flush=True)

def process_mobile_packet(packet):
    """모바일 기기의 패킷만 분석하여 추출"""
    if packet.haslayer(IP):
        ip_layer = packet.getlayer(IP)
        
        # 출발지(src)나 목적지(dst)가 모바일 IP인 경우만 통과
        if ip_layer.src == MOBILE_IP or ip_layer.dst == MOBILE_IP:
            protocol = "TCP" if packet.haslayer(TCP) else "UDP" if packet.haslayer(UDP) else "Other"
            
            packet_info = {
                "type": "NETWORK_PACKET",
                "src": ip_layer.src,
                "dst": ip_layer.dst,
                "protocol": protocol,
                "size": len(packet),
                "payload_preview": ""
            }

            # 데이터(Payload) 추출 및 스파이앱 의심 키워드 분석
            if packet.haslayer(Raw):
                try:
                    payload = packet[Raw].load.decode('utf-8', errors='ignore')
                    packet_info["payload_preview"] = payload[:50].strip() # 50자까지 확장
                    
                    # 전문성을 위한 추가 로직: 민감 키워드 발견 시 플래그 추가
                    keywords = ['sms', 'contact', 'location', 'phonebook', 'login']
                    if any(key in payload.lower() for key in keywords):
                        packet_info["alert"] = "SENSITIVE_DATA_DETECTED"
                except:
                    packet_info["payload_preview"] = "[Binary Data]"

            # 한 줄씩 JSON 출력 (Electron 전달용)
            print(json.dumps(packet_info, ensure_ascii=False), flush=True)

if __name__ == "__main__":
    try:
        # filter를 사용해 커널 수준에서 모바일 IP만 걸러내어 성능 최적화
        sniff(filter=f"host {MOBILE_IP}", prn=process_mobile_packet, store=0)
    except Exception as e:
        print(json.dumps({"type": "ERROR", "message": str(e)}))