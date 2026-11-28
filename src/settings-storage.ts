import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";

/** Write settings through a sibling temporary file so a failed write preserves the previous file.
 * @param filePath Destination settings file path.
 * @param contents Complete serialized settings to persist.
 */
export function writeSettingsAtomically(
  filePath: string,
  contents: string,
): void {
  const temporaryPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`,
  );
  let temporaryFileExists = false;

  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    temporaryFileExists = true;
    fs.writeFileSync(temporaryPath, contents, { encoding: "utf8", flag: "wx" });
    fs.renameSync(temporaryPath, filePath);
    temporaryFileExists = false;
  } finally {
    if (temporaryFileExists) {
      try {
        fs.unlinkSync(temporaryPath);
      } catch {
        // Preserve the original write or rename error if cleanup also fails.
      }
    }
  }
}
