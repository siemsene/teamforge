// Shared domain types for TeamForge.

export type SessionStatus = "draft" | "open" | "closed";

export interface InstructorProfile {
  name: string;
  email: string;
  /** Institution the instructor works for (collected at sign-up). */
  university: string;
  approved: boolean;
  createdAt: number;
  /** Rough data-usage summary, refreshed by the instructor's dashboard, so the
   * admin can see who to remind about cleaning up old sessions. */
  usage?: InstructorUsage;
}

export interface InstructorUsage {
  sessions: number;
  /** Total student capacity across the instructor's sessions. */
  students: number;
  updatedAt: number;
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
  /** Optional word per point; labels[i] describes value (min + i). Length max-min+1. */
  labels?: string[];
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

// ---------- Team management (optional post-allocation phase) ----------

export type EvalRoundId = "formative" | "summative";
export type RoundStatus = "pending" | "open" | "closed";

export interface EvalRoundConfig {
  status: RoundStatus;
  /** Free-text shown to students, e.g. "Opens Mon Oct 6, closes Fri Oct 10". */
  note?: string;
  openedAt?: number;
  closedAt?: number;
  resultsPublishedAt?: number;
}

/** Owner-only configuration on SessionDoc.teamMgmt. */
export interface TeamMgmtConfig {
  enabled: boolean;
  rosterUploadedAt: number | null;
  /** Team-factor clamp, e.g. 0.80–1.10. */
  factorFloor: number;
  factorCeiling: number;
  /** Part 2 of the peer eval (behavior ratings) on/off. */
  includeBehaviors: boolean;
  behaviors: string[];
  aiFeedbackEnabled: boolean;
  rounds: Record<EvalRoundId, EvalRoundConfig>;
}

export interface ContractSectionDef {
  id: string;
  title: string;
  /** Guidance shown to teams while writing this section. */
  prompt: string;
}

/** Student-visible mirror of team-management settings on PublicConfig.teamMgmt. */
export interface PublicTeamMgmt {
  enabled: boolean;
  includeBehaviors: boolean;
  behaviors: string[];
  aiFeedbackEnabled: boolean;
  contractSections: ContractSectionDef[];
  rounds: Record<EvalRoundId, { status: RoundStatus; note?: string; resultsPublished?: boolean }>;
}

/** AES-256-GCM ciphertext under a symmetric derived key (member key or team key). */
export interface AesEnvelope {
  iv: string; // base64
  ciphertext: string; // base64
}

export interface PeerEvalSubmission {
  submittedAt: number;
  /** ECIES to the session public key — instructor-only readable. */
  payload: EciesPayload;
}

/** Decrypted contents of a student's roster blob (never stored plaintext). */
export interface RosterInfo {
  /** This student's own stable identifier (their code index). */
  codeIndex: number;
  /** This student's own name (as the instructor entered it). */
  name: string;
  /** Capability for the team doc and team key; never shown to the student. */
  teamToken: string;
  teamLabel: string;
  /** Excludes self; codeIndex is the stable ratee identifier. */
  teammates: { codeIndex: number; name: string }[];
}

/** Decrypted peer-evaluation answers (never stored plaintext). */
export interface PeerEvalAnswers {
  round: EvalRoundId;
  raterCodeIndex: number;
  teamLabel: string;
  /** Ratee codeIndex (as string key) -> 0..100; must sum to 100. */
  points: Record<string, number>;
  /** Required where the allocation is < 15 or > 40 (waived for tiny teams). */
  justifications: Record<string, string>;
  /** Ratee codeIndex -> one 1..5 value per behavior. */
  behaviorRatings?: Record<string, number[]>;
  /** Part 3: optional, confidential to the instructor. */
  commentToInstructor?: string;
}

/** What a student sees when round results are published to them. */
export interface EvalResultView {
  round: EvalRoundId;
  teamLabel: string;
  raterCount: number;
  neutralShare: number;
  /** null when raterCount < 3 (anonymity guard — factor only). */
  adjustedMeanPoints: number | null;
  factor: number;
  behaviorAverages?: number[];
  note?: string;
}

export interface ContractContent {
  version: number;
  sections: { id: string; title: string; text: string }[];
}

export interface ContractFeedback {
  overall: string;
  sections: { id: string; strengths: string; risks: string; suggestions: string }[];
}

export type ContractStatus = "empty" | "draft" | "final";

export interface ContractState {
  status: ContractStatus;
  updatedAt: number | null;
  /** Last-write-wins concurrency marker: which member saved last. */
  updatedByCodeIndex: number | null;
  /** Team-key encrypted ContractContent. */
  content: AesEnvelope | null;
  /** The same plaintext, ECIES to the session public key, for the instructor. */
  contentForInstructor: EciesPayload | null;
  /** Team-key encrypted ContractFeedback. */
  feedback: AesEnvelope | null;
  feedbackAt: number | null;
  finalizedAt: number | null;
}

/** sessions/{sid}/teams/{tokenHash}; doc id = SHA-256(teamToken). */
export interface TeamDoc {
  teamLabel: string;
  createdAt: number;
  contract: ContractState;
}

/** Instructor-only directory, ECIES-encrypted at sessions/{sid}/results/teamDirectory. */
export interface TeamDirectory {
  createdAt: number;
  teams: {
    token: string;
    label: string;
    members: { codeIndex: number; codeHash: string; name: string }[];
  }[];
  /** codeHash -> base64 raw member key, so publishing results never needs the codes CSV again. */
  memberKeys: Record<string, string>;
}

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
  /** Instructor-editable invitation email shown on the overview tab. */
  emailTemplate?: string;
  /** Optional post-allocation phase: contracts + peer evaluations. */
  teamMgmt?: TeamMgmtConfig;
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
  /** Present when the instructor enabled team management. */
  teamMgmt?: PublicTeamMgmt;
}

export interface StudentDoc {
  codeIndex: number;
  /** Public identifier the student shares with classmates to be listed as a
   * preferred teammate. Independent of the (secret) login code. */
  shareCode?: string;
  submittedAt: number | null;
  response: EciesPayload | null;
  // ----- team management (all optional; absent on allocation-only sessions) -----
  /** Member-key encrypted RosterInfo, written by the instructor. */
  roster?: AesEnvelope | null;
  /** Student-written, ECIES to the session public key. */
  peerEvalFormative?: PeerEvalSubmission | null;
  peerEvalSummative?: PeerEvalSubmission | null;
  /** Member-key encrypted EvalResultView, written by the instructor. */
  resultFormative?: AesEnvelope | null;
  resultSummative?: AesEnvelope | null;
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
