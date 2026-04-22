declare const riskRules: {
  RISK_LEVELS: Readonly<{
    SPYWARE: string;
    PRIVACY_RISK: string;
    SAFE: string;
  }>;
  POLICY_LOCATION_SHARING_PACKAGE_IDS: ReadonlySet<string>;
  POLICY_SURVEILLANCE_LIKE_PACKAGE_IDS: ReadonlySet<string>;
  IOS_POLICY_LOCATION_SHARING_BUNDLE_IDS: ReadonlySet<string>;
  IOS_POLICY_SURVEILLANCE_LIKE_BUNDLE_IDS: ReadonlySet<string>;
  evaluateAndroidAppRisk(app: unknown): {
    riskLevel: string;
    riskReasons: unknown[];
    recommendation: unknown[];
    aiNarration: string;
  };
  evaluateAppRisk(platform: string, app: unknown): {
    riskLevel: string;
    riskReasons: unknown[];
    recommendation: unknown[];
    aiNarration: string;
    card: unknown;
  };
};

export = riskRules;
