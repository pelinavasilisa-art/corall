import * as cheerio from "cheerio";
import { fetchSiteBundle, normalizeUrl } from "./fetch.js";
import {
  PILLAR_LABELS,
  PILLAR_WEIGHTS,
  type AuditCheck,
  type AuditResult,
  type CheckStatus,
  type FetchedPage,
  type PillarId,
  type PillarScore,
} from "./types.js";

function check(
  id: string,
  pillar: PillarId,
  status: CheckStatus,
  title: string,
  detail: string,
  recommendation: string,
  weight = 1,
): AuditCheck {
  return { id, pillar, status, title, detail, recommendation, weight };
}

function textOf($: cheerio.CheerioAPI): string {
  $("script, style, noscript, svg, iframe").remove();
  return $("body").text().replace(/\s+/g, " ").trim();
}

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

function hasPattern(text: string, re: RegExp): boolean {
  return re.test(text);
}

function findPage(
  pages: FetchedPage[],
  predicate: (p: FetchedPage, path: string) => boolean,
): FetchedPage | undefined {
  return pages.find((p) => {
    try {
      return predicate(p, new URL(p.finalUrl || p.url).pathname.toLowerCase());
    } catch {
      return false;
    }
  });
}

function getRobots(pages: FetchedPage[]): string {
  const p = pages.find((x) => x.url.endsWith("/robots.txt") || x.finalUrl.endsWith("/robots.txt"));
  return p?.html || "";
}

function getSitemap(pages: FetchedPage[]): FetchedPage | undefined {
  return pages.find(
    (x) =>
      x.url.includes("sitemap") ||
      x.finalUrl.includes("sitemap") ||
      /sitemap/i.test(x.html.slice(0, 200)),
  );
}

function extractJsonLd($: cheerio.CheerioAPI): unknown[] {
  const out: unknown[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).html();
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) out.push(...parsed);
      else out.push(parsed);
    } catch {
      /* ignore invalid JSON-LD */
    }
  });
  return out;
}

function schemaTypes(ld: unknown[]): string[] {
  const types: string[] = [];
  const walk = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    const obj = node as Record<string, unknown>;
    if (obj["@type"]) {
      const t = obj["@type"];
      if (Array.isArray(t)) types.push(...t.map(String));
      else types.push(String(t));
    }
    if (Array.isArray(obj["@graph"])) obj["@graph"].forEach(walk);
  };
  ld.forEach(walk);
  return types.map((t) => t.toLowerCase());
}

