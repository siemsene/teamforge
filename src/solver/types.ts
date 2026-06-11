import type { Constraint, ProjectRequirement, Question, SurveyAnswers } from "../types";

export interface SolverStudent {
  hash: string;
  codeIndex: number;
  /** Decrypted answers; empty object for students who never submitted. */
  answers: SurveyAnswers;
  submitted: boolean;
}

export interface SolverTeam {
  id: string; // project id, or "team-K" for generic sessions
  name: string;
  minSize: number;
  maxSize: number;
  requirements: ProjectRequirement[];
}

export interface SolverInput {
  students: SolverStudent[];
  teams: SolverTeam[];
  idealTeamSize: number;
  constraints: Constraint[];
  questions: Question[];
  timeLimitSeconds: number;
}

export interface SolveResult {
  /** team id -> student hashes */
  teams: Record<string, string[]>;
  objective: number;
  status: string;
}

export type WorkerRequest = { type: "solve"; input: SolverInput };
export type WorkerResponse =
  | { type: "status"; message: string }
  | { type: "done"; result: SolveResult }
  | { type: "error"; message: string };
