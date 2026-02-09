import { describe, expect, it } from "vitest";
import {
  distanceOnlyText,
  etaTimingClass,
  etaUnitText,
  etaValueText,
  walkingMinutesFromMiles,
} from "$lib/arrivals/formatting";

describe("arrivals formatting helpers", () => {
  it("computes walking time with base speed and 500ft penalty", () => {
    expect(walkingMinutesFromMiles(0.2, 2)).toBe(9);
  });

  it("formats short distances in feet", () => {
    expect(distanceOnlyText(0.21)).toBe("1109 ft");
  });

  it("returns eta timing classes for too-far, near, and normal cases", () => {
    expect(etaTimingClass(4, 5)).toBe("eta-too-far");
    expect(etaTimingClass(7, 5)).toBe("eta-near");
    expect(etaTimingClass(12, 5)).toBe("eta-normal");
  });

  it("formats eta values and units", () => {
    expect(etaValueText(0)).toBe("now");
    expect(etaValueText(8)).toBe("8");
    expect(etaUnitText(0)).toBe("");
    expect(etaUnitText(8)).toBe("min");
  });
});
