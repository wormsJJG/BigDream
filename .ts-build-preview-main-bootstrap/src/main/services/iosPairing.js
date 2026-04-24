"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createIosPairingHelpers = createIosPairingHelpers;
function createIosPairingHelpers({ fs, CONFIG, Utils }) {
    async function validatePairing(udid) {
        const pairTool = CONFIG?.PATHS?.IOS_PAIR;
        if (!pairTool || !fs.existsSync(pairTool)) {
            return { ok: true, skipped: true };
        }
        try {
            const output = await Utils.runCommand(`"${pairTool}" validate -u ${udid}`);
            const normalized = String(output || '').trim().toLowerCase();
            const isValidated = normalized.includes('success') ||
                normalized.includes('validated') ||
                normalized.includes('paired');
            return isValidated
                ? { ok: true }
                : { ok: false, message: 'iOS 신뢰/페어링 확인이 완료되지 않았습니다.' };
        }
        catch (error) {
            const msg = String(error?.message || error || '').toLowerCase();
            if (msg.includes('passwordprotected') ||
                msg.includes('passcode') ||
                msg.includes('locked') ||
                msg.includes('pair') ||
                msg.includes('trust')) {
                return { ok: false, message: '아이폰 잠금 해제 또는 "이 컴퓨터 신뢰" 승인이 완료되지 않았습니다.' };
            }
            return { ok: false, message: 'iOS 신뢰/페어링 상태를 확인하지 못했습니다.' };
        }
    }
    return {
        validatePairing
    };
}
