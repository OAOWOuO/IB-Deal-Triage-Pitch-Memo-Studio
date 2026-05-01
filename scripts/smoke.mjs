import { spawn } from "node:child_process";

const localPort = process.env.HARNESS_PORT || "4179";
const providedBaseUrl = process.env.BASE_URL;
const baseUrl = (providedBaseUrl || `http://127.0.0.1:${localPort}`).replace(/\/$/, "");
const liveTicker = (process.env.HARNESS_TICKER || "").trim();
const livePeers = (process.env.HARNESS_PEERS || "").trim();

let child;
const results = [];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function check(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`PASS ${name}`);
  } catch (error) {
    results.push({ name, ok: false, error: error.message || String(error) });
    console.error(`FAIL ${name}: ${error.message || String(error)}`);
  }
}

async function request(pathname) {
  const response = await fetch(`${baseUrl}${pathname}`);
  const contentType = response.headers.get("content-type") || "";
  const body = contentType.includes("application/json") ? await response.json() : await response.text();
  return { response, contentType, body };
}

async function waitForHealth() {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const { response, body } = await request("/api/health");
      if (response.ok && body && body.ok) return;
    } catch {
      // Server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Server did not become healthy at ${baseUrl}`);
}

function startLocalServer() {
  child = spawn(process.execPath, ["server.mjs"], {
    cwd: new URL("..", import.meta.url),
    env: {
      ...process.env,
      PORT: localPort,
      SEC_USER_AGENT: process.env.SEC_USER_AGENT || "IB Deal Studio harness local-check@example.com",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => process.stdout.write(chunk));
  child.stderr.on("data", (chunk) => process.stderr.write(chunk));
}

if (!providedBaseUrl) {
  startLocalServer();
}

try {
  await waitForHealth();

  await check("health endpoint", async () => {
    const { response, body } = await request("/api/health");
    assert(response.ok, "health endpoint did not return 200");
    assert(body.ok === true, "health payload did not include ok=true");
    if (providedBaseUrl) assert(body.secUserAgentConfigured === true, "deployed service should configure SEC_USER_AGENT");
  });

  await check("static shell", async () => {
    const { response, body, contentType } = await request("/");
    assert(response.ok, "root page did not return 200");
    assert(contentType.includes("text/html"), "root page is not HTML");
    assert(String(body).includes("IB Deal Triage & Pitch Memo Studio"), "root page title text not found");
  });

  await check("frontend assets", async () => {
    const js = await request("/app.js");
    const css = await request("/styles.css");
    assert(js.response.ok && js.contentType.includes("javascript"), "app.js did not return JavaScript");
    assert(css.response.ok && css.contentType.includes("text/css"), "styles.css did not return CSS");
  });

  await check("product self-test agent", async () => {
    const { response, body } = await request("/api/self-test");
    assert(response.ok, "self-test endpoint did not return 200");
    assert(body.agent && body.agent.role === "Product QA Agent", "self-test agent identity missing");
    assert(Array.isArray(body.checks) && body.checks.length >= 5, "self-test checks missing");
  });

  await check("missing ticker validation", async () => {
    const { response, body } = await request("/api/company?ticker=");
    assert(response.status === 400, "missing ticker should return 400");
    assert(body.error, "missing ticker response should include an error");
  });

  await check("invalid ticker controlled failure", async () => {
    const { response, body } = await request("/api/company?ticker=NOTAREALTICKER123");
    assert(response.status >= 400, "invalid ticker should not return success");
    assert(body.error, "invalid ticker response should include an error");
  });

  if (liveTicker) {
    await check("live company pipeline", async () => {
      const params = new URLSearchParams({ ticker: liveTicker, peers: livePeers });
      const { response, body } = await request(`/api/company?${params.toString()}`);
      assert(response.ok, "live company request failed");
      assert(body.profile && body.profile.cik, "profile.cik missing");
      assert(Array.isArray(body.filings), "filings should be an array");
      assert(Array.isArray(body.sources) && body.sources.some((source) => source.includes("SEC EDGAR")), "SEC source provenance missing");
      assert(body.quality && Number.isFinite(Number(body.quality.score)), "quality score missing");
      assert(Array.isArray(body.limitations) && body.limitations.length, "limitations missing");
      assert(Array.isArray(body.agents) && body.agents.length >= 5, "agent workstreams missing");
      assert(body.harness && Array.isArray(body.harness.gates), "harness gates missing");
    });
  } else {
    console.log("SKIP live company pipeline: set HARNESS_TICKER to exercise SEC/quote data.");
  }

  const failed = results.filter((result) => !result.ok);
  if (failed.length) {
    process.exitCode = 1;
  } else {
    console.log(`Harness passed ${results.length} checks against ${baseUrl}.`);
  }
} finally {
  if (child) child.kill();
}
