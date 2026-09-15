import { describe, it, expect } from "vitest";
import { calendarLanes, Row, shiftDay } from "./model";
const row = (id: string, start: number, duration: number) =>
  ({ item: { id, startMinute: start, durationMinutes: duration } }) as Row;
describe("calendar layout", () => {
  it("keeps a chain of overlaps in consistent columns and releases them after the group", () => {
    const l = calendarLanes([
      row("a", 540, 60),
      row("b", 570, 60),
      row("c", 600, 60),
      row("d", 660, 60),
    ]);
    expect(l.get("a")).toEqual({ lane: 0, count: 2 });
    expect(l.get("b")).toEqual({ lane: 1, count: 2 });
    expect(l.get("c")).toEqual({ lane: 0, count: 2 });
    expect(l.get("d")).toEqual({ lane: 0, count: 1 });
  });
  it("separates tiny adjacent hit targets and navigates month/year boundaries", () => {
    const l = calendarLanes([row("a", 540, 1), row("b", 542, 1)]);
    expect(l.get("a")?.count).toBe(2);
    expect(l.get("b")?.lane).toBe(1);
    expect(shiftDay("2026-12-31", 1)).toBe("2027-01-01");
    expect(shiftDay("2028-02-28", 1)).toBe("2028-02-29");
  });
});
