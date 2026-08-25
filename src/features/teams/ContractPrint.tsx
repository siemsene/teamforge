import type { ContractContent } from "../../types";

/**
 * Printable contract layout. Rendered off-screen and revealed only for
 * printing (see the print styles in index.css); "Download PDF" calls
 * window.print() and the viewer chooses "Save as PDF". Shared by the student
 * editor and the instructor viewer.
 */
export function ContractPrint({
  sessionTitle,
  teamLabel,
  content,
  finalizedAt,
}: {
  sessionTitle: string;
  teamLabel: string;
  content: ContractContent;
  finalizedAt: number | null;
}) {
  return (
    <div className="contract-print">
      <h1 style={{ fontSize: "20px", fontWeight: 700, marginBottom: "4px" }}>Team Contract</h1>
      <p style={{ color: "#334155", marginBottom: "2px" }}>{sessionTitle}</p>
      <p style={{ color: "#334155", marginBottom: "2px" }}>{teamLabel}</p>
      <p style={{ color: "#64748b", fontSize: "12px", marginBottom: "16px" }}>
        {finalizedAt ? `Finalized ${new Date(finalizedAt).toLocaleDateString()}` : "Draft — not yet finalized"}
      </p>
      {content.sections.map((s) => (
        <section key={s.id} style={{ marginBottom: "14px", breakInside: "avoid" }}>
          <h2 style={{ fontSize: "14px", fontWeight: 600, marginBottom: "4px" }}>{s.title}</h2>
          <p style={{ whiteSpace: "pre-wrap", fontSize: "13px", lineHeight: 1.5 }}>
            {s.text.trim() || "—"}
          </p>
        </section>
      ))}
    </div>
  );
}
