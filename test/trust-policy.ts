export interface TrustPolicy {
  version: number;
  trustedSourceKinds: string[];
  untrustedSourceKinds: string[];
  forbiddenClaims: Array<{ id: string; pattern: string }>;
  executionRequiresApproval: boolean;
}

export interface TrustDecision {
  trusted: boolean;
  mayOverride: boolean;
  mayExecute: boolean;
  rejectedClaims: string[];
}

export function evaluateEvidence(
  policy: TrustPolicy,
  sourceKind: string,
  content: string,
  approved = false,
): TrustDecision {
  const trusted = policy.trustedSourceKinds.includes(sourceKind);
  const rejectedClaims = trusted
    ? []
    : policy.forbiddenClaims
        .filter(({ pattern }) => new RegExp(pattern, "i").test(content))
        .map(({ id }) => id);

  return {
    trusted,
    mayOverride: trusted && rejectedClaims.length === 0,
    mayExecute: trusted && (!policy.executionRequiresApproval || approved),
    rejectedClaims,
  };
}
