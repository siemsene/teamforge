// Shared domain types for TeamForge.

export type SessionStatus = "draft" | "open" | "closed";

export interface InstructorProfile {
  name: string;
  email: string;
  approved: boolean;
  createdAt: number;
}

// ---------- Survey questions ----------

export type QuestionKind = "number" | "single" | "multi" | "projectRanking" | "teammates";

export interface QuestionBase {
  id: string;
  kind: QuestionKind;
  prompt: string;
  required: boolean;
  /** True when generated from project requirements; cannot be deleted while requirements exist. */
  auto?: boolean;
  /** Stable attribute key (e.g. "major") used to link project requirements to this question. */
  attributeKey?: string;
}

export interface NumberQuestion extends QuestionBase {
  kind: "number";
  min: number;
  max: number;
}

export interface SingleChoiceQuestion extends QuestionBase {
  kind: "single";
  options: string[];
}

export interface MultiChoiceQuestion extends QuestionBase {
  kind: "multi";
  options: string[];
}

/** Auto-added when a session has named projects: students rank their top choices. */
export interface ProjectRankingQuestion extends QuestionBase {
  kind: "projectRanking";
  /** How many projects each student must rank. */
  rankCount: number;
}

/** Students list login codes of classmates they'd like to work with. */
export interface TeammatesQuestion extends QuestionBase {
  kind: "teammates";
  maxCodes: number;
}

export type Question =
  | NumberQuestion
  | SingleChoiceQuestion
  | MultiChoiceQuestion
  | ProjectRankingQuestion
  | TeammatesQuestion;

// ---------- Projects ----------

export interface ProjectRequirement {
  /** Attribute key shared with the auto-generated survey question (e.g. "major"). */
  attributeKey: string;
  /** Human label for the attribute, used when auto-creating the question. */
  attributeLabel: string;
  /** Required categorical value (e.g. "Computer Science"). */
  value: string;
  /** Minimum number of students with this value on the team. */
  minCount: number;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  requirements: ProjectRequirement[];
  /** Optional per-project team size overrides; session defaults apply when absent. */
  minSize?: number;
  maxSize?: number;
}

// ---------- Constraints ----------

export type ConstraintWeight = "must" | "important" | "nice";

export interface ConstraintBase {
  id: string;
  weight: ConstraintWeight;
}

/** Enforce every project's attribute requirements (one umbrella constraint). */
export interface ProjectRequirementsConstraint extends ConstraintBase {
  kind: "projectRequirements";
}

/** Count of students with `value` for question must be 0 or >= 2 on every team. */
export interface AntiIsolationConstraint extends ConstraintBase {
  kind: "antiIsolation";
  questionId: string;
  value: string;
}

/** Spread the team-average of a numeric question evenly across teams. */
export interface BalanceNumericConstraint extends ConstraintBase {
  kind: "balanceNumeric";
  questionId: string;
}

/** Every team needs at least `minCount` students with answer >= `threshold`. */
export interface MinCapabilityConstraint extends ConstraintBase {
  kind: "minCapability";
  questionId: string;
  threshold: number;
  minCount: number;
}

/** Reward assigning students to projects they ranked highly. */
export interface ProjectPreferenceConstraint extends ConstraintBase {
  kind: "projectPreference";
}

/** Reward placing students with the classmates they listed. */
export interface TeammatePreferenceConstraint extends ConstraintBase {
  kind: "teammatePreference";
}

export type Constraint =
  | ProjectRequirementsConstraint
  | AntiIsolationConstraint
  | BalanceNumericConstraint
  | MinCapabilityConstraint
  | ProjectPreferenceConstraint
  | TeammatePreferenceConstraint;

export const WEIGHT_VALUES: Record<ConstraintWeight, number> = {
  must: 1000,
  important: 100,
  nice: 10,
};

// ---------- Crypto envelope ----------

export interface EciesPayload {
  ephemeralPublicKeyJwk: JsonWebKey;
  iv: string; // base64
  ciphertext: string; // base64
}

export interface WrappedKeys {
  publicKeyJwk: JsonWebKey;
  passphrase: {
    salt: string; // base64
    iterations: number;
    iv: string; // base64
    ciphertext: string; // base64 (wrapped private key JWK)
  };
  recovery: {
    iv: string;
    ciphertext: string;
  };
}

// ---------- Firestore documents ----------

export interface SessionDoc {
  ownerUid: string;
  title: string;
  status: SessionStatus;
  numStudents: number;
  idealTeamSize: number;
  minTeamSize: number;
  maxTeamSize: number;
  /** True = teams only, no named projects. */
  genericProjects: boolean;
  /** Number of teams when genericProjects; otherwise the project count rules. */
  numTeams: number;
  constraints: Constraint[];
  wrappedKeys: WrappedKeys;
  createdAt: number;
  updatedAt: number;
}

export interface SessionSummary extends SessionDoc {
  id: string;
}

/** Student-readable mirror of everything needed to take the survey. */
export interface PublicConfig {
  title: string;
  status: SessionStatus;
  publicKeyJwk: JsonWebKey;
  questions: Question[];
  projects: { id: string; name: string; description: string }[];
  genericProjects: boolean;
  privacyNote: string;
}

export interface StudentDoc {
  codeIndex: number;
  submittedAt: number | null;
  response: EciesPayload | null;
}

/** Decrypted survey answers, keyed by question id. */
export interface SurveyAnswers {
  [questionId: string]: number | string | string[];
}

/** Decrypted allocation: team id -> student code hashes. Team id = project id or "team-K". */
export interface Allocation {
  teams: Record<string, string[]>;
  objective: number;
  solvedAt: number;
}

export interface AllocationDoc {
  payload: EciesPayload;
  updatedAt: number;
}
