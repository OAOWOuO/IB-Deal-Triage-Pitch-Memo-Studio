# IB Deal Triage & Pitch Memo Studio

This is a deal decision memo operating system: it turns a public or private acquisition target into an auditable triage memo by separating target facts, optional acquirer/buyer facts, banker/client-provided inputs, unavailable assumptions, and review gates.

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https%3A%2F%2Fgithub.com%2FOAOWOuO%2FIB-Deal-Triage-Pitch-Memo-Studio)

## Run

```bash
npm install
SEC_USER_AGENT="Your Name your.email@example.com" npm start
```

Then open:

```text
http://127.0.0.1:4173
```

## Quality Harness

```bash
npm run check
npm run harness
```

By default, the harness checks the server health endpoint, static assets, the Product QA Agent endpoint, and controlled API validation without using a fixed company fixture. To exercise the live SEC and quote pipeline with a banker-selected target:

```bash
HARNESS_TICKER="YOUR_TICKER" HARNESS_PEERS="PEER1,PEER2" npm run harness
```

## Agent Operating Model

The app exposes each agent as an auditable deal-workflow step instead of a generic chat response:

- Coverage banker: resolves target identity, filer status, latest filing context, and mandate gaps.
- Buyer / acquirer analyst: separates target-side triage from buyer-specific capacity and strategic-fit work.
- Financial statement analyst: extracts reported XBRL facts and marks unavailable metrics as diligence gaps.
- Valuation and trading comps analyst: calculates only market-derived outputs and labels suggested peers as approval-required.
- Capital structure analyst: screens cash, debt, leverage, and financing diligence needs.
- Risk and disclosure reviewer: escalates filing, disclosure, legal, tax, accounting, regulatory, and diligence limitations.
- MD synthesis: combines agent outputs and harness gates into a committee-readiness disposition.
- Product QA Agent: self-tests the application shell, data policy, agent workflow mapping, and deployment harness.

## Committee Pack Builder

The Committee Pack tab turns the same controlled deal packet into an MD / IC review agenda with executive readout, deal parties, financial profile, valuation and comps status, risk and diligence requests, source appendix, distribution controls, and copy/download actions.

## Recommendation Guardrail

The studio now produces a preliminary acquisition recommendation: recommend acquisition path, hold / do not approve yet, or do not recommend acquisition on current evidence. The recommendation is driven by harness gates, data completeness, agent gaps, peer approval status, and private valuation support, not fabricated banker judgment.

## Banker Valuation Workbench

When public quote data or source metrics are unavailable, users can enter explicit banker/client-approved valuation drivers such as offer price, diluted shares, equity value, enterprise value, net debt, revenue, EBITDA, net income, and book equity. The workbench calculates implied multiples separately from public-source outputs and labels them as banker inputs.

## Deploy On Render

1. Push this folder to a GitHub repository.
2. In Render, create a new Web Service from that repository.
3. Render can read `render.yaml`, or you can enter these manually:
   - Build command: `npm install`
   - Start command: `npm start`
   - Health check path: `/api/health`
4. `render.yaml` declares a production-safe SEC User-Agent for the deployed service:
   - `SEC_USER_AGENT=IB Deal Triage Pitch Memo Studio/1.0 (https://github.com/OAOWOuO/IB-Deal-Triage-Pitch-Memo-Studio; contact=OAOWOuO)`

To override it with a personal or company contact in Render, open the service, go to **Environment**, add or edit `SEC_USER_AGENT`, and redeploy. SEC asks automated clients to declare a User-Agent with contact information so EDGAR can preserve fair access and identify excessive traffic.

The server binds to `0.0.0.0` and uses Render's `PORT` environment variable when deployed. Locally, it binds to `127.0.0.1` and opens at `http://127.0.0.1:4173`.

The production Render service is connected to the `main` branch with Auto-Deploy set to `On Commit`.

## Data Policy

- SEC EDGAR submissions API: company identity and recent filing metadata.
- SEC EDGAR companyfacts API: XBRL-tagged financial facts.
- Public quote feed: used only to derive market cap and market-based multiples when available.
- Acquirer / buyer lens: optional public-company buyer packet for buyer-side triage, capacity screens, and deal-party context.
- Suggested peer screen: when banker-approved peers are not entered, the app can generate a preliminary SEC directory-based peer universe that must be approved before use.
- Private target mode: uses banker/client-provided materials entered by the user, such as CIM, management accounts, QoE, lender model, board materials, or data room extracts.
- Multi-agent memo workstreams: role-based deterministic analysis over the same sourced public or banker-provided deal packet.
- Harness gates: validates source basis, filing availability, quote/valuation traceability, peer explicitness, and assumption suppression.
- Product QA Agent: `/api/self-test` checks product thesis, private-target support, absence of company shortcuts, harness availability, and SEC configuration.
- No fabricated company data, preloaded company shortcuts, preset comps, DCF model inputs, LBO model inputs, control premiums, or invented buyer lists.
- Missing public data is shown as unavailable and becomes a diligence/control gap.
- SEC rate-limit resilience: the server retries 429 responses, persists a local SEC ticker-directory cache after successful calls, and can use local SEC CIK reference fallbacks for common tickers when the ticker directory is temporarily unavailable.

This tool is a public-data analytical workpaper. It is not investment, legal, tax, accounting, or regulatory advice.
