export function createIosScanRunner({ State, Utils, scanPostActions }) {
    async function run({ setIosStep, onSuccess, onError }) {
        try {
            const isPrivilegedRole = State.userRole === 'admin' || State.userRole === 'distributor';
            const iosProgressPolicy = isPrivilegedRole
                ? (State.iosProgressMode || 'real')
                : 'random_20_30';
            const rawData = await window.electronAPI.runIosScan(State.currentUdid, {
                progressPolicy: iosProgressPolicy,
                userRole: State.userRole || 'user'
            });
            if (rawData.error)
                throw new Error(rawData.error);
            const data = Utils.transformIosData(rawData);
            setIosStep(4, '결과 정리 중...');
            await new Promise((resolve) => setTimeout(resolve, 400));
            onSuccess(data);
            const finishedUdid = State.currentUdid;
            scanPostActions.scheduleIosBackupCleanup(finishedUdid);
        }
        catch (error) {
            onError(error);
        }
    }
    return {
        run
    };
}
