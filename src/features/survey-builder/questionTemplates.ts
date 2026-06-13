// A curated library of standard survey scales. Picking one in the question
// builder pre-fills a question with sensible defaults the instructor can then
// edit. Two reasons this matters:
//   - Consistency: the solver matches choice-option strings *exactly* (see
//     solver/answers.ts hasValue), so shared option sets avoid constraints that
//     silently match nothing.
//   - Good defaults: "how good are you at X" questions become numeric scales
//     (which the MIP can balance) with a word attached to each point.
//
// Templates carry no id/auto/attributeKey — the form generates those on save.
// Option sets (esp. demographics) are US-oriented starting points and are meant
// to be edited.

export const TEMPLATE_CATEGORIES = ["Demographics", "Academic", "Skills & ratings", "Work style"] as const;
export type TemplateCategory = (typeof TEMPLATE_CATEGORIES)[number];

export type TemplateBody =
  | { kind: "single" | "multi"; options: string[] }
  | { kind: "number"; min: number; max: number; labels: string[] }
  | { kind: "teammates"; maxCodes: number };

export interface QuestionTemplate {
  /** Unique; used as the dropdown value. */
  id: string;
  /** Dropdown text, e.g. "Gender". */
  label: string;
  category: TemplateCategory;
  /** Default question text. Rating prompts contain a "[topic]" placeholder. */
  prompt: string;
  required: boolean;
  /** One-line helper shown under the dropdown once selected. */
  description?: string;
  /** When set on a single-choice template, an auto-generated question whose
   * attributeKey matches this seeds its options from this scale. */
  attributeKey?: string;
  body: TemplateBody;
}

/**
 * Options for the standard single-choice scale matching an auto-question's
 * attributeKey (e.g. "major"), or undefined if no template is tagged for it.
 * Used to seed auto-generated categorical questions with sensible defaults.
 */
export function standardScaleOptions(attributeKey: string): string[] | undefined {
  const t = QUESTION_TEMPLATES.find((x) => x.attributeKey === attributeKey && x.body.kind === "single");
  return t && t.body.kind === "single" ? t.body.options : undefined;
}

const PREFER_NOT = "Prefer not to say";

