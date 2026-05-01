const fs = require("node:fs");
const path = require("node:path");
const { build } = require("./build-blackboard");

const repoRoot = path.resolve(__dirname, "..");
const sourcePath = path.join(repoRoot, "document", "Blackboard.md");

let timer = null;

function scheduleBuild() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    try {
      build();
    } catch (error) {
      console.error("[blackboard] build failed");
      console.error(error);
    }
  }, 120);
}

build();
console.log(`[blackboard] watching ${path.relative(repoRoot, sourcePath)}`);

fs.watch(sourcePath, { persistent: true }, scheduleBuild);
