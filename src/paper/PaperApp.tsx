import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import "./paper.css";
import "./refinement.css";
import type {
  Task,
  Session,
  State,
  Draft,
  PlanStep,
  DayItem,
} from "./paperTypes";
import { DayPlan, localDate } from "./DayPlan";
import { TaskSheet } from "./TaskSheet";
import {
  latestStepCue,
  planningViews,
  taskCompletionPrompt,
} from "../shared/planning";
import { executionChoice } from "./executionChoice";
import { PAPER_MOTTOS } from "./mottos";
import { PaperFooter } from "./PaperFooter";
import { SessionEnd } from "./SessionEnd";
import { usePaperNotice } from "./PaperNotice";
import { usePaperNavigation } from "./usePaperNavigation";
import { useWindowDrag } from "./useWindowDrag";
import { PaperChrome } from "./PaperChrome";
import { persistDraft, taskDraft } from "./taskDraft";
import { SessionHistory, SessionHistoryList } from "./SessionHistory";
import { clock, elapsedSeconds } from "./sessionTime";
import { ArrowLeft, ChevronRight, MoreHorizontal, Pencil } from "lucide-react";
import { PencilProgress } from "./PencilProgress";
import { useFocusQuiet } from "./useFocusQuiet";
import { CompletionMoment } from "./CompletionMoment";
import { findPaperPet, paperPets } from "./pets";
import { prepareCompletionSound, playCompletionSound } from "./completionSound";
import {
  CoachState,
  emptyCoach,
  WorkStart,
  WorkCard,
  WorkMenu,
  WorkOverview,
  WorkEnd,
  CoachHelp,
  WorkHistory,
  CoachSettings,
} from "./CoachUI";
import "./consistency.css";
import "./task-sheet.css";
import "./session-pages.css";
import "./focus-strip.css";

const blank: State = { tasks: [], sessions: [], notes: [], coach: emptyCoach };
const native = !!(window as unknown as { __TAURI_INTERNALS__?: unknown })
  .__TAURI_INTERNALS__;
const active = (s: Session) =>
  ["running", "paused", "waiting"].includes(s.status);
const api = <T,>(action: string, input: Record<string, unknown> = {}) =>
  invoke<T>("paper_execute", { action, input });
function getStored<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) || "null") ?? fallback;
  } catch {
    return fallback;
  }
}

