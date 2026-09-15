import { describe, expect, it } from "vitest";
import { elapsedSeconds } from "./sessionTime";
describe("recorded clock time", () => {
  const clock = {
    status: "running",
    elapsedSeconds: 10,
    plannedSeconds: 60,
    lastResumedAt: 1000,
  };
  it("includes the current running interval and caps at its planned duration", () => {
    expect(elapsedSeconds(clock, 12500)).toBe(21);
    expect(elapsedSeconds(clock, 90000)).toBe(60);
  });
  it("does not infer time while paused or when the system clock moves backwards", () => {
    expect(elapsedSeconds({ ...clock, status: "paused" }, 12500)).toBe(10);
    expect(elapsedSeconds(clock, 0)).toBe(10);
  });
});
