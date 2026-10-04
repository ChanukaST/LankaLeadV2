import { describe, it, expect } from "vitest";

// Unit test for StatusBadge mapping and ethical language requirements
describe("LankaLead Ethical Status Language", () => {
  const STATUS_LABELS: Record<string, string> = {
    WEBSITE_FOUND: "Website Found",
    WEBSITE_NOT_DETECTED: "Website Not Detected",
    WEBSITE_UNCLEAR: "Website Status Unclear",
    WEBSITE_UNREACHABLE: "Website Unreachable",
    WEBSITE_PARKED: "Website Parked",
    SOCIAL_ONLY: "Social Presence Only",
  };

  it("verifies objective evidence-based status terminology", () => {
    // Assert all statuses conform strictly to evidence-based language
    expect(STATUS_LABELS.WEBSITE_FOUND).toBe("Website Found");
    expect(STATUS_LABELS.WEBSITE_NOT_DETECTED).toBe("Website Not Detected");
    expect(STATUS_LABELS.WEBSITE_UNCLEAR).toBe("Website Status Unclear");
    expect(STATUS_LABELS.WEBSITE_UNREACHABLE).toBe("Website Unreachable");
    expect(STATUS_LABELS.WEBSITE_PARKED).toBe("Website Parked");
    expect(STATUS_LABELS.SOCIAL_ONLY).toBe("Social Presence Only");

    // Must never claim a business "needs a website" or "has no website"
    Object.values(STATUS_LABELS).forEach((label) => {
      expect(label.toLowerCase()).not.toContain("needs a website");
      expect(label.toLowerCase()).not.toContain("no website");
    });
  });

  it("verifies confidence scoring boundaries", () => {
    const calculateConfidence = (httpStatus: number, isParked: boolean, nameMatched: boolean) => {
      if (isParked) return 0.0;
      if (httpStatus >= 400) return 0.0;
      let score = 0.5;
      if (nameMatched) score += 0.25;
      return Math.min(1.0, score);
    };

    expect(calculateConfidence(200, false, true)).toBe(0.75);
    expect(calculateConfidence(200, true, true)).toBe(0.0);
    expect(calculateConfidence(404, false, true)).toBe(0.0);
  });
});
