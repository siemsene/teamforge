import { describe, expect, it } from "vitest";
import {
  CODES_CSV_HEADER,
  addedCodesCsvRows,
  addedCodesSuffix,
  nextCodeIndex,
  removalConsequences,
} from "../src/features/completion/rosterEdit";

const students = (indexes: number[]) => indexes.map((codeIndex) => ({ codeIndex }));

describe("nextCodeIndex", () => {
  it("continues past the live roster on a session that predates maxCodeIndex", () => {
    expect(nextCodeIndex(students([1, 2, 3]), { numStudents: 3 })).toBe(4);
  });

  it("does not reuse the index of the highest-numbered student after they are removed", () => {
    // The regression this whole field exists for. #5 is gone, so max(live) is 4
    // and a derived maximum would hand #5 out again — to someone the saved
    // allocation and every teammate's roster blob already know as a different
    // person.
    const session = { maxCodeIndex: 5, numStudents: 4 };
    expect(nextCodeIndex(students([1, 2, 3, 4]), session)).toBe(6);
  });

  it("never returns an index that is already live", () => {
    const live = [3, 7, 11];
    const session = { maxCodeIndex: 2, numStudents: 0 }; // deliberately behind
    expect(nextCodeIndex(students(live), session)).toBeGreaterThan(Math.max(...live));
  });

  it("falls back to the count when the roster has not loaded yet", () => {
    expect(nextCodeIndex([], { numStudents: 30 })).toBe(31);
  });

  it("survives an empty session with no fields at all", () => {
    expect(nextCodeIndex([], {})).toBe(1);
  });
});

describe("addedCodesCsvRows", () => {
  it("emits exactly the header session creation writes", () => {
    // Pinned as a literal: the instructor is told to append these rows to the
    // master codes CSV and the roster importer is handed the combined file, so a
    // second spelling would break both at once.
    expect([...CODES_CSV_HEADER]).toEqual([
      "studentIndex",
      "loginCode",
      "shareCode",
      "surveyLink",
      "yourStudentName",
      "yourStudentEmail",
    ]);
  });

  it("carries the assigned index, not a fresh 1..n", () => {
    const rows = addedCodesCsvRows(
      [
        { codeIndex: 31, code: "AAAAA-11111", shareCode: "WXYZ" },
        { codeIndex: 32, code: "BBBBB-22222", shareCode: "QRST" },
      ],
      "https://x/s/sid",
    );
    expect(rows[0]).toEqual([...CODES_CSV_HEADER]);
    expect(rows[1]).toEqual([31, "AAAAA-11111", "WXYZ", "https://x/s/sid", "", ""]);
    expect(rows[2][0]).toBe(32);
  });
});

describe("addedCodesSuffix", () => {
  it("names the range, and never collides with the master file", () => {
    expect(addedCodesSuffix(31, 35)).toBe("student-codes-31-35.csv");
    expect(addedCodesSuffix(31, 31)).toBe("student-codes-31.csv");
    expect(addedCodesSuffix(31, 35)).not.toBe("student-codes.csv");
  });
});

describe("removalConsequences", () => {
  const blank = { submittedAt: null, roster: null };

  it("reports nothing extra for a student who never submitted", () => {
    expect(removalConsequences([blank], { allocationSaved: false })).toEqual([]);
  });

  it("reports the response and the stale allocation", () => {
    expect(removalConsequences([{ ...blank, submittedAt: 5 }], { allocationSaved: true })).toEqual([
      "hasResponse",
      "inSavedAllocation",
    ]);
  });

  it("always pairs a provisioned team with the retained-key disclosure", () => {
    // Deleting the document cannot take back a team key the student already
    // opened, so the two are never reported separately.
    const out = removalConsequences([{ ...blank, roster: { iv: "i", ciphertext: "c" } }], {
      allocationSaved: false,
    });
    expect(out).toContain("provisionedTeam");
    expect(out).toContain("teamKeyRetained");
  });

  it("notices ballots and published results", () => {
    const out = removalConsequences(
      [
        { ...blank, peerEvalSummative: { submittedAt: 1, payload: null as never } },
        { ...blank, resultFormative: { iv: "i", ciphertext: "c" } },
      ],
      { allocationSaved: false },
    );
    expect(out).toContain("submittedBallot");
    expect(out).toContain("resultsPublished");
  });

  it("dedupes across a multi-student selection and keeps a stable order", () => {
    const s = { ...blank, submittedAt: 9 };
    expect(removalConsequences([s, s, s], { allocationSaved: true })).toEqual([
      "hasResponse",
      "inSavedAllocation",
    ]);
  });
});
