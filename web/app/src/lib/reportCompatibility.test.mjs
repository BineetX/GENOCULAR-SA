import assert from "node:assert/strict";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { needsReportCookieFallback, REPORT_COOKIE_FALLBACK } from "./reportCompatibility.js";

test("compatibility applies only to QUAST HTML reports", () => {
  assert.equal(needsReportCookieFallback("job/MAG_shortread_results/quast/sample/report.html"), true);
  assert.equal(needsReportCookieFallback("job/analysis/reports/sample_gtdbtk_krona.html"), false);
});

test("sandbox cookies are isolated in memory and support saved order and expiry", () => {
  const document = {};
  Object.defineProperty(document, "cookie", { configurable: true, get() { throw new Error("Sandboxed"); } });
  runInNewContext(REPORT_COOKIE_FALLBACK, { document });
  assert.equal(document.cookie, "");
  document.cookie = "order=1 0; path=/";
  assert.equal(document.cookie, "order=1 0");
  document.cookie = "order=; expires=Thu, 01 Jan 1970 00:00:00 GMT";
  assert.equal(document.cookie, "");
});

test("ordinary cookie access is not modified", () => {
  const document = { cookie: "native=value" };
  runInNewContext(REPORT_COOKIE_FALLBACK, { document });
  assert.equal(document.cookie, "native=value");
  assert.equal(Object.getOwnPropertyDescriptor(document, "cookie").get, undefined);
});
