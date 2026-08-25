// Default team-contract sections and team-management configuration. The
// sections seed the student-facing editor; teams may also add custom sections.

import type { ContractSectionDef, PublicTeamMgmt, TeamMgmtConfig } from "../../types";

export const CONTRACT_SECTIONS: ContractSectionDef[] = [
  {
    id: "communications",
    title: "Communications",
    prompt:
      "Which channel(s) will you use (e.g. group chat, email)? How quickly should members reply during the week? What tone do you expect?",
  },
  {
    id: "attendance",
    title: "Attendance",
    prompt:
      "What should a member do when they cannot attend class or a scheduled meeting? How much notice is expected, and how will they catch up?",
  },
  {
    id: "timeliness",
    title: "Timeliness",
    prompt:
      "What are your expectations for meeting internal deadlines and commitments? What happens when someone is running late on their part?",
  },
  {
    id: "respect",
    title: "Respect",
    prompt:
      "How will you handle differences of opinion and disagreement? How blunt or challenging can discussion get while still being respectful of individual differences?",
  },
  {
    id: "effort",
    title: "Effort",
    prompt:
      "How much effort does each member commit to putting into this class and its teamwork? How will you share the workload fairly?",
  },
  {
    id: "integrity",
    title: "Integrity",
    prompt:
      "What ethical rules will you hold each other to (academic honesty, giving credit, honest reporting of work done)?",
  },
];

export const DEFAULT_BEHAVIORS: string[] = [
  "Did what they said they would do, when they said they would do it.",
  "Raised a problem early rather than letting the team discover it late.",
  "Made the work of others better, not only their own part.",
  "Was someone you would choose for a team again.",
];

export function defaultTeamMgmtConfig(): TeamMgmtConfig {
  return {
    enabled: true,
    rosterUploadedAt: null,
    factorFloor: 0.8,
    factorCeiling: 1.1,
    includeBehaviors: true,
    behaviors: [...DEFAULT_BEHAVIORS],
    aiFeedbackEnabled: true,
    rounds: {
      formative: { status: "pending" },
      summative: { status: "pending" },
    },
  };
}

export function publicTeamMgmt(config: TeamMgmtConfig): PublicTeamMgmt {
  return {
    enabled: config.enabled,
    includeBehaviors: config.includeBehaviors,
    behaviors: config.behaviors,
    aiFeedbackEnabled: config.aiFeedbackEnabled,
    contractSections: CONTRACT_SECTIONS,
    rounds: {
      formative: {
        status: config.rounds.formative.status,
        note: config.rounds.formative.note,
        resultsPublished: config.rounds.formative.resultsPublishedAt != null,
      },
      summative: {
        status: config.rounds.summative.status,
        note: config.rounds.summative.note,
        resultsPublished: config.rounds.summative.resultsPublishedAt != null,
      },
    },
  };
}
