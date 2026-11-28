import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));

/** Identify a Node.js unit test module by its filename.
 * @param fileName File name found in the unit test directory.
 */
function isUnitTestFile(fileName) {
  return fileName.endsWith(".test.mjs");
}

/** Run each unit test module directly so node:test cases execute across Node versions.
 * @param testDirectory Directory containing `.test.mjs` unit test modules.
 */
function runUnitTests(testDirectory) {
  const testFiles = readdirSync(testDirectory).filter(isUnitTestFile).sort();
  if (testFiles.length === 0) {
    console.error(`No unit test modules found in ${testDirectory}`);
    return 1;
  }

  for (const testFile of testFiles) {
    const result = spawnSync(
      process.execPath,
      [path.join(testDirectory, testFile)],
      { stdio: "inherit" },
    );
    if (result.error) throw result.error;
    if (result.status !== 0) return result.status ?? 1;
  }

  return 0;
}

process.exitCode = runUnitTests(path.resolve(scriptDirectory, "../tests/unit"));
