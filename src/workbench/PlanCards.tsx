import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Check, Pencil } from "lucide-react";
import { BatchData, Candidate, dateKey, getError, paper } from "./model";

export default function PlanCards({
  id,
  streaming,
  onSaved,
}: {
  id: string;
  streaming: boolean;
  onSaved: () => void;
}) {
  const storageKey = `inky-wb-plan-${id}`;
  const initial = () => {
    try {
      return JSON.parse(localStorage.getItem(storageKey) || "{}");
    } catch {
      return {};
    }
  };
  const [draft, setDraft] = useState<{
    selected?: string[];
    edits?: Record<string, { text: string; minutes: number }>;
    date?: string;
    order?: string[];
  }>(initial);
  const [data, setData] = useState<BatchData>();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [editing, setEditing] = useState<string>();
  const [reviewed, setReviewed] = useState(false);
  const [pending, setPending] = useState<Record<string, unknown> | null>(() => {
    try {
      return JSON.parse(
        localStorage.getItem(`${storageKey}-pending`) || "null",
      );
    } catch {
      return null;
    }
  });
  const update = (next: Partial<typeof draft>) =>
    setDraft((d) => {
      const n = { ...d, ...next };
      localStorage.setItem(storageKey, JSON.stringify(n));
      return n;
    });
  const load = () =>
    paper<BatchData>("get_plan_batch", { batchId: id })
      .then(setData)
      .catch((e) => setNotice(getError(e)));
  useEffect(() => {
    if (!streaming) void load();
  }, [id, streaming]);
  if (streaming)
    return <div className="wk-candidates muted">正在整理候选步骤…</div>;
  if (!data)
    return (
      <div className="wk-candidates">
        <p>{notice || "正在读取候选…"}</p>
        <button onClick={() => void load()}>重新读取</button>
      </div>
    );
  const selected =
    draft.selected ??
    (data.batch.cards.length === 1 ? [data.batch.cards[0].id] : []);
  const order = draft.order || data.batch.cards.map((c) => c.id);
  const cards = order
    .map((id) => data.batch.cards.find((c) => c.id === id))
    .filter(Boolean) as Candidate[];
  const date = draft.date || dateKey();
  const current = (c: Candidate) => ({
    task: data.tasks.find((t) => t.id === c.taskId),
    step: data.steps.find((s) => s.id === (c.adoptedStepId || c.stepId)),
  });
  const stale = cards.filter((c) => {
    const { task, step } = current(c);
    return (
      (task && task.revision !== c.expectedTaskRevision) ||
      (step && step.revision !== c.expectedStepRevision)
    );
  });
  const joined = (c: Candidate) =>
    data.dayItems.some(
      (i) =>
        !i.removedAt &&
        i.date === date &&
        i.stepId === (c.adoptedStepId || c.stepId),
    );
  const move = (id: string, n: number) => {
    const ids = [...order],
      i = ids.indexOf(id),
      to = i + n;
    if (to < 0 || to >= ids.length) return;
    [ids[i], ids[to]] = [ids[to], ids[i]];
    update({ order: ids });
  };
  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setNotice("");
    try {
      let payload = pending;
      if (!payload) {
        const chosen = cards.filter(
          (c) => selected.includes(c.id) && !joined(c),
        );
        if (!chosen.length) throw Error("请先选择要采用的步骤。");
        if (stale.some((c) => selected.includes(c.id)) && !reviewed)
          throw Error("请先核对下方最新内容。");
        payload = {
          requestId: crypto.randomUUID(),
          batchId: id,
          expectedRevision: data.batch.revision,
          date,
          cardIds: chosen.map((c) => c.id),
          cardOverrides: chosen.map((c) => {
            const edit = draft.edits?.[c.id],
              { task, step } = current(c);
            return {
              cardId: c.id,
              text: edit?.text ?? c.text,
              plannedSeconds: Math.round(
                (edit?.minutes ?? c.plannedSeconds / 60) * 60,
              ),
              expectedResult: c.expectedResult ?? null,
              ...(task
                ? {
                    expectedTaskRevision: reviewed
                      ? task.revision
                      : c.expectedTaskRevision,
                  }
                : {}),
              ...(step
                ? {
                    expectedStepRevision: reviewed
                      ? step.revision
                      : c.expectedStepRevision,
                  }
                : {}),
            };
          }),
        };
        setPending(payload);
        localStorage.setItem(`${storageKey}-pending`, JSON.stringify(payload));
      }
      await paper("adopt_plan_cards", payload);
      setPending(null);
      localStorage.removeItem(`${storageKey}-pending`);
      update({ selected: [] });
      setReviewed(false);
      setNotice("已加入计划，可以在 Inky 中选择并开始。");
      await load();
      onSaved();
    } catch (e) {
      const message = getError(e);
      setNotice(message);
      if (
        /^(CONFLICT|INVALID_INPUT|NOT_FOUND|ACTIVE_SESSION|ACTION_COMPLETED|TASK_COMPLETED)/.test(
          message,
        )
      ) {
        setPending(null);
        localStorage.removeItem(`${storageKey}-pending`);
        setReviewed(false);
        await load();
      }
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="wk-candidates" aria-label="Coach 候选计划">
      <div className="wk-candidate-head">
        <strong>建议的下一步</strong>
        <span>采用后加入计划</span>
      </div>
      {cards.map((c, index) => {
        const edit = draft.edits?.[c.id],
          { task, step } = current(c),
          done = task?.completed || step?.completed,
          added = joined(c);
        return (
          <article key={c.id}>
            <div className="wk-candidate-row">
              <label>
                <input
                  type="checkbox"
                  checked={selected.includes(c.id) && !added}
                  disabled={busy || !!pending || !!done || added}
                  onChange={(e) =>
                    update({
                      selected: e.target.checked
                        ? [...selected, c.id]
                        : selected.filter((x) => x !== c.id),
                    })
                  }
                />
                <span>{edit?.text ?? c.text}</span>
              </label>
              <button
                aria-label={`编辑建议 ${c.text}`}
                disabled={!!pending || busy || added}
                onClick={() => setEditing(editing === c.id ? undefined : c.id)}
              >
                <Pencil size={17} />
              </button>
            </div>
            <p className="muted">
              {added
                ? "已加入计划"
                : done
                  ? "已完成"
                  : `首轮 ${edit?.minutes ?? Math.round(c.plannedSeconds / 60)} 分钟`}
            </p>
            {c.expectedResult && (
              <p className="muted">做到：{c.expectedResult}</p>
            )}
            {editing === c.id && (
              <div className="wk-candidate-edit">
                <label>
                  动作
                  <input
                    maxLength={300}
                    value={edit?.text ?? c.text}
                    onChange={(e) =>
                      update({
                        edits: {
                          ...draft.edits,
                          [c.id]: {
                            text: e.target.value,
                            minutes: edit?.minutes ?? c.plannedSeconds / 60,
                          },
                        },
                      })
                    }
                  />
                </label>
                <label>
                  首轮分钟
                  <input
                    type="number"
                    min={1}
                    max={120}
                    value={edit?.minutes ?? c.plannedSeconds / 60}
                    onChange={(e) =>
                      update({
                        edits: {
                          ...draft.edits,
                          [c.id]: {
                            text: edit?.text ?? c.text,
                            minutes: Number(e.target.value),
                          },
                        },
                      })
                    }
                  />
                </label>
              </div>
            )}
            {cards.length > 1 && (
              <div className="wk-order">
                <button
                  aria-label={`上移 ${c.text}`}
                  disabled={index === 0 || busy || !!pending}
                  onClick={() => move(c.id, -1)}
                >
                  <ArrowUp size={14} />
                </button>
                <button
                  aria-label={`下移 ${c.text}`}
                  disabled={index === cards.length - 1 || busy || !!pending}
                  onClick={() => move(c.id, 1)}
                >
                  <ArrowDown size={14} />
                </button>
              </div>
            )}
          </article>
        );
      })}
      {stale.length > 0 && (
        <div className="wk-stale">
          <p>相关任务已有更新：</p>
          {stale.map((c) => {
            const { task, step } = current(c);
            return (
              <p key={c.id}>
                当前：{task?.title} / {step?.text || "尚无此步骤"}
              </p>
            );
          })}
          <label>
            <input
              type="checkbox"
              checked={reviewed}
              disabled={!!pending || busy}
              onChange={(e) => setReviewed(e.target.checked)}
            />
            我已核对，采用所选建议
          </label>
        </div>
      )}
      <label className="wk-candidate-date">
        安排到
        <input
          aria-label="建议安排日期"
          type="date"
          value={date}
          disabled={!!pending || busy}
          onChange={(e) => update({ date: e.target.value })}
        />
      </label>
      <button
        className="wk-primary"
        disabled={
          busy ||
          (!pending &&
            !cards.some((c) => selected.includes(c.id) && !joined(c)))
        }
        onClick={() => void submit()}
      >
        {busy ? (
          "正在保存…"
        ) : pending ? (
          "核实并重试"
        ) : cards.every(joined) ? (
          <>
            <Check size={16} />
            已加入计划
          </>
        ) : cards.length === 1 ? (
          "采用这一步"
        ) : (
          `采用所选步骤（${selected.length}）`
        )}
      </button>
      {notice && (
        <p className="wk-inline-message" role="status">
          {notice}
        </p>
      )}
    </section>
  );
}
