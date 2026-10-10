export type CheckStatus = "pass" | "warn" | "fail";

export interface AuditCheck {
  id: string;
  pillar: string;
  status: CheckStatus;
  title: string;
  detail: string;
  recommendation: string;
  weight: number;
}

export interface PillarScore {
  id: string;
  label: string;
  score: number;
  maxScore: number;
  checks: AuditCheck[];
}

export interface AuditResult {
  url: string;
  analyzedAt: string;
  overallScore: number;
  disclaimer: string;
  pillars: PillarScore[];
  topFixes: AuditCheck[];
  pagesFetched: string[];
  summary: string;
}
