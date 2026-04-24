export const MockData = {
    getAndroidConnection() {
        return { status: 'connected', model: 'SM-TEST' };
    },
    getAndroidScanResult() {
        const allApps = [
            { packageName: 'com.google.android.youtube', cachedTitle: 'YouTube', installer: 'com.android.vending', isSideloaded: false, uid: '10100', origin: '공식 스토어', dataUsage: { rx: 50000000, tx: 3000000 } },
            { packageName: 'com.android.systemui', cachedTitle: 'System UI', installer: null, isSideloaded: false, uid: '1000', origin: '시스템 앱', dataUsage: { rx: 1000000, tx: 500000 } },
            {
                packageName: 'com.android.settings.daemon',
                cachedTitle: 'Wi-Fi Assistant',
                installer: null,
                isSideloaded: true,
                uid: '10272',
                origin: '외부 설치',
                dataUsage: { rx: 50000, tx: 85000000 },
                permissions: ['ACCESS_FINE_LOCATION', 'READ_SMS', 'RECEIVE_BOOT_COMPLETED']
            },
            {
                packageName: 'com.fp.backup',
                cachedTitle: 'Backup Service',
                installer: 'com.sideload.browser',
                isSideloaded: true,
                uid: '10273',
                origin: '외부 설치',
                dataUsage: { rx: 10000000, tx: 10000000 },
                reason: '[VT 확진] 악성(22/68) + READ_SMS, READ_CALL_LOG 권한 다수'
            },
            {
                packageName: 'com.hidden.syscore',
                cachedTitle: '',
                installer: null,
                isSideloaded: true,
                uid: '10274',
                origin: '외부 설치',
                dataUsage: { rx: 10000, tx: 2000000 },
                permissions: ['SYSTEM_ALERT_WINDOW', 'CAMERA', 'RECORD_AUDIO']
            },
            { packageName: 'com.kakao.talk', cachedTitle: '카카오톡', installer: 'com.android.vending', isSideloaded: false, uid: '10275', origin: '공식 스토어', dataUsage: { rx: 20000000, tx: 5000000 } }
        ];
        const apkFiles = [
            '/sdcard/Download/system_update_v1.apk',
            '/sdcard/Android/data/com.hidden.syscore/files/core.apk'
        ];
        const suspiciousApps = allApps.filter((app) => app.reason || (app.uid === '10272' && app.isSideloaded));
        if (!suspiciousApps.some((app) => app.packageName === 'com.android.settings.daemon')) {
            suspiciousApps.push(allApps.find((app) => app.packageName === 'com.android.settings.daemon'));
        }
        if (!suspiciousApps.some((app) => app.packageName === 'com.hidden.syscore')) {
            suspiciousApps.push(allApps.find((app) => app.packageName === 'com.hidden.syscore'));
        }
        return {
            deviceInfo: {
                model: 'SM-F966N (MOCK)',
                serial: 'RFCY71W09GM',
                phoneNumber: '알 수 없음',
                os: 'Android 14'
            },
            allApps,
            apkFiles,
            suspiciousApps: suspiciousApps.filter(Boolean),
            networkUsageMap: {
                '10100': { rx: 50000000, tx: 3000000 },
                '1000': { rx: 1000000, tx: 500000 },
                '10272': { rx: 50000, tx: 85000000 },
                '10273': { rx: 10000000, tx: 10000000 },
                '10274': { rx: 10000, tx: 2000000 },
                '10275': { rx: 20000000, tx: 5000000 }
            }
        };
    },
    getIosConnection() {
        return { status: 'connected', model: 'iPhone 15 Pro (TEST)', udid: '00008101-001E30590C000000', type: 'ios' };
    },
    getIosScanResult() {
        const installedApps = [
            { packageName: 'com.apple.camera', cachedTitle: '카메라' },
            { packageName: 'com.google.Gmail', cachedTitle: 'Gmail' },
            { packageName: 'com.lguplus.aicallagent', cachedTitle: '익시오' },
            { packageName: 'com.apple.weather', cachedTitle: '날씨' },
            { packageName: 'net.whatsapp.WhatsApp', cachedTitle: 'WhatsApp' },
            { packageName: 'com.spyware.agent.hidden', cachedTitle: '시스템 서비스' },
            { packageName: 'com.naver.map', cachedTitle: '네이버 지도' },
            { packageName: 'com.tistory.blog', cachedTitle: '티스토리' },
            { packageName: 'com.google.youtube', cachedTitle: 'YouTube' },
            { packageName: 'com.kakaobank.bank', cachedTitle: '카카오뱅크' }
        ];
        const suspiciousItems = [
            { module: 'SMS', check_name: 'iMessage Link IOC', description: '악성 도메인 접속 유도 링크 수신', path: '/private/var/mobile/Library/SMS/sms.db', sha256: 'a1b2c3d4...' },
            { module: 'WebKit', check_name: 'Browser History IOC', description: 'Safari에서 C2 서버 도메인 접속 흔적 발견', path: '/private/var/mobile/Library/WebKit', sha256: 'e5f6g7h8...' },
            { module: 'Process', check_name: 'Suspicious Process', description: '비정상적인 이름의 백그라운드 프로세스 활동', path: 'com.apple.bh', sha256: 'i9j0k1l2...' }
        ];
        return {
            deviceInfo: {
                model: 'iPhone 16 Pro (MOCK)',
                serial: 'IOS-TEST-UDID',
                phoneNumber: '+82 10-9999-0000',
                os: 'iOS 17.4'
            },
            suspiciousItems,
            mvtResults: {
                web: { status: 'warning', warnings: ['악성 URL 접속 흔적: hxxp://c2-server.com', 'Safari 캐시에서 비정상 파일 발견'] },
                messages: { status: 'warning', warnings: ['악성 도메인 접속 유도 링크 수신'] },
                system: { status: 'warning', warnings: ['비정상적인 이름의 백그라운드 프로세스 활동', '의심스러운 Crash Report 발견'] },
                apps: { status: 'safe', warnings: [] },
                artifacts: { status: 'safe', warnings: [] }
            },
            allApps: installedApps,
            apkFiles: []
        };
    }
};
