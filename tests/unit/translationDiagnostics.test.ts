import { describe, expect, it } from "vitest";
import { analyze } from "~/utils/translationDiagnostics";

describe("translation diagnostics", () => {
  it("detects bracket/tag errors and whitespace warnings", () => {
    const result = analyze(" [Fire|Fire  ");

    expect(result.errorCount).toBeGreaterThan(0);
    expect(result.warningCount).toBeGreaterThan(0);
    expect(result.diagnostics.map((item) => item.code)).toContain("missing-closing-tag");
  });
});
