import type { DayItem } from "../paper/paperTypes";
import type { LeftoverPlan } from "../shared/planning";
import { clock, type Row } from "./model";

export const planItemLabel = (item: DayItem) =>
  `${item.date} · ${item.startMinute == null ? "未定时刻" : clock(item.startMinute)} · ${item.durationMinutes == null ? "未填预留时长" : `预留 ${item.durationMinutes} 分钟`}`;

export default function LeftoverPlans({
  groups,
  busy,
  onContinue,
  onEdit,
  onCancel,
  onUnplan,
  onDiscuss,
}: {
  groups: LeftoverPlan[];
  busy: boolean;
  onContinue: (group: LeftoverPlan) => void;
  onEdit: (row: Row) => void;
  onCancel: (row: Row) => void;
  onUnplan: (row: Row) => void;
  onDiscuss: (row: Row) => void;
}) {
  if (!groups.length) return null;
  const pendingCount = groups.filter((group) => !group.rescheduled).length;
  return (
    <details className="wk-leftovers">
      <summary>
        旧安排{" "}
        <span>
          {pendingCount} 步待处理
          {groups.length > pendingCount
            ? ` · ${groups.length - pendingCount} 步已重新安排`
            : ""}
        </span>
      </summary>
      <p className="muted">只在你选择后调整，原来的执行记录会保留。</p>
      <div className="wk-leftovers-list">
        {groups.map((group) => {
          const row = {
            task: group.task,
            step: group.step,
            item: group.items[group.items.length - 1],
          };
          return (
            <details
              className="wk-leftover-group"
              key={`${group.task.id}:${group.step.id}`}
            >
              <summary>
                <span>{group.step.text}</span>
                <small>
                  {group.rescheduled
                    ? "已重新安排"
                    : `${group.items.length} 条旧安排`}
                </small>
              </summary>
              <p className="muted">{group.task.title}</p>
              <div className="wk-leftover-actions">
                <button disabled={busy} onClick={() => onContinue(group)}>
                  今天继续
                </button>
                <button disabled={busy} onClick={() => onUnplan(row)}>
                  放回待安排
                </button>
                <button onClick={() => onDiscuss(row)}>讨论这一步</button>
              </div>
              <ul>
                {group.items.map((item) => (
                  <li key={item.id}>
                    <span>{planItemLabel(item)}</span>
                    <div>
                      <button
                        disabled={busy}
                        onClick={() => onEdit({ ...row, item })}
                      >
                        改期
                      </button>
                      <button
                        disabled={busy}
                        onClick={() => onCancel({ ...row, item })}
                      >
                        取消本次安排
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </details>
          );
        })}
      </div>
    </details>
  );
}
