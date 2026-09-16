import { useEffect, useRef, useState } from "react";
import AdjustmentCards, { hasPendingAdjustment } from "./AdjustmentCards";
import { requestStorageKey, storagePrefix } from "./editorDraft";
import { usePlanRequest } from "./usePlanRequest";
import {
  clock,
  getError,
  validDate,
  type AdjustmentData,
  type Row,
} from "./model";
import "./bulk-reschedule.css";

type Draft = { selected: string[]; date: string; batchId?: string };
export default function BulkReschedule({
  rows,
  storageScope,
  blocked,
  onSaved,
}: {
  rows: Row[];
  storageScope: string;
  blocked: boolean;
  onSaved: () => void;
}) {
  const key = `${storagePrefix(storageScope)}bulk-reschedule`;
  const [initial] = useState(() => {
    try {
      const draft: Draft = JSON.parse(localStorage.getItem(key) || "null") || {
        selected: [],
        date: "",
      };
      if (!Array.isArray(draft.selected) || typeof draft.date !== "string")
        throw Error("invalid draft");
      return { draft, error: "" };
    } catch {
      return {
        draft: { selected: [], date: "" } as Draft,
        error: "批量改期草稿无法读取，请保留本地记录后检查。",
      };
    }
  });
  const [draft, setDraft] = useState(initial.draft);
  const [storageError, setStorageError] = useState(initial.error);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const request = usePlanRequest(
    requestStorageKey(storageScope, "bulk-reschedule"),
  );
  const pendingUnknown = !!request.pending && !request.definitiveFailure;
  const locked =
    blocked || busy || !request.ready || !!storageError || pendingUnknown;
  const items = rows.filter((row) => row.item && row.step);
  const selected = items.filter((row) => draft.selected.includes(row.item!.id));
  const persist = (next: Draft) => {
    try {
      localStorage.setItem(key, JSON.stringify(next));
      setDraft(next);
      return true;
    } catch {
      setStorageError("批量改期草稿未能保存，暂未发送新操作。");
      return false;
    }
  };
  useEffect(() => {
    if (open) dialog.current?.showModal();
    else dialog.current?.close();
  }, [open]);
  const generate = async () => {
    if (busy || blocked || !request.ready || storageError) return;
    setNotice("");
    if (!pendingUnknown) {
      if (!validDate(draft.date)) {
        setNotice("请选择有效的目标日期。");
        return;
      }
      if (!draft.selected.length || draft.selected.length > 20) {
        setNotice("请选择 1–20 条安排，一起核对后采用。");
        return;
      }
      if (
        selected.length !== draft.selected.length ||
        selected.some((row) => row.task.completed || row.step!.completed)
      ) {
        setNotice("所选安排已变化，请重新选择未完成的安排。");
        return;
      }
      if (
        new Set(selected.map((row) => row.step!.id)).size !== selected.length
      ) {
        setNotice(
          "同一步骤的多个安排不能同时改到一天，请每个步骤只选一条安排。",
        );
        return;
      }
    }
    setBusy(true);
    try {
      let result: AdjustmentData;
      if (pendingUnknown) result = (await request.retry()) as AdjustmentData;
      else {
        const batchId = crypto.randomUUID();
        // Keep the returned candidate reachable even if the response or window is lost.
        if (!persist({ ...draft, batchId })) return;
        result = (await request.submit("propose_plan_adjustment", {
          batchId,
          groups: [
            {
              id: crypto.randomUUID(),
              reason: `你选择将这 ${selected.length} 条安排一起改到 ${draft.date}，保留原时刻和预留。`,
              actions: selected.map(({ task, step, item }) => ({
                kind: "reschedule",
                taskId: task.id,
                stepId: step!.id,
                expectedTaskRevision: task.revision,
                expectedStepRevision: step!.revision,
                itemId: item!.id,
                expectedItemRevision: item!.revision,
                date: draft.date,
              })),
            },
          ],
        })) as AdjustmentData;
      }
      persist({ ...draft, batchId: result.batch.id });
      setNotice("改期预览已生成，计划尚未改变。核对后采用这一组调整。");
    } catch (error) {
      setNotice(getError(error));
    } finally {
      setBusy(false);
    }
  };
  const reset = () => {
    try {
      if (
        pendingUnknown ||
        (draft.batchId && hasPendingAdjustment(draft.batchId))
      ) {
        setNotice("上次操作仍待核实，请先重试原提交，再开始另一批改期。");
        return;
      }
      if (request.pending) request.discardDefinitiveFailure();
      if (persist({ selected: [], date: "" })) setNotice("");
    } catch (error) {
      setNotice(getError(error));
    }
  };
  const preview =
    draft.batchId && !pendingUnknown && !request.definitiveFailure && !busy;
  return (
    <div className="wk-bulk-entry">
      <button
        disabled={
          !request.ready || (blocked && !draft.batchId && !request.pending)
        }
        onClick={() => setOpen(true)}
      >
        {draft.batchId || request.pending ? "继续批量改期" : "批量改期"}
      </button>
      <dialog
        ref={dialog}
        className="wk-dialog wk-bulk-dialog"
        aria-label="批量改期"
        onCancel={(event) => {
          event.preventDefault();
          if (!busy) setOpen(false);
        }}
      >
        <header>
          <h2>批量改期</h2>
          <button
            aria-label="关闭批量改期"
            disabled={busy}
            onClick={() => setOpen(false)}
          >
            关闭
          </button>
        </header>
        <p>
          选择安排后先看预览，采用后才更新。原时刻、预留和已有执行记录保留。
        </p>
        {!preview && (
          <fieldset disabled={locked || !!draft.batchId}>
            <label className="wk-bulk-date">
              改到日期
              <input
                type="date"
                aria-label="批量改期目标日期"
                value={draft.date}
                onChange={(event) =>
                  persist({ ...draft, date: event.target.value })
                }
              />
            </label>
            <p>已选 {draft.selected.length} / 20 条安排</p>
            <div className="wk-bulk-list">
              {items.map(({ task, step, item }) => (
                <label key={item!.id}>
                  <input
                    type="checkbox"
                    aria-label={`选择安排 ${step!.text} · ${item!.date}`}
                    checked={draft.selected.includes(item!.id)}
                    disabled={
                      task.completed ||
                      step!.completed ||
                      (draft.selected.length >= 20 &&
                        !draft.selected.includes(item!.id))
                    }
                    onChange={(event) =>
                      persist({
                        ...draft,
                        selected: event.target.checked
                          ? [...draft.selected, item!.id]
                          : draft.selected.filter((id) => id !== item!.id),
                      })
                    }
                  />
                  <span>
                    {step!.text}
                    <small>
                      {item!.date} ·{" "}
                      {item!.startMinute == null
                        ? "未设时刻"
                        : clock(item!.startMinute)}{" "}
                      ·{" "}
                      {item!.durationMinutes == null
                        ? "未设预留"
                        : `预留 ${item!.durationMinutes} 分钟`}
                    </small>
                  </span>
                </label>
              ))}
              {!items.length && <p>还没有可改期的安排。</p>}
            </div>
          </fieldset>
        )}
        {preview && (
          <AdjustmentCards
            key={draft.batchId}
            id={draft.batchId!}
            streaming={false}
            onSaved={onSaved}
          />
        )}
        {pendingUnknown && (
          <p>原请求已保留。关闭或重启后，可从“继续批量改期”核实。</p>
        )}
        <footer>
          {!preview && (
            <button
              className="wk-primary"
              disabled={
                busy ||
                blocked ||
                !request.ready ||
                !!storageError ||
                (!pendingUnknown && !!request.pending)
              }
              onClick={() => void generate()}
            >
              {busy
                ? "正在生成预览…"
                : pendingUnknown
                  ? "核实并重试原提案"
                  : "生成改期预览"}
            </button>
          )}
          {(draft.batchId || request.pending) && (
            <button
              disabled={busy || pendingUnknown || !!storageError}
              onClick={reset}
            >
              开始另一批改期
            </button>
          )}
        </footer>
        {(notice || storageError || request.storageError) && (
          <p role="status" className="wk-error">
            {storageError || request.storageError || notice}
          </p>
        )}
      </dialog>
    </div>
  );
}
