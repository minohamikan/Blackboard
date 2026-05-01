const fs = require("node:fs");
const path = require("node:path");
const { parseBlackboard } = require("./build-blackboard");

const repoRoot = path.resolve(__dirname, "..");
const sourcePath = path.join(repoRoot, "document", "Blackboard.md");
const targetPath = path.join(repoRoot, "document", "Blackboard.json");
const force = process.argv.includes("--force");

function toStatus(value) {
  if (value === "O") return "done";
  if (value === "X") return "todo";
  if (value === "*") return "review";
  if (value === "△" || value === "??" || String(value || "").includes("△") || String(value || "").includes("/")) {
    return "partial";
  }
  return "none";
}

function sectionId(title, index) {
  const ascii = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return ascii || `section-${index + 1}`;
}

function convertItem(item) {
  return {
    id: item.id,
    title: item.title,
    status: toStatus(item.status),
    body: item.content,
    children: item.children.map(convertItem),
  };
}

function migrate() {
  if (fs.existsSync(targetPath) && !force) {
    console.log("[blackboard] document/Blackboard.json already exists. Use --force to overwrite.");
    return;
  }

  const markdown = fs.readFileSync(sourcePath, "utf8");
  const parsed = parseBlackboard(markdown);
  const board = {
    version: 1,
    title: parsed.title,
    updatedAt: new Date().toISOString(),
    sections: parsed.sections.map((section, index) => ({
      id: sectionId(section.title, index),
      title: section.title,
      body: section.content,
      items: section.children.map(convertItem),
    })),
  };

  fs.writeFileSync(targetPath, `${JSON.stringify(board, null, 2)}\n`, "utf8");
  console.log(`[blackboard] wrote ${path.relative(repoRoot, targetPath)}`);
}

migrate();
