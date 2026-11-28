const fs = require("node:fs");
const path = require("node:path");

const resourcesDirectory = path.resolve(__dirname, "../build-resources");
fs.mkdirSync(resourcesDirectory, { recursive: true });
fs.writeFileSync(path.join(resourcesDirectory, "portable-mode"), "");
