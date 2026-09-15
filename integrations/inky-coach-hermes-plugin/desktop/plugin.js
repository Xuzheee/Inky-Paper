import React, { useRef, useState } from 'react';
import { TRANSCRIPT_DIRECTIVE_AREA, useQuery } from '@hermes/plugin-sdk';

const h = React.createElement;
const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const button = (label, onClick, disabled = false, extra = {}) => h('button', { type: 'button', className: 'ip-button', onClick, disabled, ...extra }, label);
const cardCss = `
.ip-plan{--ip-ink:var(--ui-text-primary,#343c34);--ip-muted:var(--ui-text-secondary,#70786d);--ip-paper:var(--ui-bg-editor,#fffefa);--ip-line:color-mix(in srgb,var(--ip-ink) 18%,transparent);color:var(--ip-ink);font:inherit;font-size:14px;line-height:1.55;max-width:680px;width:100%;container-type:inline-size;margin:14px 0;box-sizing:border-box}
.ip-plan *{box-sizing:border-box}.ip-plan button,.ip-plan input,.ip-plan textarea{font:inherit}.ip-plan button{color:inherit}.ip-plan button:disabled{opacity:.45;cursor:default}.ip-plan button:focus-visible,.ip-plan input:focus-visible,.ip-plan textarea:focus-visible{outline:2px solid #718777;outline-offset:3px}
.ip-heading{display:flex;justify-content:space-between;align-items:center;gap:16px;margin-bottom:12px}.ip-brand{font-size:11px;letter-spacing:.06em;color:var(--ip-muted);display:flex;gap:7px;align-items:center}.ip-brand:before{content:'';width:7px;height:7px;border-radius:50%;background:#79917c}.ip-title{font-size:18px;font-weight:650;margin:4px 0 0}.ip-date{font-size:12px;color:var(--ip-muted);display:grid;gap:3px}.ip-date input{max-width:150px;border:1px solid var(--ip-line);border-radius:8px;background:var(--ip-paper);padding:5px 7px;color:var(--ip-ink);min-width:0}.ip-help{font-size:12px;color:var(--ip-muted);margin:0 0 16px!important}
.ip-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.ip-card{min-width:0;position:relative;border:1px solid var(--ip-line);border-radius:17px;background:color-mix(in srgb,var(--ip-paper) 94%,#cec7ac);transition:border-color .15s,background .15s;overflow:hidden}.ip-card[data-selected=true]{border:1.5px solid #7e9781;background:color-mix(in srgb,var(--ip-paper) 82%,#91ad93)}.ip-card[data-completed=true]{background:color-mix(in srgb,var(--ip-paper) 89%,#b1c5b0)}.ip-card:has(.ip-check:focus-visible){outline:2px solid #718777;outline-offset:3px}.ip-card-top{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:9px 10px 0 14px}.ip-parent{font-size:11px;color:var(--ip-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.ip-button.ip-pencil{border:0;background:transparent;padding:5px;line-height:1;display:flex;align-items:center;border-radius:6px}.ip-pencil svg{width:16px;height:16px;color:#9a9468}
.ip-card-choice{display:block;cursor:pointer;padding:6px 14px 10px;min-height:82px;position:relative}.ip-card-choice:has(input:disabled){cursor:default}.ip-check{position:absolute;opacity:0;width:1px;height:1px}.ip-card-name{display:flex;align-items:flex-start;gap:9px}.ip-check-mark{flex:0 0 18px;width:18px;height:18px;border:1px solid #aab3a3;border-radius:6px;margin-top:4px;display:grid;place-items:center;font-size:12px;color:#fff;line-height:1;background:transparent}.ip-card[data-selected=true] .ip-check-mark{border-color:#718b74;background:#718b74}.ip-card[data-completed=true] .ip-check-mark{color:#607963;border-color:#a7b9a6;background:transparent}.ip-action{font-size:16px;line-height:1.5;font-weight:650;overflow-wrap:anywhere}.ip-result{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;font-size:12px;color:var(--ip-muted);margin:8px 0 0 27px;line-height:1.6;overflow-wrap:anywhere}
.ip-card-foot{padding:0 12px 10px;display:flex;align-items:center;justify-content:space-between;gap:8px}.ip-state{font-size:11px;color:var(--ip-muted);display:flex;align-items:center;gap:5px}.ip-dot{width:6px;height:6px;border-radius:50%;background:#b7bab1}.ip-card[data-completed=true] .ip-dot{background:#78977b}.ip-state[data-joined=true] .ip-dot{background:#a4ad83}.ip-minutes{font-size:12px;white-space:nowrap;color:var(--ip-ink)}.ip-sort{display:flex;gap:3px}.ip-button.ip-arrow{padding:2px 6px;border:0;background:transparent;font-size:12px;line-height:1.4}
.ip-selected{display:flex;flex-wrap:wrap;gap:6px;margin:14px 0}.ip-button.ip-chip{display:inline-flex;align-items:center;gap:7px;padding:4px 9px;border:0;border-radius:20px;background:color-mix(in srgb,var(--ip-paper) 80%,#cfb7ae);font-size:11px;max-width:100%;text-align:left}.ip-chip span:first-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:210px}.ip-summary{font-size:12px;color:var(--ip-muted);margin:12px 0 8px!important}.ip-footer{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.ip-button{border:1px solid var(--ip-line);border-radius:9px;padding:7px 11px;background:transparent;cursor:pointer;font-size:12px}.ip-button.ip-primary{background:#667e69;border-color:#667e69;color:#fff;padding:9px 16px;font-weight:550}.ip-button.ip-refresh{border:0;color:var(--ip-muted)}.ip-notice{font-size:12px;color:var(--ip-muted);margin:10px 0!important;white-space:pre-wrap;overflow-wrap:anywhere}
.ip-editor{margin-top:14px;padding:16px;border:1px solid var(--ip-line);border-radius:13px;background:var(--ip-paper);display:grid;gap:11px}.ip-editor-heading{display:flex;justify-content:space-between;align-items:center;gap:10px}.ip-editor-heading strong{font-size:14px}.ip-editor label{font-size:12px;color:var(--ip-muted);display:grid;gap:5px}.ip-field{width:100%;border:1px solid var(--ip-line);border-radius:8px;padding:8px 10px;color:var(--ip-ink);background:transparent;min-width:0}.ip-editor textarea{resize:vertical;line-height:1.6}.ip-review{border-top:1px dashed var(--ip-line);padding:10px 14px;font-size:12px;overflow-wrap:anywhere}.ip-review p{margin:0 0 6px!important}.ip-review label{display:flex;gap:7px;align-items:flex-start}.ip-review input{margin-top:4px;accent-color:#718b74}.ip-disconnected{border:1px dashed var(--ip-line);border-radius:14px;padding:18px}
@container(max-width:360px){.ip-grid{grid-template-columns:1fr}.ip-heading{gap:8px}.ip-title{font-size:16px}.ip-date input{max-width:136px}.ip-card-choice{min-height:82px}}
@media(prefers-reduced-motion:reduce){.ip-card{transition:none}}
`;
const pencil = h('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, 'aria-hidden': true }, h('path', { d: 'm15 5 4 4M4 20l4-1 12-12a2.8 2.8 0 0 0-4-4L4 15z' }));
const frame = (...children) => h('section', { className: 'ip-plan', 'aria-label': 'Inky 候选计划卡片' }, h('style', null, cardCss), ...children);

function localDate() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export function currentObjects(data, card) {
  const task = data.tasks.find(item => item.id === card.taskId);
  const step = data.steps.find(item => item.id === (card.adoptedStepId || card.stepId));
  const stale = Boolean(
    (task && task.revision !== card.expectedTaskRevision) ||
    (step && step.revision !== card.expectedStepRevision)
  );
  return { task, step, stale, version: `${task?.revision ?? ''}:${step?.id ?? ''}:${step?.revision ?? ''}` };
}

export function selectedCards(data, draft) {
  const order = [...draft.order, ...data.batch.cards.map(card => card.id).filter(id => !draft.order.includes(id))];
  return order.map(id => data.batch.cards.find(card => card.id === id)).filter(Boolean);
}

export function adoptPayload(data, draft, requestId) {
  const cards = selectedCards(data, draft).filter(card => draft.selected.includes(card.id));
  if (!cards.length) throw new Error('请先选择要加入的卡片。');
  const overrides = cards.map(card => {
    const { task, step, stale, version } = currentObjects(data, card);
    if (task?.completed || step?.completed) throw new Error('所选卡片已在 Paper 完成，请先取消勾选这张卡片。');
    if (stale && draft.reviewed[card.id] !== version) throw new Error('内容已有变化，请先核对所选卡片下方的最新记录。');
    const edit = draft.edits[card.id] || {};
    const text = (edit.text ?? card.text).trim();
    const seconds = Math.round(Number(edit.minutes ?? card.plannedSeconds / 60) * 60);
    if (!text || text.length > 300) throw new Error('卡片动作需为 1–300 字。');
    if (!Number.isFinite(seconds) || seconds < 60 || seconds > 7200) throw new Error('首轮时长需为 1–120 分钟。');
    return {
      cardId: card.id, text, expectedResult: edit.expectedResult ?? card.expectedResult ?? null,
      plannedSeconds: seconds,
      ...(task ? { expectedTaskRevision: task.revision } : {}),
      ...(step ? { expectedStepRevision: step.revision } : {}),
    };
  });
  return {
    requestId, batchId: data.batch.id, expectedRevision: data.batch.revision,
    date: draft.date, cardIds: cards.map(card => card.id), cardOverrides: overrides,
  };
}

function unwrap(result) {
  if (!result?.ok) throw new Error(result?.error || '暂时无法读取 Paper。');
  return result.data;
}

export function PlanCards({ ctx, batchId, streaming = false }) {
  const key = `plan-draft:${batchId}`;
  const initial = () => ctx.storage.get(key, { order: [], selected: [], edits: {}, reviewed: {}, date: localDate(), pending: null });
  const [draft, setDraft] = useState(initial);
  const draftRef = useRef(draft);
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const [notice, setNotice] = useState('');
  const [editing, setEditing] = useState(null);
  const update = next => {
    draftRef.current = { ...draftRef.current, ...next };
    ctx.storage.set(key, draftRef.current);
    setDraft(draftRef.current);
  };
  const query = useQuery({
    queryKey: ['inky-coach', 'plan', batchId],
    queryFn: async () => unwrap(await ctx.rest(`/batches/${encodeURIComponent(batchId)}`, { timeoutMs: 8000 })),
    retry: false, refetchInterval: 5000, enabled: !streaming && idPattern.test(batchId),
  });
  const data = query.data;
  const locked = busy || Boolean(draft.pending);

  async function submit() {
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    setNotice('');
    try {
      let payload = draftRef.current.pending;
      if (!payload) {
        // The final read precedes the click's transaction; revision checks
        // still protect changes arriving between this read and the write.
        const fresh = await query.refetch();
        if (fresh.error || !fresh.data) throw fresh.error || new Error('读取最新卡片失败。');
        payload = adoptPayload(fresh.data, draftRef.current, crypto.randomUUID());
        update({ pending: payload });
      }
      const result = await ctx.rest('/adopt', { method: 'POST', body: payload, timeoutMs: 10000 });
      if (!result?.ok) {
        if (result?.definitive) update({ pending: null, reviewed: {} });
        await query.refetch();
        throw new Error(result?.error || '尚未确认保存，请重试。');
      }
      update({ pending: null, selected: [], reviewed: {} });
      setNotice(`已将 ${payload.cardIds.length} 张卡片加入 ${payload.date}，可在 Paper 选择卡片开始一轮。`);
      await query.refetch();
    } catch (error) {
      setNotice(error.message || '保存失败，选择和草稿仍保留。');
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }

  if (!idPattern.test(batchId)) return frame(h('p', { role: 'alert', className: 'ip-notice' }, '计划卡片标识无效，请让 Coach 重新读取候选批次。'));
  if (streaming) return frame(h('p', { role: 'status', className: 'ip-notice' }, '正在整理候选卡片…'));
  if (!data) return frame(h('div', { className: 'ip-disconnected' },
    h('strong', null, 'Inky Coach · 计划卡片'),
    h('p', { className: 'ip-notice', role: query.error ? 'alert' : 'status' }, query.error?.message || '正在读取候选卡片…'),
    button('重新连接', () => query.refetch()),
    draft.pending ? button(busy ? '正在核实保存…' : '核实原提交', submit, busy) : null,
  ));

  const cards = selectedCards(data, draft);
  function edit(cardId, field, value) {
    update({ edits: { ...draftRef.current.edits, [cardId]: { ...draftRef.current.edits[cardId], [field]: value } } });
  }
  function move(index, delta) {
    const order = cards.map(card => card.id);
    [order[index], order[index + delta]] = [order[index + delta], order[index]];
    update({ order });
  }
  function select(cardId, checked) {
    update({ selected: checked ? [...new Set([...draftRef.current.selected, cardId])] : draftRef.current.selected.filter(id => id !== cardId) });
  }
  const chosen = cards.filter(card => draft.selected.includes(card.id));
  const chosenMinutes = chosen.reduce((sum, card) => sum + Number(draft.edits[card.id]?.minutes ?? card.plannedSeconds / 60), 0);
  const editCard = cards.find(card => card.id === editing);
  const editLocked = editCard && (locked || currentObjects(data, editCard).task?.completed || currentObjects(data, editCard).step?.completed);
  const editValue = editCard ? draft.edits[editCard.id] || {} : {};
  return frame(
    h('div', { className: 'ip-heading' },
      h('div', null, h('span', { className: 'ip-brand' }, 'Inky Coach'), h('h3', { className: 'ip-title' }, '选择今天想推进的动作')),
      h('label', { className: 'ip-date' }, '计划日期', h('input', { type: 'date', value: draft.date, disabled: locked, onChange: event => update({ date: event.target.value }) })),
    ),
    h('p', { className: 'ip-help' }, '点卡片选择，点铅笔调整。加入 Inky 后，由你开始计时。'),
    h('div', { className: 'ip-grid' }, ...cards.map((card, index) => {
      const { task, step, stale, version } = currentObjects(data, card);
      const editValue = draft.edits[card.id] || {};
      const joined = data.dayItems.some(item => !item.removedAt && item.date === draft.date && item.stepId === (card.adoptedStepId || card.stepId));
      const completed = step?.completed || task?.completed;
      const selected = draft.selected.includes(card.id);
      const title = editValue.text ?? card.text;
      return h('article', { key: card.id, className: 'ip-card', 'data-card-id': card.id, 'data-selected': selected, 'data-completed': Boolean(completed) },
        h('div', { className: 'ip-card-top' },
          h('span', { className: 'ip-parent', title: task?.title || card.taskTitle }, task?.title || card.taskTitle || '关联任务'),
          button(pencil, () => setEditing(editing === card.id ? null : card.id), locked || completed, { className: 'ip-button ip-pencil', 'aria-label': `编辑 ${card.text}`, 'aria-expanded': editing === card.id }),
        ),
        h('label', { className: 'ip-card-choice' },
          h('input', { className: 'ip-check', type: 'checkbox', checked: selected, disabled: locked || (completed && !selected), 'aria-label': `选择 ${card.text}`, onChange: event => select(card.id, event.target.checked) }),
          h('span', { className: 'ip-card-name' }, h('span', { className: 'ip-check-mark', 'aria-hidden': true }, selected || completed ? '✓' : ''), h('strong', { className: 'ip-action' }, title)),
          h('span', { className: 'ip-result' }, editValue.expectedResult ?? card.expectedResult ?? '预期结果可点铅笔补充'),
        ),
        h('div', { className: 'ip-card-foot' },
          h('div', null,
            h('span', { className: 'ip-state', 'data-joined': joined }, h('span', { className: 'ip-dot', 'aria-hidden': true }), completed ? '已完成' : joined ? '已加入 · 待继续' : card.adoptedStepId ? '已采用，可再次安排' : selected ? '已选择 · 待加入' : '候选 · 未加入'),
            h('span', { className: 'ip-minutes' }, `首轮 ${editValue.minutes ?? card.plannedSeconds / 60} 分钟`),
          ),
          h('div', { className: 'ip-sort' }, button('↑', () => move(index, -1), locked || index === 0, { className: 'ip-button ip-arrow', 'aria-label': `上移 ${card.text}` }), button('↓', () => move(index, 1), locked || index === cards.length - 1, { className: 'ip-button ip-arrow', 'aria-label': `下移 ${card.text}` })),
        ),
        stale && selected ? h('div', { className: 'ip-review' },
          h('p', null, 'Paper 中的内容已有变化，当前记录：'),
          h('p', null, `任务：${task?.title || card.taskTitle}`),
          step ? h('p', null, `步骤：${step.text}；预期结果：${step.expectedResult || '未填写'}；${step.completed ? '已完成' : '未完成'}`) : null,
          h('label', null, h('input', { type: 'checkbox', checked: draft.reviewed[card.id] === version, disabled: locked, onChange: event => update({ reviewed: { ...draft.reviewed, [card.id]: event.target.checked ? version : null } }) }), ' 我已核对，采用上方卡片内容'),
        ) : null,
      );
    })),
    editCard ? h('section', { className: 'ip-editor', 'aria-label': '编辑计划卡片' },
      h('div', { className: 'ip-editor-heading' }, h('strong', null, '调整这张卡片'), button('收起编辑', () => setEditing(null))),
      h('label', null, '这一步做什么', h('input', { className: 'ip-field', value: editValue.text ?? editCard.text, maxLength: 300, disabled: editLocked, autoFocus: true, onChange: event => edit(editCard.id, 'text', event.target.value), 'aria-label': `动作 ${editCard.id}` })),
      h('label', null, '预期结果', h('textarea', { className: 'ip-field', value: editValue.expectedResult ?? editCard.expectedResult ?? '', maxLength: 2000, rows: 2, disabled: editLocked, onChange: event => edit(editCard.id, 'expectedResult', event.target.value), 'aria-label': `预期结果 ${editCard.id}` })),
      h('label', null, '首轮分钟', h('input', { className: 'ip-field', style: { maxWidth: 100 }, type: 'number', min: 1, max: 120, step: 1, value: editValue.minutes ?? editCard.plannedSeconds / 60, disabled: editLocked, onChange: event => edit(editCard.id, 'minutes', event.target.value), 'aria-label': `首轮分钟 ${editCard.id}` })),
      h('span', { className: 'ip-help' }, '修改先保留在候选中，点击加入 Inky 后才保存为计划。'),
    ) : null,
    chosen.length ? h('div', { className: 'ip-selected', 'aria-label': '已选卡片' }, ...chosen.map(card => button(h(React.Fragment, null, h('span', null, draft.edits[card.id]?.text ?? card.text), h('span', { 'aria-hidden': true }, '×')), () => select(card.id, false), locked, { key: card.id, className: 'ip-button ip-chip', 'aria-label': `取消选择 ${draft.edits[card.id]?.text ?? card.text}` }))) : null,
    notice ? h('p', { role: 'status', className: 'ip-notice' }, notice) : null,
    draft.pending && !busy ? h('p', { className: 'ip-notice' }, '已保留原提交，请重试以核实结果；不会重复创建卡片。') : null,
    query.error ? h('p', { role: 'status', className: 'ip-notice' }, '连接暂不可用，以上是最后读到的记录。') : null,
    h('p', { className: 'ip-summary' }, chosen.length ? `已选 ${chosen.length} 张${Number.isFinite(chosenMinutes) ? ` · 首轮合计 ${chosenMinutes} 分钟` : ''}` : '还没选卡片，可以先从一张开始。'),
    h('div', { className: 'ip-footer' },
      button(busy ? '正在保存…' : draft.pending ? '重试并核实原提交' : `将所选 ${draft.selected.length} 张卡片加入 Inky`, submit, busy || (!draft.pending && !draft.selected.length), { className: 'ip-button ip-primary' }),
      button('刷新执行状态', () => query.refetch(), busy, { className: 'ip-button ip-refresh' }),
    ),
  );
}

export default {
  id: 'inky-coach', name: 'Inky Coach', description: '按需拆分任务，在对话中选择卡片并加入 Inky Paper。', defaultEnabled: false,
  register(ctx) {
    ctx.register({ id: 'plan-cards', area: TRANSCRIPT_DIRECTIVE_AREA, data: {
      name: 'inky-plan', render: ({ attrs, streaming }) => h(PlanCards, { key: attrs.batchid, ctx, batchId: attrs.batchid || '', streaming }),
    } });
  },
};
