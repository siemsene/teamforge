// Reproducible document builds.
//
// Both generators embedded a wall-clock timestamp, so `npm run docs` rewrote
// every file whether or not its content had changed and each docs commit
// carried a few hundred bytes of noise:
//
//   - pdfkit derives the PDF's /ID trailer from an MD5 of the info dictionary,
//     and info.CreationDate defaults to `new Date()`. Pin the date and the id
//     becomes stable too.
//   - exceljs hands each file to JSZip without a date, so every zip entry is
//     stamped with the current time. There is no hook for it, so the workbook
//     is normalised after the fact.
//
// Follows the reproducible-builds convention: SOURCE_DATE_EPOCH overrides the
// timestamp when something genuinely wants a real one.

import JSZip from "jszip";

/** Fixed timestamp for every generated document. */
export const BUILD_DATE = new Date(Number(process.env.SOURCE_DATE_EPOCH ?? 0) * 1000);

/** Info-dictionary entries that make a pdfkit document byte-identical run to run. */
export function pdfInfo(extra) {
  return { CreationDate: BUILD_DATE, ModDate: BUILD_DATE, ...extra };
}

/**
 * Rewrites an .xlsx so every zip entry carries BUILD_DATE instead of the time
 * it happened to be generated. Content is untouched.
 */
export async function normalizeXlsx(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  zip.forEach((_path, file) => {
    file.date = BUILD_DATE;
  });
  return zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
}
