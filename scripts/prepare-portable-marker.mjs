import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const resourcesDirectory = path.resolve(scriptDirectory, "../build-resources");
mkdirSync(resourcesDirectory, { recursive: true });
writeFileSync(path.join(resourcesDirectory, "portable-mode"), "");
