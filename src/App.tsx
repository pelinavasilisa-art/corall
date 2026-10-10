import { FormEvent, useState } from "react";
import type { AuditResult, CheckStatus } from "./types";

const STATUS_RU: Record<CheckStatus, string> = {
  pass: "ок",
  warn: "внимание",
  fail: "критично",
};

export default function App() {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AuditResult | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch("/api/audit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Не удалось выполнить аудит");
      }
      setResult(data as AuditResult);
      requestAnimationFrame(() => {
        document.getElementById("results")?.scrollIntoView({ behavior: "smooth" });
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка сети");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <header className="shell hero">
        <h1 className="brand">
          GEO <span>Scan</span>
        </h1>
        <p className="lede">
          Аудит готовности сайта к ChatGPT, Yandex Alice/Neuro, Gemini и
          Perplexity — структура, текст и техника, по которым ИИ вас находит и
          цитирует.
        </p>
        <form className="audit-form" onSubmit={onSubmit}>
          <input
            type="url"
            name="url"
            inputMode="url"
            autoComplete="url"
            placeholder="https://example.ru"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            required
            aria-label="URL сайта"
          />
          <button type="submit" disabled={loading || !url.trim()}>
            {loading ? "Сканируем…" : "Проверить"}
          </button>
        </form>
        <p className="hint">
          Эвристики готовности, не гарантия ранжирования в ответах ИИ.
        </p>
        {error && <p className="error-banner">{error}</p>}
        {loading && <div className="scan-line" aria-hidden />}
      </header>

      {result && (
        <main id="results" className="shell results">
          <section className="score-block" style={{ ["--p" as string]: result.overallScore }}>
            <div
              className="score-ring"
              style={{ ["--p" as string]: result.overallScore }}
              aria-label={`Общий балл ${result.overallScore} из 100`}
            >
              <strong>{result.overallScore}</strong>
            </div>
            <div className="score-copy">
              <h2>Готовность к ИИ</h2>
              <p>{result.summary}</p>
            </div>
            <p className="disclaimer">{result.disclaimer}</p>
          </section>

          <h2 className="section-title">Столпы</h2>
          <div className="pillars">
            {result.pillars
              .filter((p) => p.id !== "bonus")
              .map((p) => (
                <div key={p.id} className="pillar">
                  <span className="pillar-name">{p.label}</span>
                  <span className="pillar-score">{p.score}</span>
                  <div className="bar" style={{ ["--p" as string]: p.score }}>
                    <i />
                  </div>
                </div>
              ))}
            {result.pillars
              .filter((p) => p.id === "bonus")
              .map((p) => (
                <div key={p.id} className="pillar">
                  <span className="pillar-name">{p.label}</span>
                  <span className="pillar-score">{p.score}</span>
                  <div className="bar" style={{ ["--p" as string]: p.score }}>
                    <i />
                  </div>
                </div>
              ))}
          </div>

          <h2 className="section-title">Что исправить сначала</h2>
          <ol className="fixes">
            {result.topFixes.map((f) => (
              <li key={f.id}>
                <strong>
                  [{STATUS_RU[f.status]}] {f.title}
                </strong>
                <span>{f.recommendation}</span>
              </li>
            ))}
          </ol>

          <h2 className="section-title">Чеклист</h2>
          <div className="checklist">
            {result.pillars.map((pillar) => (
              <section key={pillar.id} className="pillar-block">
                <h3>
                  <span>{pillar.label}</span>
                  <span>{pillar.score}/100</span>
                </h3>
                {pillar.checks.map((c) => (
                  <div key={c.id} className="check">
                    <span className={`badge ${c.status}`}>{STATUS_RU[c.status]}</span>
                    <p className="check-title">{c.title}</p>
                    <p className="check-detail">{c.detail}</p>
                    {c.status !== "pass" && (
                      <p className="check-rec">→ {c.recommendation}</p>
                    )}
                  </div>
                ))}
              </section>
            ))}
          </div>

          <p className="meta-line">
            Проверено: {result.url} · страниц: {result.pagesFetched.length} ·{" "}
            {new Date(result.analyzedAt).toLocaleString("ru-RU")}
          </p>
        </main>
      )}

      <footer className="shell footer">
        GEO Scan · эвристический аудит AI/GEO-готовности · не обещает позиции в
        ответах нейросетей
      </footer>
    </>
  );
}