export default function PaperApp() {
  const [motto] = useState(() => {
    return PAPER_MOTTOS[Math.floor(Math.random() * PAPER_MOTTOS.length)];
  });
  const [petId, setPetId] = useState(
    () => findPaperPet(getStored<string>("paper-pet", "fish")).id,
  );
  const selectedPet = findPaperPet(petId);
  const pet = selectedPet.src;
  useEffect(() => {
    localStorage.setItem("paper-pet", JSON.stringify(petId));
  }, [petId]);
  const [data, setData] = useState<State>(blank),
    [loaded, setLoaded] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const {
    view,
    navigate: setView,
    reset: resetView,
    back: goBack,
  } = usePaperNavigation();
  const [workStartTask, setWorkStartTask] = useState<Task | null>(null);
  const [historyLimit, setHistoryLimit] = useState(20);
  const [revealTask, setRevealTask] = useState<{
    taskId: string;
    request: number;
  } | null>(null);
  const [today, setToday] = useState(localDate);
  useEffect(() => {
    const updateDay = () => setToday(localDate());
    const interval = window.setInterval(updateDay, 60_000);
    window.addEventListener("focus", updateDay);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", updateDay);
    };
  }, []);
  const draftBaseline = useRef<Draft>(taskDraft());
  const [selected, setSelected] = useState(
      getStored<string>("paper-selected", ""),
    ),
    [mini, setMini] = useState(false),
    [draft, setDraft] = useState<Draft | null>(null),
    [conflict, setConflict] = useState(false);
  const [duration, setDuration] = useState(25),
    [tick, setTick] = useState(Date.now()),
    [cue, setCue] = useState(""),
    [note, setNote] = useState(getStored<string>("paper-note", ""));
  const [expanded, setExpanded] = useState(false),
    [feedbackStuck, setFeedbackStuck] = useState(false),
    [feedback, setFeedback] = useState({
      output: "",
      blocker: "",
      nextCue: "",
    }),
    [receipt, setReceipt] = useState<Session | null>(null),
    [bridge, setBridge] = useState<{
      available: boolean;
      connectionFile: string;
    } | null>(null);
  const [quickNote, setQuickNote] = useState(false);
  const [openingWorkbench, setOpeningWorkbench] = useState(false);
  const [outcomeDraft, setOutcomeDraft] = useState<{
    sessionId: string;
    completed: boolean;
  } | null>(null);
  const [workMenu, setWorkMenu] = useState(false);
  const [undoTask, setUndoTask] = useState<Task | null>(null);
  const {
    showNotice,
    clearNotice,
    fallback: noticeFallback,
  } = usePaperNotice();
  const paperRef = useRef<HTMLElement | null>(null);
  const homeScrollRef = useRef<HTMLDivElement | null>(null);
  const latestState = useRef<State>(blank);
  const [prepareRefreshBlocked, setPrepareRefreshBlocked] = useState(false);
  const [journal, setJournal] = useState<{
    synced: boolean;
    directory?: string;
    error?: string;
    preservedEdits?: string[];
  } | null>(null);
  const [celebratedTask, setCelebratedTask] = useState<Task | null>(null);
  const [completionSound, setCompletionSound] = useState(
    getStored<boolean>("paper-completion-sound", true),
  );
  useEffect(() => {
    localStorage.setItem(
      "paper-completion-sound",
      JSON.stringify(completionSound),
    );
  }, [completionSound]);
  const lock = useRef(false),
    starting = useRef(false),
    sessionRef = useRef<string | null>(null),
    requestPending = useRef<{
      action: string;
      input: Record<string, unknown>;
      id: string;
    } | null>(null);
  const session = data.sessions.find(active);
  const coach = data.coach || emptyCoach;
  const work = [...coach.blocks].reverse().find((b) => b.status !== "ended");
  const focusQuiet = useFocusQuiet(
    view === "focus" &&
      session?.kind === "focus" &&
      session.status === "running" &&
      !mini &&
      !quickNote &&
      !workMenu &&
      !error &&
      !busy,
  );
  const choice = executionChoice(data, today, selected);
  const activeTask =
    session?.kind === "focus" &&
    data.tasks.find((task) => task.id === session.taskId);
  const task = activeTask
    ? { ...activeTask, title: session!.taskTitle, nextAction: session!.action }
    : choice.task;
  const preparationIssue = session
    ? undefined
    : prepareRefreshBlocked
      ? "下一步已保存，画面尚未读取最新结果，请重新读取后再开始。"
      : choice.issue;
  const completedTasks = data.tasks.filter((t) => t.completed);
  useEffect(() => {
    const step = choice.step;
    if (step && !session)
      setDuration(Math.max(1, Math.round(step.plannedSeconds / 60)));
  }, [task?.id, task?.nextAction?.id, choice.step?.plannedSeconds]);
  const resumeHint = task?.nextAction
    ? latestStepCue(data, task.id, task.nextAction.id)?.text
    : null;
  const completionTaskId = view === "receipt" ? receipt?.taskId : task?.id;
  const completionPrompt = completionTaskId
    ? taskCompletionPrompt(data, completionTaskId)
    : null;
  const unfinishedReceipt =
    !session &&
    receipt?.kind === "focus" &&
    receipt.feedback?.outcome === "stopped"
      ? receipt
      : null;
  const remaining = session
    ? session.plannedSeconds - elapsedSeconds(session, tick)
    : 0;
  const stateSignature = useRef("");
  const refreshing = useRef<Promise<void> | null>(null);
  const refreshAgain = useRef(false);
  const refresh = async (): Promise<void> => {
    if (!native) return;
    if (refreshing.current) {
      refreshAgain.current = true;
      return refreshing.current;
    }
    const pending = (async () => {
      do {
        refreshAgain.current = false;
        try {
          const r = await api<{ state: State; journal?: typeof journal }>(
            "get_state",
          );
          if (r.journal) setJournal(r.journal);
          latestState.current = r.state;
          setPrepareRefreshBlocked(false);
          const signature = JSON.stringify(r.state);
          if (signature !== stateSignature.current) {
            stateSignature.current = signature;
            setData(r.state);
          }
          setLoaded(true);
        } catch (e) {
          setError(`读取失败：${String(e)}`);
        }
      } while (refreshAgain.current);
    })();
    refreshing.current = pending;
    try {
      await pending;
    } finally {
      refreshing.current = null;
    }
  };
  useEffect(() => {
    if (!native) {
      setLoaded(true);
      setError("请通过桌面版打开。浏览器预览不连接真实任务。");
      return;
    }
    void refresh();
    let remove: (() => void) | undefined;
    let cancelled = false;
    void listen("paper:changed", () => {
      void refresh();
    }).then((fn) => {
      if (cancelled) fn();
      else remove = fn;
    });
    const timer = setInterval(() => {
      void refresh();
    }, 15000);
    return () => {
      cancelled = true;
      remove?.();
      clearInterval(timer);
    };
  }, []);
  useEffect(() => {
    if (!native) return;
    let off: (() => void) | undefined;
    let cancelled = false;
    void listen<string>("coach:navigate", (e) => {
      setMini(false);
      setWorkMenu(false);
      if (e.payload === "home") resetView("home");
      else setView(e.payload === "work-end" ? "work-end" : "work");
      void refresh();
    }).then((f) => {
      if (cancelled) f();
      else off = f;
    });
    return () => {
      cancelled = true;
      off?.();
    };
  }, []);
  useEffect(() => {
    if (!native) return;
    let cancelled = false;
    let off: (() => void) | undefined;
    let serial = 0;
    void listen<{
      taskId: string;
      stepId: string;
      plannedSeconds: number;
      item: DayItem | null;
    }>("workbench:select", (e) => {
      const request = ++serial;
      void refresh().then(() => {
        if (cancelled || request !== serial) return;
        const current = latestState.current;
        if (current.sessions.some(active)) {
          setError("本轮番茄钟还未结束，请先返回本轮保存，再选择下一步。");
          return;
        }
        const prepared = current.planning?.prepared;
        if (
          prepared?.taskId !== e.payload.taskId ||
          prepared.stepId !== e.payload.stepId ||
          prepared.dayItemId !== (e.payload.item?.id || null)
        )
          return;
        setSelected(e.payload.taskId);
        setMini(false);
        setWorkMenu(false);
        setQuickNote(false);
        resetView("home");
        clearNotice();
        requestAnimationFrame(() => {
          if (homeScrollRef.current) homeScrollRef.current.scrollTop = 0;
        });
      });
    }).then((remove) => {
      if (cancelled) remove();
      else off = remove;
    });
    return () => {
      cancelled = true;
      off?.();
    };
  }, []);
  useEffect(() => {
    if (view !== "focus" || session?.status !== "running") return;
    setTick(Date.now());
    const timer = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [view, session?.id, session?.status]);
  useEffect(() => {
    if (session?.status === "running" && remaining <= 0 && view === "focus")
      void refresh();
  }, [session?.id, session?.status, remaining, view]);
  useEffect(() => {
    if (!session) {
      const finished = data.sessions.find(
        (s) => s.id === sessionRef.current && s.status === "finished",
      );
      if (finished && ["focus", "feedback"].includes(view)) {
        setReceipt(finished);
        resetView(
          finished.feedback?.outcome === "step_completed" ? "receipt" : "home",
        );
      }
      sessionRef.current = null;
      return;
    }
    if (session.id !== sessionRef.current) {
      sessionRef.current = session.id;
      setOutcomeDraft({
        sessionId: session.id,
        completed:
          getStored<boolean>(`paper-outcome-${session.id}`, false) === true,
      });
      setCue(getStored(`paper-cue-${session.id}`, session.resumeCue || ""));
      setFeedbackStuck(
        getStored<boolean>(`paper-feedback-stuck-${session.id}`, false) ===
          true,
      );
      setFeedback(
        getStored(`paper-feedback-${session.id}`, {
          output: "",
          blocker: "",
          nextCue: "",
        }),
      );
      resetView(
        session.status === "waiting" && session.kind !== "rest"
          ? "feedback"
          : "focus",
      );
    } else if (
      session.status === "waiting" &&
      view === "focus" &&
      session.kind !== "rest"
    ) {
      resetView("feedback");
    }
  }, [session?.id, session?.status, view]);
  useEffect(() => {
    if (draft) persistDraft(draft, draftBaseline.current);
  }, [draft]);
  useEffect(() => {
    localStorage.setItem("paper-selected", JSON.stringify(selected));
  }, [selected]);
  useEffect(() => {
    localStorage.setItem("paper-note", JSON.stringify(note));
  }, [note]);
  useEffect(() => {
    if (session)
      localStorage.setItem(
        `paper-feedback-${session.id}`,
        JSON.stringify(feedback),
      );
  }, [feedback]);
  useEffect(() => {
    if (session)
      localStorage.setItem(`paper-cue-${session.id}`, JSON.stringify(cue));
  }, [cue]);
  useEffect(() => {
    if (!undoTask || view !== "home") return;
    const timer = setTimeout(() => setUndoTask(null), 8000);
    return () => clearTimeout(timer);
  }, [undoTask, view]);
  const back = () =>
    goBack(
      session
        ? session.status === "waiting" && session.kind === "focus"
          ? "feedback"
          : "focus"
        : "home",
      (candidate) => {
        if (["focus", "feedback"].includes(candidate)) return !!session;
        if (["work", "work-end", "coach-help"].includes(candidate))
          return !!work;
        if (candidate === "work-start")
          return !work && !session && !!workStartTask;
        return !["receipt", "celebration", "edit"].includes(candidate);
      },
    );
  const openWorkStart = async () => {
    if (!task || preparationIssue) return;
    const prepared = await prepareChoice(task, choice.step, choice.item);
    if (!prepared) return;
    setWorkStartTask(structuredClone(prepared));
    setView("work-start");
  };
  const layout = mini
    ? "mini"
    : view === "focus" && session?.kind === "focus"
      ? quickNote || workMenu || work?.mode === "waiting_ai"
        ? "focus-note"
        : session.status === "paused"
          ? "paused"
          : "focus"
      : view === "focus" && session?.kind === "rest"
        ? "rest"
        : view === "feedback"
          ? "focus-complete"
          : view === "celebration" ||
              (view === "receipt" &&
                receipt?.feedback?.outcome === "step_completed")
            ? "celebration"
            : view === "receipt"
              ? "receipt"
              : "full";
  useEffect(() => {
    if (native)
      void invoke("set_window_layout", { layout }).catch((e) =>
        setError(String(e)),
      );
  }, [layout]);
  const mutate = async (
    action: string,
    input: Record<string, unknown> = {},
  ): Promise<Record<string, unknown> | null> => {
    if (lock.current) return null;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const prior = requestPending.current;
      const id =
        prior?.action === action &&
        JSON.stringify(prior.input) === JSON.stringify(input)
          ? prior.id
          : crypto.randomUUID();
      requestPending.current = { action, input, id };
      const result = await api<Record<string, unknown>>(action, {
        ...input,
        requestId: id,
      });
      requestPending.current = null;
      await refresh();
      return result;
    } catch (e) {
      setError(String(e));
      if (String(e).includes("CONFLICT")) setConflict(true);
      return null;
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const edit = (t?: Task) => {
    setConflict(false);
    setError("");
    const savedDraft = getStored<Draft | null>(
      `paper-draft-${t?.id || "new"}`,
      null,
    );
    const baseline = taskDraft(t, t?.id === task?.id ? resumeHint || "" : "");
    const nextDraft: Draft = savedDraft || {
      ...baseline,
      ...(t ? {} : { newId: crypto.randomUUID() }),
    };
    draftBaseline.current = baseline;
    setDraft(nextDraft);
    setView("edit");
  };
  const save = async () => {
    if (!draft) return;
    const r = draft.id
      ? await mutate("update_task", {
          taskId: draft.id,
          expectedRevision: draft.revision,
          patch: {
            title: draft.title,
            due: draft.due || null,
            category: draft.category || "work",
            priority: draft.priority || "medium",
            nextAction: draft.nextAction || null,
          },
        })
      : await mutate("create_task", {
          taskId: draft.newId || crypto.randomUUID(),
          ...(draft.originNoteId ? { originNoteId: draft.originNoteId } : {}),
          title: draft.title,
          due: draft.due || null,
          category: draft.category || "work",
          priority: draft.priority || "medium",
          nextAction: draft.nextAction || null,
        });
    if (r) {
      const saved = r.task as Task;
      if (!session) {
        const latest =
          latestState.current.tasks.find((task) => task.id === saved.id) ||
          saved;
        const step = latestState.current.planning?.steps.find(
          (step) =>
            step.taskId === latest.id && step.id === latest.nextAction?.id,
        );
        const savedPreparation = latestState.current.planning?.prepared;
        const keepsSource =
          savedPreparation?.taskId === latest.id &&
          savedPreparation.stepId === step?.id;
        const source =
          keepsSource && savedPreparation.dayItemId
            ? latestState.current.planning?.dayItems.find(
                (item) => item.id === savedPreparation.dayItemId,
              )
            : undefined;
        if (keepsSource && savedPreparation.dayItemId && !source) {
          setError("任务已保存，原安排已不可用，请重新选择下一步。");
          return;
        }
        if (!(await prepareChoice(latest, step, source))) return;
      }
      setSelected(saved.id);
      localStorage.removeItem("paper-edit-draft");
      localStorage.removeItem(
        `paper-draft-${draft.id || draft.originNoteId || "new"}`,
      );
      setDraft(null);
      resetView(session ? "focus" : "home");
    }
  };
  const start = async (kind = "focus", target = task) => {
    if (kind === "focus" && !target) return false;
    if (
      kind === "focus" &&
      target?.id === choice.task?.id &&
      preparationIssue
    ) {
      setError(preparationIssue);
      return false;
    }
    const step = data.planning?.steps.find(
      (s) => s.id === target?.nextAction?.id && s.taskId === target?.id,
    );
    const planItem =
      target?.id === choice.task?.id && step?.id === choice.step?.id
        ? choice.item
        : planningViews(data, today).today.find(
            (row) => row.task.id === target?.id && row.step?.id === step?.id,
          )?.item;
    const r = await mutate("start_session", {
      kind,
      plannedSeconds: kind === "rest" ? 300 : duration * 60,
      ...(kind === "focus"
        ? { taskId: target!.id, expectedRevision: target!.revision }
        : {}),
      ...(kind === "focus" && step
        ? {
            stepId: step.id,
            expectedStepRevision: step.revision,
            ...(planItem ? { dayItemId: planItem.id } : {}),
          }
        : {}),
    });
    if (r) {
      setExpanded(false);
      setFeedbackStuck(false);
      setQuickNote(false);
      setFeedback({ output: "", blocker: "", nextCue: "" });
      resetView("focus");
    }
    return !!r;
  };
  const startSelected = async () => {
    if (session) {
      setView("focus");
      return;
    }
    if (!task || starting.current) return;
    if (preparationIssue) {
      setError(preparationIssue);
      return;
    }
    starting.current = true;
    try {
      let switched = false;
      if (work?.status === "active" && work.taskId !== task.id) {
        const changed = await mutate("switch_work_task", {
          blockId: work.id,
          expectedRevision: work.revision,
          taskId: task.id,
          expectedTaskRevision: task.revision,
        });
        if (!changed) return;
        switched = true;
      }
      const started = await start("focus", task);
      if (!started && switched)
        showNotice(
          "工作目标已切换，本轮尚未开始。看过错误提示后可重试 start。",
        );
    } finally {
      starting.current = false;
    }
  };
  const prepareChoice = async (
    target: Task,
    step?: PlanStep,
    item?: DayItem,
  ): Promise<Task | null> => {
    if (latestState.current.sessions.some(active) || step?.completed)
      return null;
    const result = await mutate("prepare_step", {
      taskId: target.id,
      stepId: step?.id || null,
      expectedRevision: target.revision,
      expectedStepRevision: step?.revision ?? null,
      dayItemId: item?.id || null,
    });
    if (result) {
      if (latestState.current.sessions.some(active)) {
        setError(
          "当前一轮已经开始，请先返回本轮；便签不会替换正在执行的步骤。",
        );
        return null;
      }
      const persisted = latestState.current.planning?.prepared;
      if (
        persisted?.taskId !== target.id ||
        persisted.stepId !== (result.step as PlanStep).id ||
        persisted.dayItemId !== (item?.id || null)
      ) {
        setPrepareRefreshBlocked(true);
        setError("下一步已保存，画面尚未读取最新结果，请重新读取后再开始。");
        return null;
      }
      setSelected(target.id);
      setDuration(
        Math.max(1, Math.round((result.step as PlanStep).plannedSeconds / 60)),
      );
      return result.task as Task;
    }
    return null;
  };
  const chooseStep = async (step: PlanStep, item?: DayItem) => {
    const target = data.tasks.find((t) => t.id === step.taskId);
    if (!target || !(await prepareChoice(target, step, item))) return;
    setReceipt(null);
    setRevealTask(null);
    resetView("home");
    clearNotice();
    requestAnimationFrame(() => {
      if (homeScrollRef.current) homeScrollRef.current.scrollTop = 0;
    });
  };
  const chooseNextStep = (taskId?: string | null) => {
    if (taskId)
      setRevealTask((previous) => ({
        taskId,
        request: (previous?.request || 0) + 1,
      }));
    resetView("home");
    requestAnimationFrame(() => {
      homeScrollRef.current
        ?.querySelector(".task-sheet")
        ?.scrollIntoView?.({ block: "start" });
    });
  };
  const continueStep = async (previous: Session) => {
    const current = latestState.current;
    if (current.sessions.some(active)) {
      setError("当前一轮还未保存，请先返回本轮。");
      return;
    }
    const target = current.tasks.find((t) => t.id === previous.taskId);
    const step = current.planning?.steps.find(
      (s) => s.id === previous.action?.id && s.taskId === previous.taskId,
    );
    if (!target || target.completed || !step || step.completed) {
      setError("原步骤已完成或不可用，请在清单选择下一步。");
      return;
    }
    const source = current.planning?.sessionLinks?.find(
      (link) => link.sessionId === previous.id,
    );
    const item = source
      ? current.planning?.dayItems.find((item) => item.id === source.dayItemId)
      : undefined;
    if (
      source &&
      (!item ||
        item.removedAt != null ||
        item.taskId !== target.id ||
        item.stepId !== step.id)
    ) {
      setError(
        "原安排已取消或变化，请在清单重新选择这一步；不会自动改成计划外执行。",
      );
      return;
    }
    if (await prepareChoice(target, step, item)) {
      setReceipt(null);
      setRevealTask(null);
      resetView("home");
      showNotice("这一步已准备好，点击 start 再开始。");
    }
  };
  const sessionAction = async (
    action: string,
    extra: Record<string, unknown> = {},
  ) => {
    if (!session) return null;
    return mutate(action, {
      sessionId: session.id,
      expectedRevision: session.revision,
      ...extra,
    });
  };
  const withCue = async (action: string) => {
    if (!session) return;
    let revision = session.revision;
    if (cue !== (session.resumeCue || "")) {
      const saved = await sessionAction("save_cue", { resumeCue: cue });
      if (!saved) return;
      revision = (saved.session as Session).revision;
    }
    await mutate(action, { sessionId: session.id, expectedRevision: revision });
  };
  const saveCue = async () => {
    if (!session || cue === session.resumeCue || (!cue && !session.resumeCue))
      return true;
    const r = await sessionAction("save_cue", { resumeCue: cue });
    return !!r;
  };
  const returnToTasks = () => {
    setWorkMenu(false);
    setQuickNote(false);
    setView("home");
  };
  const openSessionEnd = async () => {
    if (!session || busy) return;
    // Stop counting before asking for an outcome; browsing never changes it.
    if (session.status === "running") {
      if (!(await sessionAction("pause_session"))) return;
    } else if (session.status === "paused" && !(await saveCue())) return;
    setWorkMenu(false);
    setQuickNote(false);
    setExpanded(false);
    setView("feedback");
  };
  const finish = async (outcome: string) => {
    if (completionSound && outcome === "step_completed")
      prepareCompletionSound();
    const r = await sessionAction("finish_session", { outcome, ...feedback });
    if (r) {
      if (completionSound && outcome === "step_completed")
        playCompletionSound(false);
      setReceipt(r.session as Session);
      localStorage.removeItem(`paper-feedback-${session?.id}`);
      localStorage.removeItem(`paper-feedback-stuck-${session?.id}`);
      localStorage.removeItem(`paper-outcome-${session?.id}`);
      setOutcomeDraft(null);
      sessionRef.current = null;
      resetView(outcome === "step_completed" ? "receipt" : "home");
      if (outcome !== "step_completed")
        showNotice(
          outcome === "rest_ended"
            ? "休息结束，下一步由你决定。"
            : "番茄钟已结束，计时已保存，待办保持未完成。",
        );
    }
  };
  const completeTask = async (t: Task, stayOnSheet = false) => {
    if (!t.completed && completionSound) prepareCompletionSound();
    const r = await mutate("update_task", {
      taskId: t.id,
      expectedRevision: t.revision,
      patch: { completed: !t.completed },
    });
    if (r) {
      setUndoTask(t.completed ? null : (r.task as Task));
      if (t.completed) {
        setSelected(t.id);
        if (view === "celebration") setView("home");
      } else {
        if (!stayOnSheet) {
          setCelebratedTask(r.task as Task);
          setView("celebration");
        }
        if (completionSound) playCompletionSound(true);
      }
    }
  };
  const completeStep = async (step: PlanStep) => {
    const parent = data.tasks.find((t) => t.id === step.taskId);
    if (session || !parent || parent.completed) return;
    await mutate("set_step_completed", {
      taskId: parent.id,
      stepId: step.id,
      expectedTaskRevision: parent.revision,
      expectedStepRevision: step.revision,
      completed: !step.completed,
    });
  };
  const keepTaskOpen = async () => {
    if (!completionPrompt) return;
    await mutate("acknowledge_task_completion", {
      taskId: completionPrompt.task.id,
      expectedTaskRevision: completionPrompt.task.revision,
      steps: completionPrompt.steps.map((step) => ({
        id: step.id,
        revision: step.revision,
      })),
    });
  };
  const parentCompletion = () =>
    completionPrompt && (
      <section className="task-completion-prompt" aria-label="父任务收尾">
        <p>整个任务也完成了吗？</p>
        <small>{completionPrompt.task.title}</small>
        <div>
          <button
            className="text-button"
            disabled={busy}
            onClick={() => void completeTask(completionPrompt.task)}
          >
            整个任务已完成
          </button>
          <button
            className="text-button"
            disabled={busy}
            onClick={() => void keepTaskOpen()}
          >
            保留后续
          </button>
        </div>
      </section>
    );
  const changeDraft = (key: keyof Draft, value: string) =>
    setDraft((d) => (d ? { ...d, [key]: value } : d));
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const paperDragEnabled =
    view === "feedback" || (view === "focus" && session?.kind === "focus");
  const paperDragProps = useWindowDrag({
    enabled: native && !mini && paperDragEnabled,
    moveBy: (deltaX, deltaY) => invoke("move_window_by", { deltaX, deltaY }),
    onError: (error) => setError(String(error)),
  });
  const dragProps = {
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      if (
        e.button !== 0 ||
        (e.target as HTMLElement).closest("button,input,textarea,select,a")
      )
        return;
      drag.current = { x: e.screenX, y: e.screenY, moved: false };
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    onPointerMove: (e: React.PointerEvent<HTMLElement>) => {
      const d = drag.current;
      if (!d) return;
      const dx = e.screenX - d.x,
        dy = e.screenY - d.y;
      if (Math.abs(dx) + Math.abs(dy) > 1) {
        d.moved = true;
        d.x = e.screenX;
        d.y = e.screenY;
        if (native) void invoke("move_window_by", { deltaX: dx, deltaY: dy });
      }
    },
    onPointerUp: () => {
      const d = drag.current;
      drag.current = null;
      if (mini && d && !d.moved) setMini(false);
    },
  };
  const header = (showBack = false) => (
    <header {...dragProps}>
      {showBack ? (
        <button className="icon" aria-label="返回上一页" onClick={back}>
          <ArrowLeft size={16} />
        </button>
      ) : null}
      <span className="brand">Inky Paper</span>
      <div className="header-actions">
        <button
          className="icon"
          aria-label="切换迷你宠物"
          title="迷你宠物"
          onClick={() => setMini(true)}
        >
          <img
            src="/paper-assets/imgIconMinimize2.svg"
            alt=""
            className="ui-icon"
          />
        </button>
        {view !== "settings" && (
          <button className="outline small" onClick={() => setView("settings")}>
            设置
          </button>
        )}
      </div>
    </header>
  );
  const footer = () => (
    <PaperFooter
      pet={pet}
      petName={selectedPet.name}
      motto={motto}
      openPet={() => setMini(true)}
    />
  );
  const errors = error ? (
    <div className="error" role="alert">
      {error.replace(/^.*CONFLICT: /, "")}
      <button
        onClick={() => {
          setError("");
          void refresh();
        }}
      >
        重新读取
      </button>
    </div>
  ) : null;
  if (mini)
    return (
      <main
        className="mini-pet"
        {...dragProps}
        role="button"
        tabIndex={0}
        aria-label="返回 Inky Paper"
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") setMini(false);
        }}
      >
        <img src={pet} draggable={false} alt={selectedPet.name} />
      </main>
    );
  return (
    <main
      ref={paperRef}
      id="paper-page-scroll"
      className={`paper paper-scroll-surface ${layout} ${view}${focusQuiet ? " focus-quiet" : ""}${view === "focus" ? (session?.kind === "rest" ? " rest-view" : " focus-strip") : ""}`}
      {...(paperDragEnabled ? paperDragProps : {})}
    >
      {view !== "home" &&
        view !== "focus" &&
        view !== "feedback" &&
        view !== "celebration" &&
        view !== "receipt" &&
        header(true)}
      {errors}
      {journal && !journal.synced && (
        <p className="journal-warning" role="status">
          {journal.error || "Markdown 待同步，应用中的记录已保存。"}
        </p>
      )}
      {noticeFallback}
      {!loaded ? (
        <div className="empty">正在打开纸页…</div>
      ) : view === "day-plan" ? (
        <DayPlan
          data={data}
          busy={busy}
          hasSession={!!session}
          mutate={mutate}
          choose={chooseStep}
          reportError={setError}
        />
      ) : view === "work-start" && workStartTask ? (
        <WorkStart
          key={`${workStartTask.id}-${workStartTask.revision}`}
          task={workStartTask}
          currentTask={data.tasks.find((t) => t.id === workStartTask.id)}
          settings={coach.settings}
          initialSeconds={duration * 60}
          reviewTask={(latest) =>
            setWorkStartTask(structuredClone(latest as Task))
          }
          busy={busy}
          mutate={mutate}
          done={(timed) => {
            setWorkMenu(false);
            resetView(timed ? "focus" : "work");
          }}
        />
      ) : view === "work" && work ? (
        <WorkOverview
          key={work.id}
          taskCompleted={
            !!data.tasks.find((t) => t.id === work.taskId)?.completed
          }
          nextAction={
            data.tasks.find((t) => t.id === work.taskId)?.nextAction?.text
          }
          block={work}
          coach={coach}
          busy={busy}
          mutate={mutate}
          open={setView}
          hasSession={!!session}
          startSession={() => {
            const target = data.tasks.find((t) => t.id === work.taskId);
            if (target) void start("focus", target);
          }}
        />
      ) : view === "work-end" && work ? (
        <WorkEnd
          block={work}
          busy={busy}
          hasSession={!!session}
          mutate={mutate}
          done={() => {
            sessionRef.current = null;
            setView("home");
          }}
        />
      ) : view === "coach-help" && work ? (
        <CoachHelp
          block={work}
          coach={coach}
          busy={busy}
          mutate={mutate}
          refresh={refresh}
          hasSession={!!session}
          adopt={async (input) =>
            mutate("respond_coach_proposal", {
              ...input,
              ...(session
                ? {
                    finishSessionId: session.id,
                    expectedSessionRevision: session.revision,
                  }
                : {}),
            })
          }
          openWork={() => setView("work")}
        />
      ) : view === "home" ? (
        <>
          <div
            className="home-body paper-scroll-surface"
            id="paper-home-scroll"
            ref={homeScrollRef}
          >
            {header()}
            <section className="intro">
              <h1>就从这一步开始</h1>
            </section>
            {session && !task && (
              <button className="primary" onClick={() => setView("focus")}>
                {session.kind === "rest" ? "返回休息计时" : "返回番茄钟"}
              </button>
            )}
            {task ? (
              <section
                className="next-card"
                aria-label="当前步骤"
                data-single-content={
                  !task.nextAction?.text ||
                  task.nextAction.text.trim().replace(/\s+/g, " ") ===
                    task.title.trim().replace(/\s+/g, " ")
                }
              >
                <img
                  className="tape"
                  src="/paper-assets/imgPaper4.svg"
                  alt=""
                />
                <div className="next-card-top">
                  {task.nextAction?.text &&
                    task.nextAction.text.trim().replace(/\s+/g, " ") !==
                      task.title.trim().replace(/\s+/g, " ") && (
                      <p className="eyebrow">{task.title}</p>
                    )}
                  <button
                    className="sheet-edit"
                    aria-label="修改下一步"
                    title="修改这一步"
                    onClick={() => edit(task)}
                  >
                    <Pencil size={13} />
                  </button>
                </div>
                <h2 className={task.nextAction?.completed ? "crossed" : ""}>
                  {task.nextAction?.text || task.title}
                </h2>
                {resumeHint && (
                  <p className="resume-hint">
                    <span>上次留给自己</span>
                    {resumeHint}
                  </p>
                )}
                {preparationIssue && (
                  <p className="error" role="alert">
                    {preparationIssue}
                  </p>
                )}
                {!preparationIssue &&
                  choice.item &&
                  choice.item.date !== today &&
                  !session && (
                    <p className="caption">
                      来自 {choice.item.date} 的安排；计时按实际发生日记录。
                    </p>
                  )}
                {task.nextAction?.completed && !session ? (
                  <p className="muted">这一步已划掉，去下面选下一步。</p>
                ) : (
                  <div className="next-start-row">
                    {!session && (
                      <select
                        aria-label="专注时长"
                        value={duration}
                        onChange={(e) => setDuration(Number(e.target.value))}
                        disabled={busy}
                      >
                        {![15, 25, 45].includes(duration) && (
                          <option value={duration}>{duration} 分钟</option>
                        )}
                        <option value={15}>15 分钟</option>
                        <option value={25}>25 分钟</option>
                        <option value={45}>45 分钟</option>
                      </select>
                    )}
                    <button
                      className={`primary${session ? " return-to-round" : ""}`}
                      disabled={busy || !!preparationIssue}
                      onClick={() => void startSelected()}
                    >
                      {session
                        ? session.kind === "rest"
                          ? "返回休息计时"
                          : "返回番茄钟"
                        : "start"}
                    </button>
                  </div>
                )}
              </section>
            ) : (
              <section className="blank-note">
                {preparationIssue && (
                  <p className="error" role="alert">
                    {preparationIssue}
                  </p>
                )}
                <img
                  className="empty-pet"
                  src={pet}
                  alt="Inky 陪你留下一件小事"
                />
                <p>
                  {completedTasks.length
                    ? "做过的事，已经留在纸上。"
                    : "不必把一天安排满。"}
                  <br />
                  {completedTasks.length
                    ? "可以歇一会儿，也可以再添一件。"
                    : "先留下一件就好。"}
                </p>
              </section>
            )}
            {parentCompletion()}
            {unfinishedReceipt && (
              <section className="step-continuation" aria-label="继续本轮步骤">
                <p>
                  刚才停在：
                  {unfinishedReceipt.action?.text ||
                    unfinishedReceipt.taskTitle}
                </p>
                <div>
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={() => void continueStep(unfinishedReceipt)}
                  >
                    继续这一步
                  </button>
                  <button
                    className="text-button"
                    onClick={() => chooseNextStep(unfinishedReceipt.taskId)}
                  >
                    选择其他步骤
                  </button>
                </div>
              </section>
            )}
            {session && (
              <p className="session-browse-status" role="status">
                {session.status === "running"
                  ? "计时继续中，查看任务不会中断。"
                  : session.status === "paused"
                    ? "计时已暂停，可返回继续或结束。"
                    : "计时已到时，可返回记录完成情况。"}
              </p>
            )}
            <TaskSheet
              data={data}
              date={today}
              selectedTaskId={task?.id}
              selectedStepId={task?.nextAction?.id}
              revealTask={revealTask}
              busy={busy}
              hasSession={!!session}
              choose={chooseStep}
              selectTask={(target) => {
                if (session) return;
                void prepareChoice(target).then((prepared) => {
                  if (prepared && homeScrollRef.current)
                    homeScrollRef.current.scrollTop = 0;
                });
              }}
              edit={edit}
              complete={(target) => completeTask(target, true)}
              completeStep={completeStep}
            />
            {undoTask && (
              <div className="undo-note" role="status">
                <span>任务已划掉</span>
                <button
                  disabled={busy}
                  onClick={() => {
                    const latest = data.tasks.find((t) => t.id === undoTask.id);
                    if (latest?.completed) void completeTask(latest);
                    else setUndoTask(null);
                  }}
                >
                  撤销
                </button>
              </div>
            )}
            <button className="outline add" onClick={() => edit()}>
              <img
                className="ui-icon"
                src="/paper-assets/imgIconPlus.svg"
                alt=""
              />{" "}
              临时做一件
            </button>
            <button
              className="outline today-plan-link"
              onClick={() => setView("day-plan")}
            >
              <span>今日计划与记录</span>
              <span>{planningViews(data, today).today.length} 张卡片</span>
            </button>
            {work ? (
              <WorkCard block={work} open={() => setView("work")} />
            ) : !session &&
              task &&
              !task.nextAction?.completed &&
              !preparationIssue ? (
              <button
                className="text-button work-start-link"
                onClick={openWorkStart}
              >
                安排一个工作时段
              </button>
            ) : null}
            <div className="quiet-nav">
              <button onClick={() => setView("notes")}>随手记</button>
              <span>·</span>
              <button onClick={() => setView("history")}>足迹</button>
              <span>·</span>
              <button
                aria-label="打开工作台"
                aria-busy={openingWorkbench}
                disabled={openingWorkbench}
                onClick={() => {
                  setOpeningWorkbench(true);
                  void invoke("open_workbench")
                    .catch((e) => setError(`打开工作台失败：${String(e)}`))
                    .finally(() => setOpeningWorkbench(false));
                }}
              >
                工作台
              </button>
            </div>
            {getStored<Draft | null>("paper-edit-draft", null) && (
              <button
                className="draft-link"
                onClick={() => {
                  const saved = getStored<Draft | null>(
                    "paper-edit-draft",
                    null,
                  );
                  draftBaseline.current = taskDraft(
                    data.tasks.find((t) => t.id === saved?.id),
                  );
                  setDraft(saved);
                  setView("edit");
                }}
              >
                继续未保存的草稿
              </button>
            )}
          </div>
          {footer()}
        </>
      ) : view === "edit" && draft ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <h1>{draft.id ? "整理这件事" : "添一件小事"}</h1>
          <p className="muted">下一步，写到可以直接动手。</p>
          <label>
            任务名称
            <input
              autoFocus
              required
              maxLength={300}
              value={draft.title}
              onChange={(e) => changeDraft("title", e.target.value)}
            />
          </label>
          <details className="task-metadata">
            <summary>分类与优先级</summary>
            <div className="metadata-fields">
              <label>
                分类
                <select
                  aria-label="分类"
                  value={draft.category || "work"}
                  onChange={(e) => changeDraft("category", e.target.value)}
                >
                  <option value="work">工作</option>
                  <option value="study">学习</option>
                  <option value="life">生活</option>
                  <option value="idea">想法</option>
                </select>
              </label>
              <label>
                优先级
                <select
                  aria-label="优先级"
                  value={draft.priority || "medium"}
                  onChange={(e) => changeDraft("priority", e.target.value)}
                >
                  <option value="high">高</option>
                  <option value="medium">中</option>
                  <option value="low">低</option>
                </select>
              </label>
            </div>
          </details>
          <label>
            截止备注 · 不自动提醒
            <input
              maxLength={100}
              placeholder="例如：周五下班前"
              value={draft.due}
              onChange={(e) => changeDraft("due", e.target.value)}
            />
          </label>
          <label>
            下一步
            <textarea
              maxLength={300}
              placeholder="例如：列出任务页的 3 个关键状态"
              value={draft.nextAction}
              onChange={(e) => changeDraft("nextAction", e.target.value)}
            />
          </label>
          {conflict && (
            <div className="conflict">
              <p>
                最新内容：{data.tasks.find((t) => t.id === draft.id)?.title}
                <br />
                {data.tasks.find((t) => t.id === draft.id)?.nextAction?.text}
              </p>
              <button
                type="button"
                onClick={() => {
                  setDraft({
                    ...draft,
                    revision: data.tasks.find((t) => t.id === draft.id)
                      ?.revision,
                  });
                  setConflict(false);
                  setError("");
                }}
              >
                已核对，保留我的草稿
              </button>
            </div>
          )}
          <div className="form-actions">
            <button className="primary" disabled={busy || conflict || !native}>
              保存
            </button>
            <button type="button" className="text-button" onClick={back}>
              稍后再写
            </button>
            {draft.id && (
              <button
                type="button"
                className="text-button"
                disabled={busy || session?.taskId === draft.id}
                onClick={async () => {
                  const current = data.tasks.find((t) => t.id === draft.id);
                  if (current) {
                    await completeTask(current);
                  }
                }}
              >
                整个任务都完成了
              </button>
            )}
          </div>
        </form>
      ) : view === "focus" && session ? (
        <>
          {session.kind === "rest" ? (
            <>
              {header()}
              <section className="rest-heading">
                <h1>
                  {session.status === "waiting" ? "休息结束" : "休息一下"}
                </h1>
              </section>
              <section className="rest-clock">
                <div className="timer" role="timer">
                  {clock(remaining)}
                </div>
                <progress
                  aria-label="休息进度"
                  max={session.plannedSeconds}
                  value={Math.max(0, session.plannedSeconds - remaining)}
                />
                <p>
                  {session.status === "waiting"
                    ? "下一步，等你准备好再开始。"
                    : "起身走走，看看窗外。"}
                </p>
              </section>
              <button
                className="primary rest-end"
                disabled={busy}
                onClick={() => void finish("rest_ended")}
              >
                结束休息
              </button>
              <button
                className="text-button rest-return"
                onClick={returnToTasks}
              >
                返回任务列表
              </button>
              {footer()}
            </>
          ) : (
            <>
              <nav className="focus-navigation" aria-label="番茄钟导航">
                <button onClick={returnToTasks}>
                  <ArrowLeft size={13} />
                  返回任务列表
                </button>
                <button disabled={busy} onClick={() => void openSessionEnd()}>
                  结束番茄钟
                </button>
              </nav>
              <div className="focus-main">
                <div className="focus-heading">
                  <div>
                    <h2 title={session.action?.text || session.taskTitle}>
                      {session.action?.text || session.taskTitle}
                    </h2>
                    <p className="focus-state">
                      {session.status === "paused"
                        ? work?.mode === "waiting_ai"
                          ? "等待 AI"
                          : "已暂停"
                        : session.status === "waiting"
                          ? "本轮结束"
                          : "正在专注"}
                    </p>
                  </div>
                </div>
                <div className="focus-clock">
                  <div className="timer-row">
                    <span
                      className={`timer${clock(remaining).length > 5 ? " timer-wide" : ""}`}
                      role="timer"
                    >
                      {clock(remaining)}
                    </span>
                  </div>
                </div>
              </div>
              <PencilProgress
                elapsed={session.plannedSeconds - remaining}
                total={session.plannedSeconds}
                running={session.status === "running"}
              />
              <div className="focus-bottom">
                <div className="focus-action-group">
                  <button
                    className="focus-toggle"
                    disabled={busy}
                    onClick={() =>
                      void (work?.mode === "waiting_ai"
                        ? mutate("set_work_mode", {
                            blockId: work.id,
                            expectedRevision: work.revision,
                            mode: "working",
                            resumeCue: cue || null,
                          })
                        : session.status === "paused"
                          ? withCue("resume_session")
                          : sessionAction("pause_session"))
                    }
                  >
                    {session.status === "paused" ? "继续" : "暂停"}
                  </button>
                  {work && (
                    <button
                      className="work-more"
                      aria-label="更多工作操作"
                      aria-expanded={workMenu}
                      onClick={() => {
                        setQuickNote(false);
                        setWorkMenu(!workMenu);
                      }}
                    >
                      <MoreHorizontal size={15} />
                    </button>
                  )}
                </div>
                <button
                  className="focus-pet"
                  aria-label="切换迷你宠物"
                  title="切换迷你宠物"
                  onClick={() => setMini(true)}
                >
                  <img src={pet} alt="" />
                </button>
                <button
                  className="focus-note-button"
                  onClick={() => setQuickNote(!quickNote)}
                  aria-expanded={quickNote}
                >
                  <img
                    className="ui-icon"
                    src="/paper-assets/imgIconPlus.svg"
                    alt=""
                  />
                  随手记
                </button>
              </div>
              {workMenu && work && (
                <WorkMenu
                  block={work}
                  busy={busy}
                  mutate={mutate}
                  close={() => setWorkMenu(false)}
                  open={(v) => {
                    setWorkMenu(false);
                    setView(v);
                  }}
                />
              )}
              {work?.mode === "waiting_ai" && session.status === "paused" && (
                <p className="work-wait-label">
                  等待 AI · 回来先查看刚才的结果
                </p>
              )}
              {quickNote && (
                <section className="quick-note">
                  <div className="quick-note-heading">
                    <span>页边随手记</span>
                    <button onClick={() => setQuickNote(false)}>收起</button>
                  </div>
                  <textarea
                    autoFocus
                    rows={2}
                    maxLength={2000}
                    aria-label="本轮随手记"
                    value={note}
                    placeholder="先记下来，稍后再处理"
                    onChange={(e) => setNote(e.target.value)}
                  />
                  <button
                    className="primary"
                    disabled={busy || !note.trim()}
                    onClick={async () => {
                      if (
                        await mutate("capture_note", {
                          text: note,
                          sessionId: session.id,
                        })
                      ) {
                        setNote("");
                        setQuickNote(false);
                      }
                    }}
                  >
                    记下，回到这一轮
                  </button>
                </section>
              )}
              {session.status === "paused" && !quickNote && (
                <div className="cue">
                  <label>
                    回来先做什么？
                    <input
                      aria-label="回来先做什么"
                      maxLength={500}
                      placeholder="留下一句，方便继续"
                      value={cue}
                      onChange={(e) => {
                        setCue(e.target.value);
                      }}
                    />
                  </label>
                </div>
              )}
            </>
          )}
        </>
      ) : view === "feedback" && session ? (
        <SessionEnd
          key={session.id}
          session={session}
          busy={busy}
          completed={
            outcomeDraft?.sessionId === session.id && outcomeDraft.completed
          }
          chooseCompleted={(completed) => {
            setOutcomeDraft({ sessionId: session.id, completed });
            localStorage.setItem(
              `paper-outcome-${session.id}`,
              JSON.stringify(completed),
            );
          }}
          expanded={expanded}
          setExpanded={setExpanded}
          feedback={feedback}
          setFeedback={setFeedback}
          stuck={feedbackStuck}
          setStuck={(stuck) => {
            setFeedbackStuck(stuck);
            localStorage.setItem(
              `paper-feedback-stuck-${session.id}`,
              JSON.stringify(stuck),
            );
          }}
          returnToTasks={returnToTasks}
          returnToTimer={() => setView("focus")}
          save={() =>
            void finish(
              outcomeDraft?.sessionId === session.id && outcomeDraft.completed
                ? "step_completed"
                : "stopped",
            )
          }
          workControls={
            work && (
              <p className="end-work-status">
                工作时段仍在继续 ·{" "}
                <button
                  className="text-button"
                  onClick={() => setView("work-end")}
                >
                  结束本段
                </button>
              </p>
            )
          }
          footer={footer()}
        />
      ) : view === "celebration" && celebratedTask ? (
        <>
          <div className="completion-drag" {...dragProps}>
            Inky Paper · 完成记
          </div>
          <CompletionMoment
            pet={pet}
            key={`${celebratedTask.id}-${celebratedTask.revision}`}
            title={celebratedTask.title}
            wholeTask
          />
          <button
            className="primary"
            onClick={() => setView(session ? "focus" : "home")}
          >
            {session ? "回到当前一轮" : "收好，回到任务页"}
          </button>
          <button
            className="text-button"
            disabled={busy}
            onClick={() => {
              const latest = data.tasks.find((t) => t.id === celebratedTask.id);
              if (latest?.completed) void completeTask(latest);
              else setView("home");
            }}
          >
            刚才点错了，撤销完成
          </button>
        </>
      ) : view === "receipt" && receipt ? (
        <>
          {receipt.feedback?.outcome === "step_completed" ? (
            <>
              <div className="completion-drag" {...dragProps}>
                Inky Paper · 完成记
              </div>
              <CompletionMoment
                pet={pet}
                key={receipt.id}
                title={receipt.action?.text || receipt.taskTitle}
                wholeTask={false}
              />
            </>
          ) : (
            <>
              <h1 {...dragProps}>
                {receipt.feedback?.outcome === "step_completed"
                  ? "这一步，收好了。"
                  : "纸页留好了。"}
              </h1>
              <p
                className={
                  receipt.feedback?.outcome === "step_completed"
                    ? "crossed receipt-step"
                    : "receipt-step"
                }
              >
                {receipt.action?.text || receipt.taskTitle}
              </p>
              <p className="muted">
                {receipt.feedback?.outcome === "step_completed"
                  ? "这一步已完成，整个任务仍待办。"
                  : "计时和你留下的话都已保存。"}
              </p>
            </>
          )}
          {receipt.feedback?.nextCue && (
            <p className="cue-note">下次：{receipt.feedback.nextCue}</p>
          )}
          {parentCompletion()}
          <button
            className="primary"
            onClick={() => chooseNextStep(receipt.taskId)}
          >
            选择下一步
          </button>
          <button className="text-button" onClick={() => setView("home")}>
            回到任务页
          </button>
          <button
            className="text-button"
            disabled={busy}
            onClick={() => void start("rest")}
          >
            休息 5 分钟
          </button>
        </>
      ) : view === "notes" ? (
        <>
          <h1>随手留一笔</h1>
          <p className="muted">
            {session
              ? "先收下来，记好后回到这一轮。"
              : "先收下来，不急着整理。"}
          </p>
          <textarea
            className="note-input"
            aria-label="随手记"
            maxLength={2000}
            placeholder="刚想到的事……"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <button
            className="primary"
            disabled={busy || !note.trim() || !native}
            onClick={async () => {
              if (
                await mutate("capture_note", {
                  text: note,
                  ...(session ? { sessionId: session.id } : {}),
                })
              ) {
                setNote("");
                if (session)
                  setView(
                    session.status === "waiting" && session.kind === "focus"
                      ? "feedback"
                      : "focus",
                  );
              }
            }}
          >
            {session ? "记下，回到这一轮" : "记下"}
          </button>
          <div className="notes-list">
            {[...data.notes].reverse().map((n) => (
              <article key={n.id}>
                <p>{n.text}</p>
                {n.taskTitle && <p className="caption">属于：{n.taskTitle}</p>}
                <button
                  className="text-button"
                  onClick={() => {
                    if (n.convertedTaskId) {
                      const target = data.tasks.find(
                        (task) => task.id === n.convertedTaskId,
                      );
                      if (target && !session) {
                        const step = data.planning?.steps.find(
                          (step) =>
                            step.taskId === target.id &&
                            step.id === target.nextAction?.id,
                        );
                        void prepareChoice(target, step).then((prepared) => {
                          if (prepared) setView("home");
                        });
                      } else setView("home");
                    } else {
                      draftBaseline.current = taskDraft();
                      setDraft(
                        getStored<Draft>(`paper-draft-${n.id}`, {
                          newId: crypto.randomUUID(),
                          originNoteId: n.id,
                          title: n.text.slice(0, 300),
                          due: "",
                          category: "idea",
                          priority: "medium",
                          nextAction: "",
                        }),
                      );
                      setConflict(false);
                      setError("");
                      setView("edit");
                    }
                  }}
                >
                  {n.convertedTaskId ? "查看已转成的任务" : "转为任务"}
                </button>
                <time>
                  {new Date(n.createdAt).toLocaleString("zh-CN", {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </time>
              </article>
            ))}
          </div>
        </>
      ) : view === "history" ? (
        <>
          <h1>留在纸上的足迹</h1>
          <button className="outline" onClick={() => setView("day-plan")}>
            按日期查看计划与记录
          </button>
          <p className="muted">记录计时与选择，不替你评判状态。</p>
          <WorkHistory
            coach={coach}
            limit={historyLimit}
            renderSessions={(ids) => (
              <SessionHistoryList
                sessions={[...data.sessions]
                  .reverse()
                  .filter((s) => ids.includes(s.id))}
              />
            )}
          />
          {data.sessions.some(
            (s) => !coach.blocks.some((b) => b.sessionIds.includes(s.id)),
          ) && <p className="muted">独立计时记录</p>}
          <div className="history-list">
            {[...data.sessions]
              .reverse()
              .filter(
                (s) => !coach.blocks.some((b) => b.sessionIds.includes(s.id)),
              )
              .slice(0, historyLimit)
              .map((s) => (
                <SessionHistory key={s.id} session={s} />
              ))}
            {!data.sessions.length && !coach.blocks.length && (
              <p className="empty">开始第一轮后，足迹会留在这里。</p>
            )}
          </div>
          {(coach.blocks.length > historyLimit ||
            data.sessions.filter(
              (s) => !coach.blocks.some((b) => b.sessionIds.includes(s.id)),
            ).length > historyLimit) && (
            <button
              className="outline"
              onClick={() => setHistoryLimit((n) => n + 20)}
            >
              加载更早的记录
            </button>
          )}
        </>
      ) : view === "settings" ? (
        <>
          <h1>纸页背面</h1>
          <section className="settings-group">
            <h2>Markdown 工作记录</h2>
            <p>计划与执行记录自动保存。个人笔记单独存放，可以自由编辑。</p>
            <button
              className="outline"
              onClick={() =>
                void invoke("open_work_journal", {}).catch((e) =>
                  setError(String(e)),
                )
              }
            >
              打开工作记录文件夹
            </button>
            {journal?.directory && (
              <p className="caption" style={{ overflowWrap: "anywhere" }}>
                {journal.directory}
              </p>
            )}
            {!!journal?.preservedEdits?.length && (
              <p className="caption">
                检测到自动记录被手改，已保存独立备份，原文字可在记录文件夹找到。
              </p>
            )}
          </section>
          <CoachSettings coach={coach} busy={busy} mutate={mutate} />
          <section className="settings-group">
            <h2>与 Hermes 协作</h2>
            <p>在对话中安排任务、讨论状态。这里接住下一步，并留下执行记录。</p>
            <button
              className="outline"
              onClick={() =>
                void invoke<{ available: boolean; connectionFile: string }>(
                  "get_paper_bridge_status",
                )
                  .then(setBridge)
                  .catch((e) => setError(String(e)))
              }
            >
              检查本地连接
            </button>
            <p className="connection-help">
              在 Hermes 对话里说明“使用 Inky Paper”，避免写入旧版
              Inky。连接变更后，请新开一段对话。
            </p>
            {bridge && (
              <p role="status">
                {bridge.available ? "本地同步服务可用" : "本地同步服务不可用"}
                <br />
                <small>
                  应用开启或隐藏时可同步，退出后停止。这项检查不代表 Hermes
                  已连接。
                </small>
              </p>
            )}
          </section>
          <section className="settings-group">
            <h2>完成时，轻轻庆祝</h2>
            <div className="sound-setting">
              <button
                className="outline"
                role="switch"
                aria-checked={completionSound}
                onClick={() => setCompletionSound(!completionSound)}
              >
                完成音效{completionSound ? "已开启" : "已关闭"}
              </button>
              <button
                className="text-button"
                onClick={() => {
                  void prepareCompletionSound().then(() =>
                    playCompletionSound(true),
                  );
                }}
              >
                试听
              </button>
            </div>
            <p>只在你确认完成并保存成功后响起。</p>
          </section>
          <details className="settings-group pet-settings">
            <summary>陪你的小伙伴 · {selectedPet.name}</summary>
            <p>选一只，陪你做事、专注和收好每一小步。</p>
            <div className="pet-options" role="group" aria-label="选择小伙伴">
              {paperPets.map((option) => (
                <button
                  key={option.id}
                  className="pet-option"
                  aria-pressed={petId === option.id}
                  onClick={() => setPetId(option.id)}
                >
                  <img src={option.src} alt="" draggable={false} />
                  <span>{option.name}</span>
                  <small>{petId === option.id ? "正在陪你" : "选择这只"}</small>
                </button>
              ))}
            </div>
          </details>
          <section className="settings-group">
            <h2>轻轻放在桌角</h2>
            <p>
              Alt + Shift + F 显示 / 隐藏
              <br />
              拖动页眉、纸张左边缘或底部空白移动窗口；点击迷你宠物返回。
            </p>
            <button className="outline" onClick={() => setMini(true)}>
              切换迷你宠物
            </button>
          </section>
          <p className="caption">
            Inky Paper 0.6.4 · 独立数据空间
            <br />
            计时不等于有效专注；空白时段不推断为休息。
          </p>
          <button
            className="text-button"
            onClick={() => void invoke("quit_app")}
          >
            退出 Inky Paper
          </button>
        </>
      ) : null}
      <PaperChrome
        paperRef={paperRef}
        scrollRef={view === "home" ? homeScrollRef : paperRef}
        pageKey={`${view}:${loaded}`}
        canDrag={native}
        moveBy={(deltaX, deltaY) =>
          invoke("move_window_by", { deltaX, deltaY })
        }
        onError={(error) => setError(String(error))}
      />
    </main>
  );
}
