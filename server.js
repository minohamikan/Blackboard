const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { URL } = require("node:url");

const rootDir = __dirname;
const publicDir = path.join(rootDir, "public");
const dataPath = process.env.BLACKBOARD_PATH || path.join(rootDir, "document", "Blackboard.json");
const port = Number(process.env.PORT || 4173);

const statusAliases = new Map([
  ["O", "done"],
  ["done", "done"],
  ["△", "partial"],
  ["??", "partial"],
  ["partial", "partial"],
  ["X", "todo"],
  ["todo", "todo"],
  ["*", "review"],
  ["review", "review"],
  ["none", "none"],
  ["", "none"],
]);

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

function send(res, statusCode, body, headers = {}) {
  res.writeHead(statusCode, headers);
  res.end(body);
}

function sendJson(res, statusCode, payload) {
  send(res, statusCode, JSON.stringify(payload, null, 2), {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
}

function sendError(res, statusCode, message) {
  sendJson(res, statusCode, { error: message });
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 5 * 1024 * 1024) {
        reject(new Error("Request body is too large."));
        req.destroy();
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function readBoard() {
  if (!fs.existsSync(dataPath)) {
    return {
      version: 1,
      title: "Blackboard",
      updatedAt: new Date().toISOString(),
      sections: [],
    };
  }

  return JSON.parse(fs.readFileSync(dataPath, "utf8"));
}

function normalizeStatus(value) {
  const normalized = statusAliases.get(String(value ?? "").trim());
  if (!normalized) {
    throw new Error(`Invalid status: ${value}`);
  }
  return normalized;
}

function normalizeStringArray(value, fieldName) {
  if (value == null) return [];
  if (!Array.isArray(value)) {
    throw new Error(`${fieldName} must be an array.`);
  }
  return value.map((entry) => String(entry));
}

function normalizeItem(item, pathLabel) {
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    throw new Error(`${pathLabel} must be an object.`);
  }

  const id = String(item.id ?? "").trim();
  if (!id) {
    throw new Error(`${pathLabel}.id is required.`);
  }

  const children = item.children == null ? [] : item.children;
  if (!Array.isArray(children)) {
    throw new Error(`${pathLabel}.children must be an array.`);
  }

  return {
    id,
    title: String(item.title ?? id).trim() || id,
    status: normalizeStatus(item.status),
    body: normalizeStringArray(item.body, `${pathLabel}.body`),
    children: children.map((child, index) => normalizeItem(child, `${pathLabel}.children[${index}]`)),
  };
}

function normalizeBoard(board) {
  if (!board || typeof board !== "object" || Array.isArray(board)) {
    throw new Error("Board must be an object.");
  }

  const sections = board.sections == null ? [] : board.sections;
  if (!Array.isArray(sections)) {
    throw new Error("sections must be an array.");
  }

  return {
    version: 1,
    title: String(board.title ?? "Blackboard").trim() || "Blackboard",
    updatedAt: new Date().toISOString(),
    sections: sections.map((section, sectionIndex) => {
      if (!section || typeof section !== "object" || Array.isArray(section)) {
        throw new Error(`sections[${sectionIndex}] must be an object.`);
      }

      const id = String(section.id ?? `section-${sectionIndex + 1}`).trim();
      const items = section.items == null ? [] : section.items;
      if (!Array.isArray(items)) {
        throw new Error(`sections[${sectionIndex}].items must be an array.`);
      }

      return {
        id,
        title: String(section.title ?? id).trim() || id,
        body: normalizeStringArray(section.body, `sections[${sectionIndex}].body`),
        items: items.map((item, itemIndex) => normalizeItem(item, `sections[${sectionIndex}].items[${itemIndex}]`)),
      };
    }),
  };
}

function backupExistingFile() {
  if (!fs.existsSync(dataPath)) return;

  const backupDir = path.join(path.dirname(dataPath), ".blackboard-backups");
  fs.mkdirSync(backupDir, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = path.join(backupDir, `Blackboard.${stamp}.json`);
  fs.copyFileSync(dataPath, backupPath);
}

function writeBoard(board) {
  const normalized = normalizeBoard(board);
  fs.mkdirSync(path.dirname(dataPath), { recursive: true });
  backupExistingFile();

  const tempPath = `${dataPath}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  fs.renameSync(tempPath, dataPath);
  return normalized;
}

function safeStaticPath(urlPath) {
  const requested = urlPath === "/" ? "/index.html" : urlPath;
  const filePath = path.normalize(path.join(publicDir, requested));
  if (!filePath.startsWith(publicDir)) return null;
  return filePath;
}

async function handleApi(req, res, pathname) {
  if (pathname === "/api/health" && req.method === "GET") {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (pathname !== "/api/blackboard") {
    sendError(res, 404, "Not found.");
    return;
  }

  if (req.method === "GET") {
    try {
      sendJson(res, 200, normalizeBoard(readBoard()));
    } catch (error) {
      sendError(res, 500, error.message);
    }
    return;
  }

  if (req.method === "PUT") {
    try {
      const rawBody = await readRequestBody(req);
      const board = JSON.parse(rawBody);
      sendJson(res, 200, writeBoard(board));
    } catch (error) {
      sendError(res, 400, error.message);
    }
    return;
  }

  sendError(res, 405, "Method not allowed.");
}

function serveStatic(res, pathname) {
  const filePath = safeStaticPath(pathname);
  if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    send(res, 404, "Not found.", { "content-type": "text/plain; charset=utf-8" });
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  send(res, 200, fs.readFileSync(filePath), {
    "content-type": mimeTypes[ext] || "application/octet-stream",
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  if (url.pathname.startsWith("/api/")) {
    handleApi(req, res, url.pathname);
    return;
  }

  serveStatic(res, url.pathname);
});

server.listen(port, "0.0.0.0", () => {
  console.log(`[blackboard] http://localhost:${port}`);
  console.log(`[blackboard] data ${dataPath}`);
});
