// Live price lookups for the investment tracker.
//
// Mutual funds: matched against AMFI's official daily NAV data via
// api.mfapi.in (a well-known free wrapper around the AMFI feed — no API key
// needed). Scheme names are matched by normalized substring/word-overlap
// since a fund's display name on Groww rarely matches AMFI's registered
// name exactly (e.g. "HDFC Defence Fund Direct Growth" vs "HDFC Defence
// Fund - Direct Plan - Growth Option").
//
// Stocks/ETFs: resolved to a ticker via Yahoo Finance's (unofficial, no key)
// search endpoint once, cached on the investment row, then priced via
// Yahoo's chart endpoint on every refresh.
//
// Both are third-party network calls with no SLA, so every lookup here is
// wrapped so one failure never takes down the whole refresh — the caller
// just gets back "no match" for that holding.

const FETCH_TIMEOUT_MS = 15000;
const USER_AGENT = "Mozilla/5.0 (compatible; FinFlowPriceRefresh/1.0)";

async function fetchJson(url) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { "User-Agent": USER_AGENT },
  });
  if (!res.ok) throw new Error(`Request to ${url} failed with status ${res.status}`);
  return res.json();
}

function normalizeSchemeName(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// ---- Mutual funds (AMFI via mfapi.in) ----

let amfiSchemeListCache = null;
let amfiSchemeListCachedAt = 0;
const AMFI_LIST_TTL_MS = 6 * 60 * 60 * 1000; // NAVs are declared once a day

async function getAmfiSchemeList() {
  const now = Date.now();
  if (amfiSchemeListCache && now - amfiSchemeListCachedAt < AMFI_LIST_TTL_MS) {
    return amfiSchemeListCache;
  }
  const list = await fetchJson("https://api.mfapi.in/mf");
  amfiSchemeListCache = list;
  amfiSchemeListCachedAt = now;
  return list;
}

function findBestSchemeMatch(schemeName, list) {
  const target = normalizeSchemeName(schemeName);
  const targetWords = new Set(target.split(" ").filter(Boolean));
  if (targetWords.size === 0) return null;

  let best = null;
  let bestScore = 0;
  for (const scheme of list) {
    const candidate = normalizeSchemeName(scheme.schemeName);
    if (candidate.includes(target)) {
      // A direct substring match is about as confident as this gets.
      return scheme;
    }
    const candidateWords = new Set(candidate.split(" ").filter(Boolean));
    let overlap = 0;
    for (const word of targetWords) {
      if (candidateWords.has(word)) overlap++;
    }
    const score = overlap / targetWords.size;
    if (score > bestScore) {
      bestScore = score;
      best = scheme;
    }
  }
  return bestScore >= 0.85 ? best : null;
}

// Returns the latest NAV (in rupees) for a scheme name, or null if no
// confident match was found in the AMFI list.
export async function fetchMutualFundNav(schemeName) {
  const list = await getAmfiSchemeList();
  const match = findBestSchemeMatch(schemeName, list);
  if (!match) return null;
  return fetchMutualFundNavByCode(match.schemeCode);
}

// Same lookup, but for when the caller already has an exact scheme code
// (e.g. the user picked one of the as-you-type suggestions) — no fuzzy
// name matching needed.
export async function fetchMutualFundNavByCode(schemeCode) {
  const detail = await fetchJson(`https://api.mfapi.in/mf/${schemeCode}/latest`);
  const nav = Number(detail?.data?.[0]?.nav);
  return Number.isFinite(nav) ? nav : null;
}

// As-you-type suggestions for the "Add a holding" form — a looser
// substring/word-overlap search over the same AMFI list, capped to a
// handful of results instead of requiring one confident match.
export async function searchMutualFundSuggestions(query) {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];
  const list = await getAmfiSchemeList();
  const target = normalizeSchemeName(trimmed);
  const targetWords = target.split(" ").filter(Boolean);

  const results = [];
  for (const scheme of list) {
    const candidate = normalizeSchemeName(scheme.schemeName);
    if (targetWords.every((word) => candidate.includes(word))) {
      results.push({ name: scheme.schemeName, schemeCode: scheme.schemeCode });
      if (results.length >= 10) break;
    }
  }
  return results;
}

// ---- Stocks/ETFs (Yahoo Finance) ----

// Resolves a company name to a Yahoo ticker symbol, preferring NSE (India)
// listings over BSE or foreign exchanges.
export async function resolveStockSymbol(name) {
  const json = await fetchJson(`https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(name)}`);
  const quotes = Array.isArray(json?.quotes) ? json.quotes : [];
  const equities = quotes.filter((q) => q.quoteType === "EQUITY" && typeof q.symbol === "string");
  const nse = equities.find((q) => q.exchange === "NSI");
  const chosen = nse ?? equities[0];
  return chosen?.symbol ?? null;
}

// Returns the latest traded price (in rupees, or whatever currency the
// ticker trades in) for a resolved symbol, or null if unavailable.
export async function fetchStockPrice(symbol) {
  const json = await fetchJson(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`);
  const price = Number(json?.chart?.result?.[0]?.meta?.regularMarketPrice);
  return Number.isFinite(price) ? price : null;
}

// As-you-type suggestions for the "Add a holding" form — same search Yahoo
// endpoint as resolveStockSymbol, but returns every reasonable match (NSE
// preferred first) instead of picking just one.
export async function searchStockSuggestions(query) {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];
  const json = await fetchJson(`https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(trimmed)}`);
  const quotes = Array.isArray(json?.quotes) ? json.quotes : [];
  return quotes
    .filter((q) => q.quoteType === "EQUITY" && typeof q.symbol === "string")
    .sort((a, b) => (a.exchange === "NSI" ? -1 : 0) - (b.exchange === "NSI" ? -1 : 0))
    .slice(0, 10)
    .map((q) => ({
      name: q.longname || q.shortname || q.symbol,
      symbol: q.symbol,
      exchange: q.exchDisp || q.exchange,
    }));
}
