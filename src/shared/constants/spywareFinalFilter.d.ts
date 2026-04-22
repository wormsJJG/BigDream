declare const spywareFinalFilter: {
  evaluateAndroidSpywareFinalVerdict(app: unknown): {
    isSpyware: boolean;
    reasons: unknown[];
    narration: string;
  };
};

export = spywareFinalFilter;
