import { describe, expect, it } from "vitest";
import { regexEngineCreate, regexEngineLookup } from "~/utils/regexEngine";

describe("regex engine", () => {
  it("performs dictionary-backed replacements", () => {
    const dictionary = [{ find: "Fire", replace: "ไฟ" }];

    expect(regexEngineLookup("Fire", dictionary).replace).toBe("ไฟ");
  });

  it("creates captures for unmatched regex fragments", () => {
    const result = regexEngineCreate("Adds Fire Damage", [{ find: "Fire", replace: "ไฟ" }]);

    expect(result.find).toBe("Adds \\b(.+)\\b Damage");
    expect(result.replace).toBe("Adds $1 Damage");
  });
});
