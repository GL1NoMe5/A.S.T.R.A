"use strict";

// Public report contract and rendering regressions. Run: node --test tests/report.test.cjs
// The small DOM double throws on HTML injection; browser layout is checked separately.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const reportDir = path.join(root, "app/static/report");
const source = fs.readFileSync(path.join(reportDir, "report.js"), "utf8");
const html = fs.readFileSync(path.join(reportDir, "report.html"), "utf8");
const sample = JSON.parse(fs.readFileSync(path.join(root, "examples/optimization.sample.json"), "utf8"));
const cloneSample = () => structuredClone(sample);

class ElementDouble {
  constructor(tagName, ownerDocument) {
    this.tagName = tagName.toUpperCase();
    this.ownerDocument = ownerDocument;
    this.children = [];
    this.attributes = {};
    this.listeners = new Map();
    this.hidden = false;
    this.disabled = false;
    this._text = "";
    const classes = new Set();
    this.classList = { add: (...names) => names.forEach((x) => classes.add(x)),
      remove: (...names) => names.forEach((x) => classes.delete(x)), contains: (name) => classes.has(name) };
  }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return this._text + this.children.map((child) => child.textContent).join(""); }
  set innerHTML(_) { throw new Error("Report must not render user JSON via innerHTML"); }
  get firstChild() { return this.children[0] || null; }
  appendChild(child) { this.children.push(child); return child; }
  removeChild(child) { this.children.splice(this.children.indexOf(child), 1); return child; }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  getAttribute(key) { return this.attributes[key] ?? null; }
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  click() { this.listeners.get("click")?.({ preventDefault() {} }); }
}

function bootReport({ search = "", hash = "", snapshot = null, storageError = false } = {}) {
  const nodes = new Map();
  const docMock = {
    getElementById(id) { return nodes.get(id) || null; },
    createElement(tagName) { return new ElementDouble(tagName, docMock); },
    createElementNS(_ns, tagName) { return new ElementDouble(tagName, docMock); },
  };
  for (const match of html.matchAll(/\bid="([^"]+)"/g)) {
    nodes.set(match[1], new ElementDouble("div", docMock));
  }
  nodes.get("print-btn").disabled = true;
  nodes.get("report-document").hidden = true;
  const stats = { parseCalls: 0, printCalls: 0, replacedUrls: [] };
  const pageUrl = new URL(`http://127.0.0.1:8010/static/report/report.html${search}${hash}`);
  const winMock = {
    print() { stats.printCalls += 1; },
    location: { protocol: search ? "http:" : "file:", search, hash, href: pageUrl.href },
    history: { replaceState(_state, _title, relativeUrl) {
      const updated = new URL(relativeUrl, winMock.location.href);
      stats.replacedUrls.push(relativeUrl);
      Object.assign(winMock.location, { protocol: updated.protocol, search: updated.search, hash: updated.hash, href: updated.href });
    } },
    sessionStorage: { getItem(key) {
      if (storageError) throw new Error("Storage is unavailable");
      return key === "astra:report:current" ? snapshot : null;
    } },
  };
  const context = vm.createContext({
    document: docMock,
    window: winMock,
    module: { exports: {} },
    TextEncoder,
    URL,
    URLSearchParams,
    console,
    JSON: { ...JSON, parse(text) { stats.parseCalls += 1; return JSON.parse(text); }, stringify: JSON.stringify },
  });
  vm.runInContext(source, context, { filename: "report.js" });
  assert.ok(winMock.AstraReport, "The report must expose its browser loading API");
  return { ...context.module.exports, api: winMock.AstraReport, docMock, nodes, stats, winMock };
}

async function chooseJsonFile(report, text, name = "manual.json") {
  const input = report.nodes.get("json-file-input");
  input.files = [{ name, size: Buffer.byteLength(text, "utf8"), async text() { return text; } }];
  input.listeners.get("change")();
  await new Promise(setImmediate);
}

function allDescendants(node) {
  return node.children.flatMap((child) => [child, ...allDescendants(child)]);
}

function assertRejectedMutation(mutate, expectedField) {
  const data = cloneSample();
  mutate(data);
  const result = bootReport().validateReportData(data);
  assert.equal(result.valid, false, `${expectedField} must be rejected`);
  assert.ok(result.errors.some((message) => message.includes(expectedField)), result.errors.join("\n"));
}

