import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 4173);
const IS_DEPLOYED = process.env.RENDER === "true" || process.env.NODE_ENV === "production";
const HOST = process.env.HOST || (IS_DEPLOYED ? "0.0.0.0" : "127.0.0.1");
const SEC_USER_AGENT = process.env.SEC_USER_AGENT || "IBDealStudio/1.0 local-research@example.com";
const CACHE_MS = 1000 * 60 * 15;
const cache = new Map();

const SEC_HEADERS = {
  "User-Agent": SEC_USER_AGENT,
  Accept: "application/json,text/plain,*/*",
  "Accept-Encoding": "gzip, deflate",
};

const conceptMap = {
  revenue: ["RevenueFromContractWithCustomerExcludingAssessedTax", "SalesRevenueNet", "Revenues", "RevenueFromContractWithCustomerIncludingAssessedTax", "InterestAndDividendIncomeOperating"],
  grossProfit: ["GrossProfit"],
  costRevenue: ["CostOfRevenue", "CostOfGoodsAndServicesSold"],
  operatingIncome: ["OperatingIncomeLoss"],
  netIncome: ["NetIncomeLoss", "ProfitLoss", "NetIncomeLossAvailableToCommonStockholdersBasic"],
  assets: ["Assets"],
  cash: ["CashAndCashEquivalentsAtCarryingValue", "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents"],
  currentDebt: ["LongTermDebtAndFinanceLeaseObligationsCurrent", "LongTermDebtCurrent", "ShortTermBorrowings", "ShortTermDebtCurrent"],
  longDebt: ["LongTermDebtAndFinanceLeaseObligationsNoncurrent", "LongTermDebtNoncurrent", "LongTermDebt"],
  equity: ["StockholdersEquity", "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"],
  cfo: ["NetCashProvidedByUsedInOperatingActivities", "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations"],
  capex: ["PaymentsToAcquirePropertyPlantAndEquipment", "PaymentsToAcquireProductiveAssets"],
  da: ["DepreciationDepletionAndAmortization", "DepreciationDepletionAndAmortizationExpense", "DepreciationAndAmortization", "Depreciation"],
  shares: ["EntityCommonStockSharesOutstanding", "CommonStocksIncludingAdditionalPaidInCapitalMember"],
  eps: ["EarningsPerShareDiluted", "EarningsPerShareBasic"],
  deposits: ["Deposits", "InterestBearingDepositsInDomesticOffices", "NoninterestBearingDeposits"],
  loans: ["LoansAndLeasesReceivableNetReportedAmount", "FinancingReceivableExcludingAccruedInterestAfterAllowanceForCreditLoss"],
};

const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname === "/api/health") {
      sendJson(res, 200, { ok: true, secUserAgentConfigured: Boolean(process.env.SEC_USER_AGENT) });
      return;
    }
    if (url.pathname === "/api/search") {
      const q = (url.searchParams.get("q") || "").trim();
      sendJson(res, 200, await searchCompanies(q));
      return;
    }
    if (url.pathname === "/api/company") {
      const ticker = (url.searchParams.get("ticker") || "").trim();
      const peers = (url.searchParams.get("peers") || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 8);
      if (!ticker) {
        sendJson(res, 400, { error: "Ticker or CIK is required." });
        return;
      }
      const target = await buildCompany(ticker);
      target.peers = [];
      for (const peer of peers) {
        try {
          await delay(130);
          target.peers.push(await buildCompany(peer));
        } catch (error) {
          target.peers.push({
            profile: { ticker: peer.toUpperCase(), name: "Unable to resolve" },
            metrics: {},
            quality: { score: 0, level: "Unavailable" },
            quote: null,
            error: error.message,
          });
        }
      }
      target.agents = buildAgentWorkstreams(target);
      target.harness = buildMemoHarness(target);
      sendJson(res, 200, target);
      return;
    }
    await serveStatic(url.pathname, res);
  } catch (error) {
    sendJson(res, 500, { error: error.message || String(error) });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`IB Deal Studio live-data server running at http://${HOST}:${PORT}`);
  console.log(`SEC User-Agent: ${SEC_USER_AGENT}`);
});

async function serveStatic(requestPath, res) {
  const safePath = requestPath === "/" ? "/index.html" : requestPath;
  const normalized = path.normalize(safePath).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(__dirname, normalized);
  if (!filePath.startsWith(__dirname)) {
    sendText(res, 403, "Forbidden");
    return;
  }
  try {
    const data = await readFile(filePath);
    res.writeHead(200, { "Content-Type": mime[path.extname(filePath)] || "application/octet-stream" });
    res.end(data);
  } catch {
    sendText(res, 404, "Not found");
  }
}