export async function runAudit(inputUrl: string): Promise<AuditResult> {
  const url = normalizeUrl(inputUrl);
  const { pages } = await fetchSiteBundle(url);

  const home =
    pages.find((p) => {
      try {
        const path = new URL(p.finalUrl || p.url).pathname;
        return path === "/" || path === "";
      } catch {
        return false;
      }
    }) || pages[0];

  if (!home?.ok || !home.html) {
    throw new Error(
      home?.error
        ? `Не удалось загрузить сайт: ${home.error}`
        : `Не удалось загрузить сайт (HTTP ${home?.status || 0})`,
    );
  }

  const $home = cheerio.load(home.html);
  const homeText = textOf($home);
  const allHtml = pages.map((p) => p.html).join("\n");
  const allText = pages
    .filter((p) => p.ok && p.html.includes("<"))
    .map((p) => textOf(cheerio.load(p.html)))
    .join(" ");

  const checks: AuditCheck[] = [];

  // ——— Architecture ———
  const hasAbout = !!findPage(
    pages,
    (_p, path) => /about|o-nas|company|о-нас|о_нас/.test(path) || /о нас|о компании|about us/i.test(allText),
  ) || /\/about|\/o-nas|о нас|о компании/i.test(allHtml);

  const hasServicesHub = !!findPage(
    pages,
    (_p, path) => /service|uslug|услуг/.test(path),
  ) || /услуг|services/i.test($home("a").text() + $home("nav").text());

  const serviceLinks = $home("a")
    .toArray()
    .map((a) => ({
      href: ($home(a).attr("href") || "").toLowerCase(),
      text: $home(a).text().trim(),
    }))
    .filter(
      (l) =>
        /service|uslug|услуг|price|цен|тариф/.test(l.href) ||
        /услуг|сервис|тариф/.test(l.text),
    );
  const distinctServicePaths = new Set(
    serviceLinks
      .map((l) => {
        try {
          return new URL(l.href, home.finalUrl).pathname;
        } catch {
          return "";
        }
      })
      .filter((p) => p && p !== "/" && !/sitemap|robots/.test(p)),
  );

  const hasKb =
    !!findPage(pages, (_p, path) => /blog|knowledge|baza|wiki|статья|stat/.test(path)) ||
    /база знаний|блог|статьи|knowledge/i.test(allHtml);

  const hasCases =
    !!findPage(pages, (_p, path) => /case|kejs|portfolio|проект|works/.test(path)) ||
    /кейс|портфолио|наши работы|case stud/i.test(allText);

  const hasLocations =
    /адрес|address|локац|филиал|город|г\.\s*[А-ЯA-Z]|метро|как добраться/i.test(allText);

  const hasFaqPage =
    !!findPage(pages, (_p, path) => /faq|vopros|вопрос/.test(path)) ||
    /часто задаваем|faq|вопрос[ыа]?\s*и\s*ответ/i.test(allText);

  checks.push(
    check(
      "arch-home",
      "architecture",
      home.ok ? "pass" : "fail",
      "Главная страница доступна",
      home.ok ? `Загружена: ${home.finalUrl}` : "Главная не открылась",
      "Убедитесь, что сайт отвечает по HTTPS без редирект-петель.",
    ),
    check(
      "arch-about",
      "architecture",
      hasAbout ? "pass" : "warn",
      "Страница «О компании»",
      hasAbout ? "Найдена страница или блок о компании" : "Нет явной страницы About / О нас",
      "Добавьте страницу с фактами: кто вы, опыт, экспертиза, география.",
    ),
    check(
      "arch-services",
      "architecture",
      hasServicesHub || distinctServicePaths.size >= 2 ? "pass" : distinctServicePaths.size === 1 ? "warn" : "fail",
      "Услуги и отдельные страницы услуг",
      `Ссылок/путей по услугам: ${distinctServicePaths.size}${hasServicesHub ? ", есть раздел услуг" : ""}`,
      "Сделайте раздел услуг и отдельную страницу на каждую ключевую услугу.",
      1.4,
    ),
    check(
      "arch-kb",
      "architecture",
      hasKb ? "pass" : "warn",
      "База знаний / блог",
      hasKb ? "Найден блог или база знаний" : "Нет раздела со статьями/знаниями",
      "Публикуйте экспертные статьи, которые отвечают на реальные вопросы клиентов.",
    ),
    check(
      "arch-cases",
      "architecture",
      hasCases ? "pass" : "warn",
      "Кейсы / портфолио",
      hasCases ? "Найдены кейсы или портфолио" : "Кейсы не обнаружены",
      "Добавьте кейсы с задачей, решением и измеримым результатом.",
    ),
    check(
      "arch-locations",
      "architecture",
      hasLocations ? "pass" : "warn",
      "Локации / адреса",
      hasLocations ? "Есть упоминания адреса или локаций" : "Адрес/город не найдены в тексте",
      "Укажите город, адрес и режим работы в HTML-тексте, не только на карте-картинке.",
    ),
    check(
      "arch-faq",
      "architecture",
      hasFaqPage ? "pass" : "warn",
      "FAQ в структуре сайта",
      hasFaqPage ? "FAQ найден" : "FAQ не найден",
      "Создайте раздел FAQ с реальными вопросами клиентов.",
    ),
  );

  // ——— Content quality ———
  const wordCount = countWords(homeText);
  const imgCount = $home("img").length;
  const textToImg = imgCount === 0 ? wordCount : wordCount / imgCount;

  const fluffRatio = fluffScore(homeText);
  const h1s = $home("h1")
    .toArray()
    .map((el) => $home(el).text().replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const h1 = h1s[0] || "";
  const h1Good =
    h1.length >= 12 &&
    h1.length <= 90 &&
    !/добро пожаловать|welcome|главная/i.test(h1) &&
    /\S+\s+\S+/.test(h1);

  const hasPricesInHtml =
    /(\d[\d\s]{1,8}\s?(₽|руб|rub|USD|\$|€))|от\s*\d|цена[:\s]|стоимость[:\s]|тариф/i.test(
      allText,
    );
  const priceOnlyInPdf =
    !hasPricesInHtml && /\.pdf/i.test(allHtml) && /прайс|price|цен/i.test(allHtml);

  const hasProcess =
    /этап|процесс|как мы работаем|шаг\s*\d|1\.\s*.+2\.\s*/i.test(allText);
  const hasAudience =
    /для кого|подходит|целев|аудитор|клиент|B2B|B2C|малом?у бизнесу|компани/i.test(
      allText,
    );
  const hasMeasurable =
    /(\d+\s?%|\+\d+|рост|ROI|экономия|срок\s*\d+|дней|месяц)/i.test(allText) &&
    hasCases;
  const hasTeamBios =
    /команда|о специалисте|опыт\s*\d+|лет опыта|наш эксперт|биограф|основатель/i.test(
      allText,
    );
  const hasTrust =
    /отзыв|сертификат|лицензи|гарант|партнёр|клиенты|рейтинг|на рынке с/i.test(
      allText,
    );

  checks.push(
    check(
      "content-facts",
      "content",
      fluffRatio < 0.35 ? "pass" : fluffRatio < 0.55 ? "warn" : "fail",
      "Конкретика вместо воды",
      `Доля «воды» (оценка): ${Math.round(fluffRatio * 100)}%, слов на главной: ${wordCount}`,
      "Замените общие фразы фактами: цифры, сроки, география, специализация.",
      1.3,
    ),
    check(
      "content-h1",
      "content",
      h1s.length === 1 && h1Good ? "pass" : h1s.length === 1 ? "warn" : "fail",
      "H1 по формуле (кто + что + для кого)",
      h1 ? `H1 (${h1s.length}): «${h1.slice(0, 80)}»` : "H1 не найден",
      "Один H1: услуга/продукт + аудитория/город, без «Добро пожаловать».",
      1.2,
    ),
    check(
      "content-services-depth",
      "content",
      hasProcess && hasAudience ? "pass" : hasProcess || hasAudience ? "warn" : "fail",
      "Услуги: процесс, аудитория",
      `Процесс: ${hasProcess ? "да" : "нет"}, аудитория: ${hasAudience ? "да" : "нет"}`,
      "На страницах услуг опишите этапы работы и для кого услуга.",
    ),
    check(
      "content-prices",
      "content",
      hasPricesInHtml ? "pass" : priceOnlyInPdf ? "fail" : "warn",
      "Цены в HTML, не только в PDF/картинках",
      hasPricesInHtml
        ? "Цены/тарифы найдены в тексте"
        : priceOnlyInPdf
          ? "Цены, похоже, только в PDF"
          : "Цены в тексте не обнаружены",
      "Публикуйте ориентиры цен в HTML — ИИ плохо читает прайсы в PDF и на скриншотах.",
      1.3,
    ),
    check(
      "content-cases-metrics",
      "content",
      hasMeasurable ? "pass" : hasCases ? "warn" : "fail",
      "Кейсы с измеримым результатом",
      hasMeasurable ? "Есть числовые результаты рядом с кейсами" : "Метрик в кейсах мало или нет",
      "В каждом кейсе укажите до/после: %, срок, экономию, охват.",
    ),
    check(
      "content-team",
      "content",
      hasTeamBios ? "pass" : "warn",
      "Команда / эксперты",
      hasTeamBios ? "Есть признаки биографий команды" : "Биографии экспертов не найдены",
      "Добавьте страницу команды с регалиями — усиливает доверие и Person schema.",
    ),
    check(
      "content-trust",
      "content",
      hasTrust ? "pass" : "warn",
      "Сигналы доверия",
      hasTrust ? "Отзывы/сертификаты/гарантии найдены" : "Trust-сигналы слабые",
      "Покажите отзывы, сертификаты, лицензии, известных клиентов.",
    ),
    check(
      "content-text-vs-img",
      "content",
      textToImg >= 40 && wordCount >= 200 ? "pass" : wordCount >= 80 ? "warn" : "fail",
      "Текста достаточно относительно картинок",
      `Слов: ${wordCount}, изображений: ${imgCount}`,
      "Не прячьте смысл в баннерах — ключевые факты должны быть в тексте.",
    ),
  );

  // ——— Writing for AI ———
  const firstParagraph = homeText.slice(0, 400);
  const directAnswer =
    firstParagraph.length > 80 &&
    !/мы лучш|инновационн|комплексн(?:ый|ое)|полный спектр|индивидуальн/i.test(
      firstParagraph.slice(0, 120),
    ) &&
    (/\d|для |помог|предлага|специализ|занима/i.test(firstParagraph) ||
      h1Good);

  const hasSpecifics = /(\d+|₽|руб|год|лет|клиент|город|час|день)/i.test(homeText);
  const hasExplanation = homeText.length > 600 && $home("h2, h3").length >= 2;
  const hasEvidence =
    /исслед|данные|по наш|результат|кейс|отзыв|источник|по статистик/i.test(allText);
  const hasQA =
    ($home("details, [itemtype*='FAQPage'], .faq, #faq").length > 0 ||
      hasFaqPage) &&
    /вопрос|ответ|\?/.test(allText);
  const hasCTA =
    /оставить заявк|заказать|записаться|получить консультац|связаться|написать|позвон|купить|рассчитать/i.test(
      homeText,
    );

  checks.push(
    check(
      "write-direct",
      "writing",
      directAnswer ? "pass" : "warn",
      "Прямой ответ в начале",
      directAnswer
        ? "Начало страницы выглядит конкретным"
        : "Первый экран звучит общо / маркетингово",
      "В первых 2–3 предложениях ответьте: кто вы и какую задачу решаете.",
      1.3,
    ),
    check(
      "write-specifics",
      "writing",
      hasSpecifics ? "pass" : "fail",
      "Конкретика и детали",
      hasSpecifics ? "Есть цифры/факты" : "Мало конкретных деталей",
      "Добавляйте числа, сроки, названия услуг и географии.",
    ),
    check(
      "write-explain",
      "writing",
      hasExplanation ? "pass" : "warn",
      "Пояснение через подзаголовки",
      `H2/H3 на главной: ${$home("h2, h3").length}`,
      "Структурируйте текст подзаголовками-вопросами и короткими абзацами.",
    ),
    check(
      "write-evidence",
      "writing",
      hasEvidence ? "pass" : "warn",
      "Доказательства и ссылки на опыт",
      hasEvidence ? "Есть отсылки к результатам/источникам" : "Доказательная база слабая",
      "Подкрепляйте тезисы кейсами, цифрами и отзывами.",
    ),
    check(
      "write-qa",
      "writing",
      hasQA ? "pass" : "warn",
      "Формат вопрос–ответ",
      hasQA ? "Q&A присутствует" : "Q&A не найден",
      "Отвечайте на типичные вопросы в FAQ и в статьях.",
    ),
    check(
      "write-cta",
      "writing",
      hasCTA ? "pass" : "warn",
      "Понятный CTA",
      hasCTA ? "Призыв к действию найден" : "CTA не обнаружен",
      "Добавьте явный следующий шаг: заявка, звонок, расчёт.",
    ),
  );

  // ——— Technical ———
  const robots = getRobots(pages);
  const robotsOk = robots.length > 0;
  const disallowAll = /user-agent:\s*\*[\s\S]*?disallow:\s*\/\s*$/im.test(robots);
  const allowsGoogle =
    robotsOk &&
    !/user-agent:\s*googlebot[\s\S]*?disallow:\s*\/\s*$/im.test(robots) &&
    !disallowAll;
  const allowsOAI =
    robotsOk &&
    !/user-agent:\s*oai-searchbot[\s\S]*?disallow:\s*\/\s*$/im.test(robots) &&
    !disallowAll;

  const robotsMeta = ($home('meta[name="robots"]').attr("content") || "").toLowerCase();
  const badNoindex = /noindex/.test(robotsMeta);

  const sitemap = getSitemap(pages);
  const hasSitemap =
    (sitemap?.ok && /<urlset|<sitemapindex/i.test(sitemap.html)) ||
    /sitemap\.xml/i.test(robots);

  const title = ($home("title").first().text() || "").trim();
  const metaDesc = (
    $home('meta[name="description"]').attr("content") ||
    $home('meta[property="og:description"]').attr("content") ||
    ""
  ).trim();
  const uniqueMeta = title.length >= 10 && metaDesc.length >= 40;

  const internalLinks = $home("a[href]")
    .toArray()
    .filter((a) => {
      const href = $home(a).attr("href") || "";
      try {
        const u = new URL(href, home.finalUrl);
        return u.origin === new URL(home.finalUrl).origin && !!$home(a).text().trim();
      } catch {
        return false;
      }
    }).length;

  const ld = extractJsonLd($home);
  const types = schemaTypes(ld);
  const hasOrg = types.some((t) =>
    ["organization", "localbusiness", "medicalbusiness", "dentist", "store", "corporation"].includes(t),
  );
  const hasService = types.some((t) => t === "service" || t === "product");
  const hasPerson = types.some((t) => t === "person");
  const hasArticle = types.some((t) => ["article", "blogposting", "newsarticle"].includes(t));
  const hasFaqSchema = types.some((t) => t === "faqpage");
  const schemaScore =
    (hasOrg ? 1 : 0) + (hasService ? 1 : 0) + (hasPerson ? 1 : 0) + (hasArticle || hasFaqSchema ? 1 : 0);

  // JS-gated heuristic: little text but many root scripts / empty body-ish
  const scriptRoots = $home("body > script").length;
  const jsGated = wordCount < 40 && scriptRoots >= 3;
  const mobileViewport = !!$home('meta[name="viewport"]').attr("content");

  checks.push(
    check(
      "tech-robots",
      "technical",
      robotsOk && allowsGoogle && allowsOAI
        ? "pass"
        : robotsOk && allowsGoogle
          ? "warn"
          : "fail",
      "robots.txt: Googlebot и OAI-SearchBot",
      robotsOk
        ? `robots.txt найден; Googlebot: ${allowsGoogle ? "ок" : "риск"}, OAI-SearchBot: ${allowsOAI ? "ок" : "риск"}`
        : "robots.txt не найден или пуст",
      "Разрешите Googlebot и OAI-SearchBot; не закрывайте сайт Disallow: /.",
      1.4,
    ),
    check(
      "tech-noindex",
      "technical",
      badNoindex ? "fail" : "pass",
      "Нет вредоносного noindex",
      badNoindex ? `meta robots: ${robotsMeta}` : "noindex на главной не найден",
      "Уберите noindex с публичных страниц, которые должны цитироваться.",
      1.5,
    ),
    check(
      "tech-sitemap",
      "technical",
      hasSitemap ? "pass" : "warn",
      "Sitemap.xml",
      hasSitemap ? "Sitemap обнаружен" : "Sitemap не найден",
      "Добавьте sitemap.xml и укажите его в robots.txt.",
    ),
    check(
      "tech-meta",
      "technical",
      uniqueMeta && h1s.length === 1 ? "pass" : uniqueMeta || title ? "warn" : "fail",
      "Уникальные title / meta / H1",
      `title: ${title ? "есть" : "нет"}, description: ${metaDesc ? "есть" : "нет"}, H1: ${h1s.length}`,
      "У каждой важной страницы — свой title, description и один H1.",
      1.2,
    ),
    check(
      "tech-links",
      "technical",
      internalLinks >= 8 ? "pass" : internalLinks >= 3 ? "warn" : "fail",
      "HTML-внутренние ссылки",
      `Внутренних текстовых ссылок на главной: ${internalLinks}`,
      "Связывайте услуги, кейсы и статьи обычными <a href> в HTML.",
    ),
    check(
      "tech-schema",
      "technical",
      schemaScore >= 2 ? "pass" : schemaScore === 1 ? "warn" : "fail",
      "Schema.org разметка",
      types.length
        ? `Типы: ${[...new Set(types)].slice(0, 8).join(", ")}`
        : "JSON-LD не найден",
      "Добавьте Organization/LocalBusiness, Service, Person, Article/FAQPage по смыслу.",
      1.3,
    ),
    check(
      "tech-js",
      "technical",
      jsGated ? "fail" : wordCount >= 80 ? "pass" : "warn",
      "Контент не спрятан за JS",
      jsGated
        ? "Мало текста при обилии скриптов — риск JS-гейта"
        : `Текста в HTML: ${wordCount} слов`,
      "SSR или пререндер основного контента — краулеры ИИ должны видеть текст без JS.",
      1.4,
    ),
    check(
      "tech-mobile",
      "technical",
      mobileViewport && wordCount >= 50 ? "pass" : mobileViewport ? "warn" : "fail",
      "Мобильно-читаемый текст",
      mobileViewport ? "viewport meta есть" : "Нет viewport meta",
      "Текст должен читаться на мобильных без zoom; viewport обязателен.",
    ),
  );

  // ——— Query coverage ———
  const brandMention =
    title.split(/[|\-—·]/).length > 0 &&
    (hasPattern(allText, /мы\s|наш[аеи]? |компани|бренд/i) || title.length > 5);
  const categoryQs =
    /что такое|как выбрать|виды|типы|отличи|когда нужн/i.test(allText) || hasKb;
  const comparisonQs =
    /vs |против |сравнен|чем отлича|лучше ли|альтернатив|конкурент/i.test(allText);
  const commercialQs =
    /сколько стоит|цена|стоимость|заказать|где купить|как записаться|срок|гарантия/i.test(
      allText,
    );

  checks.push(
    check(
      "q-brand",
      "queries",
      brandMention ? "pass" : "warn",
      "Брендовые вопросы",
      brandMention ? "Бренд/компания представлены в тексте" : "Слабое брендовое присутствие",
      "Ответьте: кто вы, чем известны, чем отличаетесь.",
    ),
    check(
      "q-category",
      "queries",
      categoryQs ? "pass" : "warn",
      "Категорийные / образовательные вопросы",
      categoryQs ? "Есть обучающий/категорийный контент" : "Мало контента «что это / как выбрать»",
      "Пишите статьи, объясняющие категорию услуги простым языком.",
    ),
    check(
      "q-compare",
      "queries",
      comparisonQs ? "pass" : "warn",
      "Сравнительные вопросы",
      comparisonQs ? "Есть сравнения/отличия" : "Сравнений не найдено",
      "Добавьте страницу «чем мы отличаемся» или сравнения подходов/тарифов.",
    ),
    check(
      "q-commercial",
      "queries",
      commercialQs ? "pass" : "fail",
      "Коммерческие вопросы",
      commercialQs ? "Есть ответы про цену/заказ/срок" : "Коммерческие ответы слабые",
      "Явно закройте: цена, как заказать, сроки, гарантии.",
      1.3,
    ),
  );

  // ——— FAQ & local ———
  const realFaq =
    hasFaqPage &&
    ((allText.match(/\?/g) || []).length >= 3 || hasFaqSchema || /вопрос/i.test(allText));
  const cityAddress =
    /г\.\s*[А-ЯЁA-Z]|город|улица|ул\.|проспект|адрес|офис/i.test(allText);
  const hours = /пн|вт|ср|чт|пт|сб|вс|ежедневн|круглосуточ|режим работы|часов|:\s*\d{2}/i.test(
    allText,
  );
  const differentiation =
    /отлича|уникальн|в отличие|наш подход|почему (мы|выбирают)|преимуществ/i.test(
      allText,
    );

  checks.push(
    check(
      "local-faq",
      "faqLocal",
      realFaq ? "pass" : hasFaqPage ? "warn" : "fail",
      "Настоящий FAQ",
      realFaq ? "FAQ с вопросами найден" : "FAQ отсутствует или слишком бедный",
      "Соберите 8–15 реальных вопросов клиентов с прямыми ответами.",
      1.3,
    ),
    check(
      "local-city",
      "faqLocal",
      cityAddress ? "pass" : "warn",
      "Город и адрес",
      cityAddress ? "Адрес/город в тексте есть" : "Город/адрес не найдены",
      "Укажите город и адрес в HTML + LocalBusiness schema.",
    ),
    check(
      "local-hours",
      "faqLocal",
      hours ? "pass" : "warn",
      "Часы работы",
      hours ? "Режим работы упоминается" : "Часы работы не найдены",
      "Опубликуйте часы работы текстом — важно для локальных ИИ-ответов.",
    ),
    check(
      "local-diff",
      "faqLocal",
      differentiation ? "pass" : "warn",
      "Отстройка от конкурентов",
      differentiation ? "Есть дифференциация" : "Сложно понять отличие от конкурентов",
      "Сформулируйте 3–5 отличий: метод, гарантии, ниша, сроки.",
    ),
  );

  // ——— Bonus (optional, low weight) ———
  const llms = pages.find((p) => p.url.endsWith("/llms.txt") || p.finalUrl.endsWith("/llms.txt"));
  const hasLlms = !!(llms?.ok && llms.html.trim().length > 20);
  checks.push(
    check(
      "bonus-llms",
      "bonus",
      hasLlms ? "pass" : "warn",
      "llms.txt (опционально)",
      hasLlms ? "llms.txt найден — небольшой бонус" : "llms.txt нет — это не критично",
      "Можно добавить llms.txt с кратким описанием сайта, но не вместо нормального контента.",
      0.3,
    ),
  );

  const pillars = scorePillars(checks);
  const overallScore = computeOverall(pillars);
  const topFixes = checks
    .filter((c) => c.pillar !== "bonus" && c.status !== "pass")
    .sort((a, b) => {
      const rank = { fail: 0, warn: 1, pass: 2 };
      const d = rank[a.status] - rank[b.status];
      if (d !== 0) return d;
      return b.weight - a.weight;
    })
    .slice(0, 5);

  const summary = buildSummary(overallScore, topFixes);

  return {
    url: home.finalUrl || url,
    analyzedAt: new Date().toISOString(),
    overallScore,
    disclaimer:
      "Оценка эвристическая: это готовность / вероятность быть понятым и процитированным ИИ, а не гарантия позиций в ChatGPT, Alice, Gemini или Perplexity.",
    pillars,
    topFixes,
    pagesFetched: pages.map((p) => p.finalUrl || p.url),
    summary,
  };
}

function fluffScore(text: string): number {
  if (!text) return 1;
  const fluff =
    text.match(
      /инновационн|комплексн|индивидуальн|полный спектр|высокий уровень|качественн|уникальн(?:ый|ое) (?:подход|решени)|лучшие специалисты|динамичн|синерг|клиентоориентир/gi,
    ) || [];
  const sentences = Math.max(text.split(/[.!?]+/).filter((s) => s.trim().length > 20).length, 1);
  return Math.min(1, fluff.length / Math.max(sentences * 0.35, 1));
}

function scorePillars(checks: AuditCheck[]): PillarScore[] {
  const order: PillarId[] = [
    "architecture",
    "content",
    "writing",
    "technical",
    "queries",
    "faqLocal",
    "bonus",
  ];

  return order.map((id) => {
    const pillarChecks = checks.filter((c) => c.pillar === id);
    const maxPoints = pillarChecks.reduce((s, c) => s + c.weight, 0) || 1;
    const points = pillarChecks.reduce((s, c) => {
      if (c.status === "pass") return s + c.weight;
      if (c.status === "warn") return s + c.weight * 0.45;
      return s;
    }, 0);
    const raw = Math.round((points / maxPoints) * 100);
    return {
      id,
      label: PILLAR_LABELS[id],
      score: raw,
      maxScore: 100,
      checks: pillarChecks,
    };
  });
}

function computeOverall(pillars: PillarScore[]): number {
  let total = 0;
  let weightSum = 0;
  for (const [id, w] of Object.entries(PILLAR_WEIGHTS) as [keyof typeof PILLAR_WEIGHTS, number][]) {
    const p = pillars.find((x) => x.id === id);
    if (!p) continue;
    total += (p.score / 100) * w;
    weightSum += w;
  }
  // Tiny optional bonus from llms.txt etc. — max +3
  const bonus = pillars.find((p) => p.id === "bonus");
  const bonusPoints = bonus && bonus.score >= 70 ? 3 : bonus && bonus.score >= 40 ? 1 : 0;
  const base = weightSum ? (total / weightSum) * 100 : 0;
  return Math.max(0, Math.min(100, Math.round(base + bonusPoints)));
}

function buildSummary(score: number, fixes: AuditCheck[]): string {
  const level =
    score >= 80
      ? "Сайт хорошо подготовлен к обнаружению ИИ-системами"
      : score >= 60
        ? "Базовая готовность есть, но есть заметные пробелы"
        : score >= 40
          ? "Средняя готовность — ИИ может плохо понимать и цитировать сайт"
          : "Низкая готовность — приоритетно закрыть технику и структуру";
  const focus = fixes[0] ? ` Начните с: «${fixes[0].title}».` : "";
  return `${level}.${focus}`;
}