test("the real optimizer JSON satisfies the report contract", () => {
  const report = bootReport();
  const result = report.validateReportData(sample);
  assert.equal(result.valid, true, result.errors.join("\n"));
  assert.equal(report.api.loadJsonText(JSON.stringify(sample), "optimization.sample.json"), true);
  assert.equal(report.nodes.get("print-btn").disabled, false);
  assert.equal(report.nodes.get("report-document").hidden, false);
});

test("dashboard navigation automatically renders exactly the stored calculation", () => {
  const data = cloneSample();
  data.run_id = "specific-calculation-opened-by-dashboard";
  data.costs.first_year_total = 456789;
  const report = bootReport({ search: "?source=dashboard", snapshot: JSON.stringify(data) });
  assert.equal(report.nodes.get("meta-run-id").textContent, data.run_id);
  assert.equal(report.nodes.get("cost-first-year").textContent.replace(/\D/g, ""), "456789");
  assert.equal(report.nodes.get("print-btn").disabled, false);
  assert.equal(report.nodes.get("report-document").hidden, false);
  assert.equal(report.nodes.get("dashboard-link").hidden, false);
  assert.match(report.nodes.get("loaded-file-badge").textContent, /Расчёт из дашборда/);
});

test("missing or blocked dashboard storage leaves manual import available with print disabled", () => {
  for (const options of [{ snapshot: null }, { storageError: true }]) {
    const report = bootReport({ search: "?source=dashboard", ...options });
    assert.equal(report.nodes.get("print-btn").disabled, true);
    assert.equal(report.nodes.get("report-document").hidden, true);
    assert.equal(report.nodes.get("error-panel").hidden, false);
    assert.match(report.nodes.get("error-list").textContent, /JSON/);
    assert.equal(report.api.loadJsonText(JSON.stringify(sample), "manual.json"), true);
    assert.equal(report.nodes.get("print-btn").disabled, false);
  }
});

test("the stored snapshot is ignored unless navigation explicitly requests the dashboard source", () => {
  for (const search of ["", "?source=other"]) {
    const report = bootReport({ search, snapshot: JSON.stringify(sample) });
    assert.equal(report.stats.parseCalls, 0);
    assert.equal(report.nodes.get("print-btn").disabled, true);
    assert.equal(report.nodes.get("report-document").hidden, true);
  }
});

test("manual JSON replaces dashboard data and removes only the auto-load source flag", async () => {
  const report = bootReport({ search: "?source=dashboard&layout=compact", hash: "#costs", snapshot: JSON.stringify(sample) });
  const manual = cloneSample();
  manual.run_id = "manual-replacement-calculation";
  manual.costs.first_year_total = 987654;
  await chooseJsonFile(report, JSON.stringify(manual), "replacement.json");
  assert.equal(report.nodes.get("meta-run-id").textContent, manual.run_id);
  assert.equal(report.nodes.get("cost-first-year").textContent.replace(/\D/g, ""), "987654");
  assert.equal(report.nodes.get("print-btn").disabled, false);
  assert.deepEqual(report.stats.replacedUrls, ["/static/report/report.html?layout=compact#costs"]);
  const refreshed = bootReport({ search: report.winMock.location.search, hash: report.winMock.location.hash, snapshot: JSON.stringify(sample) });
  assert.equal(refreshed.stats.parseCalls, 0, "Refresh must not silently restore the older dashboard calculation");
  assert.equal(refreshed.nodes.get("report-document").hidden, true);
});

test("a rejected manual file does not remove the dashboard source flag", async () => {
  const report = bootReport({ search: "?source=dashboard&layout=compact", hash: "#costs", snapshot: JSON.stringify(sample) });
  await chooseJsonFile(report, "{invalid JSON");
  assert.deepEqual(report.stats.replacedUrls, []);
  assert.equal(report.winMock.location.search, "?source=dashboard&layout=compact");
  assert.equal(report.winMock.location.hash, "#costs");
  assert.equal(report.nodes.get("print-btn").disabled, true);
  assert.equal(report.nodes.get("error-panel").hidden, false);
});