export const QUESTION_TEMPLATES: QuestionTemplate[] = [
  // ---------- Demographics ----------
  {
    id: "gender",
    label: "Gender",
    category: "Demographics",
    prompt: "What is your gender?",
    required: false,
    description: "Inclusive default options; edit to match your context.",
    attributeKey: "gender",
    body: { kind: "single", options: ["Woman", "Man", "Non-binary", "Prefer to self-describe", PREFER_NOT] },
  },
  {
    id: "race-ethnicity",
    label: "Race / ethnicity",
    category: "Demographics",
    prompt: "Which best describes your race or ethnicity? (select all that apply)",
    required: false,
    description: "Multiple choice, US-census-style. Adjust categories for your population.",
    body: {
      kind: "multi",
      options: [
        "American Indian or Alaska Native",
        "Asian",
        "Black or African American",
        "Hispanic or Latino",
        "Middle Eastern or North African",
        "Native Hawaiian or Other Pacific Islander",
        "White",
        "Prefer to self-describe",
        PREFER_NOT,
      ],
    },
  },
  {
    id: "age-range",
    label: "Age range",
    category: "Demographics",
    prompt: "What is your age range?",
    required: false,
    attributeKey: "age-range",
    body: { kind: "single", options: ["Under 18", "18–20", "21–23", "24–26", "27–30", "31+", PREFER_NOT] },
  },
  {
    id: "first-generation",
    label: "First-generation student",
    category: "Demographics",
    prompt: "Are you a first-generation college student?",
    required: false,
    body: { kind: "single", options: ["Yes", "No", "Not sure", PREFER_NOT] },
  },

  // ---------- Academic ----------
  {
    id: "class-standing",
    label: "Class standing",
    category: "Academic",
    prompt: "What is your current class standing?",
    required: true,
    attributeKey: "class-standing",
    body: { kind: "single", options: ["First year", "Sophomore", "Junior", "Senior", "Graduate student"] },
  },
  {
    id: "major",
    label: "Major / field of study",
    category: "Academic",
    prompt: "What is your major or primary field of study?",
    required: true,
    description: "Starter list — replace with the majors offered in your program.",
    attributeKey: "major",
    body: {
      kind: "single",
      options: [
        "Business",
        "Computer Science",
        "Engineering",
        "Humanities",
        "Natural Sciences",
        "Social Sciences",
        "Arts & Design",
        "Undecided",
        "Other",
      ],
    },
  },
  {
    id: "gpa-range",
    label: "GPA range",
    category: "Academic",
    prompt: "Which range best describes your current GPA?",
    required: false,
    attributeKey: "gpa-range",
    body: { kind: "single", options: ["Below 2.5", "2.5–2.9", "3.0–3.4", "3.5–3.7", "3.8–4.0", PREFER_NOT] },
  },
  {
    id: "enrollment-status",
    label: "Enrollment status",
    category: "Academic",
    prompt: "Are you enrolled full-time or part-time?",
    required: true,
    attributeKey: "enrollment-status",
    body: { kind: "single", options: ["Full-time", "Part-time"] },
  },

  // ---------- Skills & ratings (numeric, with a word per point) ----------
  {
    id: "proficiency-1-5",
    label: "Proficiency (1–5)",
    category: "Skills & ratings",
    prompt: "How would you rate your proficiency in [topic]?",
    required: true,
    description: "Numeric so the optimizer can balance skill across teams. Replace [topic].",
    body: { kind: "number", min: 1, max: 5, labels: ["No experience", "Novice", "Competent", "Proficient", "Expert"] },
  },
  {
    id: "agreement-1-5",
    label: "Agreement (1–5)",
    category: "Skills & ratings",
    prompt: "[Statement] — how much do you agree?",
    required: true,
    description: "Standard 5-point Likert agreement scale. Replace [statement].",
    body: {
      kind: "number",
      min: 1,
      max: 5,
      labels: ["Strongly disagree", "Disagree", "Neutral", "Agree", "Strongly agree"],
    },
  },
  {
    id: "frequency-1-5",
    label: "Frequency (1–5)",
    category: "Skills & ratings",
    prompt: "How often do you [activity]?",
    required: true,
    description: "Replace [activity].",
    body: { kind: "number", min: 1, max: 5, labels: ["Never", "Rarely", "Sometimes", "Often", "Always"] },
  },
  {
    id: "interest-1-5",
    label: "Interest (1–5)",
    category: "Skills & ratings",
    prompt: "How interested are you in [topic]?",
    required: true,
    description: "Replace [topic].",
    body: {
      kind: "number",
      min: 1,
      max: 5,
      labels: ["No interest", "Slight interest", "Moderate interest", "High interest", "Very high interest"],
    },
  },

  // ---------- Work style ----------
  {
    id: "team-role",
    label: "Preferred team role",
    category: "Work style",
    prompt: "Which team roles do you prefer? (select all that apply)",
    required: false,
    body: {
      kind: "multi",
      options: [
        "Leader / coordinator",
        "Researcher / analyst",
        "Designer / creative",
        "Builder / implementer",
        "Writer / communicator",
        "Quality / tester",
      ],
    },
  },
  {
    id: "time-commitment",
    label: "Weekly time commitment",
    category: "Work style",
    prompt: "How many hours per week can you commit to this project?",
    required: true,
    body: { kind: "single", options: ["Under 3 hours", "3–5 hours", "6–10 hours", "11+ hours"] },
  },
  {
    id: "work-preference",
    label: "Work preference",
    category: "Work style",
    prompt: "How do you prefer to work with your team?",
    required: false,
    body: { kind: "single", options: ["Mostly in person", "Hybrid", "Mostly remote", "No preference"] },
  },
  {
    id: "leadership-preference",
    label: "Leadership preference",
    category: "Work style",
    prompt: "What is your preference around leading the team?",
    required: false,
    body: {
      kind: "single",
      options: ["I prefer to lead", "I'm happy to contribute without leading", "No preference"],
    },
  },
  {
    id: "preferred-teammates",
    label: "Preferred teammates",
    category: "Work style",
    prompt: "List the share codes of classmates you would most like to be on a team with.",
    required: false,
    description:
      "Students enter classmates' public share codes (shown after login; safe to share, can't be used to log in). Pair it with the suggested 'Respect teammate preferences' constraint to honor these.",
    body: { kind: "teammates", maxCodes: 3 },
  },
];
