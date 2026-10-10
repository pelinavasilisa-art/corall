import type { FetchedPage } from "./types.js";

const USER_AGENT =
  "GEOScanBot/1.0 (+https://localhost; AI readiness auditor; respectful fetch)";

const TIMEOUT_MS = 12000;

export function normalizeUrl(input: string): string {
  let raw = input.trim();
  if (!raw) throw new Error("URL пустой");
  if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`;
  const url = new URL(raw);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Разрешены только http/https");
  }
  return url.toString();
}

export async function fetchPage(url: string): Promise<FetchedPage> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "ru,en;q=0.8",
      },
    });
    const contentType = res.headers.get("content-type") || "";
    let html = "";
    if (
      contentType.includes("html") ||
      contentType.includes("xml") ||
      contentType.includes("text") ||
      !contentType
    ) {
      html = await res.text();
      // Cap size to avoid memory issues
      if (html.length > 2_000_000) html = html.slice(0, 2_000_000);
    }
    return {
      url,
      ok: res.ok,
      status: res.status,
      html,
      finalUrl: res.url || url,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Ошибка загрузки";
    return {
      url,
      ok: false,
      status: 0,
      html: "",
      finalUrl: url,
      error: message,
    };
  } finally {
    clearTimeout(timer);
  }
}

export function resolveUrl(base: string, path: string): string {
  return new URL(path, base).toString();
}

export async function fetchSiteBundle(startUrl: string) {
  const home = await fetchPage(startUrl);
  const origin = new URL(home.finalUrl || startUrl).origin;

  const candidatePaths = [
    "/about",
    "/about/",
    "/o-nas",
    "/o-nas/",
    "/company",
    "/services",
    "/services/",
    "/uslugi",
    "/uslugi/",
    "/faq",
    "/faq/",
    "/contacts",
    "/contacts/",
    "/kontakty",
    "/kontakty/",
    "/blog",
    "/cases",
    "/kejsy",
    "/portfolio",
    "/robots.txt",
    "/sitemap.xml",
    "/llms.txt",
  ];

  // Discover more paths from homepage links
  const discovered = discoverInternalPaths(home.html, origin);

  const toFetch = new Set<string>();
  for (const p of candidatePaths) toFetch.add(resolveUrl(origin, p));
  for (const p of discovered.slice(0, 12)) toFetch.add(p);

  // Don't re-fetch home
  toFetch.delete(home.finalUrl);
  toFetch.delete(startUrl);

  const pages: FetchedPage[] = [home];
  const results = await Promise.all(
    [...toFetch].map((u) => fetchPage(u)),
  );

  for (const page of results) {
    // Keep useful responses; soft-404s with empty body skipped
    if (page.ok && page.html.length > 80) {
      pages.push(page);
    } else if (
      page.url.endsWith("robots.txt") ||
      page.url.endsWith("sitemap.xml") ||
      page.url.endsWith("llms.txt")
    ) {
      // Keep even empty/failed for analysis
      pages.push(page);
    }
  }

  return { origin, pages };
}

function discoverInternalPaths(html: string, origin: string): string[] {
  if (!html) return [];
  const hrefs = [...html.matchAll(/href=["']([^"'#]+)["']/gi)].map((m) => m[1]);
  const keywords =
    /about|o-nas|company|service|uslug|faq|vopros|contact|kontakt|case|kejs|portfolio|blog|stat|price|cen|team|komand|location|adres|filial|vacanc|otzyv/i;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const href of hrefs) {
    try {
      const abs = new URL(href, origin);
      if (abs.origin !== origin) continue;
      if (!keywords.test(abs.pathname)) continue;
      const key = abs.origin + abs.pathname;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(abs.toString());
    } catch {
      /* ignore bad urls */
    }
  }
  return out;
}