test("invalid roots, required sections and numeric types are rejected", () => {
  const report = bootReport();
  for (const invalid of [null, [], "calculation", 12, true]) {
    assert.equal(report.validateReportData(invalid).valid, false);
  }
  assertRejectedMutation((data) => { delete data.request; }, "request");
  assertRejectedMutation((data) => { data.costs.first_year_total = "34800000"; }, "costs.first_year_total");
  assertRejectedMutation((data) => { data.zones[0].trees = 1.5; }, "zones[0].trees");
  assertRejectedMutation((data) => { data.summary.pm25_after = Infinity; }, "summary.pm25_after");
  assertRejectedMutation((data) => { data.summary.cooling_c = NaN; }, "summary.cooling_c");
});

test("invalid coordinates, sensitivity ranges and calendar dates are rejected", () => {
  assertRejectedMutation((data) => { data.zones[0].latitude = 90.1; }, "zones[0].latitude");
  assertRejectedMutation((data) => { data.summary.cooling_c_range = [2, 1]; }, "summary.cooling_c_range");
  assertRejectedMutation((data) => { data.summary.pm25_reduction_range = [-1, 2]; }, "summary.pm25_reduction_range");
  assertRejectedMutation((data) => { data.created_at = "2026-02-30T12:00:00Z"; }, "created_at");
  assertRejectedMutation((data) => { data.background.air.source_time = "2026-10-24T25:00:00Z"; }, "background.air.source_time");
});

test("background values reject numeric strings, objects, arrays and nonfinite numbers", () => {
  for (const invalid of ["4.7", {}, [], true, null, NaN, Infinity]) {
    assertRejectedMutation((data) => { data.background.air.values.pm25 = invalid; }, "background.air.values.pm25");
  }
  for (const invalid of ["3.39", { value: 3.39 }, [3.39]]) {
    assertRejectedMutation((data) => { data.background.weather.values.wind_speed = invalid; }, "background.weather.values.wind_speed");
  }
});

test("default and cached backgrounds permit missing European AQI without inventing a number", () => {
  const report = bootReport();
  const data = cloneSample();
  data.background.air.status = "default";
  data.background.air.source_time = null;
  data.background.air.fetched_at = null;
  data.background.air.values.european_aqi = null;
  data.background.weather.status = "cached";
  assert.equal(report.validateReportData(data).valid, true);
  report.renderReportDom(data, report.docMock);
  assert.match(report.nodes.get("bg-air-status").textContent, /Резервный/);
  assert.match(report.nodes.get("bg-weather-status").textContent, /Кэш/);
  assert.doesNotMatch(report.nodes.get("bg-air-values").textContent, /AQI/);
});

test("missing background channels render explicit fallback status", () => {
  const report = bootReport();
  const data = cloneSample();
  data.background = {};
  assert.equal(report.api.loadJsonText(JSON.stringify(data), "missing-channels.json"), true);
  for (const channel of ["air", "weather"]) {
    assert.match(report.nodes.get(`bg-${channel}-status`).textContent, /Резервный/);
    assert.match(report.nodes.get(`bg-${channel}-values`).textContent, /отсутствует/);
    assert.match(report.nodes.get(`bg-${channel}-source-time`).textContent, /Не указано/);
  }
});

test("public loader enforces actual UTF-8 bytes before parsing despite forged size", () => {
  const report = bootReport();
  // Fewer than 5 Mi characters, but more than 5 MiB in UTF-8; deliberately invalid JSON.
  const oversized = "я".repeat(report.MAX_FILE_BYTES / 2 + 1);
  assert.ok(oversized.length < report.MAX_FILE_BYTES);
  assert.equal(report.api.loadJsonText(oversized, "large.json", 1), false);
  assert.equal(report.stats.parseCalls, 0, "Oversize rejection must precede JSON.parse");
  assert.match(report.nodes.get("error-summary").textContent, /размер/i);
  assert.equal(report.nodes.get("print-btn").disabled, true);
});

test("public loader accepts a valid JSON exactly at the UTF-8 size limit", () => {
  const report = bootReport();
  const data = cloneSample();
  data.note = "";
  const padding = report.MAX_FILE_BYTES - Buffer.byteLength(JSON.stringify(data), "utf8");
  data.note = "я".repeat(Math.floor(padding / 2)) + (padding % 2 ? "x" : "");
  const text = JSON.stringify(data);
  assert.equal(Buffer.byteLength(text, "utf8"), report.MAX_FILE_BYTES);
  assert.equal(report.api.loadJsonText(text, "boundary.json", 0), true);
  assert.equal(report.nodes.get("print-btn").disabled, false);
  assert.match(report.nodes.get("loaded-file-badge").textContent, /5120/);
});

