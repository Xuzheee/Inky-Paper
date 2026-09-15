import { useEffect, useState } from "react";
import type { DailyRecord } from "./dailyRecord";
import { getError, paper, parseDate } from "./model";

export type DayEntry = {
  record?: DailyRecord;
  error?: string;
  loading?: boolean;
};
export function useDailyRecords(dates: string[], refreshKey: number) {
  const [entries, setEntries] = useState<Record<string, DayEntry>>({});
  const datesKey = dates.join(",");
  useEffect(() => {
    let disposed = false,
      pending = false;
    const selectedDates = datesKey.split(",");
    const refresh = async () => {
      if (pending) return;
      pending = true;
      const pairs = await Promise.all(
        selectedDates.map(async (date) => {
          try {
            const record = await paper<DailyRecord>("get_daily_record", {
              date,
              utcOffsetMinutes: -parseDate(date).getTimezoneOffset(),
            });
            return [date, { record }] as const;
          } catch (e) {
            return [date, { error: getError(e) }] as const;
          }
        }),
      );
      if (!disposed) setEntries(Object.fromEntries(pairs));
      pending = false;
    };
    setEntries((old) =>
      Object.fromEntries(
        selectedDates.map((d) => [d, { ...old[d], loading: true }]),
      ),
    );
    void refresh();
    const visibleRefresh = () => {
      if (document.visibilityState !== "hidden") void refresh();
    };
    const timer = window.setInterval(visibleRefresh, 15_000);
    window.addEventListener("focus", visibleRefresh);
    return () => {
      disposed = true;
      clearInterval(timer);
      window.removeEventListener("focus", visibleRefresh);
    };
  }, [datesKey, refreshKey]);
  return entries;
}
