import assert from "node:assert/strict";
import test from "node:test";
import { isRedundantAnalysisSection } from "./analysisRenderers.js";

test("only the redundant MetaPhlAn rank-abundance views are removed", () => {
  for (const renderer of ["mag_metaphlan_rank_v2", "metaphlan_rank_abundance"]) {
    assert.equal(isRedundantAnalysisSection({ renderer }), true);
    assert.equal(isRedundantAnalysisSection({ id: renderer }), true);
  }
  for (const renderer of ["read_alpha", "mag_metaphlan_alpha_v2", "mag_metaphlan_v2", "mag_rank_abundance", "gtdbtk_krona"]) {
    assert.equal(isRedundantAnalysisSection({ renderer }), false);
  }
});
