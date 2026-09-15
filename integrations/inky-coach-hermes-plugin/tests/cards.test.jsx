import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import plugin, { PlanCards, adoptPayload, currentObjects } from '../desktop/plugin.js';

const uuid = number => `10000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const batchId = uuid(1);
const fixture = () => ({
  batch: { id: batchId, revision: 1, cards: [2, 3, 4].map(n => ({ id: uuid(n), taskId: uuid(20), taskTitle: '写周报', text: `动作 ${n}`, expectedResult: null, plannedSeconds: 1500, adoptedStepId: null })) },
  tasks: [], steps: [], dayItems: [],
});
function context(data = fixture()) {
  const saved = {};
  return {
    storage: { get: (key, fallback) => saved[key] || fallback, set: (key, value) => { saved[key] = value; } },
    rest: vi.fn(async path => path.startsWith('/batches') ? { ok: true, data } : { ok: true, data: {} }),
    saved,
  };
}
afterEach(cleanup);

describe('Hermes card adoption', () => {
  it('selects only checked cards and sends edits in the displayed order', async () => {
    const ctx = context();
    render(<PlanCards ctx={ctx} batchId={batchId} />);
    await screen.findByLabelText('选择 动作 2');
    fireEvent.click(screen.getByLabelText('选择 动作 2'));
    fireEvent.click(screen.getByLabelText('选择 动作 4'));
    fireEvent.click(screen.getByLabelText('编辑 动作 4'));
    fireEvent.change(screen.getByLabelText(`动作 ${uuid(4)}`), { target: { value: '先找数据' } });
    fireEvent.change(screen.getByLabelText(`首轮分钟 ${uuid(4)}`), { target: { value: '15' } });
    fireEvent.click(screen.getByLabelText('上移 动作 4'));
    fireEvent.click(screen.getByLabelText('上移 动作 4'));
    fireEvent.click(screen.getByText('将所选 2 张卡片加入 Inky'));
    await screen.findByText(/已将 2 张卡片加入/);
    const calls = ctx.rest.mock.calls.filter(([path]) => path === '/adopt');
    expect(calls).toHaveLength(1);
    expect(calls[0][1].body.cardIds).toEqual([uuid(4), uuid(2)]);
    expect(calls[0][1].body.cardOverrides[0]).toMatchObject({ text: '先找数据', plannedSeconds: 900 });
    expect(ctx.saved[`plan-draft:${batchId}`].pending).toBeNull();
  });

  it('preserves the exact pending transaction after an uncertain network failure', async () => {
    const ctx = context();
    let failures = 0;
    ctx.rest.mockImplementation(async path => {
      if (path.startsWith('/batches')) return { ok: true, data: fixture() };
      if (failures++ === 0) throw new Error('Connection lost');
      return { ok: true, data: {} };
    });
    const tree = render(<PlanCards ctx={ctx} batchId={batchId} />);
    fireEvent.click(await screen.findByLabelText('选择 动作 2'));
    fireEvent.click(screen.getByText('将所选 1 张卡片加入 Inky'));
    await screen.findByText('Connection lost');
    const pending = ctx.saved[`plan-draft:${batchId}`].pending;
    expect(pending.cardIds).toEqual([uuid(2)]);
    tree.unmount();
    render(<PlanCards ctx={ctx} batchId={batchId} />);
    await screen.findByLabelText('选择 动作 2');
    fireEvent.click(screen.getByText('重试并核实原提交'));
    await screen.findByText(/已将 1 张卡片加入/);
    const calls = ctx.rest.mock.calls.filter(([path]) => path === '/adopt');
    expect(calls[0][1].body).toEqual(calls[1][1].body);
  });

  it('requires explicit review of fresh task/step changes and rejects a later revision', async () => {
    const data = fixture();
    data.batch.cards[0].expectedTaskRevision = 1;
    data.batch.cards[0].stepId = uuid(30);
    data.batch.cards[0].expectedStepRevision = 1;
    data.tasks = [{ id: uuid(20), title: '周报新标题', revision: 2 }];
    data.steps = [{ id: uuid(30), text: 'Paper 中的新动作', expectedResult: '证据列表', revision: 2 }];
    const draft = { order: [], selected: [uuid(2)], edits: {}, reviewed: {}, date: '2026-09-13' };
    expect(() => adoptPayload(data, draft, uuid(50))).toThrow(/先核对/);
    draft.reviewed[uuid(2)] = currentObjects(data, data.batch.cards[0]).version;
    expect(adoptPayload(data, draft, uuid(50)).cardOverrides[0]).toMatchObject({ expectedTaskRevision: 2, expectedStepRevision: 2 });
    data.tasks[0].revision = 3;
    expect(() => adoptPayload(data, draft, uuid(51))).toThrow(/先核对/);
  });

  it('performs no writes on render, refresh, or card selection', async () => {
    const ctx = context();
    render(<PlanCards ctx={ctx} batchId={batchId} />);
    fireEvent.click(await screen.findByLabelText('选择 动作 2'));
    fireEvent.click(screen.getByText('刷新执行状态'));
    await waitFor(() => expect(ctx.rest.mock.calls.length).toBeGreaterThanOrEqual(2));
    expect(ctx.rest.mock.calls.every(([path]) => path.startsWith('/batches'))).toBe(true);
    const register = vi.fn();
    plugin.register({ register });
    expect(register.mock.calls[0][0].data.name).toBe('inky-plan');
    expect(register.mock.calls[0][0].data.render({ attrs: { batchid: batchId }, streaming: false }).props.batchId).toBe(batchId);
  });

  it('keeps compact selection chips and pencil edits as drafts until adoption', async () => {
    const ctx = context();
    render(<PlanCards ctx={ctx} batchId={batchId} />);
    await screen.findByLabelText('选择 动作 2');
    expect(screen.queryByLabelText(`动作 ${uuid(2)}`)).toBeNull();
    fireEvent.click(screen.getByLabelText('编辑 动作 2'));
    fireEvent.change(screen.getByLabelText(`动作 ${uuid(2)}`), { target: { value: '核对三个数字' } });
    fireEvent.click(screen.getByText('收起编辑'));
    fireEvent.click(screen.getByLabelText('选择 动作 2'));
    expect(screen.getByLabelText('取消选择 核对三个数字')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('取消选择 核对三个数字'));
    expect(screen.getByLabelText('选择 动作 2').checked).toBe(false);
    expect(ctx.saved[`plan-draft:${batchId}`].edits[uuid(2)].text).toBe('核对三个数字');
    expect(ctx.rest.mock.calls.every(([path]) => path.startsWith('/batches'))).toBe(true);
  });

  it('lets the user deselect a card completed in Paper while the draft was open', async () => {
    const data = fixture();
    data.tasks = [{ id: uuid(20), title: '写周报', revision: 1, completed: false }];
    data.batch.cards.forEach(card => { card.expectedTaskRevision = 1; });
    data.batch.cards[0].adoptedStepId = uuid(30);
    data.batch.cards[0].expectedStepRevision = 1;
    data.steps = [{ id: uuid(30), text: '动作 2', revision: 1, completed: false }];
    const ctx = context(data);
    render(<PlanCards ctx={ctx} batchId={batchId} />);
    fireEvent.click(await screen.findByLabelText('选择 动作 2'));
    fireEvent.click(screen.getByLabelText('选择 动作 3'));
    data.steps[0] = { ...data.steps[0], revision: 2, completed: true };
    fireEvent.click(screen.getByText('将所选 2 张卡片加入 Inky'));
    await screen.findByText('所选卡片已在 Paper 完成，请先取消勾选这张卡片。');
    expect(ctx.rest.mock.calls.filter(([path]) => path === '/adopt')).toHaveLength(0);
    expect(screen.getByLabelText('选择 动作 2').disabled).toBe(false);
    fireEvent.click(screen.getByLabelText('选择 动作 2'));
    expect(screen.getByLabelText('选择 动作 2').disabled).toBe(true);
    fireEvent.click(screen.getByText('将所选 1 张卡片加入 Inky'));
    await screen.findByText(/已将 1 张卡片加入/);
    const calls = ctx.rest.mock.calls.filter(([path]) => path === '/adopt');
    expect(calls).toHaveLength(1);
    expect(calls[0][1].body.cardIds).toEqual([uuid(3)]);
  });
});
