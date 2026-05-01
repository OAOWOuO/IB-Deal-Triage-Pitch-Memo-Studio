(function () {
  "use strict";

  const state = {
    activeTab: "overview",
    loading: false,
    error: "",
    result: null,
    notes: {
      mandate: "",
      decision: "",
      bankerNotes: ""
    }
  };

  const tabs = ["overview", "financials", "valuation", "peers", "risks", "agents", "memo", "controls"];

  const form = document.getElementById("companyForm");
  const tickerInput = document.getElementById("tickerInput");
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
    const filing = document.getElementById("stripFiling");
    const quality = document.getElementById("stripQuality");
    const market = document.getElementById("stripMarket");
    if (!state.result) {
      strip.classList.add("empty");
      target.textContent = "No company loaded";
      filing.textContent = "-";
      quality.textContent = "-";
      market.textContent = "-";
      return;
    }
    const r = state.result;
    strip.classList.remove("empty");
    target.textContent = `${r.profile.ticker || r.profile.cik} / ${r.profile.name}`;
    filing.textContent = r.filings && r.filings[0] ? `${r.filings[0].form} filed ${dateFmt(r.filings[0].filingDate)}` : "Not available";
    quality.textContent = `${r.quality.score}/100 (${r.quality.level})`;
    market.textContent = fmt(r.metrics.marketCap);
  }

  function setActiveTab(tab) {
    state.activeTab = tabs.includes(tab) ? tab : "overview";
    document.querySelectorAll(".tab").forEach((button) => {
      button.classList.toggle("active", button.dataset.tab === state.activeTab);
    });
    render();
  }

  async function fetchCompany(ticker, peers) {
    state.loading = true;
    state.error = "";
    state.result = null;
    updateStatus();
    render();
    const params = new URLSearchParams({ ticker: ticker.trim(), peers: peers.trim() });
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

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const ticker = tickerInput.value.trim();
    if (!ticker) {
      showToast("Enter a ticker or SEC CIK.");
      return;
    }
    fetchCompany(ticker, peersInput.value);
  });

  document.addEventListener("click", (event) => {
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
      download(`${fileSafe(state.result.profile.ticker || state.result.profile.cik)}-ib-memo.txt`, buildMemo(), "text/plain");
    }
    if (action.dataset.action === "print-memo") {
      state.activeTab = "memo";
      setActiveTab("memo");
      setTimeout(() => window.print(), 120);
    }
    if (action.dataset.action === "export-json") {
      download(`${fileSafe(state.result.profile.ticker || state.result.profile.cik)}-live-data.json`, JSON.stringify(state.result, null, 2), "application/json");
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
          <div class="loading">Fetching live SEC filings, XBRL company facts, quote data, and peer metrics...</div>
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
            <p class="eyebrow">No fabricated company data</p>
            <h2>Start with a banker-selected public company ticker or SEC CIK</h2>
          </div>
        </div>
        <div class="notice strong">
          This workspace does not preload fabricated numbers. It builds the screen from public SEC EDGAR filings,
          XBRL company facts, and live-delayed market quote data. If a metric is not available from those sources,
          the app will mark it as unavailable instead of inventing it.
        </div>
      </section>
      <section class="grid-3">
        <div class="panel">
          <p class="eyebrow">What it can do</p>
          <h2>Public Company Deal Screen</h2>
          <ul class="section-list">
            <li>Resolve ticker to SEC CIK and company profile.</li>
            <li>Pull latest 10-K, 10-Q, 8-K, proxy, and registration filings.</li>
            <li>Extract reported revenue, net income, assets, cash, debt, equity, cash flow, capex, shares, and more when XBRL tags exist.</li>
            <li>Run role-based analyst workstreams and memo-readiness harness gates over the same sourced packet.</li>
          </ul>
        </div>
        <div class="panel">
          <p class="eyebrow">What it will not do</p>
          <h2>No Fake IB Model</h2>
          <ul class="section-list">
            <li>No fabricated buyer names, invented private-company numbers, preloaded companies, or preset comps.</li>
            <li>No DCF, LBO, WACC, synergy, or control-premium model inputs unless a future version accepts explicit banker-provided values.</li>
            <li>No investment advice. It is a public-data workbench for analyst triage.</li>
          </ul>
        </div>
        <div class="panel">
          <p class="eyebrow">Enterprise posture</p>
          <h2>Auditability First</h2>
          <ul class="section-list">
            <li>Every displayed metric carries source tags, filing dates, and API provenance.</li>
            <li>Data gaps are treated as diligence issues, not silently filled.</li>
            <li>Memo output includes agent findings, harness gates, data limitations, and exact source list.</li>
          </ul>
        </div>
      </section>
    `;
  }

  function renderTab() {
    if (state.activeTab === "financials") return financialsTab();
    if (state.activeTab === "valuation") return valuationTab();
    if (state.activeTab === "peers") return peersTab();
    if (state.activeTab === "risks") return risksTab();
    if (state.activeTab === "agents") return agentsTab();
    if (state.activeTab === "memo") return memoTab();
    if (state.activeTab === "controls") return controlsTab();
    return overviewTab();
  }

  function overviewTab() {
    const r = state.result;
    const m = r.metrics;
    return `
      <section class="panel">
        <div class="panel-heading">
          <div>
            <p class="eyebrow">Target Overview</p>
            <h2>${escapeHtml(r.profile.name)}</h2>
          </div>
          <span class="pill ${qualityClass(r.quality.level)}">${r.quality.score}/100 public-data completeness</span>
        </div>
        <div class="metric-grid">
          ${metric("Ticker / Exchange", `${r.profile.ticker || "Not available"} / ${r.profile.exchange || "Not available"}`, r.profile.cik)}
          ${metric("SEC filer category", r.profile.category || "Not available", r.profile.sicDescription || "")}
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
              <h2>What the public data supports</h2>
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
              <h2>What still requires company materials</h2>
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
    const rows = [
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
            <p class="eyebrow">SEC XBRL Facts</p>
            <h2>Reported Financial Metrics</h2>
          </div>
          <span class="pill">Fetched ${dateFmt(r.fetchedAt)}</span>
        </div>
        ${metricTable(rows)}
      </section>

      <section class="grid-2">
        <div class="panel">
          <p class="eyebrow">Trend Calculations</p>
          <h2>Calculated only from disclosed periods</h2>
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
    const rows = [
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
            <p class="eyebrow">Market-Derived Only</p>
            <h2>Valuation Outputs</h2>
          </div>
          <span class="pill ${m.enterpriseValue.value == null ? "amber" : "green"}">No assumption-based range</span>
        </div>
        <div class="notice strong">
          This screen intentionally does not generate DCF, LBO, synergy, control premium, or target-price outputs.
          It shows only market-implied figures that can be traced to public quote data and SEC XBRL facts.
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
            No peer tickers were provided. Add peer tickers in the input bar and fetch again.
            The app will not invent a peer set because banker-selected comps are a judgment call.
          </div>
        </section>
      `;
    }
    return `
      <section class="panel">
        <div class="panel-heading">
          <div>
            <p class="eyebrow">User-Specified Peer Set</p>
            <h2>Trading Comparison</h2>
          </div>
          <span class="pill">${peers.length} live peers</span>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Company</th>
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
              <h2>Public-data flags</h2>
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
              <h2>Filing intelligence</h2>
            </div>
          </div>
          ${filingsTable(r.filings)}
        </div>
      </section>
    `;
  }

  function agentsTab() {
    const r = state.result;
    const agents = r.agents || [];
    const harness = r.harness || { gates: [], score: 0, level: "Unavailable", disposition: "Harness not available." };
    return `
      <section class="panel">
        <div class="panel-heading">
          <div>
            <p class="eyebrow">Role-Based Memo Orchestration</p>
            <h2>Analyst agents run on the same sourced data packet</h2>
          </div>
          <span class="pill ${harness.readyForExternalUse ? "green" : "amber"}">${escapeHtml(harness.level)} / ${escapeHtml(String(harness.score))}</span>
        </div>
        <div class="notice strong">
          These are deterministic analyst workstreams, not hidden assumptions. Each role can only use the target packet,
          banker-supplied peers, SEC facts, filing metadata, quote data, and explicit unavailable flags.
        </div>
      </section>

      <section class="agent-grid">
        ${agents.map(agentCard).join("")}
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
                return `
                  <tr>
                    <td><strong>${escapeHtml(label)}</strong></td>
                    <td>${escapeHtml(label === "Shares outstanding" ? fmt(value, { type: "integer" }) : fmt(value))}</td>
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
    const m = r.metrics;
    const lines = [];
    lines.push(`${r.profile.name} (${r.profile.ticker || r.profile.cik}) - Public Data Deal Triage Memo`);
    lines.push(`Generated: ${new Date().toLocaleString()}`);
    lines.push("");
    lines.push("1. Source Basis");
    lines.push(`This memo uses public SEC EDGAR filings/XBRL company facts and public market quote data only. No fabricated company data, banker assumptions, DCF, LBO, synergy, or control premium inputs are included.`);
    lines.push(`SEC CIK: ${r.profile.cik}. Latest filing shown: ${r.filings[0] ? `${r.filings[0].form} filed ${r.filings[0].filingDate}` : "not available"}.`);
    lines.push("");
    lines.push("2. Agent Workstream Readout");
    if (r.agents && r.agents.length) {
      r.agents.forEach((agent) => {
        lines.push(`${agent.role} (${agent.confidence} confidence):`);
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
      r.peers.forEach((peer) => {
        lines.push(`- ${peer.profile.ticker || peer.profile.cik} / ${peer.profile.name}: market cap ${fmt(peer.metrics.marketCap)}, EV/Revenue ${fmt(metricValue(peer.metrics.evRevenue), { type: "multiple" })}, data quality ${peer.quality.score}/100.`);
      });
    } else {
      lines.push("- No peer tickers were supplied. A banker-selected peer set is required before using this for relative valuation discussion.");
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

  render();
  updateStatus();
})();
