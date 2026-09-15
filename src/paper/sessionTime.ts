export type SessionClock = {
  status: string;
  elapsedSeconds: number;
  plannedSeconds: number;
  lastResumedAt: number | null;
};
export function elapsedSeconds(session: SessionClock, now = Date.now()) {
  return Math.min(
    session.plannedSeconds,
    session.elapsedSeconds +
      (session.status === "running" && session.lastResumedAt != null
        ? Math.max(0, Math.floor((now - session.lastResumedAt) / 1000))
        : 0),
  );
}
export const clock = (seconds: number) =>
  `${String(Math.floor(Math.max(0, seconds) / 60)).padStart(2, "0")}:${String(Math.floor(Math.max(0, seconds) % 60)).padStart(2, "0")}`;
