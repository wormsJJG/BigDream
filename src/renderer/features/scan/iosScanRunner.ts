import type { IosProgressMode, RendererState } from '../../../types/renderer-context';
import type { IosScanResult } from '../../../main/services/iosService';

export interface IosScanRunner {
  run(args: {
    setIosStep: (step: number, text: string) => void;
    onSuccess: (data: IosScanResult) => void;
    onError: (error: unknown) => void;
  }): Promise<void>;
}

export function createIosScanRunner({
  State,
  Utils,
  scanPostActions
}: {
  State: Pick<RendererState, 'userRole' | 'iosProgressMode' | 'currentUdid'>;
  Utils: {
    transformIosData: (rawData: IosScanResult) => IosScanResult;
  };
  scanPostActions: {
    scheduleIosBackupCleanup: (udid: string | undefined) => void;
  };
}): IosScanRunner {
  async function run({
    setIosStep,
    onSuccess,
    onError
  }: {
    setIosStep: (step: number, text: string) => void;
    onSuccess: (data: IosScanResult) => void;
    onError: (error: unknown) => void;
  }): Promise<void> {
    try {
      const isPrivilegedRole = State.userRole === 'admin' || State.userRole === 'distributor';
      const iosProgressPolicy: IosProgressMode | 'random_20_30' = isPrivilegedRole
        ? (State.iosProgressMode || 'real')
        : 'random_20_30';

      const rawData = await window.electronAPI.runIosScan(State.currentUdid, {
        progressPolicy: iosProgressPolicy,
        userRole: State.userRole || 'user'
      }) as IosScanResult & { error?: string };
      if (rawData.error) throw new Error(rawData.error);

      const data = Utils.transformIosData(rawData);
      setIosStep(4, '결과 정리 중...');
      await new Promise((resolve) => setTimeout(resolve, 400));
      onSuccess(data);

      const finishedUdid = State.currentUdid;
      scanPostActions.scheduleIosBackupCleanup(finishedUdid || undefined);
    } catch (error) {
      onError(error);
    }
  }

  return {
    run
  };
}