function sendJson(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function sendText(res, status, text) {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(text);
}

async function cached(key, fn, ttl = CACHE_MS) {
  const existing = cache.get(key);
  if (existing && Date.now() - existing.time < ttl) return existing.value;
  const value = await fn();
  cache.set(key, { time: Date.now(), value });
  return value;
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, { headers: options.headers || SEC_HEADERS });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Fetch failed ${response.status} for ${url}: ${text.slice(0, 180)}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Expected JSON from ${url}, received: ${text.slice(0, 180)}`);
  }
}

async function fetchText(url) {
  const response = await fetch(url, { headers: { "User-Agent": SEC_USER_AGENT, Accept: "text/csv,text/plain,*/*" } });
  const text = await response.text();
  if (!response.ok) throw new Error(`Fetch failed ${response.status} for ${url}: ${text.slice(0, 180)}`);
  return text;
}

async function loadTickerMap() {
  const raw = await cached("sec-tickers", () => fetchJson("https://www.sec.gov/files/company_tickers.json"), 1000 * 60 * 60 * 6);
  return Object.values(raw).map((item) => ({
    cik: String(item.cik_str).padStart(10, "0"),
    ticker: String(item.ticker || "").toUpperCase(),
    title: item.title,
  }));
}

async function searchCompanies(q) {
  if (!q || q.length < 1) return [];
  const needle = q.toUpperCase();
  const map = await loadTickerMap();
  return map
    .filter((item) => item.ticker.includes(needle) || item.title.toUpperCase().includes(needle) || item.cik.includes(needle))
    .slice(0, 12);
}

async function resolveCompany(input) {
  const value = input.trim().toUpperCase();
  if (/^\d{1,10}$/.test(value)) {
    return { cik: value.padStart(10, "0"), ticker: "", title: "" };
  }
  const normalized = value.replace(".", "-");
  const map = await loadTickerMap();
  const match = map.find((item) => item.ticker === normalized);
  if (!match) throw new Error(`Could not resolve ${input} to an SEC company ticker/CIK.`);
  return match;
}

async function buildCompany(input) {
  const resolved = await resolveCompany(input);
  const cik = resolved.cik;
  const cikNoZeros = String(Number(cik));
  const submissions = await cached(`submissions-${cik}`, () => fetchJson(`https://data.sec.gov/submissions/CIK${cik}.json`));
  await delay(130);
  const facts = await cached(`facts-${cik}`, () => fetchJson(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`));
  const quote = resolved.ticker ? await fetchQuote(resolved.ticker).catch(() => null) : null;
  const metrics = buildMetrics(facts, quote);
  const filings = buildFilings(submissions, cikNoZeros);
  const profile = {
    cik,
    ticker: resolved.ticker || (submissions.tickers && submissions.tickers[0]) || "",
    name: submissions.name || resolved.title || facts.entityName || "",
    exchange: submissions.exchanges && submissions.exchanges[0],
    sic: submissions.sic,
    sicDescription: submissions.sicDescription,
    category: submissions.category,
    fiscalYearEnd: submissions.fiscalYearEnd,
    location: submissions.addresses && submissions.addresses.business ? [submissions.addresses.business.city, submissions.addresses.business.stateOrCountry].filter(Boolean).join(", ") : "",
  };
  const sources = collectSources(metrics, filings, quote);
  const risks = buildRisks(profile, metrics, filings, quote);
  const quality = buildQuality(metrics, filings, quote);
  return {
    fetchedAt: new Date().toISOString(),
    secUserAgentConfigured: Boolean(process.env.SEC_USER_AGENT),
    profile,
    quote,
    metrics,
    filings,
    risks,
    observations: buildObservations(profile, metrics, quote),
    limitations: buildLimitations(metrics, quote),
    quality,
    sources,
  };
}

async function fetchQuote(ticker) {
  const stooqTicker = ticker.toLowerCase().replace("-", ".") + ".us";
  const csv = await cached(`quote-${ticker}`, () => fetchText(`https://stooq.com/q/l/?s=${encodeURIComponent(stooqTicker)}&f=sd2t2ohlcv&h&e=csv`), 1000 * 60);
  const lines = csv.trim().split(/\r?\n/);
  if (lines.length < 2) return null;
  const headers = parseCsv(lines[0]);
  const values = parseCsv(lines[1]);
  const row = Object.fromEntries(headers.map((h, i) => [h, values[i]]));
  const close = numberOrNull(row.Close);
  if (close == null) return null;
  return {
    symbol: row.Symbol,
    date: row.Date,
    time: row.Time,
    open: numberOrNull(row.Open),
    high: numberOrNull(row.High),
    low: numberOrNull(row.Low),
    close,
    volume: numberOrNull(row.Volume),
    source: "Stooq public quote feed",
  };
}

function parseCsv(line) {
  const out = [];
  let current = "";
  let quoted = false;
  for (const char of line) {
    if (char === '"') quoted = !quoted;
    else if (char === "," && !quoted) {
      out.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  out.push(current);
  return out.map((item) => item.trim());
}

function buildMetrics(facts, quote) {
  const revenue = latestDuration(facts, conceptMap.revenue, "annual");
  const priorRevenue = previousDuration(facts, conceptMap.revenue, revenue);
  const grossProfit = latestDuration(facts, conceptMap.grossProfit, "annual") || deriveGrossProfit(facts, revenue);
  const operatingIncome = latestDuration(facts, conceptMap.operatingIncome, "annual");
  const netIncome = latestDuration(facts, conceptMap.netIncome, "annual");
  const assets = latestInstant(facts, conceptMap.assets);
  const cash = latestInstant(facts, conceptMap.cash);
  const currentDebt = latestInstant(facts, conceptMap.currentDebt);
  const longDebt = latestInstant(facts, conceptMap.longDebt);
  const debt = deriveDebt(currentDebt, longDebt);
  const equity = latestInstant(facts, conceptMap.equity);
  const cfo = latestDuration(facts, conceptMap.cfo, "annual");
  const capex = latestDuration(facts, conceptMap.capex, "annual");
  const freeCashFlow = deriveFreeCashFlow(cfo, capex);
  const da = latestDuration(facts, conceptMap.da, "annual");
  const ebitda = deriveEbitda(operatingIncome, da);
  const shares = latestShares(facts);
  const eps = latestDuration(facts, conceptMap.eps, "annual", ["USD/shares"]);
  const marketCap = quote && shares ? quote.close * shares.value : null;
  const enterpriseValue = deriveEnterpriseValue(marketCap, debt, cash);
  return {
    revenue,
    priorRevenue,
    revenueGrowth: deriveRatio(revenue, priorRevenue, "Revenue growth", (a, b) => ((a - b) / Math.abs(b)) * 100),
    grossProfit,
    grossMargin: deriveRatio(grossProfit, revenue, "Gross margin", (a, b) => (a / b) * 100),
    operatingIncome,
    operatingMargin: deriveRatio(operatingIncome, revenue, "Operating margin", (a, b) => (a / b) * 100),
    netIncome,
    assets,
    cash,
    debt,
    equity,
    operatingCashFlow: cfo,
    capex,
    freeCashFlow,
    freeCashFlowMargin: deriveRatio(freeCashFlow, revenue, "Free cash flow margin", (a, b) => (a / b) * 100),
    da,
    ebitda,
    ebitdaMargin: deriveRatio(ebitda, revenue, "EBITDA margin", (a, b) => (a / b) * 100),
    shares,
    eps,
    marketCap,
    marketCapSource: marketCap == null ? null : `Quote close ${quote.date}; shares from ${shares.source}`,
    enterpriseValue,
    evRevenue: deriveRatio(enterpriseValue, revenue, "EV / Revenue", (a, b) => a / b),
    evEbitda: deriveRatio(enterpriseValue, ebitda, "EV / EBITDA", (a, b) => a / b),
    priceEarnings: deriveRatio({ value: marketCap, source: "Market cap" }, netIncome, "P / E", (a, b) => a / b),
    priceBook: deriveRatio({ value: marketCap, source: "Market cap" }, equity, "P / Book", (a, b) => a / b),
    deposits: latestInstant(facts, conceptMap.deposits),
    loans: latestInstant(facts, conceptMap.loans),
  };
}

function deriveGrossProfit(facts, revenue) {
  const cost = latestDuration(facts, conceptMap.costRevenue, "annual");
  if (!revenue || !cost) return null;
  return derived(revenue.value - cost.value, "Gross profit derived as revenue minus cost of revenue", [revenue, cost]);
}

function deriveDebt(currentDebt, longDebt) {
  if (!currentDebt && !longDebt) return null;
  const value = (currentDebt ? currentDebt.value : 0) + (longDebt ? longDebt.value : 0);
  return derived(value, "Debt derived as current debt plus long-term debt where both are disclosed", [currentDebt, longDebt].filter(Boolean));
}

function deriveFreeCashFlow(cfo, capex) {
  if (!cfo || !capex) return null;
  return derived(cfo.value - Math.abs(capex.value), "Free cash flow derived as operating cash flow minus absolute capex", [cfo, capex]);
}

function deriveEbitda(operatingIncome, da) {
  if (!operatingIncome || !da) return null;
  return derived(operatingIncome.value + Math.abs(da.value), "EBITDA derived as operating income plus depreciation/amortization", [operatingIncome, da]);
}

function deriveEnterpriseValue(marketCap, debt, cash) {
  if (marketCap == null || !debt || !cash) return { value: null, source: "Requires market cap, debt, and cash from public sources" };
  return derived(marketCap + debt.value - cash.value, "Enterprise value derived as market cap plus debt minus cash", [debt, cash, { source: "Market cap from quote and shares" }]);
}

function deriveRatio(a, b, label, fn) {
  if (!a || !b || a.value == null || b.value == null || Number(b.value) === 0) {
    return { value: null, source: `${label} requires both source metrics` };
  }
  return derived(fn(Number(a.value), Number(b.value)), `${label} calculated from public source metrics`, [a, b]);
}

function derived(value, source, inputs) {
  const dates = inputs.map((item) => item.end || item.filed).filter(Boolean).sort();
  return {
    value: Number.isFinite(value) ? value : null,
    source,
    sources: inputs.map((item) => item.source).filter(Boolean),
    filed: inputs.map((item) => item.filed).filter(Boolean).sort().at(-1),
    end: dates.at(-1),
  };
}

function latestDuration(facts, candidates, mode = "annual", units = ["USD"]) {
  const all = factRecords(facts, candidates, units).filter((record) => {
    if (!record.start) return false;
    if (mode === "annual") return record.fp === "FY" || record.form === "10-K" || durationDays(record) >= 330;
    if (mode === "quarterly") return durationDays(record) >= 55 && durationDays(record) <= 140;
    return true;
  });
  const records = mode === "annual" && all.some((record) => record.fp === "FY" || record.form === "10-K")
    ? all.filter((record) => record.fp === "FY" || record.form === "10-K")
    : all;
  return selectLatest(records);
}

function previousDuration(facts, candidates, latest, units = ["USD"]) {
  if (!latest) return null;
  const all = factRecords(facts, candidates, units).filter((record) => record.start && record.end !== latest.end && (record.fp === "FY" || record.form === "10-K" || durationDays(record) >= 330));
  const records = all.some((record) => record.fp === "FY" || record.form === "10-K")
    ? all.filter((record) => record.fp === "FY" || record.form === "10-K")
    : all;
  return selectLatest(records);
}

function latestInstant(facts, candidates, units = ["USD"]) {
  const records = factRecords(facts, candidates, units).filter((record) => !record.start || durationDays(record) <= 2);
  return selectLatest(records);
}

function latestShares(facts) {
  const records = [
    ...factRecords(facts, ["EntityCommonStockSharesOutstanding"], ["shares"], ["dei"]),
    ...factRecords(facts, ["CommonStocksIncludingAdditionalPaidInCapitalMember"], ["shares"], ["dei"]),
  ];
  return selectLatest(records);
}

function factRecords(facts, candidates, units = ["USD"], taxonomies = ["us-gaap", "ifrs-full", "dei"]) {
  const out = [];
  for (const taxonomyName of taxonomies) {
    const taxonomy = facts.facts && facts.facts[taxonomyName];
    if (!taxonomy) continue;
    for (const tag of candidates) {
      const concept = taxonomy[tag];
      if (!concept || !concept.units) continue;
      for (const unit of units) {
        const rows = concept.units[unit] || [];
        for (const row of rows) {
          const value = numberOrNull(row.val);
          if (value == null) continue;
          out.push({
            value,
            start: row.start,
            end: row.end,
            filed: row.filed,
            form: row.form,
            fy: row.fy,
            fp: row.fp,
            accn: row.accn,
            frame: row.frame,
            tag,
            label: concept.label,
            unit,
            source: `${taxonomyName}:${tag} ${row.form || ""} ${row.filed || ""}`.trim(),
          });
        }
      }
    }
  }
  return out;
}

function selectLatest(records) {
  if (!records.length) return null;
  records.sort((a, b) => {
    const end = String(b.end || "").localeCompare(String(a.end || ""));
    if (end !== 0) return end;
    return String(b.filed || "").localeCompare(String(a.filed || ""));
  });
  return records[0];
}

function durationDays(record) {
  if (!record.start || !record.end) return 0;
  return Math.round((new Date(record.end) - new Date(record.start)) / 86400000);
}

function numberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function buildFilings(submissions, cikNoZeros) {
  const recent = submissions.filings && submissions.filings.recent;
  if (!recent) return [];
  const forms = recent.form || [];
  const accessions = recent.accessionNumber || [];
  const filed = recent.filingDate || [];
  const report = recent.reportDate || [];
  const docs = recent.primaryDocument || [];
  const accepted = new Set(["10-K", "10-Q", "8-K", "DEF 14A", "S-1", "S-3", "424B2", "424B5", "SC 13D", "SC 13G"]);
  const rows = [];
  for (let i = 0; i < forms.length; i += 1) {
    if (!accepted.has(forms[i])) continue;
    const accn = accessions[i];
    const doc = docs[i];
    rows.push({
      form: forms[i],
      accessionNumber: accn,
      filingDate: filed[i],
      reportDate: report[i],
      primaryDocument: doc,
      url: accn && doc ? `https://www.sec.gov/Archives/edgar/data/${cikNoZeros}/${accn.replaceAll("-", "")}/${doc}` : "https://www.sec.gov/edgar/search/",
    });
    if (rows.length >= 14) break;
  }
  return rows;
}

function buildQuality(metrics, filings, quote) {
  const checks = [
    metrics.revenue && metrics.revenue.value != null,
    metrics.netIncome && metrics.netIncome.value != null,
    metrics.assets && metrics.assets.value != null,
    metrics.cash && metrics.cash.value != null,
    metrics.equity && metrics.equity.value != null,
    metrics.shares && metrics.shares.value != null,
    quote && quote.close != null,
    filings && filings.length > 0,
    metrics.enterpriseValue && metrics.enterpriseValue.value != null,
    metrics.evRevenue && metrics.evRevenue.value != null,
  ];
  const score = Math.round((checks.filter(Boolean).length / checks.length) * 100);
  const level = score >= 80 ? "High" : score >= 60 ? "Usable" : score >= 40 ? "Limited" : "Unavailable";
  return { score, level };
}

function buildRisks(profile, metrics, filings, quote) {
  const risks = [];
  if (!quote) risks.push({ level: "gap", title: "Quote unavailable", detail: "Market cap and market-based multiples cannot be derived without a public quote." });
  if (!metrics.shares || metrics.shares.value == null) risks.push({ level: "gap", title: "Shares outstanding unavailable", detail: "Market capitalization cannot be fully tied to SEC facts without shares outstanding." });
  if (!metrics.enterpriseValue || metrics.enterpriseValue.value == null) risks.push({ level: "gap", title: "Enterprise value unavailable", detail: "EV requires market cap, debt, and cash. One or more public inputs are missing." });
  if (metrics.revenueGrowth && metrics.revenueGrowth.value != null && metrics.revenueGrowth.value < 0) risks.push({ level: "watch", title: "Revenue decline", detail: `Latest annual revenue growth is ${metrics.revenueGrowth.value.toFixed(1)}% based on disclosed periods.` });
  if (metrics.freeCashFlow && metrics.freeCashFlow.value != null && metrics.freeCashFlow.value < 0) risks.push({ level: "watch", title: "Negative free cash flow", detail: "Operating cash flow less capex is negative based on latest annual disclosed values." });
  if (metrics.debt && metrics.ebitda && metrics.debt.value != null && metrics.ebitda.value > 0 && metrics.debt.value / metrics.ebitda.value > 4) risks.push({ level: "watch", title: "Leverage screen", detail: "Debt / EBITDA is above 4.0x based on public XBRL-derived EBITDA." });
  if (!filings || !filings.some((f) => f.form === "10-K")) risks.push({ level: "gap", title: "Latest 10-K not in recent filing window", detail: "Recent filing feed did not include a 10-K among the screened forms." });
  if (!risks.length) risks.push({ level: "good", title: "No generated public-data red flags", detail: "No rule-based public-data risk flags were triggered. This does not replace legal, financial, commercial, or regulatory diligence." });
  if (profile.sicDescription) risks.push({ level: "good", title: "SEC industry classification available", detail: `SEC SIC description: ${profile.sicDescription}.` });
  return risks;
}

function buildObservations(profile, metrics, quote) {
  const observations = [];
  observations.push(`SEC identity resolved for ${profile.name} with CIK ${profile.cik}${profile.ticker ? ` and ticker ${profile.ticker}` : ""}.`);
  if (quote) observations.push(`Latest public quote loaded from ${quote.source}: close ${quote.close} on ${quote.date}.`);
  if (metrics.marketCap != null) observations.push(`Market capitalization is derived from public quote close multiplied by latest SEC shares outstanding.`);
  if (metrics.evRevenue && metrics.evRevenue.value != null) observations.push(`EV / Revenue is calculable from public EV and latest annual disclosed revenue.`);
  if (metrics.ebitda && metrics.ebitda.value != null) observations.push(`EBITDA is derivable from operating income plus depreciation/amortization XBRL tags; verify taxonomy consistency before external use.`);
  else observations.push("EBITDA is not derivable from the available standard XBRL tags, so EBITDA-based valuation is intentionally withheld.");
  if (metrics.revenueGrowth && metrics.revenueGrowth.value != null) observations.push(`Latest annual revenue growth is ${metrics.revenueGrowth.value.toFixed(1)}% based on two disclosed annual periods.`);
  return observations;
}

function buildLimitations(metrics, quote) {
  const limitations = [
    "Public filings do not replace management forecasts, customer cohorts, quality of earnings, tax diligence, legal diligence, or banker judgment.",
    "Private buyer appetite, strategic synergies, control premium, DCF, LBO, and process timing require explicit banker/client inputs and are not fabricated here.",
  ];
  if (!quote) limitations.push("Quote source did not return a valid close, so market-derived outputs are incomplete.");
  if (!metrics.enterpriseValue || metrics.enterpriseValue.value == null) limitations.push("Enterprise value is unavailable until quote, shares, debt, and cash are all available.");
  if (!metrics.ebitda || metrics.ebitda.value == null) limitations.push("EBITDA-based multiples are unavailable because standard XBRL inputs were missing.");
  return limitations;
}

function collectSources(metrics, filings, quote) {
  const sources = new Set();
  sources.add("SEC EDGAR submissions API: company identity and recent filing metadata");
  sources.add("SEC EDGAR companyfacts API: XBRL-tagged financial facts");
  if (quote) sources.add(`${quote.source}: delayed public quote for ${quote.symbol}`);
  for (const item of Object.values(metrics)) {
    if (item && typeof item === "object") {
      if (item.source) sources.add(item.source);
      if (Array.isArray(item.sources)) item.sources.forEach((source) => sources.add(source));
    }
  }
  if (filings && filings[0]) sources.add(`Latest screened filing: ${filings[0].form} filed ${filings[0].filingDate}`);
  return Array.from(sources).slice(0, 60);
}

function buildAgentWorkstreams(company) {
  const { profile, metrics, filings, quote } = company;
  const peers = company.peers || [];
  const validPeers = peers.filter((peer) => peer && !peer.error);
  const peerEvRevenue = median(validPeers.map((peer) => valueOf(peer.metrics && peer.metrics.evRevenue)));
  const peerEvEbitda = median(validPeers.map((peer) => valueOf(peer.metrics && peer.metrics.evEbitda)));
  const leverage = valueOf(metrics.debt) != null && valueOf(metrics.ebitda) > 0 ? valueOf(metrics.debt) / valueOf(metrics.ebitda) : null;
  const latest = filings && filings[0];
  const has10k = filings && filings.some((filing) => filing.form === "10-K");
  return [
    {
      id: "coverage",
      role: "Coverage banker",
      mandate: "Frame the target and the immediate committee question from public identity, filer status, and trading context.",
      status: profile.cik && latest ? "green" : "gap",
      confidence: confidenceFrom([profile.cik, latest, quote]),
      findings: [
        `SEC identity resolves to ${profile.name || "unavailable"}${profile.ticker ? ` (${profile.ticker})` : ""} with CIK ${profile.cik || "unavailable"}.`,
        latest ? `Most recent screened filing is ${latest.form} filed ${latest.filingDate}.` : "No screened recent SEC filing was available.",
        profile.sicDescription ? `SEC industry classification: ${profile.sicDescription}.` : "SEC industry classification is unavailable."
      ],
      gaps: [
        !company.notes && "Mandate context is banker-provided and is not inferred from public data.",
        !latest && "Recent filing metadata is unavailable."
      ].filter(Boolean),
      nextSteps: ["Confirm client mandate, transaction objective, confidentiality level, and committee audience before external use."],
      evidence: ["SEC submissions API", latest ? `${latest.form} ${latest.filingDate}` : "No recent filing evidence"]
    },
    {
      id: "financials",
      role: "Financial statement analyst",
      mandate: "Extract reported operating profile from XBRL facts and refuse to backfill missing values.",
      status: hasMetric(metrics.revenue) && hasMetric(metrics.netIncome) ? "green" : "gap",
      confidence: confidenceFrom([metrics.revenue, metrics.netIncome, metrics.assets, metrics.cash, metrics.debt]),
      findings: [
        `Revenue: ${formatNumber(valueOf(metrics.revenue))}; revenue growth: ${formatPercent(valueOf(metrics.revenueGrowth))}.`,
        `Net income: ${formatNumber(valueOf(metrics.netIncome))}; free cash flow: ${formatNumber(valueOf(metrics.freeCashFlow))}.`,
        `Cash: ${formatNumber(valueOf(metrics.cash))}; debt: ${formatNumber(valueOf(metrics.debt))}; equity: ${formatNumber(valueOf(metrics.equity))}.`
      ],
      gaps: [
        !hasMetric(metrics.revenue) && "Revenue was not available from accepted public XBRL tags.",
        !hasMetric(metrics.ebitda) && "EBITDA could not be derived from standard public XBRL tags.",
        !hasMetric(metrics.freeCashFlow) && "Free cash flow could not be derived from public CFO and capex tags."
      ].filter(Boolean),
      nextSteps: ["Tie out XBRL tags to filed statements before using figures in a client-facing book."],
      evidence: [sourceOf(metrics.revenue), sourceOf(metrics.netIncome), sourceOf(metrics.freeCashFlow)].filter(Boolean)
    },
    {
      id: "valuation",
      role: "Valuation and trading comps analyst",
      mandate: "Calculate only market-derived outputs and mark assumption-based valuation work as unavailable.",
      status: hasMetric(metrics.enterpriseValue) && hasMetric(metrics.evRevenue) ? "green" : "watch",
      confidence: confidenceFrom([quote, metrics.shares, metrics.enterpriseValue, metrics.evRevenue]),
      findings: [
        `Market cap: ${formatNumber(metrics.marketCap)}; enterprise value: ${formatNumber(valueOf(metrics.enterpriseValue))}.`,
        `EV / Revenue: ${formatMultiple(valueOf(metrics.evRevenue))}; EV / EBITDA: ${formatMultiple(valueOf(metrics.evEbitda))}.`,
        validPeers.length ? `Banker-supplied peer set contains ${validPeers.length} resolved peer${validPeers.length === 1 ? "" : "s"}; peer median EV/Revenue ${formatMultiple(peerEvRevenue)}, EV/EBITDA ${formatMultiple(peerEvEbitda)}.` : "No banker-supplied peer set was provided."
      ],
      gaps: [
        !quote && "Public quote is unavailable, so market-derived valuation is incomplete.",
        !hasMetric(metrics.shares) && "Shares outstanding is unavailable, so market cap cannot be tied to SEC facts.",
        !validPeers.length && "Relative valuation requires a banker-selected peer set and rationale."
      ].filter(Boolean),
      nextSteps: ["Add peer rationale, include/exclude decisions, and outlier treatment before relying on comps."],
      evidence: [quote && quote.source, sourceOf(metrics.enterpriseValue), sourceOf(metrics.evRevenue)].filter(Boolean)
    },
    {
      id: "capital-structure",
      role: "Capital structure analyst",
      mandate: "Screen debt, cash, leverage, and balance sheet capacity from public facts only.",
      status: hasMetric(metrics.cash) && hasMetric(metrics.debt) ? "green" : "watch",
      confidence: confidenceFrom([metrics.cash, metrics.debt, metrics.equity, metrics.ebitda]),
      findings: [
        `Cash and equivalents: ${formatNumber(valueOf(metrics.cash))}.`,
        `Debt: ${formatNumber(valueOf(metrics.debt))}.`,
        `Debt / EBITDA: ${leverage == null ? "Not available" : formatMultiple(leverage)}.`
      ],
      gaps: [
        !hasMetric(metrics.debt) && "Debt tags were incomplete or unavailable.",
        !hasMetric(metrics.ebitda) && "Leverage cannot be calculated without public EBITDA derivation.",
        "Debt maturity schedule, ratings, revolver availability, covenants, and liquidity runway require filing review or company materials."
      ],
      nextSteps: ["Review debt footnotes, maturity table, rating agency commentary, and covenant package before financing recommendations."],
      evidence: [sourceOf(metrics.cash), sourceOf(metrics.debt), sourceOf(metrics.ebitda)].filter(Boolean)
    },
    {
      id: "risk-disclosure",
      role: "Risk and disclosure reviewer",
      mandate: "Identify public-data red flags, missing diligence workstreams, and disclosure constraints.",
      status: company.risks && company.risks.some((risk) => risk.level === "gap") ? "watch" : "green",
      confidence: confidenceFrom([filings && filings.length, has10k, company.risks && company.risks.length]),
      findings: (company.risks || []).slice(0, 4).map((risk) => `${risk.title}: ${risk.detail}`),
      gaps: [
        !has10k && "Recent filing window did not include a 10-K.",
        "Legal, tax, accounting, regulatory, QoE, customer, and management diligence are outside public-data automation."
      ].filter(Boolean),
      nextSteps: ["Escalate unresolved public-data gaps before investment committee or client distribution."],
      evidence: (filings || []).slice(0, 4).map((filing) => `${filing.form} filed ${filing.filingDate}`)
    },
    {
      id: "md-synthesis",
      role: "MD synthesis",
      mandate: "Convert analyst outputs into a decision-ready readout without inventing banker judgment.",
      status: company.quality && company.quality.score >= 80 && validPeers.length ? "green" : "watch",
      confidence: confidenceFrom([company.quality && company.quality.score >= 80, validPeers.length, hasMetric(metrics.enterpriseValue)]),
      findings: [
        `Public-data completeness is ${company.quality ? `${company.quality.score}/100 (${company.quality.level})` : "not available"}.`,
        validPeers.length ? "A relative trading discussion can be started, subject to peer rationale and outlier review." : "The memo should remain a target triage note until peers are supplied.",
        "No DCF, LBO, synergy, buyer appetite, or control-premium conclusions are generated without banker-provided inputs."
      ],
      gaps: [
        !validPeers.length && "Peer set and rationale missing.",
        "Decision request and mandate context must be entered by the banker."
      ].filter(Boolean),
      nextSteps: ["Use the memo as an internal workpaper unless harness gates are cleared and banker context is added."],
      evidence: ["Quality harness", "Role-based public-data agent outputs"]
    }
  ];
}

function buildMemoHarness(company) {
  const { profile, metrics, filings, quote, sources } = company;
  const peers = company.peers || [];
  const resolvedPeers = peers.filter((peer) => peer && !peer.error);
  const gates = [
    gate("No preloaded company dataset", true, "critical", "The API requires a user-supplied ticker or CIK and pulls live public sources."),
    gate("SEC identity resolved", Boolean(profile.cik), "critical", profile.cik ? `CIK ${profile.cik}` : "Ticker/CIK could not be resolved."),
    gate("Source provenance captured", sources && sources.length >= 3, "critical", `${sources ? sources.length : 0} source records attached.`),
    gate("Recent filing metadata available", filings && filings.length > 0, "critical", filings && filings[0] ? `${filings[0].form} filed ${filings[0].filingDate}` : "No recent filing metadata."),
    gate("Public quote available", Boolean(quote && quote.close), "important", quote ? `${quote.source} close ${quote.close} on ${quote.date}` : "Quote unavailable."),
    gate("Market value traceable", metrics.marketCap != null && hasMetric(metrics.shares), "important", "Requires quote close and SEC shares outstanding."),
    gate("Enterprise value traceable", hasMetric(metrics.enterpriseValue), "important", "Requires market cap, debt, and cash."),
    gate("Revenue-based valuation traceable", hasMetric(metrics.evRevenue), "important", "Requires EV and reported revenue."),
    gate("EBITDA-based valuation traceable", hasMetric(metrics.evEbitda), "advisory", "Withheld unless public EBITDA can be derived."),
    gate("Banker-selected peer set supplied", resolvedPeers.length > 0, "important", resolvedPeers.length ? `${resolvedPeers.length} resolved peer${resolvedPeers.length === 1 ? "" : "s"}.` : "No peer set provided."),
    gate("Assumption-based valuation suppressed", true, "critical", "DCF, LBO, synergy, buyer appetite, and control premium are not generated without explicit banker inputs."),
    gate("Memo limitations included", company.limitations && company.limitations.length > 0, "critical", `${company.limitations ? company.limitations.length : 0} limitation statements attached.`)
  ];
  const criticalPassed = gates.filter((item) => item.severity === "critical").every((item) => item.status === "pass");
  const weighted = gates.reduce((sum, item) => sum + (item.status === "pass" ? weightOf(item.severity) : 0), 0);
  const possible = gates.reduce((sum, item) => sum + weightOf(item.severity), 0);
  const score = Math.round((weighted / possible) * 100);
  const blockers = gates.filter((item) => item.status !== "pass" && item.severity !== "advisory");
  return {
    score,
    level: score >= 85 && criticalPassed ? "Committee-ready draft" : score >= 70 && criticalPassed ? "Internal review draft" : "Triage only",
    readyForExternalUse: score >= 85 && criticalPassed && blockers.length === 0,
    disposition: blockers.length ? `${blockers.length} important gate${blockers.length === 1 ? "" : "s"} still open.` : "Core public-data gates cleared.",
    gates,
    blockers: blockers.map((item) => item.label),
    nextActions: gates.filter((item) => item.status !== "pass").map((item) => item.detail).slice(0, 6)
  };
}

function gate(label, ok, severity, detail) {
  return {
    label,
    status: ok ? "pass" : "gap",
    severity,
    detail
  };
}

function weightOf(severity) {
  if (severity === "critical") return 3;
  if (severity === "important") return 2;
  return 1;
}

function confidenceFrom(values) {
  const score = values.filter(Boolean).length / values.length;
  if (score >= 0.8) return "High";
  if (score >= 0.5) return "Medium";
  return "Low";
}

function hasMetric(metric) {
  return valueOf(metric) != null;
}

function valueOf(metric) {
  if (metric == null) return null;
  if (typeof metric === "number") return Number.isFinite(metric) ? metric : null;
  if (Object.prototype.hasOwnProperty.call(metric, "value")) return numberOrNull(metric.value);
  return null;
}

function sourceOf(metric) {
  if (!metric || typeof metric !== "object") return "";
  if (metric.source) return metric.source;
  if (metric.sources && metric.sources.length) return metric.sources.join("; ");
  return "";
}

function median(values) {
  const nums = values.filter((value) => value != null && Number.isFinite(value)).sort((a, b) => a - b);
  if (!nums.length) return null;
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
}

function formatNumber(value) {
  if (value == null || !Number.isFinite(Number(value))) return "Not available";
  const n = Number(value);
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000_000) return `$${(n / 1_000_000_000_000).toFixed(2)}tn`;
  if (abs >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}bn`;
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}mm`;
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function formatPercent(value) {
  if (value == null || !Number.isFinite(Number(value))) return "Not available";
  return `${Number(value).toFixed(1)}%`;
}

function formatMultiple(value) {
  if (value == null || !Number.isFinite(Number(value))) return "Not available";
  return `${Number(value).toFixed(1)}x`;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
