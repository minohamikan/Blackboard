const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { URL } = require("node:url");

const rootDir = path.resolve(__dirname, "..");
const publicDir = path.join(rootDir, "public");
const port = Number(process.env.PORT || 4173);
const localJsonPath = path.resolve(
  rootDir,
  process.env.BLACKBOARD_LOCAL_JSON || path.join("document", "Blackboard.json")
);

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

function safePath(pathname) {
  const requestPath = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.normalize(path.join(publicDir, requestPath));
  const relative = path.relative(publicDir, filePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return null;
  return filePath;
}

function isInsideRoot(filePath) {
  const relative = path.relative(rootDir, filePath);
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function sendJson(res, status, data) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(`${JSON.stringify(data, null, 2)}\n`);
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > 2 * 1024 * 1024) {
        reject(new Error("Request body is too large."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

async function handleBlackboardApi(req, res, url) {
  if (url.pathname !== "/api/blackboard") return false;

  if (!isInsideRoot(localJsonPath)) {
    sendJson(res, 500, { error: "BLACKBOARD_LOCAL_JSON must stay inside the project directory." });
    return true;
  }

  if (req.method === "GET") {
    if (!fs.existsSync(localJsonPath)) {
      sendJson(res, 404, { error: "Local blackboard JSON file was not found." });
      return true;
    }

    res.writeHead(200, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    });
    res.end(fs.readFileSync(localJsonPath, "utf8"));
    return true;
  }

  if (req.method === "PUT" || req.method === "POST") {
    const body = await readRequestBody(req);
    const parsed = JSON.parse(body);

    fs.mkdirSync(path.dirname(localJsonPath), { recursive: true });
    fs.writeFileSync(localJsonPath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
    sendJson(res, 200, {
      ok: true,
      path: path.relative(rootDir, localJsonPath).replaceAll(path.sep, "/")
    });
    return true;
  }

  res.writeHead(405, {
    "content-type": "text/plain; charset=utf-8",
    allow: "GET, PUT, POST"
  });
  res.end("Method not allowed");
  return true;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  try {
    if (await handleBlackboardApi(req, res, url)) return;
  } catch (error) {
    sendJson(res, 500, { error: error.message });
    return;
  }

  const filePath = safePath(url.pathname);

  if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, {
    "content-type": mimeTypes[ext] || "application/octet-stream",
    "cache-control": "no-store"
  });
  res.end(fs.readFileSync(filePath));
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Blackboard local preview: http://localhost:${port}`);
  console.log(`Local JSON file: ${path.relative(rootDir, localJsonPath)}`);
});
