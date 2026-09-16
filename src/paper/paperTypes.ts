import type { CoachState } from "./CoachUI";

export type Action = {
  id: string;
  text: string;
  completed: boolean;
  source: string;
};
export type Task = {
  id: string;
  title: string;
  due: string | null;
  dueDate?: string | null;
  category: string;
  priority: string;
  completed: boolean;
  nextAction: Action | null;
  revision: number;
  source: string;
  updatedAt: number;
};
export type Session = {
  id: string;
  taskId: string | null;
  taskTitle: string;
  action: Action | null;
  kind: string;
  status: string;
  revision: number;
  plannedSeconds: number;
  elapsedSeconds: number;
  lastResumedAt: number | null;
  startedAt: number;
  endedAt: number | null;
  pauseCount: number;
  resumeCue: string | null;
  feedback: {
    outcome: string;
    output: string | null;
    blocker: string | null;
    nextCue: string | null;
  } | null;
};
export type State = {
  planning?: PlanningState;
  coach: CoachState;
  tasks: Task[];
  sessions: Session[];
  notes: {
    id: string;
    text: string;
    createdAt: number;
    taskTitle?: string;
    convertedTaskId?: string;
  }[];
};
export type PlanStep = {
  id: string;
  taskId: string;
  text: string;
  expectedResult: string | null;
  plannedSeconds: number;
  completed: boolean;
  revision: number;
};
export type DayItem = {
  id: string;
  date: string;
  taskId: string;
  stepId: string;
  order: number;
  revision: number;
  removedAt: number | null;
  startMinute?: number | null;
  durationMinutes?: number | null;
  resolvedAt?: number | null;
  resolution?: string | null;
  continuedTo?: string | null;
};
export type PreparedStep = { taskId: string; stepId: string; dayItemId: string | null };
export type PlanChange = {
  id: string; operation: string; source: string; recordedAt: number;
  before: DayItem | null; after: DayItem | null;
};
export type PlanningState = {
  steps: PlanStep[];
  dayItems: DayItem[];
  manualStepChanges?: ManualStepChange[];
  prepared?: PreparedStep | null;
  planChanges?: PlanChange[];
  sessionLinks?: { sessionId: string; dayItemId: string; planDate: string }[];
};
export type ManualStepChange = {
  id: string;
  taskId: string;
  taskTitle: string;
  stepId: string;
  stepText: string;
  completed: boolean;
  recordedAt: number;
};
export type Draft = {
  originNoteId?: string;
  newId?: string;
  id?: string;
  revision?: number;
  title: string;
  due: string;
  category?: string;
  priority?: string;
  nextAction: string;
};
