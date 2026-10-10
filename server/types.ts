export type CheckStatus = "pass" | "warn" | "fail";

export interface AuditCheck {
  id: string;
  pillar: PillarId;
  status: CheckStatus;
  title: string;
  detail: string;
  recommendation: string;
  weight: number;
}

export type PillarId =
  | "architecture"
  | "content"
  | "writing"
  | "technical"
  | "queries"
  | "faqLocal"
  | "bonus";

export interface PillarScore {
  id: PillarId;
  label: string;
  score: number;
  maxScore: number;
  checks: AuditCheck[];
}

export interface FetchedPage {
  url: string;
  ok: boolean;
  status: number;
  html: string;
  finalUrl: string;
  error?: string;
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

export const PILLAR_LABELS: Record<PillarId, string> = {
  architecture: "Архитектура",
  content: "Качество контента",
  writing: "Письмо для ИИ",
  technical: "Техника для краулеров",
  queries: "Покрытие запросов",
  faqLocal: "FAQ и локальность",
  bonus: "Бонус (опционально)",
};

export const PILLAR_WEIGHTS: Record<Exclude<PillarId, "bonus">, number> = {
  architecture: 18,
  content: 20,
  writing: 15,
  technical: 22,
  queries: 12,
  faqLocal: 13,
};