test("a failed load clears the previous printable report and suppresses print", () => {
  const report = bootReport();
  assert.equal(report.api.loadJsonText(JSON.stringify(sample), "valid.json"), true);
  report.nodes.get("print-btn").click();
  assert.equal(report.stats.printCalls, 1);
  for (const badText of ["{broken", "null", JSON.stringify({ run_id: "incomplete" })]) {
    assert.equal(report.api.loadJsonText(badText, "invalid.json"), false);
    assert.equal(report.nodes.get("print-btn").disabled, true);
    assert.equal(report.nodes.get("report-document").hidden, true);
    assert.equal(report.nodes.get("loaded-file-badge").hidden, true);
    assert.equal(report.nodes.get("error-panel").hidden, false);
    report.nodes.get("print-btn").click();
    assert.equal(report.stats.printCalls, 1);
  }
});

test("sample rendering preserves supplied costs, zero cooling and UTC+5 date", () => {
  const report = bootReport();
  report.renderReportDom(sample, report.docMock);
  const digits = (id) => report.nodes.get(id).textContent.replace(/\D/g, "");
  assert.equal(digits("cost-first-year"), "34800000");
  assert.equal(digits("cost-horizon"), "72600000");
  assert.equal(digits("rate-sapling"), "20000");
  assert.equal(report.nodes.get("eco-cooling-main").textContent, "0,00 °C");
  assert.match(report.nodes.get("eco-cooling-note").textContent, /Нулевое/);
  assert.match(report.nodes.get("meta-created-at").textContent, /25\.10\.2026.*01:03.*UTC\+5/);
  assert.equal(report.nodes.get("zones-tbody").children.length, sample.zones.length);
});

test("an empty allocation with zero costs remains a valid readable report", () => {
  const report = bootReport();
  const data = cloneSample();
  data.zones = [];
  data.used_trees = 0;
  data.unused_trees = data.request.budget_trees;
  data.background = null;
  data.methodology.sources = [];
  for (const key of Object.keys(data.costs)) {
    if (typeof data.costs[key] === "number") data.costs[key] = 0;
  }
  for (const key of Object.keys(data.request)) {
    if (key.endsWith("_kzt")) data.request[key] = 0;
  }
  for (const key of Object.keys(data.summary)) {
    if (typeof data.summary[key] === "number") data.summary[key] = 0;
    if (Array.isArray(data.summary[key])) data.summary[key] = [0, 0];
  }
  assert.equal(report.validateReportData(data).valid, true);
  report.renderReportDom(data, report.docMock);
  assert.equal(report.nodes.get("zones-empty").hidden, false);
  assert.equal(report.nodes.get("zones-table-wrapper").hidden, true);
  assert.equal(report.nodes.get("cost-first-year").textContent, "0 тенге");
  assert.equal(report.nodes.get("eco-pm25-main").textContent, "0,00 мкг/м³");
  assert.match(report.nodes.get("meth-sources-list").textContent, /не приложены/);
});

test("user strings remain literal text and only HTTP(S) sources become links", () => {
  const report = bootReport();
  const data = cloneSample();
  const injection = '<img src=x onerror="globalThis.injected=true">';
  data.note = injection;
  data.zones[0].name = injection;
  data.methodology.sources = ["javascript:alert(1)", "data:text/html,unsafe", injection, "https://example.org/source"];
  assert.equal(report.api.loadJsonText(JSON.stringify(data), injection), true);
  assert.equal(report.nodes.get("dec-model-note").textContent, injection);
  assert.ok(report.nodes.get("zones-tbody").textContent.includes(injection));
  const descendants = [...report.nodes.values()].flatMap(allDescendants);
  assert.equal(descendants.some((node) => ["SCRIPT", "IMG"].includes(node.tagName)), false);
  const links = allDescendants(report.nodes.get("meth-sources-list")).filter((node) => node.tagName === "A");
  assert.equal(links.length, 1);
  assert.equal(links[0].href, "https://example.org/source");
  assert.equal(links[0].rel, "noopener noreferrer");
});
