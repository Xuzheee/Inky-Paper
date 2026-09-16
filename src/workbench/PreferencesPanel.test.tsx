// @vitest-environment jsdom
import { afterEach, it, expect, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import type { State, Preference } from "../paper/paperTypes";
import PreferencesPanel from "./PreferencesPanel";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const pref: Preference = {
  id: "pref",
  revision: 1,
  text: "首轮15分钟",
  scope: "global",
  date: null,
  projectId: null,
  enabled: true,
  confirmedAt: 1,
  updatedAt: 1,
  source: "user",
};
const state = (preferences: Preference[] = []): State => ({
  tasks: [],
  sessions: [],
  notes: [],
  coach: {
    blocks: [],
    proposals: [],
    analysisStatus: "",
    settings: { enabled: false, hermes: false, revision: 1 },
    activities: [],
  },
  planning: { steps: [], dayItems: [], context: { days: [], preferences } },
});
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.mocked(invoke).mockReset();
});
it("persists only explicitly confirmed scope and supports disabling without deleting history", async () => {
  vi.mocked(invoke).mockResolvedValue({});
  const saved = vi.fn();
  render(
    <PreferencesPanel state={state([pref])} storageScope="a" onSaved={saved} />,
  );
  expect(invoke).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("修改偏好"));
  fireEvent.change(screen.getByLabelText("生效范围"), {
    target: { value: "day" },
  });
  fireEvent.change(screen.getByLabelText("生效日期"), {
    target: { value: "2030-03-04" },
  });
  fireEvent.click(screen.getByLabelText("用于相关请求"));
  expect(invoke).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("确认保存偏好"));
  await waitFor(() => expect(saved).toHaveBeenCalled());
  expect(vi.mocked(invoke).mock.calls[0][1]).toMatchObject({
    action: "save_preference",
    input: {
      scope: "day",
      date: "2030-03-04",
      projectId: null,
      enabled: false,
      expectedRevision: 1,
    },
  });
});
it("blocks stale preference edits and requires an explicit review before using the latest version", async () => {
  vi.mocked(invoke).mockResolvedValue({});
  const props = { storageScope: "a", onSaved: vi.fn() };
  const r = render(<PreferencesPanel {...props} state={state([pref])} />);
  fireEvent.click(screen.getByText("修改偏好"));
  fireEvent.change(screen.getByLabelText("偏好内容"), {
    target: { value: "首轮10分钟" },
  });
  r.rerender(
    <PreferencesPanel
      {...props}
      state={state([{ ...pref, text: "首轮20分钟", revision: 2 }])}
    />,
  );
  expect((screen.getByText("确认保存偏好") as HTMLButtonElement).disabled).toBe(
    true,
  );
  expect(invoke).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("已核对，保留草稿"));
  fireEvent.click(screen.getByText("确认保存偏好"));
  await waitFor(() => expect(props.onSaved).toHaveBeenCalled());
  expect(vi.mocked(invoke).mock.calls[0][1]).toMatchObject({
    input: { expectedRevision: 2, text: "首轮10分钟" },
  });
});
it("keeps deletion retry identical after restarting and describes its limited scope", async () => {
  vi.mocked(invoke).mockRejectedValue(Error("offline"));
  const props = { state: state([pref]), storageScope: "a", onSaved: vi.fn() };
  const r = render(<PreferencesPanel {...props} />);
  expect(screen.getByText(/已有对话、事件记录/)).toBeTruthy();
  fireEvent.click(screen.getByText("删除偏好"));
  await screen.findByText("offline");
  const first = vi.mocked(invoke).mock.calls[0][1];
  r.unmount();
  vi.mocked(invoke).mockResolvedValue({});
  render(<PreferencesPanel {...props} />);
  fireEvent.click(screen.getByText("核实并重试偏好操作"));
  await waitFor(() => expect(props.onSaved).toHaveBeenCalled());
  expect(vi.mocked(invoke).mock.calls[1][1]).toEqual(first);
});
