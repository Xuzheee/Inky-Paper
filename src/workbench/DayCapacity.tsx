import { useEffect, useState } from "react";
import type { State } from "../paper/paperTypes";
import { paper, getError, clock } from "./model";
import { usePlanRequest } from "./usePlanRequest";
import "./context.css";

type Capacity = {
  availableMinutes: number | null;
  reservedMinutes: number;
  unestimatedCount: number;
  calendarOccupiedMinutes: number;
  overlapPairs: { first: string; second: string }[];
  unavailableConflicts: {
    itemId: string;
    startMinute: number;
    endMinute: number;
  }[];
  overBudget: boolean | null;
  fullyEstimated: boolean;
};
const minute = (text: string) => {
  const [h, m] = text.split(":").map(Number);
  return h * 60 + m;
};
export default function DayCapacity({
  state,
  date,
  scope,
  onSaved,
  onDiscuss,
}: {
  state: State;
  date: string;
  scope: string;
  onSaved: () => void;
  onDiscuss: (text: string) => void;
}) {
  const constraint = state.planning?.context?.days.find((d) => d.date === date);
  const key = `inky-wb-${scope}-day-${date}`;
  const [draft, setDraft] = useState(() => {
    const initial = {
      revision: constraint?.revision || 0,
      available: constraint?.availableMinutes?.toString() ?? "",
      intervals: (constraint?.unavailable || []).map((i) => ({
        start: clock(i.startMinute),
        end: i.endMinute === 1440 ? "24:00" : clock(i.endMinute),
      })),
    };
    try {
      return (
        (JSON.parse(localStorage.getItem(key) || "null") as typeof initial) ||
        initial
      );
    } catch {
      return initial;
    }
  });
  const [capacity, setCapacity] = useState<Capacity>();
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const request = usePlanRequest(`${key}-request`);
  useEffect(() => {
    let stale = false;
    void paper("get_day_capacity", { date })
      .then((r) => {
        if (!stale) setCapacity(r.capacity as Capacity);
      })
      .catch((e) => {
        if (!stale) setError(getError(e));
      });
    return () => {
      stale = true;
    };
  }, [state, date]);
  const update = (next: typeof draft) => {
    try {
      localStorage.setItem(key, JSON.stringify(next));
      setDraft(next);
      setError("");
    } catch {
      setError("草稿未能保存，请检查本地存储后重试。");
    }
  };
  const conflict = draft.revision !== (constraint?.revision || 0);
  const save = async () => {
    setBusy(true);
    setError("");
    try {
      const result =
        request.pending && !request.definitiveFailure
          ? await request.retry()
          : await request.submit("save_day_constraints", {
              date,
              expectedRevision: draft.revision,
              availableMinutes:
                draft.available === "" ? null : Number(draft.available),
              unavailable: draft.intervals.map((i) => ({
                startMinute: minute(i.start),
                endMinute: minute(i.end),
              })),
            });
      localStorage.removeItem(key);
      setDraft({
        ...draft,
        revision: (result.constraints as { revision: number }).revision,
      });
      setEditing(false);
      onSaved();
    } catch (e) {
      setError(getError(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <details className="wk-context wk-capacity">
      <summary>
        {date} · 全日预留 {capacity?.reservedMinutes ?? "…"} 分钟
        {capacity?.unestimatedCount
          ? ` · ${capacity.unestimatedCount} 项未估计`
          : ""}
        {capacity?.overBudget ? " · 超出预算" : ""}
        {capacity &&
        capacity.overlapPairs.length + capacity.unavailableConflicts.length > 0
          ? " · 有时间冲突"
          : ""}
      </summary>
      <p>
        可投入{" "}
        {capacity?.availableMinutes == null
          ? "未填写"
          : `${capacity.availableMinutes} 分钟`}{" "}
        · 日历占用 {capacity?.calendarOccupiedMinutes ?? 0} 分钟
      </p>
      <p className="muted">
        预留是计划投入；首轮时长不计作总工时。
        {capacity &&
          !capacity.fullyEstimated &&
          "仍有未估计事项，无法判断是否全部放得下。"}
      </p>
      {capacity?.overlapPairs.map((pair) => (
        <p key={`${pair.first}-${pair.second}`} className="wk-error">
          日程重叠：
          {[pair.first, pair.second]
            .map(
              (id) =>
                state.planning?.steps.find(
                  (s) =>
                    s.id ===
                    state.planning?.dayItems.find((i) => i.id === id)?.stepId,
                )?.text || "安排",
            )
            .join(" / ")}
        </p>
      ))}
      {!!capacity?.unavailableConflicts.length && (
        <p className="wk-error">
          {capacity.unavailableConflicts.length} 条安排占用了明确的不可用时间。
        </p>
      )}
      <div className="wk-context-actions">
        <button onClick={() => setEditing(!editing)}>
          {editing ? "收起编辑" : "自己调整"}
        </button>
        <button
          onClick={() =>
            onDiscuss(
              `请根据 ${date} 的可投入时间、预留和冲突，帮我取舍已有安排。先提出候选。`,
            )
          }
        >
          请 Coach 帮我取舍
        </button>
      </div>
      {(editing || request.pending) && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <fieldset
            disabled={busy || (!!request.pending && !request.definitiveFailure)}
          >
            <label>
              当天可投入分钟（可不填）
              <input
                type="number"
                min="0"
                max="1440"
                value={draft.available}
                onChange={(e) =>
                  update({ ...draft, available: e.target.value })
                }
              />
            </label>
            <p>不可用时间（可不填）</p>
            {draft.intervals.map((interval, index) => (
              <div key={index} className="wk-context-actions">
                <label>
                  开始
                  <input
                    aria-label={`不可用开始 ${index + 1}`}
                    type="time"
                    value={interval.start}
                    onChange={(e) =>
                      update({
                        ...draft,
                        intervals: draft.intervals.map((v, i) =>
                          i === index ? { ...v, start: e.target.value } : v,
                        ),
                      })
                    }
                  />
                </label>
                <label>
                  结束
                  <input
                    aria-label={`不可用结束 ${index + 1}`}
                    type="text"
                    inputMode="numeric"
                    pattern="(?:[01][0-9]|2[0-3]):[0-5][0-9]|24:00"
                    placeholder="18:00"
                    value={interval.end}
                    onChange={(e) =>
                      update({
                        ...draft,
                        intervals: draft.intervals.map((v, i) =>
                          i === index ? { ...v, end: e.target.value } : v,
                        ),
                      })
                    }
                  />
                </label>
                <button
                  type="button"
                  onClick={() =>
                    update({
                      ...draft,
                      intervals: draft.intervals.filter((_, i) => i !== index),
                    })
                  }
                >
                  移除
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() =>
                update({
                  ...draft,
                  intervals: [
                    ...draft.intervals,
                    { start: "12:00", end: "13:00" },
                  ],
                })
              }
            >
              添加不可用时间
            </button>
          </fieldset>
          {conflict && (
            <p className="wk-error">
              当天约束已有更新，草稿保留。
              <button
                type="button"
                disabled={busy || (!!request.pending && !request.definitiveFailure)}
                onClick={() => {
                  request.discardDefinitiveFailure();
                  update({ ...draft, revision: constraint?.revision || 0 });
                }}
              >
                已核对，以当前版本保存草稿
              </button>
            </p>
          )}
          <button
            className="wk-primary"
            disabled={
              busy ||
              !request.ready ||
              (conflict && (!request.pending || request.definitiveFailure))
            }
          >
            {request.pending && !request.definitiveFailure
              ? "核实并重试"
              : "保存当天约束"}
          </button>
        </form>
      )}
      {(error || request.storageError) && (
        <p className="wk-error" role="alert">
          {error || request.storageError}
        </p>
      )}
    </details>
  );
}
