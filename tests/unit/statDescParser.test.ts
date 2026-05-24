import { describe, expect, it } from "vitest";
import { dummyFile1 } from "~/utils/dummyFiles";
import { descEncode, parseDesc } from "~/utils/statDescParser";

describe("stat description parser", () => {
  it("parses and re-encodes StatDescription text", () => {
    const desc = parseDesc("Metadata/test.txt", dummyFile1, "Thai");

    expect(desc).toBeTruthy();
    if (!desc) return;
    expect(desc.translations.English.length).toBeGreaterThan(0);
    expect(desc.translations.Thai.length).toBe(desc.translations.English.length);
    expect(descEncode(desc)).toBeInstanceOf(Uint8Array);
  });
});
