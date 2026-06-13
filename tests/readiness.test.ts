import { describe, expect, it } from "vitest";
import { getSessionReadiness } from "../src/features/sessions/readiness";
import type { Project, PublicConfig, SessionDoc } from "../src/types";

const session: SessionDoc = {
  ownerUid: "owner",
  title: "Course",
  status: "draft",
  numStudents: 4,
  idealTeamSize: 2,
  minTeamSize: 2,
  maxTeamSize: 2,
  genericProjects: false,
  numTeams: 2,
  constraints: [],
  wrappedKeys: {
    publicKeyJwk: {},
    passphrase: { salt: "", iterations: 1, iv: "", ciphertext: "" },
    recovery: { iv: "", ciphertext: "" },
  },
  createdAt: 1,
  updatedAt: 1,
};

const publicConfig: PublicConfig = {
  title: "Course",
  status: "draft",
  publicKeyJwk: {},
  genericProjects: false,
  privacyNote: "",
  projects: [
    { id: "p1", name: "P1", description: "" },
    { id: "p2", name: "P2", description: "" },
  ],
  questions: [
    {
      id: "auto-project-ranking",
      kind: "projectRanking",
      prompt: "Rank projects",
      required: true,
      auto: true,
      rankCount: 2,
    },
    {
      id: "auto-attr-major",
      kind: "single",
      prompt: "Major",
      required: true,
      auto: true,
      attributeKey: "major",
      options: ["Computer Science", "Business"],
    },
  ],
};

const projects: Project[] = [
  {
    id: "p1",
    name: "P1",
    description: "",
    requirements: [{ attributeKey: "major", attributeLabel: "Major", value: "Computer Science", minCount: 1 }],
  },
  { id: "p2", name: "P2", description: "", requirements: [] },
];

describe("session readiness", () => {
  it("passes core blockers for a configured project session", () => {
    const report = getSessionReadiness(session, publicConfig, projects);
    expect(report.blockers).toHaveLength(0);
    expect(report.warnings.map((w) => w.id)).toContain("constraints-present");
  });

  it("blocks opening when requirement values are not present in the survey", () => {
    const broken = {
      ...publicConfig,
      questions: publicConfig.questions.map((q) =>
        q.id === "auto-attr-major" && q.kind === "single" ? { ...q, options: ["Business"] } : q,
      ),
    };
    const report = getSessionReadiness(session, broken, projects);
    expect(report.blockers.map((b) => b.id)).toContain("requirements");
  });

  it("blocks opening when capacity cannot fit the roster", () => {
    const report = getSessionReadiness({ ...session, numStudents: 5 }, publicConfig, projects);
    expect(report.blockers.map((b) => b.id)).toContain("capacity");
  });
});
