export function createIosScanProgressBinding({ setIosStep, resolveIosStageMessage, hasMeaningfulBackupSignal, trustPromptMessage }) {
    function bind() {
        let iosBackupStageLatched = false;
        try {
            if (!window.electronAPI || typeof window.electronAPI.onIosScanProgress !== 'function') {
                return () => { };
            }
            return window.electronAPI.onIosScanProgress((rawPayload) => {
                try {
                    const payload = (rawPayload || {});
                    const stage = String(payload?.stage || '').trim().toLowerCase();
                    const msg = resolveIosStageMessage(payload);
                    const rawMessage = String(payload?.message || '');
                    const trustConfirmed = payload?.trustConfirmed === true;
                    const shouldLatchBackup = trustConfirmed
                        && (hasMeaningfulBackupSignal(payload)
                            || /백업|데이터 수집/i.test(rawMessage));
                    if (stage === 'mvt') {
                        iosBackupStageLatched = true;
                        setIosStep(3, '정밀 분석 진행 중...');
                        return;
                    }
                    if (stage === 'backup') {
                        if (shouldLatchBackup) {
                            iosBackupStageLatched = true;
                        }
                        if (iosBackupStageLatched || shouldLatchBackup) {
                            setIosStep(2, msg || '검사 데이터 수집 중...');
                        }
                        else {
                            setIosStep(1, trustPromptMessage);
                        }
                        return;
                    }
                    if (iosBackupStageLatched) {
                        setIosStep(2, msg || '검사 데이터 수집 중...');
                        return;
                    }
                    if (!trustConfirmed) {
                        setIosStep(1, msg || trustPromptMessage);
                        return;
                    }
                    setIosStep(1, msg || trustPromptMessage);
                }
                catch (_e) { }
            }) || (() => { });
        }
        catch (_e) {
            return () => { };
        }
    }
    return {
        bind
    };
}
