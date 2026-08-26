// Saving a contract as a PDF.
//
// There is no way to hand a browser a finished PDF without either shipping a
// PDF library or asking it to print. A library is the wrong trade here: the
// standard PDF fonts only cover WinAnsi, so a student writing a name with a
// character outside Latin-1 would get the wrong glyphs, and embedding a
// Unicode font to fix that costs more bundle than this one button is worth.
// Printing renders exactly what the student typed, in whatever script.
//
// So the print dialog stays — but the button now says so, and the file it
// saves is named properly. Browsers take the "Save as PDF" filename from
// document.title, which otherwise leaves students with "TeamForge.pdf".

/** Characters no common filesystem accepts, plus control characters. */
const ILLEGAL_IN_FILENAME = new RegExp("[\\\\/:*?\"<>|\\u0000-\\u001f]", "g");

/** A readable, filesystem-safe name for a contract PDF. */
export function contractPdfName(sessionTitle: string, teamLabel: string): string {
  const parts = ["Team Contract", sessionTitle, teamLabel]
    .map((part) => part.replace(ILLEGAL_IN_FILENAME, " ").replace(/\s+/g, " ").trim())
    .filter(Boolean);
  return parts.join(" - ").slice(0, 120);
}

/**
 * Opens the print dialog with `filename` as the suggested name, restoring the
 * page title afterwards.
 *
 * `afterprint` is unreliable — Safari has historically not fired it, and a
 * dialog the user simply leaves open fires nothing at all — so a timer restores
 * the title regardless. Restoring twice is harmless.
 */
export function printAs(filename: string): void {
  const previous = document.title;
  document.title = filename;

  const restore = () => {
    document.title = previous;
    window.removeEventListener("afterprint", restore);
  };
  window.addEventListener("afterprint", restore);
  window.print();
  setTimeout(restore, 60_000);
}
