# IB Deal Triage & Pitch Memo Studio

This is a deal decision memo operating system: it turns a public or private acquisition target into an auditable triage memo by separating sourced facts, banker/client-provided inputs, unavailable assumptions, and review gates.

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

## Deploy On Render

1. Push this folder to a GitHub repository.
2. In Render, create a new Web Service from that repository.
3. Render can read `render.yaml`, or you can enter these manually:
   - Build command: `npm install`
   - Start command: `npm start`
   - Health check path: `/api/health`
4. Add an environment variable:
   - `SEC_USER_AGENT=Your Name your.email@example.com`

The server binds to `0.0.0.0` and uses Render's `PORT` environment variable when deployed. Locally, it binds to `127.0.0.1` and opens at `http://127.0.0.1:4173`.

## Data Policy

- SEC EDGAR submissions API: company identity and recent filing metadata.
- SEC EDGAR companyfacts API: XBRL-tagged financial facts.
- Public quote feed: used only to derive market cap and market-based multiples when available.
- Private target mode: uses banker/client-provided materials entered by the user, such as CIM, management accounts, QoE, lender model, board materials, or data room extracts.
- Multi-agent memo workstreams: role-based deterministic analysis over the same sourced public or banker-provided deal packet.
- Harness gates: validates source basis, filing availability, quote/valuation traceability, peer explicitness, and assumption suppression.
- Product QA Agent: `/api/self-test` checks product thesis, private-target support, absence of company shortcuts, harness availability, and SEC configuration.
- No fabricated company data, preloaded company shortcuts, preset comps, DCF model inputs, LBO model inputs, control premiums, or invented buyer lists.
- Missing public data is shown as unavailable and becomes a diligence/control gap.

This tool is a public-data analytical workpaper. It is not investment, legal, tax, accounting, or regulatory advice.
