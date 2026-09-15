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
};
export type PlanningState = {
  steps: PlanStep[];
  dayItems: DayItem[];
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
