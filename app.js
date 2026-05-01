(function () {
  "use strict";

  const state = {
    entryMode: "public",
    activeTab: "overview",
    loading: false,
    error: "",
    result: null,
    selfTest: null,
    notes: {
      mandate: "",
      decision: "",
      bankerNotes: ""
    }
  };

  const tabs = ["overview", "financials", "valuation", "peers", "risks", "agents", "committee", "memo", "controls"];

  const form = document.getElementById("companyForm");
  const privateForm = document.getElementById("privateForm");
  const tickerInput = document.getElementById("tickerInput");
  const acquirerInput = document.getElementById("acquirerInput");
  const peersInput = document.getElementById("peersInput");
  const workspace = document.getElementById("workspace");
  const toast = document.getElementById("toast");

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function fmt(value, options) {
    if (value === null || value === undefined || Number.isNaN(Number(value))) return "Not available";
    const n = Number(value);
    if (options && options.type === "pct") return `${n.toFixed(options.digits ?? 1)}%`;
    if (options && options.type === "multiple") return `${n.toFixed(options.digits ?? 1)}x`;
    if (options && options.type === "price") return `$${n.toFixed(2)}`;
    if (options && options.type === "integer") return n.toLocaleString();
    const abs = Math.abs(n);
    if (abs >= 1_000_000_000_000) return `$${(n / 1_000_000_000_000).toFixed(2)}tn`;
    if (abs >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}bn`;
    if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}mm`;
    return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  }

  function dateFmt(value) {
    if (!value) return "Not available";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return value;
    return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  }

  function showToast(message) {
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => toast.classList.remove("show"), 2400);
  }

  function updateStatus() {
    const strip = document.getElementById("statusStrip");
    const target = document.getElementById("stripTarget");
    const acquirer = document.getElementById("stripAcquirer");
    const filing = document.getElementById("stripFiling");
    const quality = document.getElementById("stripQuality");
    const market = document.getElementById("stripMarket");
    if (!state.result) {
      strip.classList.add("empty");
      target.textContent = "No company loaded";
      acquirer.textContent = "Not selected";
      filing.textContent = "-";
      quality.textContent = "-";
      market.textContent = "-";
      return;
    }
    const r = state.result;
    strip.classList.remove("empty");
    target.textContent = targetLabel(r);
    acquirer.textContent = acquirerLabel(r);
    filing.textContent = r.filings && r.filings[0] ? `${r.filings[0].form} filed ${dateFmt(r.filings[0].filingDate)}` : r.mode === "private" ? r.privateContext.period || "Private materials" : "Not available";
    quality.textContent = `${r.quality.score}/100 (${r.quality.level})`;
    market.textContent = r.mode === "private" && r.metrics.marketCap == null ? "Private / not publicly traded" : fmt(r.metrics.marketCap);
  }

  function setActiveTab(tab) {
    state.activeTab = tabs.includes(tab) ? tab : "overview";
    document.querySelectorAll(".tab").forEach((button) => {
      button.classList.toggle("active", button.dataset.tab === state.activeTab);
    });
    render();
  }

  function setEntryMode(mode) {
    state.entryMode = mode === "private" ? "private" : "public";
    document.querySelectorAll("[data-mode]").forEach((button) => {
      button.classList.toggle("active", button.dataset.mode === state.entryMode);
    });
    document.querySelectorAll("[data-entry-panel]").forEach((panel) => {
      panel.classList.toggle("hidden", panel.dataset.entryPanel !== state.entryMode);
    });
  }

  function targetLabel(result) {
    if (!result) return "No company loaded";
    if (result.mode === "private") return `Private / ${result.profile.name}`;
    return `${result.profile.ticker || result.profile.cik} / ${result.profile.name}`;
  }

  function acquirerLabel(result) {
    if (!result) return "Not selected";
    if (result.mode === "private") return result.privateContext && result.privateContext.buyerName ? result.privateContext.buyerName : "Not selected";
    return result.acquirer ? `${result.acquirer.profile.ticker || result.acquirer.profile.cik} / ${result.acquirer.profile.name}` : "Not selected";
  }

  function peerUniverseLabel(result) {
    if (!result || result.mode === "private") return "Documented in notes";
    if (!result.peerUniverse) return "Not available";
    if (result.peerUniverse.mode === "explicit") return "Banker-approved input";
    if (result.peerUniverse.mode === "suggested") return "Suggested screen";
    return "Not available";
  }

  function peerUniverseCaption(result) {
    if (!result || result.mode === "private") return "Private comps require banker-provided universe or notes.";
    if (!result.peerUniverse) return "";
    return result.peerUniverse.methodology || "";
  }

  function dealRecommendation(result) {
    const harness = result.harness || { gates: [], readyForExternalUse: false };
    const gates = harness.gates || [];
    const nonAdvisoryGaps = gates.filter((gate) => gate.status !== "pass" && gate.severity !== "advisory");
    const criticalGaps = gates.filter((gate) => gate.status !== "pass" && gate.severity === "critical");
    const agentGapCount = (result.agents || []).reduce((sum, agent) => sum + ((agent.gaps || []).length), 0);
    const reasons = [];
    if (criticalGaps.length) reasons.push(`${criticalGaps.length} critical control gate${criticalGaps.length === 1 ? "" : "s"} open.`);
    if (nonAdvisoryGaps.length) reasons.push(`${nonAdvisoryGaps.length} non-advisory readiness gate${nonAdvisoryGaps.length === 1 ? "" : "s"} not cleared.`);
    if (agentGapCount) reasons.push(`${agentGapCount} agent diligence gap${agentGapCount === 1 ? "" : "s"} visible.`);
    if (result.quality && result.quality.score < 70) reasons.push(`Data completeness is only ${result.quality.score}/100.`);
    if (result.mode !== "private" && result.peerUniverse && result.peerUniverse.mode !== "explicit") reasons.push("Peer universe is not banker-approved yet.");
    if (result.mode === "private" && !hasValue(result.metrics.enterpriseValue)) reasons.push("No explicit valuation or purchase price input was provided.");

    if (criticalGaps.length || (result.quality && result.quality.score < 50)) {
      return {
        status: "gap",
        label: "Do not recommend acquisition on current evidence",
        headline: "Do not approve an acquisition recommendation yet.",
        rationale: reasons.length ? reasons : ["Source support is too limited for an acquisition recommendation."],
        nextStep: "Resolve critical gates, source gaps, and diligence evidence before re-opening the acquisition question."
      };
    }
    if (!harness.readyForExternalUse || nonAdvisoryGaps.length || (result.mode !== "private" && result.peerUniverse && result.peerUniverse.mode !== "explicit")) {
      return {
        status: "watch",
        label: "Hold / do not approve acquisition yet",
        headline: "Keep the case in diligence and internal review.",
        rationale: reasons.length ? reasons : ["The deal packet is useful for triage, but not yet cleared for an acquisition recommendation."],
        nextStep: "Clear open gates, approve or replace the peer universe, and document the banker decision ask."
      };
    }
    return {
      status: "green",
      label: "Recommend acquisition path",
      headline: "Recommend moving the acquisition case into committee approval discussion.",
      rationale: reasons.length ? reasons : ["Core readiness gates are cleared and agent workstreams support an acquisition path discussion."],
      nextStep: "Use the committee pack for MD / IC review; final approval still requires banker, legal, tax, accounting, regulatory, and client sign-off."
    };
  }

  async function fetchCompany(ticker, peers, acquirer) {
    state.loading = true;
    state.error = "";
    state.result = null;
    state.selfTest = null;
    updateStatus();
    render();
    const params = new URLSearchParams({ ticker: ticker.trim(), peers: peers.trim(), acquirer: acquirer.trim() });
    try {
      const response = await fetch(`/api/company?${params.toString()}`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to fetch company data.");
      state.result = payload;
      state.activeTab = "overview";
      showToast(`Loaded ${payload.profile.name}.`);
    } catch (error) {
      state.error = error.message || String(error);
    } finally {
      state.loading = false;
      updateStatus();
      setActiveTab(state.activeTab);
    }
  }

  function buildPrivateDealPacket() {
    const name = fieldValue("privateNameInput");
    if (!name) {
      showToast("Enter the private target name.");
      return null;
    }
    const sector = fieldValue("privateSectorInput") || "Not provided";
    const buyerName = fieldValue("privateBuyerInput");
    const period = fieldValue("privatePeriodInput") || "Period not provided";
    const sourceBasis = fieldValue("privateSourceInput") || "Source package not provided";
    const source = `Banker/client-provided private materials: ${sourceBasis}; ${period}`;
    const revenue = privateMetric(fieldNumber("privateRevenueInput"), "Revenue", source, period);
    const ebitda = privateMetric(fieldNumber("privateEbitdaInput"), "EBITDA", source, period);
    const cash = privateMetric(fieldNumber("privateCashInput"), "Cash", source, period);
    const debt = privateMetric(fieldNumber("privateDebtInput"), "Debt", source, period);
    const providedEv = privateMetric(fieldNumber("privateEvInput"), "Provided enterprise value", source, period);
    const netDebt = debt.value != null || cash.value != null
      ? derivedPrivateMetric((debt.value || 0) - (cash.value || 0), "Net debt derived from banker/client-provided debt minus cash", [debt, cash], period)
      : privateMetric(null, "Net debt", "Requires banker/client-provided debt and cash", period);
    const evRevenue = ratioMetric(providedEv, revenue, "Provided EV / Revenue", (a, b) => a / b, period);
    const evEbitda = ratioMetric(providedEv, ebitda, "Provided EV / EBITDA", (a, b) => a / b, period);
    const ebitdaMargin = ratioMetric(ebitda, revenue, "EBITDA margin", (a, b) => (a / b) * 100, period);
    const metrics = {
      revenue,
      priorRevenue: privateMetric(null, "Prior revenue", "Requires additional banker/client-provided period", period),
      revenueGrowth: privateMetric(null, "Revenue growth", "Requires two banker/client-provided periods", period),
      grossProfit: privateMetric(null, "Gross profit", "Requires banker/client-provided gross profit", period),
      grossMargin: privateMetric(null, "Gross margin", "Requires banker/client-provided gross profit and revenue", period),
      operatingIncome: privateMetric(null, "Operating income", "Requires banker/client-provided operating income", period),
      operatingMargin: privateMetric(null, "Operating margin", "Requires banker/client-provided operating income and revenue", period),
      netIncome: privateMetric(null, "Net income", "Requires banker/client-provided net income", period),
      assets: privateMetric(null, "Assets", "Requires banker/client-provided balance sheet", period),
      cash,
      debt,
      equity: privateMetric(null, "Equity", "Requires banker/client-provided balance sheet", period),
      operatingCashFlow: privateMetric(null, "Operating cash flow", "Requires banker/client-provided cash flow statement", period),
      capex: privateMetric(null, "Capital expenditure", "Requires banker/client-provided capex", period),
      freeCashFlow: privateMetric(null, "Free cash flow", "Requires banker/client-provided CFO and capex", period),
      freeCashFlowMargin: privateMetric(null, "Free cash flow margin", "Requires banker/client-provided free cash flow and revenue", period),
      da: privateMetric(null, "Depreciation and amortization", "Requires banker/client-provided D&A", period),
      ebitda,
      ebitdaMargin,
      shares: privateMetric(null, "Shares", "Private target has no public share count unless provided in capitalization materials", period),
      eps: privateMetric(null, "EPS", "Not applicable without provided capitalization and earnings data", period),
      marketCap: null,
      marketCapSource: "Private target is not publicly traded.",
      enterpriseValue: providedEv,
      evRevenue,
      evEbitda,
      priceEarnings: privateMetric(null, "P / E", "Requires provided equity value and net income", period),
      priceBook: privateMetric(null, "P / Book", "Requires provided equity value and book equity", period),
      netDebt
    };
    const packet = {
      mode: "private",
      fetchedAt: new Date().toISOString(),
      secUserAgentConfigured: false,
      privateContext: { sector, period, sourceBasis, buyerName },
      profile: {
        cik: "",
        ticker: "",
        name,
        exchange: "Private",
        sicDescription: sector,
        category: "Private / non-SEC public filer",
        fiscalYearEnd: period,
        location: ""
      },
      quote: null,
      metrics,
      filings: [],
      peers: [],
      risks: buildPrivateRisks(metrics, sourceBasis, period),
      observations: buildPrivateObservations(name, buyerName, sector, period, sourceBasis, metrics),
      limitations: buildPrivateLimitations(),
      quality: buildPrivateQuality(metrics, sourceBasis, period),
      sources: [
        source,
        "Private target workflow: no SEC public-company filing or public quote is assumed.",
        "All populated private-company metrics are banker/client-provided and require diligence tie-out."
      ]
    };
    packet.agents = buildPrivateAgents(packet);
    packet.harness = buildPrivateHarness(packet);
    return packet;
  }

  function fieldValue(id) {
    const node = document.getElementById(id);
    return node ? node.value.trim() : "";
  }

  function fieldNumber(id) {
    const raw = fieldValue(id);
    if (!raw) return null;
    const normalized = raw.replace(/[$,\s]/g, "");
    const value = Number(normalized);
    return Number.isFinite(value) ? value : null;
  }

  function privateMetric(value, label, source, period) {
    return { value: Number.isFinite(Number(value)) ? Number(value) : null, source: source || `${label} not provided`, end: period || "", filed: "" };
  }

  function derivedPrivateMetric(value, source, inputs, period) {
    return {
      value: Number.isFinite(Number(value)) ? Number(value) : null,
      source,
      sources: inputs.map((item) => item.source).filter(Boolean),
      end: period || "",
      filed: ""
    };
  }

  function ratioMetric(a, b, label, fn, period) {
    if (!a || !b || a.value == null || b.value == null || Number(b.value) === 0) {
      return privateMetric(null, label, `${label} requires both banker/client-provided inputs`, period);
    }
    return derivedPrivateMetric(fn(Number(a.value), Number(b.value)), `${label} calculated from banker/client-provided inputs`, [a, b], period);
  }

  function buildPrivateRisks(metrics, sourceBasis, period) {
    const risks = [
      { level: "watch", title: "Private-company source dependency", detail: "This target is not validated through SEC public-company filings; the memo depends on banker/client-provided materials." },
      { level: "watch", title: "Confidential diligence required", detail: "A private acquisition can proceed, but requires NDA, data room, management materials, QoE, legal, tax, and commercial diligence." }
    ];
    if (!sourceBasis || sourceBasis === "Source package not provided") risks.push({ level: "gap", title: "Source package missing", detail: "Private-company analysis requires the basis of materials, such as CIM, management accounts, QoE, or data room extract." });
    if (!period || period === "Period not provided") risks.push({ level: "gap", title: "Financial period missing", detail: "Revenue and EBITDA must be tied to a defined period before committee use." });
    if (!hasValue(metrics.revenue)) risks.push({ level: "gap", title: "Revenue not provided", detail: "Scale and revenue-based valuation cannot be assessed without banker/client-provided revenue." });
    if (!hasValue(metrics.ebitda)) risks.push({ level: "gap", title: "EBITDA not provided", detail: "EBITDA-based leverage and valuation screens cannot be assessed without source materials." });
    if (!hasValue(metrics.enterpriseValue)) risks.push({ level: "watch", title: "Valuation input withheld", detail: "The app will not invent a purchase price, control premium, or enterprise value for a private target." });
    return risks;
  }

  function buildPrivateObservations(name, buyerName, sector, period, sourceBasis, metrics) {
    const observations = [
      `${name} is being treated as a private/confidential acquisition target rather than a public-company SEC filer.`,
      buyerName ? `Acquirer / buyer lens: ${buyerName}.` : "No acquirer / buyer has been selected; memo remains target-side triage.",
      `Source package: ${sourceBasis}. Financial period: ${period}.`,
      `Business description / sector: ${sector}.`
    ];
    if (hasValue(metrics.revenue)) observations.push(`Revenue is banker/client-provided at ${fmt(metrics.revenue.value)}.`);
    if (hasValue(metrics.ebitda)) observations.push(`EBITDA is banker/client-provided at ${fmt(metrics.ebitda.value)}; QoE tie-out is required before external use.`);
    if (hasValue(metrics.netDebt)) observations.push(`Net debt is derived from banker/client-provided debt and cash at ${fmt(metrics.netDebt.value)}.`);
    observations.push("Private M&A does not require the target to be public; it requires authorized materials, diligence access, and validated banker/client inputs.");
    return observations;
  }

  function buildPrivateLimitations() {
    return [
      "Private-company mode does not fetch SEC public-company filings, public quote data, market cap, or public trading multiples for the target.",
      "Any revenue, EBITDA, cash, debt, or provided valuation inputs must come from authorized banker/client materials and require diligence tie-out.",
      "The app does not infer buyer appetite, synergies, purchase price, DCF, LBO, control premium, fairness, legal, tax, or regulatory conclusions.",
      "If this app is deployed on shared infrastructure, confidential inputs should only be entered when the deal team has authorization and an approved data-handling process."
    ];
  }

  function buildPrivateQuality(metrics, sourceBasis, period) {
    const checks = [
      Boolean(sourceBasis && sourceBasis !== "Source package not provided"),
      Boolean(period && period !== "Period not provided"),
      hasValue(metrics.revenue),
      hasValue(metrics.ebitda),
      hasValue(metrics.cash),
      hasValue(metrics.debt),
      hasValue(metrics.enterpriseValue)
    ];
    const score = Math.round((checks.filter(Boolean).length / checks.length) * 100);
    const level = score >= 80 ? "High" : score >= 60 ? "Usable" : score >= 40 ? "Limited" : "Unavailable";
    return { score, level };
  }

  function buildPrivateAgents(packet) {
    const m = packet.metrics;
    return [
      {
        id: "private-intake",
        role: "Private deal intake banker",
        mandate: "Convert a non-public target into an auditable acquisition workpaper without pretending public filings exist.",
        workflowStep: "01. Private intake and material source",
        usedWhen: "Runs after the private target form is submitted.",
        inputs: ["target name", "buyer name if provided", "sector description", "source package", "financial period"],
        output: "Private deal identity, material basis, and confidentiality posture.",
        decisionUse: "Confirms the case is a private M&A workpaper based on authorized banker/client materials.",
        controlGate: "Private source package identified",
        status: packet.privateContext.sourceBasis === "Source package not provided" ? "watch" : "green",
        confidence: confidenceFromClient([packet.profile.name, packet.privateContext.sourceBasis, packet.privateContext.period]),
        findings: [
          `Target: ${packet.profile.name}. Sector / description: ${packet.privateContext.sector}.`,
          packet.privateContext.buyerName ? `Acquirer / buyer: ${packet.privateContext.buyerName}.` : "No acquirer / buyer has been selected yet.",
          `Source package: ${packet.privateContext.sourceBasis}.`,
          "Private companies can be acquired; the workflow shifts from public-market evidence to authorized private materials and diligence validation."
        ],
        gaps: packet.privateContext.sourceBasis === "Source package not provided" ? ["Source package must be identified before committee use."] : [],
        nextSteps: ["Confirm NDA status, data room access, management materials, and permitted use of confidential information."]
      },
      {
        id: "private-financials",
        role: "Private financial diligence analyst",
        mandate: "Use only banker/client-provided metrics and expose missing diligence inputs.",
        workflowStep: "02. Private financial diligence",
        usedWhen: "Runs after private revenue, EBITDA, cash, and debt fields are parsed.",
        inputs: ["banker/client revenue", "banker/client EBITDA", "cash", "debt", "financial period"],
        output: "Provided financial profile, derived net debt, and missing diligence items.",
        decisionUse: "Shows which private-company metrics can support triage and what needs QoE tie-out.",
        controlGate: "Revenue and EBITDA provided",
        status: hasValue(m.revenue) && hasValue(m.ebitda) ? "green" : "gap",
        confidence: confidenceFromClient([hasValue(m.revenue), hasValue(m.ebitda), hasValue(m.cash), hasValue(m.debt)]),
        findings: [
          `Revenue: ${fmt(m.revenue.value)}.`,
          `EBITDA: ${fmt(m.ebitda.value)}; EBITDA margin: ${fmt(metricValue(m.ebitdaMargin), { type: "pct" })}.`,
          `Cash: ${fmt(m.cash.value)}. Debt: ${fmt(m.debt.value)}. Net debt: ${fmt(m.netDebt.value)}.`
        ],
        gaps: [
          !hasValue(m.revenue) && "Revenue is missing.",
          !hasValue(m.ebitda) && "EBITDA is missing.",
          !hasValue(m.cash) && "Cash is missing.",
          !hasValue(m.debt) && "Debt is missing."
        ].filter(Boolean),
        nextSteps: ["Tie provided financials to QoE, management accounts, audited financials, and data room support."]
      },
      {
        id: "private-valuation",
        role: "Private valuation guardrail analyst",
        mandate: "Allow valuation discussion only when the banker supplies explicit valuation inputs.",
        workflowStep: "03. Private valuation guardrail",
        usedWhen: "Runs after optional enterprise value or purchase price input is checked.",
        inputs: ["provided enterprise value", "provided revenue", "provided EBITDA"],
        output: "Provided valuation multiples or a valuation-withheld flag.",
        decisionUse: "Prevents the memo from inventing price, DCF, LBO, synergy, or control premium conclusions.",
        controlGate: "Valuation input explicitly provided",
        status: hasValue(m.enterpriseValue) ? "green" : "watch",
        confidence: confidenceFromClient([hasValue(m.enterpriseValue), hasValue(m.revenue), hasValue(m.ebitda)]),
        findings: [
          `Provided enterprise value: ${fmt(m.enterpriseValue.value)}.`,
          `Provided EV / Revenue: ${fmt(metricValue(m.evRevenue), { type: "multiple" })}.`,
          `Provided EV / EBITDA: ${fmt(metricValue(m.evEbitda), { type: "multiple" })}.`
        ],
        gaps: hasValue(m.enterpriseValue) ? [] : ["No purchase price, EV, or valuation range was provided; the app will not invent one."],
        nextSteps: ["Add banker-approved valuation input or keep the memo as diligence triage only."]
      },
      {
        id: "private-process",
        role: "Private M&A process advisor",
        mandate: "Translate private-target gaps into acquisition process steps.",
        workflowStep: "04. Private process and diligence path",
        usedWhen: "Runs after private intake, financial, and valuation guardrails are complete.",
        inputs: ["private material basis", "financial gaps", "valuation guardrails", "buyer lens"],
        output: "Diligence request path and process constraints for a non-public target.",
        decisionUse: "Frames the next banker actions before using the memo outside internal triage.",
        controlGate: "Diligence limitations disclosed",
        status: "watch",
        confidence: "Medium",
        findings: [
          "A non-public target can still be acquired through bilateral negotiation, auction, sponsor process, carve-out, or negotiated strategic transaction.",
          "The evidence stack should be NDA, CIM or management presentation, data room, QoE, legal/tax/regulatory review, and financing sources where relevant.",
          "The memo should distinguish banker-provided facts from unverified management claims."
        ],
        gaps: ["Buyer universe, synergies, financing, and purchase agreement risk require explicit banker/client inputs."],
        nextSteps: ["Build a diligence request list and decision ask before using the memo externally."]
      }
    ];
  }

  function buildPrivateHarness(packet) {
    const m = packet.metrics;
    const gates = [
      clientGate("Private target path selected", true, "critical", "The workflow does not require SEC public-company status."),
      clientGate("Target name provided", Boolean(packet.profile.name), "critical", packet.profile.name || "Missing target name."),
      clientGate("Acquirer lens documented or intentionally open", true, "advisory", packet.privateContext.buyerName ? `Buyer: ${packet.privateContext.buyerName}` : "Buyer not selected; memo remains target-side triage."),
      clientGate("Source package identified", packet.privateContext.sourceBasis !== "Source package not provided", "critical", packet.privateContext.sourceBasis),
      clientGate("Financial period identified", packet.privateContext.period !== "Period not provided", "critical", packet.privateContext.period),
      clientGate("Revenue provided", hasValue(m.revenue), "important", hasValue(m.revenue) ? fmt(m.revenue.value) : "Missing revenue."),
      clientGate("EBITDA provided", hasValue(m.ebitda), "important", hasValue(m.ebitda) ? fmt(m.ebitda.value) : "Missing EBITDA."),
      clientGate("Net debt derivable", hasValue(m.netDebt), "important", hasValue(m.netDebt) ? fmt(m.netDebt.value) : "Requires cash and debt."),
      clientGate("Valuation input explicitly provided", hasValue(m.enterpriseValue), "advisory", hasValue(m.enterpriseValue) ? fmt(m.enterpriseValue.value) : "No EV or price supplied; valuation outputs withheld."),
      clientGate("Public-market assumptions suppressed", true, "critical", "No public market cap, quote, public share count, or public trading multiple is invented."),
      clientGate("Diligence limitations included", packet.limitations.length > 0, "critical", `${packet.limitations.length} limitation statements attached.`)
    ];
    const criticalPassed = gates.filter((gate) => gate.severity === "critical").every((gate) => gate.status === "pass");
    const weighted = gates.reduce((sum, gate) => sum + (gate.status === "pass" ? clientGateWeight(gate.severity) : 0), 0);
    const possible = gates.reduce((sum, gate) => sum + clientGateWeight(gate.severity), 0);
    const score = Math.round((weighted / possible) * 100);
    const blockers = gates.filter((gate) => gate.status !== "pass" && gate.severity !== "advisory");
    return {
      score,
      level: score >= 85 && criticalPassed ? "Committee-ready draft" : score >= 70 && criticalPassed ? "Internal review draft" : "Triage only",
      readyForExternalUse: score >= 85 && criticalPassed && blockers.length === 0,
      disposition: blockers.length ? `${blockers.length} private-deal gate${blockers.length === 1 ? "" : "s"} still open.` : "Core private-deal gates cleared.",
      gates,
      blockers: blockers.map((gate) => gate.label),
      nextActions: gates.filter((gate) => gate.status !== "pass").map((gate) => gate.detail).slice(0, 6)
    };
  }

  function hasValue(metric) {
    return metric && metric.value != null && Number.isFinite(Number(metric.value));
  }

  function confidenceFromClient(values) {
    const score = values.filter(Boolean).length / values.length;
    if (score >= 0.8) return "High";
    if (score >= 0.5) return "Medium";
    return "Low";
  }

  function clientGate(label, ok, severity, detail) {
    return { label, status: ok ? "pass" : "gap", severity, detail };
  }

  function clientGateWeight(severity) {
    if (severity === "critical") return 3;
    if (severity === "important") return 2;
    return 1;
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const ticker = tickerInput.value.trim();
    if (!ticker) {
      showToast("Enter a ticker or SEC CIK.");
      return;
    }
    fetchCompany(ticker, peersInput.value, acquirerInput.value);
  });

  privateForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const packet = buildPrivateDealPacket();
    if (!packet) return;
    state.result = packet;
    state.error = "";
    state.loading = false;
    state.selfTest = null;
    state.activeTab = "overview";
    updateStatus();
    setActiveTab("overview");
    showToast(`Built private-deal memo for ${packet.profile.name}.`);
  });

  document.addEventListener("click", (event) => {
    const modeButton = event.target.closest("[data-mode]");
    if (modeButton) {
      setEntryMode(modeButton.dataset.mode);
      return;
    }
    const tabButton = event.target.closest("[data-tab]");
    if (tabButton) {
      setActiveTab(tabButton.dataset.tab);
      return;
    }
    const action = event.target.closest("[data-action]");
    if (!action) return;
    if (action.dataset.action === "copy-memo") {
      copyMemo();
    }
    if (action.dataset.action === "download-memo") {
      download(`${fileSafe(state.result.profile.ticker || state.result.profile.cik || state.result.profile.name)}-ib-memo.txt`, buildMemo(), "text/plain");
    }
    if (action.dataset.action === "copy-pack") {
      copyCommitteePack();
    }
    if (action.dataset.action === "download-pack") {
      download(`${fileSafe(state.result.profile.ticker || state.result.profile.cik || state.result.profile.name)}-committee-pack.txt`, buildCommitteePack(), "text/plain");
    }
    if (action.dataset.action === "print-memo") {
      state.activeTab = "memo";
      setActiveTab("memo");
      setTimeout(() => window.print(), 120);
    }
    if (action.dataset.action === "export-json") {
      download(`${fileSafe(state.result.profile.ticker || state.result.profile.cik || state.result.profile.name)}-deal-packet.json`, JSON.stringify(state.result, null, 2), "application/json");
    }
    if (action.dataset.action === "run-self-test") {
      runSelfTest();
    }
  });

  document.addEventListener("input", (event) => {
    const note = event.target.closest("[data-note]");
    if (note) {
      state.notes[note.dataset.note] = note.value;
    }
  });

  function render() {
    if (state.loading) {
      workspace.innerHTML = `
        <section class="panel">
          <div class="loading">Fetching target packet, optional acquirer packet, SEC filings, XBRL facts, quote data, and peer universe...</div>
        </section>
      `;
      return;
    }
    if (state.error) {
      workspace.innerHTML = `
        <section class="panel">
          <div class="notice">
            <strong>Unable to load live data.</strong><br />
            ${escapeHtml(state.error)}
          </div>
        </section>
      `;
      return;
    }
    if (!state.result) {
      workspace.innerHTML = emptyState();
      return;
    }
    workspace.innerHTML = renderTab();
  }

  function emptyState() {
    return `
      <section class="panel">
        <div class="panel-heading">
          <div>
            <p class="eyebrow">Product thesis</p>
            <h2>Turn an acquisition target into a decision memo, not a research dump</h2>
          </div>
        </div>
        <div class="notice strong">
          The studio separates what is sourced, what is banker/client-provided, what is unavailable, and what must
          be cleared before the memo can support an internal deal decision.
        </div>
      </section>
      <section class="grid-3">
        <div class="panel">
          <p class="eyebrow">Public target path</p>
          <h2>Live public-company evidence</h2>
          <ul class="section-list">
            <li>Resolve ticker to SEC CIK and company profile.</li>
            <li>Pull latest 10-K, 10-Q, 8-K, proxy, and registration filings.</li>
            <li>Extract reported revenue, net income, assets, cash, debt, equity, cash flow, capex, shares, and more when XBRL tags exist.</li>
            <li>Run role-based analyst workstreams and memo-readiness harness gates over the same sourced packet.</li>
          </ul>
        </div>
        <div class="panel">
          <p class="eyebrow">Private target path</p>
          <h2>Acquisitions do not require a public ticker</h2>
          <ul class="section-list">
            <li>Use CIM, management accounts, QoE, board materials, lender model, or data room extracts.</li>
            <li>Private financial inputs are marked as banker/client-provided and processed in the browser.</li>
            <li>The memo withholds purchase price, synergies, DCF, LBO, and control premium unless explicitly supplied.</li>
          </ul>
        </div>
        <div class="panel">
          <p class="eyebrow">Enterprise posture</p>
          <h2>Decision gates before output</h2>
          <ul class="section-list">
            <li>Every displayed metric carries source tags, filing dates, source package, or input provenance.</li>
            <li>Data gaps are treated as diligence issues, not silently filled.</li>
            <li>Memo output includes agent findings, product self-test status, harness gates, data limitations, and exact source list.</li>
          </ul>
        </div>
      </section>
      <section class="panel">
        <div class="panel-heading">
          <div>
            <p class="eyebrow">Enterprise workflow</p>
            <h2>Built around the way IB teams review a live deal</h2>
          </div>
        </div>
        <div class="workflow-rail">
          <div><strong>01</strong><span>Resolve target and deal parties</span></div>
          <div><strong>02</strong><span>Load source-backed public or private evidence</span></div>
          <div><strong>03</strong><span>Run role-based analyst agents over the same packet</span></div>
          <div><strong>04</strong><span>Surface comps, diligence gaps, and unavailable assumptions</span></div>
          <div><strong>05</strong><span>Clear harness gates before memo export</span></div>
        </div>
      </section>
      <section class="panel">
        <div class="panel-heading">
          <div>
            <p class="eyebrow">Product QA Agent</p>
            <h2>Run a self-test before loading a target</h2>
          </div>
          <button class="secondary-button" type="button" data-action="run-self-test">Run self-test</button>
        </div>
        ${selfTestPanel()}
      </section>
    `;
  }

  function renderTab() {
    if (state.activeTab === "financials") return financialsTab();
    if (state.activeTab === "valuation") return valuationTab();
    if (state.activeTab === "peers") return peersTab();
    if (state.activeTab === "risks") return risksTab();
    if (state.activeTab === "agents") return agentsTab();
    if (state.activeTab === "committee") return committeePackTab();
    if (state.activeTab === "memo") return memoTab();
    if (state.activeTab === "controls") return controlsTab();
    return overviewTab();
  }

  function overviewTab() {
    const r = state.result;
    const m = r.metrics;
    const recommendation = dealRecommendation(r);
    return `
      <section class="panel recommendation-panel ${agentStatusClass(recommendation.status)}">
        <div class="panel-heading compact">
          <div>
            <p class="eyebrow">Preliminary Acquisition Recommendation</p>
            <h2>${escapeHtml(recommendation.label)}</h2>
          </div>
          <span class="status-chip ${agentStatusClass(recommendation.status)}">${escapeHtml(recommendation.status)}</span>
        </div>
        <div class="notice strong">
          <strong>${escapeHtml(recommendation.headline)}</strong><br>
          ${escapeHtml(recommendation.nextStep)}
        </div>
        <ul class="section-list">
          ${recommendation.rationale.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
        </ul>
      </section>

      <section class="panel">
        <div class="panel-heading">
          <div>
            <p class="eyebrow">Target Overview</p>
            <h2>${escapeHtml(r.profile.name)}</h2>
          </div>
          <span class="pill ${qualityClass(r.quality.level)}">${r.quality.score}/100 ${r.mode === "private" ? "private-materials completeness" : "public-data completeness"}</span>
        </div>
        <div class="metric-grid">
          ${metric(r.mode === "private" ? "Target type" : "Ticker / Exchange", r.mode === "private" ? "Private / confidential" : `${r.profile.ticker || "Not available"} / ${r.profile.exchange || "Not available"}`, r.mode === "private" ? r.privateContext.sourceBasis : r.profile.cik)}
          ${metric("Acquirer / buyer", acquirerLabel(r), r.mode === "private" ? "Banker/client-provided buyer lens" : r.acquirer ? "Live public acquirer packet loaded" : "Target-side triage; no buyer selected")}
          ${metric(r.mode === "private" ? "Sector / source basis" : "SEC filer category", r.mode === "private" ? r.profile.sicDescription || "Not provided" : r.profile.category || "Not available", r.mode === "private" ? r.privateContext.period : r.profile.sicDescription || "")}
          ${metric("Peer universe", peerUniverseLabel(r), peerUniverseCaption(r))}
          ${metric("Latest price", fmt(r.quote && r.quote.close, { type: "price" }), quoteCaption(r.quote))}
          ${metric("Market cap", fmt(m.marketCap), sourceCaption(m.marketCapSource))}
          ${metric("Revenue", fmt(metricValue(m.revenue)), sourceCaption(m.revenue))}
          ${metric("Revenue growth", fmt(metricValue(m.revenueGrowth), { type: "pct" }), sourceCaption(m.revenueGrowth))}
          ${metric("Net income", fmt(metricValue(m.netIncome)), sourceCaption(m.netIncome))}
          ${metric("Free cash flow", fmt(metricValue(m.freeCashFlow)), sourceCaption(m.freeCashFlow))}
        </div>
      </section>

      <section class="grid-2">
        <div class="panel">
          <div class="panel-heading compact">
            <div>
              <p class="eyebrow">IB Readout</p>
              <h2>${r.mode === "private" ? "What the provided materials support" : "What the public data supports"}</h2>
            </div>
          </div>
          <ul class="section-list">
            ${r.observations.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
          </ul>
        </div>
        <div class="panel">
          <div class="panel-heading compact">
            <div>
              <p class="eyebrow">Data Limitations</p>
              <h2>${r.mode === "private" ? "What still requires diligence" : "What still requires company materials"}</h2>
            </div>
          </div>
          <ul class="risk-list">
            ${r.limitations.map((item) => `<li class="watch">${escapeHtml(item)}</li>`).join("")}
          </ul>
        </div>
      </section>
    `;
  }

  function financialsTab() {
    const r = state.result;
    const rows = r.mode === "private"
      ? [
          ["Revenue", r.metrics.revenue],
          ["EBITDA", r.metrics.ebitda],
          ["EBITDA margin", r.metrics.ebitdaMargin],
          ["Cash and equivalents", r.metrics.cash],
          ["Debt", r.metrics.debt],
          ["Net debt", r.metrics.netDebt],
          ["Free cash flow", r.metrics.freeCashFlow],
          ["Assets", r.metrics.assets],
          ["Equity", r.metrics.equity]
        ]
      : [
          ["Revenue", r.metrics.revenue],
          ["Gross profit", r.metrics.grossProfit],
          ["Operating income", r.metrics.operatingIncome],
          ["EBITDA, if derivable from XBRL", r.metrics.ebitda],
          ["Net income", r.metrics.netIncome],
          ["Assets", r.metrics.assets],
          ["Cash and equivalents", r.metrics.cash],
          ["Debt", r.metrics.debt],
          ["Stockholders equity", r.metrics.equity],
          ["Operating cash flow", r.metrics.operatingCashFlow],
          ["Capital expenditure", r.metrics.capex],
          ["Free cash flow", r.metrics.freeCashFlow],
          ["Shares outstanding", r.metrics.shares]
        ];
    return `
      <section class="panel">
        <div class="panel-heading">
          <div>
            <p class="eyebrow">${r.mode === "private" ? "Private Materials" : "SEC XBRL Facts"}</p>
            <h2>${r.mode === "private" ? "Banker / Client-Provided Metrics" : "Reported Financial Metrics"}</h2>
          </div>
          <span class="pill">Fetched ${dateFmt(r.fetchedAt)}</span>
        </div>
        ${metricTable(rows)}
      </section>

      <section class="grid-2">
        <div class="panel">
          <p class="eyebrow">Trend Calculations</p>
          <h2>${r.mode === "private" ? "Calculated only from provided inputs" : "Calculated only from disclosed periods"}</h2>
          <div class="metric-grid">
            ${metric("Revenue growth", fmt(metricValue(r.metrics.revenueGrowth), { type: "pct" }), sourceCaption(r.metrics.revenueGrowth))}
            ${metric("Gross margin", fmt(metricValue(r.metrics.grossMargin), { type: "pct" }), sourceCaption(r.metrics.grossMargin))}
            ${metric("Operating margin", fmt(metricValue(r.metrics.operatingMargin), { type: "pct" }), sourceCaption(r.metrics.operatingMargin))}
            ${metric("FCF margin", fmt(metricValue(r.metrics.freeCashFlowMargin), { type: "pct" }), sourceCaption(r.metrics.freeCashFlowMargin))}
          </div>
        </div>
        <div class="panel">
          <p class="eyebrow">Source Discipline</p>
          <h2>Metric provenance</h2>
          <ul class="source-list">
            ${r.sources.slice(0, 10).map((source) => `<li>${escapeHtml(source)}</li>`).join("")}
          </ul>
        </div>
      </section>
    `;
  }

  function valuationTab() {
    const r = state.result;
    const m = r.metrics;
    const rows = r.mode === "private"
      ? [
          ["Provided enterprise value", metricValue(m.enterpriseValue), sourceCaption(m.enterpriseValue)],
          ["Provided EV / Revenue", metricValue(m.evRevenue), sourceCaption(m.evRevenue)],
          ["Provided EV / EBITDA", metricValue(m.evEbitda), sourceCaption(m.evEbitda)],
          ["Net debt", metricValue(m.netDebt), sourceCaption(m.netDebt)],
          ["Market capitalization", m.marketCap, sourceCaption(m.marketCapSource)]
        ]
      : [
          ["Share price", r.quote ? r.quote.close : null, quoteCaption(r.quote)],
          ["Shares outstanding", metricValue(m.shares), sourceCaption(m.shares)],
          ["Market capitalization", m.marketCap, sourceCaption(m.marketCapSource)],
          ["Enterprise value", metricValue(m.enterpriseValue), sourceCaption(m.enterpriseValue)],
          ["EV / Revenue", metricValue(m.evRevenue), sourceCaption(m.evRevenue)],
          ["EV / EBITDA", metricValue(m.evEbitda), sourceCaption(m.evEbitda)],
          ["P / E", metricValue(m.priceEarnings), sourceCaption(m.priceEarnings)],
          ["P / Book", metricValue(m.priceBook), sourceCaption(m.priceBook)]
        ];
    return `
      <section class="panel">
        <div class="panel-heading">
          <div>
            <p class="eyebrow">${r.mode === "private" ? "Provided Inputs Only" : "Market-Derived Only"}</p>
            <h2>${r.mode === "private" ? "Private Valuation Guardrails" : "Valuation Outputs"}</h2>
          </div>
          <span class="pill ${m.enterpriseValue.value == null ? "amber" : "green"}">No assumption-based range</span>
        </div>
        <div class="notice strong">
          ${r.mode === "private"
            ? "Private targets can be acquired, but valuation outputs require explicit banker/client inputs. The app does not invent purchase price, DCF, LBO, synergies, or control premium."
            : "This screen intentionally does not generate DCF, LBO, synergy, control premium, or target-price outputs. It shows only market-implied figures that can be traced to public quote data and SEC XBRL facts."}
        </div>
      </section>
      <section class="panel">
        ${simpleRows(rows)}
      </section>
    `;
  }

  function peersTab() {
    const peers = state.result.peers || [];
    if (!peers.length) {
      return `
        <section class="panel">
          <div class="empty-state">
            ${state.result.mode === "private"
              ? "Private target comps are not auto-generated. Add banker-approved public comps in the public target path or document a peer set in banker notes."
              : "No peer screen was available. Add banker-approved tickers or refine the target/acquirer inputs. The app will not invent a final comps set; suggested screens require banker approval."}
          </div>
        </section>
      `;
    }
    const universe = state.result.peerUniverse || {};
    return `
      <section class="panel">
        <div class="panel-heading">
          <div>
            <p class="eyebrow">${universe.mode === "explicit" ? "Banker-Approved Peer Set" : "Suggested Peer Screen"}</p>
            <h2>${universe.mode === "explicit" ? "Trading Comparison" : "Preliminary universe requiring approval"}</h2>
          </div>
          <span class="pill ${universe.mode === "explicit" ? "green" : "amber"}">${peers.length} live peer${peers.length === 1 ? "" : "s"}</span>
        </div>
        <div class="notice strong">
          ${escapeHtml(universe.methodology || "Peer methodology not available.")}
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Company</th>
                <th>Selection basis</th>
                <th>Price date</th>
                <th>Market cap</th>
                <th>EV / Revenue</th>
                <th>EV / EBITDA</th>
                <th>P / E</th>
                <th>Public-data quality</th>
              </tr>
            </thead>
            <tbody>
              ${[state.result].concat(peers).map(peerRow).join("")}
            </tbody>
          </table>
        </div>
      </section>
    `;
  }

  function risksTab() {
    const r = state.result;
    return `
      <section class="grid-2">
        <div class="panel">
          <div class="panel-heading compact">
            <div>
              <p class="eyebrow">Risk Register</p>
              <h2>${r.mode === "private" ? "Private-deal diligence flags" : "Public-data flags"}</h2>
            </div>
          </div>
          <ul class="risk-list">
            ${r.risks.map((risk) => `<li class="${escapeHtml(risk.level)}"><strong>${escapeHtml(risk.title)}</strong><br>${escapeHtml(risk.detail)}</li>`).join("")}
          </ul>
        </div>
        <div class="panel">
          <div class="panel-heading compact">
            <div>
              <p class="eyebrow">Recent SEC Filings</p>
              <h2>${r.mode === "private" ? "Private materials status" : "Filing intelligence"}</h2>
            </div>
          </div>
          ${r.mode === "private" ? privateMaterialsPanel(r) : filingsTable(r.filings)}
        </div>
      </section>
    `;
  }

  function agentsTab() {
    const r = state.result;
    const agents = r.agents || [];
    const harness = r.harness || { gates: [], score: 0, level: "Unavailable", disposition: "Harness not available." };
    const gates = harness.gates || [];
    const blockers = gates.filter((gate) => gate.status !== "pass" && gate.severity !== "advisory");
    const agentGaps = agents.reduce((sum, agent) => sum + ((agent.gaps || []).length), 0);
    const sourceCount = r.sources && r.sources.length ? r.sources.length : r.mode === "private" ? 1 : 0;
    return `
      <section class="panel">
        <div class="panel-heading">
          <div>
            <p class="eyebrow">Role-Based Memo Orchestration</p>
            <h2>Agent operating model for the deal packet</h2>
          </div>
          <span class="pill ${harness.readyForExternalUse ? "green" : "amber"}">${escapeHtml(harness.level)} / ${escapeHtml(String(harness.score))}</span>
        </div>
        <div class="notice strong">
          Each agent is a bounded workstream tied to a real IB checkpoint. The output is controlled by source provenance,
          banker/client inputs, unavailable flags, and harness gates.
        </div>
        <div class="metric-grid compact-metrics">
          ${metric("Active workstreams", String(agents.length), "Deal-specific analyst agents running on this packet")}
          ${metric("Open control gates", String(blockers.length), blockers.length ? "Resolve before broader memo use" : "No non-advisory blocker open")}
          ${metric("Agent open gaps", String(agentGaps), agentGaps ? "Visible diligence or source gaps" : "No agent gap listed")}
          ${metric("Evidence records", String(sourceCount), "Source or input provenance attached")}
        </div>
      </section>

      ${agentWorkflowPanel(agents, harness)}

      <section class="agent-grid">
        ${agents.map(agentCard).join("")}
      </section>

      <section class="panel">
        <div class="panel-heading">
          <div>
            <p class="eyebrow">Product QA Agent</p>
            <h2>Self-tests product readiness before you trust the workflow</h2>
          </div>
          <button class="secondary-button" type="button" data-action="run-self-test">Run self-test</button>
        </div>
        ${selfTestPanel()}
      </section>

      <section class="panel">
        <div class="panel-heading">
          <div>
            <p class="eyebrow">Harness</p>
            <h2>Memo readiness gates</h2>
          </div>
          <span class="pill ${harness.readyForExternalUse ? "green" : "amber"}">${escapeHtml(harness.disposition || "")}</span>
        </div>
        ${harnessTable(harness.gates || [])}
      </section>
    `;
  }

  function agentWorkflowPanel(agents, harness) {
    if (!agents.length) {
      return `<section class="panel"><div class="empty-state">No deal agents are active for this packet.</div></section>`;
    }
    return `
      <section class="panel">
        <div class="panel-heading">
          <div>
            <p class="eyebrow">Agent Workflow Map</p>
            <h2>Where each agent is used in the memo process</h2>
          </div>
          <span class="pill ${harness.readyForExternalUse ? "green" : "amber"}">${escapeHtml(harness.disposition || "Readiness pending")}</span>
        </div>
        <div class="table-wrap workflow-table">
          <table>
            <thead>
              <tr><th>Step</th><th>Agent</th><th>Used when</th><th>Output</th><th>Control gate</th><th>Status</th></tr>
            </thead>
            <tbody>
              ${agents.map((agent) => `
                <tr>
                  <td><strong>${escapeHtml(agent.workflowStep || agent.role)}</strong></td>
                  <td>${escapeHtml(agent.role)}</td>
                  <td>${escapeHtml(agent.usedWhen || "Runs when this workstream is available.")}</td>
                  <td>${escapeHtml(agent.output || agent.mandate || "")}</td>
                  <td>${escapeHtml(agent.controlGate || "No gate mapped")}</td>
                  <td><span class="status-chip ${agentStatusClass(agent.status)}">${escapeHtml(agent.status || "watch")}</span></td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      </section>
    `;
  }

  function selfTestPanel() {
    if (!state.selfTest) {
      return `<div class="empty-state">The QA agent verifies product thesis, agent workflow mapping, private-target support, absence of preloaded company shortcuts, static assets, SEC configuration, and harness availability.</div>`;
    }
    return `
      <div class="notice strong">
        <strong>${escapeHtml(state.selfTest.agent.role)}:</strong>
        ${escapeHtml(state.selfTest.agent.summary)}
      </div>
      ${agentMetaPanel(state.selfTest.agent)}
      <div class="table-wrap">
        <table>
          <thead><tr><th>Check</th><th>Status</th><th>Evidence</th></tr></thead>
          <tbody>
            ${state.selfTest.checks
              .map(
                (check) => `
                <tr>
                  <td><strong>${escapeHtml(check.label)}</strong></td>
                  <td><span class="status-chip ${check.status === "pass" ? "good" : "gap"}">${escapeHtml(check.status)}</span></td>
                  <td>${escapeHtml(check.detail)}</td>
                </tr>
              `
              )
              .join("")}
          </tbody>
        </table>
      </div>
    `;
  }

  function agentCard(agent) {
    return `
      <section class="panel agent-card">
        <div class="panel-heading compact">
          <div>
            <p class="eyebrow">${escapeHtml(agent.role)}</p>
            <h2>${escapeHtml(agent.mandate)}</h2>
          </div>
          <span class="status-chip ${agentStatusClass(agent.status)}">${escapeHtml(agent.confidence)} confidence</span>
        </div>
        ${agentMetaPanel(agent)}
        <h3>Findings</h3>
        <ul class="section-list">
          ${(agent.findings || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
        </ul>
        ${agent.gaps && agent.gaps.length ? `<h3>Open gaps</h3><ul class="risk-list">${agent.gaps.map((item) => `<li class="watch">${escapeHtml(item)}</li>`).join("")}</ul>` : ""}
        <h3>Next step</h3>
        <ul class="source-list">
          ${(agent.nextSteps || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
        </ul>
      </section>
    `;
  }

  function agentMetaPanel(agent) {
    return `
      <div class="agent-context-grid">
        <div>
          <span>Workflow step</span>
          <strong>${escapeHtml(agent.workflowStep || "Not mapped")}</strong>
        </div>
        <div>
          <span>Decision use</span>
          <strong>${escapeHtml(agent.decisionUse || "Not mapped")}</strong>
        </div>
        <div>
          <span>Control gate</span>
          <strong>${escapeHtml(agent.controlGate || "No gate mapped")}</strong>
        </div>
      </div>
      ${agent.inputs && agent.inputs.length ? `<div class="tag-list">${agent.inputs.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}</div>` : ""}
    `;
  }

  function harnessTable(gates) {
    return `
      <div class="table-wrap">
        <table>
          <thead><tr><th>Gate</th><th>Status</th><th>Severity</th><th>Evidence / action</th></tr></thead>
          <tbody>
            ${gates
              .map(
                (gate) => `
                <tr>
                  <td><strong>${escapeHtml(gate.label)}</strong></td>
                  <td><span class="status-chip ${gate.status === "pass" ? "good" : "gap"}">${escapeHtml(gate.status)}</span></td>
                  <td>${escapeHtml(gate.severity)}</td>
                  <td>${escapeHtml(gate.detail)}</td>
                </tr>
              `
              )
              .join("")}
          </tbody>
        </table>
      </div>
    `;
  }

  function memoTab() {
    return `
      <section class="panel printable">
        <div class="panel-heading">
          <div>
            <p class="eyebrow">Generated From Live Public Sources</p>
            <h2>Multi-Agent Banker Memo</h2>
          </div>
          <div class="button-row">
            <button class="secondary-button" type="button" data-action="copy-memo">Copy</button>
            <button class="secondary-button" type="button" data-action="download-memo">Download</button>
            <button class="secondary-button" type="button" data-action="export-json">Export JSON</button>
            <button class="primary-button" type="button" data-action="print-memo">Print / PDF</button>
          </div>
        </div>
        <div class="memo-preview"><pre>${escapeHtml(buildMemo())}</pre></div>
      </section>
    `;
  }

  function committeePackTab() {
    const r = state.result;
    const harness = r.harness || { gates: [], level: r.quality.level, score: r.quality.score, disposition: "Readiness not available." };
    const sections = committeePackSections(r);
    const diligence = committeeDiligenceItems(r);
    const recommendation = dealRecommendation(r);
    return `
      <section class="panel">
        <div class="panel-heading">
          <div>
            <p class="eyebrow">Committee Pack Builder</p>
            <h2>MD / IC review pack generated from the controlled deal packet</h2>
          </div>
          <div class="button-row">
            <button class="secondary-button" type="button" data-action="copy-pack">Copy pack</button>
            <button class="secondary-button" type="button" data-action="download-pack">Download pack</button>
          </div>
        </div>
        <div class="notice strong">
          This pack converts the same source-backed memo packet into a review agenda: what is ready, who owns it,
          what remains open, and what cannot be concluded without banker/client inputs.
        </div>
        <div class="metric-grid compact-metrics">
          ${metric("Recommendation", recommendation.label, recommendation.nextStep)}
          ${metric("Readiness", `${harness.level || "Unavailable"} / ${harness.score || 0}`, harness.disposition || "")}
          ${metric("Decision ask", state.notes.decision || "Not provided", "Add in Case Controls before external committee use")}
          ${metric("Deal parties", `${targetLabel(r)} -> ${acquirerLabel(r)}`, "Target / seller and optional acquirer / buyer")}
        </div>
      </section>

      <section class="panel">
        <div class="panel-heading">
          <div>
            <p class="eyebrow">Pack Sections</p>
            <h2>Auto-built review agenda</h2>
          </div>
        </div>
        <div class="table-wrap workflow-table">
          <table>
            <thead><tr><th>Section</th><th>Owner</th><th>Status</th><th>What the committee gets</th><th>Source / control</th></tr></thead>
            <tbody>
              ${sections.map((section) => `
                <tr>
                  <td><strong>${escapeHtml(section.name)}</strong></td>
                  <td>${escapeHtml(section.owner)}</td>
                  <td><span class="status-chip ${agentStatusClass(section.status)}">${escapeHtml(section.status)}</span></td>
                  <td>${escapeHtml(section.output)}</td>
                  <td>${escapeHtml(section.control)}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      </section>

      <section class="grid-2">
        <div class="panel">
          <p class="eyebrow">Diligence Request List</p>
          <h2>Open items to clear before broader distribution</h2>
          <ul class="risk-list">
            ${diligence.length ? diligence.map((item) => `<li class="watch">${escapeHtml(item)}</li>`).join("") : `<li class="good">No open diligence item was generated by the current packet.</li>`}
          </ul>
        </div>
        <div class="panel">
          <p class="eyebrow">Distribution Controls</p>
          <h2>What this pack refuses to invent</h2>
          <ul class="section-list">
            <li>No DCF, LBO, synergy, control premium, fairness, or buyer appetite conclusion without explicit inputs.</li>
            <li>Suggested peers remain preliminary until banker include/exclude approval is documented.</li>
            <li>Private-company metrics remain banker/client-provided and require diligence tie-out.</li>
            <li>Open harness gates keep the pack in internal-review mode.</li>
          </ul>
        </div>
      </section>
    `;
  }

  function committeePackSections(r) {
    const harness = r.harness || { gates: [] };
    const agents = r.agents || [];
    const financialAgent = agents.find((agent) => agent.id && agent.id.includes("financial"));
    const valuationAgent = agents.find((agent) => agent.id && agent.id.includes("valuation"));
    const riskAgent = agents.find((agent) => agent.id && (agent.id.includes("risk") || agent.id.includes("process")));
    const mdAgent = agents.find((agent) => agent.id && agent.id.includes("md"));
    const peerGate = (harness.gates || []).find((gate) => gate.label && gate.label.toLowerCase().includes("peer"));
    return [
      {
        name: "Executive readout",
        owner: mdAgent ? mdAgent.role : "MD synthesis",
        status: harness.readyForExternalUse ? "green" : "watch",
        output: harness.disposition || "Readiness disposition and decision boundary.",
        control: "Harness readiness disposition"
      },
      {
        name: "Deal party context",
        owner: "Coverage banker / buyer analyst",
        status: r.mode === "private" || r.acquirer ? "green" : "watch",
        output: `Target: ${targetLabel(r)}. Acquirer / buyer: ${acquirerLabel(r)}.`,
        control: "Target and acquirer fields"
      },
      {
        name: "Financial profile",
        owner: financialAgent ? financialAgent.role : "Financial statement analyst",
        status: financialAgent ? financialAgent.status : "watch",
        output: r.mode === "private" ? "Banker/client-provided revenue, EBITDA, cash, debt, and net debt." : "Reported XBRL revenue, earnings, cash flow, balance sheet, and missing-tag flags.",
        control: r.mode === "private" ? "Private source package identified" : "Reported financial facts traceable"
      },
      {
        name: "Valuation and comps",
        owner: valuationAgent ? valuationAgent.role : "Valuation analyst",
        status: valuationAgent ? valuationAgent.status : "watch",
        output: r.mode === "private" ? "Only explicitly provided valuation inputs and derived multiples." : `${peerUniverseLabel(r)}; market-derived EV, trading multiples, and peer approval status.`,
        control: peerGate ? `${peerGate.label}: ${peerGate.status}` : "Valuation input gate"
      },
      {
        name: "Risk and diligence",
        owner: riskAgent ? riskAgent.role : "Risk reviewer",
        status: riskAgent ? riskAgent.status : "watch",
        output: "Disclosure, diligence, source, legal, tax, regulatory, and data-quality gaps.",
        control: "Diligence limitations disclosed"
      },
      {
        name: "Source appendix",
        owner: "Product QA Agent",
        status: r.sources && r.sources.length ? "green" : "watch",
        output: `${r.sources && r.sources.length ? r.sources.length : r.mode === "private" ? 1 : 0} source or input provenance records.`,
        control: "Source provenance captured"
      }
    ];
  }

  function committeeDiligenceItems(r) {
    const items = [];
    (r.agents || []).forEach((agent) => {
      (agent.gaps || []).forEach((gap) => items.push(`${agent.role}: ${gap}`));
    });
    (r.harness && r.harness.gates ? r.harness.gates : [])
      .filter((gate) => gate.status !== "pass")
      .forEach((gate) => items.push(`${gate.label}: ${gate.detail}`));
    (r.limitations || []).slice(0, 4).forEach((item) => items.push(`Limitation: ${item}`));
    return Array.from(new Set(items)).slice(0, 10);
  }

  function controlsTab() {
    const r = state.result;
    const harness = r.harness || { gates: [], level: r.quality.level, score: r.quality.score };
    return `
      <section class="panel">
        <div class="panel-heading">
          <div>
            <p class="eyebrow">Workflow and Quality Control</p>
            <h2>Case controls and banker inputs</h2>
          </div>
          <span class="pill ${harness.readyForExternalUse ? "green" : "amber"}">${escapeHtml(harness.level)} / ${escapeHtml(String(harness.score))}</span>
        </div>
        <ul class="quality-list">
          ${(harness.gates || [])
            .map((gate) => `<li><strong class="status-chip ${gate.status === "pass" ? "good" : "gap"}">${escapeHtml(gate.status)}</strong> ${escapeHtml(gate.label)} <small>${escapeHtml(gate.detail)}</small></li>`)
            .join("")}
        </ul>
      </section>

      <section class="grid-3">
        <div class="panel">
          <p class="eyebrow">Mandate context</p>
          <h2>Banker-provided, not fabricated</h2>
          <div class="field">
            <label for="mandateNote">Mandate / transaction context</label>
            <textarea id="mandateNote" data-note="mandate" placeholder="Enter banker-provided mandate, transaction type, committee audience, and confidentiality context.">${escapeHtml(
              state.notes.mandate
            )}</textarea>
          </div>
        </div>
        <div class="panel">
          <p class="eyebrow">Decision requested</p>
          <h2>Review ask</h2>
          <div class="field">
            <label for="decisionNote">Decision requested</label>
            <textarea id="decisionNote" data-note="decision" placeholder="Enter the specific decision or next-step approval requested from the deal team.">${escapeHtml(
              state.notes.decision
            )}</textarea>
          </div>
        </div>
        <div class="panel">
          <p class="eyebrow">Internal notes</p>
          <h2>Execution comments</h2>
          <div class="field">
            <label for="bankerNotes">Banker notes</label>
            <textarea id="bankerNotes" data-note="bankerNotes" placeholder="Add relationship, conflicts, or client-specific comments here.">${escapeHtml(
              state.notes.bankerNotes
            )}</textarea>
          </div>
        </div>
      </section>
    `;
  }

  function metric(label, value, caption) {
    return `<div class="metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(caption || "")}</small></div>`;
  }

  function metricValue(metricObj) {
    return metricObj && Object.prototype.hasOwnProperty.call(metricObj, "value") ? metricObj.value : metricObj;
  }

  function sourceCaption(metricObj) {
    if (!metricObj) return "";
    if (typeof metricObj === "string") return metricObj;
    if (metricObj.source) return metricObj.source;
    if (metricObj.sources && metricObj.sources.length) return metricObj.sources.join("; ");
    return "";
  }

  function quoteCaption(quote) {
    if (!quote) return "Quote unavailable from public feed";
    return `${quote.source}; ${quote.date || "date unavailable"} ${quote.time || ""}`.trim();
  }

  function metricTable(rows) {
    return `
      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>Metric</th><th>Value</th><th>Period / Source</th><th>Filed</th></tr>
          </thead>
          <tbody>
            ${rows
              .map(([label, metricObj]) => {
                const value = metricValue(metricObj);
                const display = label.toLowerCase().includes("margin") || label.toLowerCase().includes("growth")
                  ? fmt(value, { type: "pct" })
                  : label === "Shares outstanding"
                    ? fmt(value, { type: "integer" })
                    : fmt(value);
                return `
                  <tr>
                    <td><strong>${escapeHtml(label)}</strong></td>
                    <td>${escapeHtml(display)}</td>
                    <td>${escapeHtml(sourceCaption(metricObj))}</td>
                    <td>${escapeHtml(metricObj && metricObj.filed ? dateFmt(metricObj.filed) : "Not available")}</td>
                  </tr>
                `;
              })
              .join("")}
          </tbody>
        </table>
      </div>
    `;
  }

  function simpleRows(rows) {
    return `
      <div class="table-wrap">
        <table>
          <thead><tr><th>Output</th><th>Value</th><th>Source / Logic</th></tr></thead>
          <tbody>
            ${rows
              .map(([label, value, source]) => {
                const display =
                  label.includes("EV /") || label.includes("P /") ? fmt(value, { type: "multiple" }) : label.includes("price") ? fmt(value, { type: "price" }) : fmt(value);
                return `<tr><td><strong>${escapeHtml(label)}</strong></td><td>${escapeHtml(display)}</td><td>${escapeHtml(source || "")}</td></tr>`;
              })
              .join("")}
          </tbody>
        </table>
      </div>
    `;
  }

  function peerRow(company) {
    return `
      <tr>
        <td><strong>${escapeHtml(company.profile.ticker || company.profile.cik)}</strong><br>${escapeHtml(company.profile.name)}</td>
        <td>${escapeHtml(company.peerSelection ? `${company.peerSelection.source}${company.peerSelection.requiresApproval ? " / approval needed" : ""}` : "Target company")}</td>
        <td>${escapeHtml(company.quote ? `${company.quote.date} ${company.quote.time || ""}` : "Not available")}</td>
        <td>${escapeHtml(fmt(company.metrics.marketCap))}</td>
        <td>${escapeHtml(fmt(metricValue(company.metrics.evRevenue), { type: "multiple" }))}</td>
        <td>${escapeHtml(fmt(metricValue(company.metrics.evEbitda), { type: "multiple" }))}</td>
        <td>${escapeHtml(fmt(metricValue(company.metrics.priceEarnings), { type: "multiple" }))}</td>
        <td><span class="status-chip ${qualityClass(company.quality.level)}">${company.quality.score}/100</span></td>
      </tr>
    `;
  }

  function filingsTable(filings) {
    if (!filings || !filings.length) return `<div class="empty-state">No recent filing metadata available.</div>`;
    return `
      <div class="table-wrap">
        <table>
          <thead><tr><th>Form</th><th>Filed</th><th>Report date</th><th>Document</th></tr></thead>
          <tbody>
            ${filings
              .map(
                (f) => `
                <tr>
                  <td><strong>${escapeHtml(f.form)}</strong></td>
                  <td>${escapeHtml(dateFmt(f.filingDate))}</td>
                  <td>${escapeHtml(dateFmt(f.reportDate))}</td>
                  <td><a href="${escapeHtml(f.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(f.primaryDocument || f.accessionNumber)}</a></td>
                </tr>
              `
              )
              .join("")}
          </tbody>
        </table>
      </div>
    `;
  }

  function privateMaterialsPanel(result) {
    return `
      <div class="table-wrap">
        <table>
          <thead><tr><th>Private source item</th><th>Status</th><th>Use in memo</th></tr></thead>
          <tbody>
            <tr>
              <td><strong>Source package</strong></td>
              <td>${escapeHtml(result.privateContext.sourceBasis)}</td>
              <td>Basis for banker/client-provided facts.</td>
            </tr>
            <tr>
              <td><strong>Financial period</strong></td>
              <td>${escapeHtml(result.privateContext.period)}</td>
              <td>Period tie-out for revenue, EBITDA, cash, debt, and optional valuation inputs.</td>
            </tr>
            <tr>
              <td><strong>Public filings</strong></td>
              <td>Not applicable</td>
              <td>Private-company acquisition path does not depend on SEC public-company filings.</td>
            </tr>
          </tbody>
        </table>
      </div>
    `;
  }

  function qualityClass(level) {
    if (level === "High") return "green";
    if (level === "Usable") return "watch";
    if (level === "Limited") return "amber";
    return "gap";
  }

  function agentStatusClass(status) {
    if (status === "green" || status === "pass") return "good";
    if (status === "watch") return "watch";
    return "gap";
  }

  function buildMemo() {
    const r = state.result;
    if (r.mode === "private") return buildPrivateMemo(r);
    const m = r.metrics;
    const recommendation = dealRecommendation(r);
    const lines = [];
    lines.push(`${r.profile.name} (${r.profile.ticker || r.profile.cik}) - Public Data Deal Triage Memo`);
    lines.push(`Generated: ${new Date().toLocaleString()}`);
    lines.push("");
    lines.push("1. Source Basis");
    lines.push(`This memo uses public SEC EDGAR filings/XBRL company facts and public market quote data only. No fabricated company data, banker assumptions, DCF, LBO, synergy, or control premium inputs are included.`);
    lines.push(`SEC CIK: ${r.profile.cik}. Latest filing shown: ${r.filings[0] ? `${r.filings[0].form} filed ${r.filings[0].filingDate}` : "not available"}.`);
    lines.push(`Deal parties: target / seller is ${r.profile.name}; acquirer / buyer is ${r.acquirer ? r.acquirer.profile.name : "not selected"}.`);
    lines.push(`Preliminary acquisition recommendation: ${recommendation.label}. ${recommendation.nextStep}`);
    recommendation.rationale.forEach((item) => lines.push(`- Recommendation rationale: ${item}`));
    lines.push("");
    lines.push("2. Agent Workstream Readout");
    if (r.agents && r.agents.length) {
      r.agents.forEach((agent) => {
        lines.push(`${agent.workflowStep || "Agent step"} - ${agent.role} (${agent.confidence} confidence):`);
        if (agent.usedWhen) lines.push(`- Used when: ${agent.usedWhen}`);
        if (agent.output) lines.push(`- Output: ${agent.output}`);
        if (agent.controlGate) lines.push(`- Control gate: ${agent.controlGate}`);
        (agent.findings || []).slice(0, 3).forEach((item) => lines.push(`- ${item}`));
        if (agent.gaps && agent.gaps.length) lines.push(`- Open gap: ${agent.gaps[0]}`);
      });
    } else {
      lines.push("- Agent workstreams were not available for this data packet.");
    }
    lines.push("");
    lines.push("3. Harness / Readiness Gates");
    if (r.harness) {
      lines.push(`Harness status: ${r.harness.level}; score ${r.harness.score}/100. ${r.harness.disposition}`);
      (r.harness.gates || []).forEach((gate) => {
        lines.push(`- ${gate.status.toUpperCase()} / ${gate.severity}: ${gate.label} - ${gate.detail}`);
      });
    } else {
      lines.push("- Harness output was not available.");
    }
    lines.push("");
    lines.push("4. Public Trading Snapshot");
    lines.push(`Share price: ${fmt(r.quote && r.quote.close, { type: "price" })}. Market cap: ${fmt(m.marketCap)}. Enterprise value: ${fmt(metricValue(m.enterpriseValue))}.`);
    lines.push(`EV / Revenue: ${fmt(metricValue(m.evRevenue), { type: "multiple" })}. EV / EBITDA: ${fmt(metricValue(m.evEbitda), { type: "multiple" })}. P / E: ${fmt(metricValue(m.priceEarnings), { type: "multiple" })}. P / Book: ${fmt(metricValue(m.priceBook), { type: "multiple" })}.`);
    lines.push("");
    lines.push("5. Reported Financial Profile");
    lines.push(`Revenue: ${fmt(metricValue(m.revenue))}. Revenue growth: ${fmt(metricValue(m.revenueGrowth), { type: "pct" })}. Net income: ${fmt(metricValue(m.netIncome))}. Free cash flow: ${fmt(metricValue(m.freeCashFlow))}.`);
    lines.push(`Assets: ${fmt(metricValue(m.assets))}. Cash: ${fmt(metricValue(m.cash))}. Debt: ${fmt(metricValue(m.debt))}. Equity: ${fmt(metricValue(m.equity))}.`);
    lines.push("");
    lines.push("6. Banker Observations");
    r.observations.forEach((item) => lines.push(`- ${item}`));
    lines.push("");
    lines.push("7. Risks / Data Gaps");
    r.risks.forEach((risk) => lines.push(`- ${risk.title}: ${risk.detail}`));
    lines.push("");
    lines.push("8. Peer Set");
    if (r.peers && r.peers.length) {
      lines.push(`Peer universe basis: ${peerUniverseLabel(r)}. ${peerUniverseCaption(r)}`);
      r.peers.forEach((peer) => {
        const selection = peer.peerSelection ? `${peer.peerSelection.source}${peer.peerSelection.requiresApproval ? "; banker approval required" : ""}` : "Target";
        lines.push(`- ${peer.profile.ticker || peer.profile.cik} / ${peer.profile.name}: market cap ${fmt(peer.metrics.marketCap)}, EV/Revenue ${fmt(metricValue(peer.metrics.evRevenue), { type: "multiple" })}, data quality ${peer.quality.score}/100. Selection: ${selection}.`);
      });
    } else {
      lines.push("- No peer universe was available. A banker-approved peer set is required before using this for relative valuation discussion.");
    }
    lines.push("");
    lines.push("9. Banker-Provided Context");
    lines.push(`Mandate context: ${state.notes.mandate || "Not provided."}`);
    lines.push(`Decision requested: ${state.notes.decision || "Not provided."}`);
    lines.push(`Internal notes: ${state.notes.bankerNotes || "Not provided."}`);
    lines.push("");
    lines.push("10. Limitations");
    r.limitations.forEach((item) => lines.push(`- ${item}`));
    lines.push("");
    lines.push("This output is a public-data analytical workpaper, not investment, legal, tax, accounting, or regulatory advice.");
    return lines.join("\n");
  }

  function buildPrivateMemo(r) {
    const m = r.metrics;
    const recommendation = dealRecommendation(r);
    const lines = [];
    lines.push(`${r.profile.name} - Private / Confidential Acquisition Triage Memo`);
    lines.push(`Generated: ${new Date().toLocaleString()}`);
    lines.push("");
    lines.push("1. Product Purpose");
    lines.push("This memo turns a non-public acquisition target into a decision-ready triage workpaper by separating banker/client-provided facts, unavailable assumptions, diligence gaps, and review gates.");
    lines.push("A target does not need to be public to be acquired. For private targets, the evidence base shifts to authorized private materials and diligence validation.");
    lines.push(`Deal parties: target / seller is ${r.profile.name}; acquirer / buyer is ${r.privateContext.buyerName || "not selected"}.`);
    lines.push(`Preliminary acquisition recommendation: ${recommendation.label}. ${recommendation.nextStep}`);
    recommendation.rationale.forEach((item) => lines.push(`- Recommendation rationale: ${item}`));
    lines.push("");
    lines.push("2. Source Basis");
    lines.push(`Source package: ${r.privateContext.sourceBasis}. Financial period: ${r.privateContext.period}.`);
    lines.push("No SEC public-company filing, market quote, market cap, or public share count is assumed for this private target.");
    lines.push("");
    lines.push("3. Agent Workstream Readout");
    (r.agents || []).forEach((agent) => {
      lines.push(`${agent.workflowStep || "Agent step"} - ${agent.role} (${agent.confidence} confidence):`);
      if (agent.usedWhen) lines.push(`- Used when: ${agent.usedWhen}`);
      if (agent.output) lines.push(`- Output: ${agent.output}`);
      if (agent.controlGate) lines.push(`- Control gate: ${agent.controlGate}`);
      (agent.findings || []).slice(0, 3).forEach((item) => lines.push(`- ${item}`));
      if (agent.gaps && agent.gaps.length) lines.push(`- Open gap: ${agent.gaps[0]}`);
    });
    lines.push("");
    lines.push("4. Harness / Readiness Gates");
    if (r.harness) {
      lines.push(`Harness status: ${r.harness.level}; score ${r.harness.score}/100. ${r.harness.disposition}`);
      (r.harness.gates || []).forEach((gate) => lines.push(`- ${gate.status.toUpperCase()} / ${gate.severity}: ${gate.label} - ${gate.detail}`));
    }
    lines.push("");
    lines.push("5. Provided Financial Profile");
    lines.push(`Revenue: ${fmt(metricValue(m.revenue))}. EBITDA: ${fmt(metricValue(m.ebitda))}. EBITDA margin: ${fmt(metricValue(m.ebitdaMargin), { type: "pct" })}.`);
    lines.push(`Cash: ${fmt(metricValue(m.cash))}. Debt: ${fmt(metricValue(m.debt))}. Net debt: ${fmt(metricValue(m.netDebt))}.`);
    lines.push(`Provided enterprise value: ${fmt(metricValue(m.enterpriseValue))}. Provided EV / Revenue: ${fmt(metricValue(m.evRevenue), { type: "multiple" })}. Provided EV / EBITDA: ${fmt(metricValue(m.evEbitda), { type: "multiple" })}.`);
    lines.push("");
    lines.push("6. Diligence Flags");
    r.risks.forEach((risk) => lines.push(`- ${risk.title}: ${risk.detail}`));
    lines.push("");
    lines.push("7. Banker-Provided Context");
    lines.push(`Mandate context: ${state.notes.mandate || "Not provided."}`);
    lines.push(`Decision requested: ${state.notes.decision || "Not provided."}`);
    lines.push(`Internal notes: ${state.notes.bankerNotes || "Not provided."}`);
    lines.push("");
    lines.push("8. Limitations");
    r.limitations.forEach((item) => lines.push(`- ${item}`));
    lines.push("");
    lines.push("This output is a private-target analytical workpaper, not investment, legal, tax, accounting, or regulatory advice.");
    return lines.join("\n");
  }

  function buildCommitteePack() {
    const r = state.result;
    const harness = r.harness || { level: "Unavailable", score: 0, disposition: "Readiness not available.", gates: [] };
    const recommendation = dealRecommendation(r);
    const lines = [];
    lines.push(`${r.profile.name} - Committee Review Pack`);
    lines.push(`Generated: ${new Date().toLocaleString()}`);
    lines.push("");
    lines.push("1. Executive Readout");
    lines.push(`Preliminary acquisition recommendation: ${recommendation.label}.`);
    lines.push(`Recommendation next step: ${recommendation.nextStep}`);
    recommendation.rationale.forEach((item) => lines.push(`- Recommendation rationale: ${item}`));
    lines.push(`Readiness: ${harness.level} / ${harness.score}. ${harness.disposition}`);
    lines.push(`Decision ask: ${state.notes.decision || "Not provided."}`);
    lines.push(`Use boundary: ${harness.readyForExternalUse ? "External-ready draft." : "Internal review only until open gates and banker inputs are cleared."}`);
    lines.push("");
    lines.push("2. Deal Parties");
    lines.push(`Target / seller: ${targetLabel(r)}.`);
    lines.push(`Acquirer / buyer: ${acquirerLabel(r)}.`);
    lines.push("");
    lines.push("3. Pack Sections");
    committeePackSections(r).forEach((section) => {
      lines.push(`- ${section.name} | Owner: ${section.owner} | Status: ${section.status} | Control: ${section.control}`);
      lines.push(`  Output: ${section.output}`);
    });
    lines.push("");
    lines.push("4. Diligence Request List");
    const diligence = committeeDiligenceItems(r);
    if (diligence.length) diligence.forEach((item) => lines.push(`- ${item}`));
    else lines.push("- No open diligence item was generated by the current packet.");
    lines.push("");
    lines.push("5. Distribution Controls");
    lines.push("- No DCF, LBO, synergy, control premium, fairness, or buyer appetite conclusion without explicit inputs.");
    lines.push("- Suggested peers remain preliminary until banker include/exclude approval is documented.");
    lines.push("- Private-company metrics remain banker/client-provided and require diligence tie-out.");
    lines.push("- Open harness gates keep the pack in internal-review mode.");
    return lines.join("\n");
  }

  function copyMemo() {
    const memo = buildMemo();
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(memo).then(() => showToast("Memo copied."));
      return;
    }
    const textarea = document.createElement("textarea");
    textarea.value = memo;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
    showToast("Memo copied.");
  }

  function copyCommitteePack() {
    const pack = buildCommitteePack();
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(pack).then(() => showToast("Committee pack copied."));
      return;
    }
    const textarea = document.createElement("textarea");
    textarea.value = pack;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
    showToast("Committee pack copied.");
  }

  async function runSelfTest() {
    try {
      showToast("Product QA agent is running.");
      const response = await fetch("/api/self-test");
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Self-test failed.");
      state.selfTest = payload;
      render();
      showToast(payload.ok ? "Product self-test passed." : "Product self-test found gaps.");
    } catch (error) {
      state.selfTest = {
        ok: false,
        agent: { role: "Product QA Agent", summary: error.message || String(error) },
        checks: [{ label: "Self-test endpoint", status: "gap", detail: error.message || String(error) }]
      };
      render();
    }
  }

  function download(name, content, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function fileSafe(value) {
    return String(value || "company").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
  }

  setEntryMode(state.entryMode);
  render();
  updateStatus();
})();
