const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const sourcePath = path.join(repoRoot, "document", "Blackboard.md");
const targetPath = path.join(repoRoot, "document", "Blackboard.html");

function normalizeText(text) {
  return text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function inlineMarkdown(value) {
  let html = escapeHtml(value);
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\[([A-Za-z0-9-]+)\]/g, '<span class="inline-id">[$1]</span>');
  return html;
}

function stripMarkdownTitle(value) {
  return value
    .replace(/^#+\s*/, "")
    .replace(/\s+#+$/, "")
    .replace(/^\*\*(.*)\*\*$/, "$1")
    .replace(/^\*+|\*+$/g, "")
    .trim();
}

function extractStatus(rawTitle) {
  let title = rawTitle.trim();
  let status = "";
  let statusLabel = "";

  const mixed = title.match(/\s+(O|X|\*|△|\?\?)\s*(?:또는|\/)\s*(O|X|\*|△|\?\?)\s*$/);
  if (mixed) {
    status = `${normalizeStatus(mixed[1])}/${normalizeStatus(mixed[2])}`;
    statusLabel = status;
    title = title.slice(0, mixed.index).trim();
    return { title, status, statusLabel };
  }

  const coded = title.match(/\s+`(O|X|\*|△|\?\?)`\s*$/);
  if (coded) {
    status = normalizeStatus(coded[1]);
    statusLabel = status;
    title = title.slice(0, coded.index).trim();
    return { title, status, statusLabel };
  }

  const plain = title.match(/\s+(O|X|\*|△|\?\?)\s*$/);
  if (plain) {
    status = normalizeStatus(plain[1]);
    statusLabel = status;
    title = title.slice(0, plain.index).trim();
  }

  return { title, status, statusLabel };
}

function normalizeStatus(value) {
  return value === "??" ? "△" : value;
}

function statusKind(status) {
  if (!status) return "none";
  if (status === "O") return "done";
  if (status === "X") return "todo";
  if (status === "*" || status === "＊") return "review";
  if (status.includes("△") || status.includes("/")) return "partial";
  return "none";
}

function isItemLine(line) {
  return /^(\s*)(?:#{1,6}\s*)?(?:<-\s*)?\[[A-Za-z0-9-]+\]\s+/.test(line);
}

function parseItemLine(line, lineNo) {
  const match = line.match(/^(\s*)(?:(#{1,6})\s*)?(?:<-\s*)?\[([A-Za-z0-9-]+)\]\s*(.*?)\s*$/);
  if (!match) return null;

  const [, indentText, heading, id, rawTitle] = match;
  const parsed = extractStatus(stripMarkdownTitle(rawTitle));

  return {
    type: "item",
    id,
    title: parsed.title || id,
    status: parsed.status,
    statusLabel: parsed.statusLabel,
    kind: statusKind(parsed.status),
    lineNo,
    indent: indentText.length,
    stackIndent: indentText.length,
    headingLevel: heading ? heading.length : 0,
    content: [],
    children: [],
    depth: 0,
  };
}

function parseHeadingSection(line) {
  const match = line.match(/^(#{1,6})\s+(?!\[)(.+?)\s*#*\s*$/);
  if (!match || match[1].length === 1) return null;
  return stripMarkdownTitle(match[2]);
}

function parseDashSection(line, lines, index, currentNode) {
  const match = line.match(/^-\s+(.+?)\s*$/);
  if (!match) return null;

  const title = match[1].trim();
  if (!isLikelySectionTitle(title)) return null;
  if (!currentNode) return title;
  if (isPreviousNonBlankListItem(lines, index) && !hasSectionKeyword(title)) return null;
  return hasItemSoon(lines, index) ? title : null;
}

function isLikelySectionTitle(title) {
  if (!title || title.length > 48) return false;
  if (/[\[\]]/.test(title)) return false;
  if (/^(O|X|\*|△|\?\?)\s*=/.test(title)) return false;
  if (/[.!?。！？:]$/.test(title)) return false;
  if (/^\d+[.)]/.test(title)) return false;
  return true;
}

function hasSectionKeyword(title) {
  return /(최종|입력|목표|하지|설계|결정|추가|부분해|가정|가설|제어|보류|blocker|focus)/i.test(title);
}

function hasItemSoon(lines, index) {
  let seen = 0;
  for (let i = index + 1; i < lines.length && seen < 6; i += 1) {
    const next = lines[i].trim();
    if (!next) continue;
    seen += 1;
    if (isItemLine(lines[i])) return true;
    if (/^[^:]{1,30}:$/.test(next)) continue;
    if (/^[-*]\s+/.test(next) || /^\d+[.)]\s+/.test(next)) return false;
  }
  return false;
}

function isPreviousNonBlankListItem(lines, index) {
  for (let i = index - 1; i >= 0; i -= 1) {
    const previous = lines[i].trim();
    if (!previous) continue;
    return /^[-*]\s+/.test(previous) || /^\d+[.)]\s+/.test(previous);
  }
  return false;
}

function makeSection(title, lineNo) {
  return {
    type: "section",
    title,
    lineNo,
    content: [],
    children: [],
  };
}

function findIdParent(id, idMap) {
  const parts = id.split("-");
  while (parts.length > 1) {
    parts.pop();
    const parentId = parts.join("-");
    if (idMap.has(parentId)) return idMap.get(parentId);
  }
  return null;
}

function findStackParent(item, stack) {
  while (stack.length && stack.at(-1).stackIndent >= item.indent) {
    stack.pop();
  }
  return stack.at(-1) || null;
}

function pushStack(item, stack) {
  while (stack.length && stack.at(-1).stackIndent >= item.stackIndent) {
    stack.pop();
  }
  stack.push(item);
}

function parseBlackboard(markdown) {
  const lines = normalizeText(markdown).split("\n");
  const firstTitle = lines.find((line) => line.trim());
  const documentTitle = firstTitle ? stripMarkdownTitle(firstTitle) : "Blackboard";
  const root = {
    title: documentTitle,
    sections: [],
  };

  let currentSection = null;
  let currentNode = null;
  const idMap = new Map();
  const stack = [];
  const headingStack = [];

  function ensureSection(title = "개요", lineNo = 1) {
    if (!currentSection || currentSection.title !== title) {
      currentSection = makeSection(title, lineNo);
      root.sections.push(currentSection);
      currentNode = null;
      stack.length = 0;
      headingStack.length = 0;
    }
    return currentSection;
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const lineNo = index + 1;
    const trimmed = line.trim();

    if (!trimmed) {
      if (currentNode) currentNode.content.push("");
      else if (currentSection) currentSection.content.push("");
      continue;
    }

    const item = parseItemLine(line, lineNo);
    if (item) {
      const section = currentSection || ensureSection("개요", lineNo);
      let parent = null;

      if (item.headingLevel) {
        while (headingStack.length && headingStack.at(-1).headingLevel >= item.headingLevel) {
          headingStack.pop();
        }
        parent = headingStack.at(-1)?.node || null;
      } else {
        parent = findIdParent(item.id, idMap) || findStackParent(item, stack);
      }

      item.depth = parent ? parent.depth + 1 : 0;
      item.stackIndent = parent ? Math.max(item.indent, parent.stackIndent + 1) : item.indent;

      if (parent) parent.children.push(item);
      else section.children.push(item);

      idMap.set(item.id, item);
      currentNode = item;

      if (item.headingLevel) {
        headingStack.push({ headingLevel: item.headingLevel, node: item });
      } else {
        pushStack(item, stack);
      }

      continue;
    }

    const headingSection = parseHeadingSection(line);
    const dashSection = parseDashSection(line, lines, index, currentNode);
    const sectionTitle = headingSection || dashSection;
    if (sectionTitle) {
      ensureSection(sectionTitle, lineNo);
      continue;
    }

    const target = currentNode || currentSection || ensureSection("개요", lineNo);
    target.content.push(line);
  }

  const stats = countStats(root.sections);
  return { ...root, stats };
}

function countStats(sections) {
  const stats = {
    sections: sections.length,
    items: 0,
    done: 0,
    partial: 0,
    todo: 0,
    review: 0,
    none: 0,
  };

  function visit(node) {
    stats.items += 1;
    stats[node.kind || "none"] += 1;
    node.children.forEach(visit);
  }

  sections.forEach((section) => section.children.forEach(visit));
  return stats;
}

function renderMarkdownLines(lines) {
  const result = [];
  let listType = "";
  let paragraph = [];

  function flushParagraph() {
    if (!paragraph.length) return;
    result.push(`<p>${inlineMarkdown(paragraph.join(" "))}</p>`);
    paragraph = [];
  }

  function closeList() {
    if (!listType) return;
    result.push(`</${listType}>`);
    listType = "";
  }

  function openList(type) {
    if (listType === type) return;
    closeList();
    listType = type;
    result.push(`<${type}>`);
  }

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      flushParagraph();
      closeList();
      continue;
    }

    const unordered = line.match(/^[-*]\s+(.+)$/);
    if (unordered) {
      flushParagraph();
      openList("ul");
      result.push(`<li>${inlineMarkdown(unordered[1])}</li>`);
      continue;
    }

    const ordered = line.match(/^\d+[.)]\s+(.+)$/);
    if (ordered) {
      flushParagraph();
      openList("ol");
      result.push(`<li>${inlineMarkdown(ordered[1])}</li>`);
      continue;
    }

    if (/^[^:]{1,40}:$/.test(line)) {
      flushParagraph();
      closeList();
      result.push(`<p class="label">${inlineMarkdown(line)}</p>`);
      continue;
    }

    closeList();
    paragraph.push(line);
  }

  flushParagraph();
  closeList();
  return result.join("\n");
}

function collectSearchText(node) {
  return [
    node.id,
    node.title,
    node.status,
    ...node.content,
    ...node.children.flatMap((child) => collectSearchText(child)),
  ].join(" ");
}

function renderItem(node) {
  const body = [
    node.content.length ? `<div class="markdown">${renderMarkdownLines(node.content)}</div>` : "",
    node.children.length ? `<div class="children">${node.children.map(renderItem).join("\n")}</div>` : "",
  ].filter(Boolean).join("\n");

  const status = node.statusLabel || node.status;
  const childLabel = node.children.length ? `${node.children.length}개 하위` : "하위 없음";
  const search = escapeHtml(collectSearchText(node).toLowerCase());

  return `
<details class="bb-item depth-${Math.min(node.depth, 6)}" data-id="${escapeHtml(node.id)}" data-status="${escapeHtml(node.kind)}" data-search="${search}">
  <summary>
    <span class="id">[${escapeHtml(node.id)}]</span>
    <span class="item-title">${inlineMarkdown(node.title)}</span>
    ${status ? `<span class="status ${escapeHtml(node.kind)}">${escapeHtml(status)}</span>` : ""}
    <span class="child-count">${childLabel}</span>
  </summary>
  <div class="item-body">
    ${body || '<p class="empty">내용 없음</p>'}
  </div>
</details>`;
}

function sectionStats(section) {
  const stats = { items: 0, done: 0, partial: 0, todo: 0, review: 0, none: 0 };
  function visit(node) {
    stats.items += 1;
    stats[node.kind || "none"] += 1;
    node.children.forEach(visit);
  }
  section.children.forEach(visit);
  return stats;
}

function renderSection(section) {
  const stats = sectionStats(section);
  const content = section.content.length ? `<div class="markdown section-note">${renderMarkdownLines(section.content)}</div>` : "";
  const items = section.children.length ? section.children.map(renderItem).join("\n") : '<p class="empty">항목 없음</p>';

  return `
<details class="section" open>
  <summary>
    <span class="section-title">${inlineMarkdown(section.title)}</span>
    <span class="section-count">${stats.items}개 항목</span>
  </summary>
  <div class="section-body">
    ${content}
    ${items}
  </div>
</details>`;
}

function renderPage(model) {
  const generatedAt = new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Seoul",
  }).format(new Date());

  const stats = model.stats;
  const sections = model.sections.map(renderSection).join("\n");

  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(model.title)}</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f6f7f9;
      --panel: #ffffff;
      --panel-strong: #eef2f6;
      --text: #1c2430;
      --muted: #657083;
      --line: #d9dee7;
      --accent: #2f6fed;
      --done: #177245;
      --partial: #9a6100;
      --todo: #b42318;
      --review: #7653c5;
      --none: #6b7280;
      --shadow: 0 10px 26px rgba(23, 31, 48, 0.08);
    }

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
      font-family: "Segoe UI", "Malgun Gothic", system-ui, sans-serif;
      line-height: 1.55;
    }

    .app {
      width: min(1180px, calc(100% - 32px));
      margin: 0 auto;
      padding: 28px 0 44px;
    }

    header {
      display: grid;
      gap: 16px;
      margin-bottom: 18px;
    }

    .topline {
      display: flex;
      align-items: end;
      justify-content: space-between;
      gap: 16px;
      flex-wrap: wrap;
    }

    h1 {
      margin: 0;
      font-size: clamp(28px, 4vw, 42px);
      line-height: 1.12;
      letter-spacing: 0;
    }

    .source {
      margin: 5px 0 0;
      color: var(--muted);
      font-size: 14px;
    }

    .stats {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }

    .stat {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      border: 1px solid var(--line);
      background: var(--panel);
      border-radius: 8px;
      padding: 7px 10px;
      font-size: 13px;
      color: var(--muted);
    }

    .stat strong {
      color: var(--text);
      font-weight: 700;
    }

    .toolbar {
      display: grid;
      grid-template-columns: minmax(220px, 1fr) auto;
      gap: 10px;
      align-items: center;
      border: 1px solid var(--line);
      background: var(--panel);
      border-radius: 8px;
      padding: 10px;
      box-shadow: var(--shadow);
      position: sticky;
      top: 10px;
      z-index: 10;
    }

    .search {
      width: 100%;
      min-height: 38px;
      border: 1px solid var(--line);
      border-radius: 7px;
      padding: 8px 11px;
      font: inherit;
      color: var(--text);
      background: #fff;
    }

    .actions {
      display: flex;
      gap: 7px;
      flex-wrap: wrap;
      justify-content: end;
    }

    button {
      min-height: 38px;
      border: 1px solid var(--line);
      border-radius: 7px;
      background: var(--panel-strong);
      color: var(--text);
      padding: 7px 10px;
      font: inherit;
      font-size: 13px;
      cursor: pointer;
    }

    button:hover {
      border-color: #aeb8c7;
    }

    button.active {
      background: var(--accent);
      border-color: var(--accent);
      color: #fff;
    }

    main {
      display: grid;
      gap: 12px;
      margin-top: 16px;
    }

    details {
      border-radius: 8px;
    }

    summary {
      list-style: none;
      cursor: pointer;
    }

    summary::-webkit-details-marker {
      display: none;
    }

    .section {
      border: 1px solid var(--line);
      background: var(--panel);
      box-shadow: var(--shadow);
      overflow: clip;
    }

    .section > summary {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 15px 17px;
      background: var(--panel-strong);
      border-bottom: 1px solid transparent;
    }

    .section[open] > summary {
      border-bottom-color: var(--line);
    }

    .section-title {
      font-size: 18px;
      font-weight: 800;
    }

    .section-count,
    .child-count {
      color: var(--muted);
      font-size: 12px;
      white-space: nowrap;
    }

    .section-body {
      padding: 12px;
      display: grid;
      gap: 10px;
    }

    .bb-item {
      border: 1px solid var(--line);
      background: #fff;
      overflow: hidden;
    }

    .bb-item > summary {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr) auto auto;
      gap: 10px;
      align-items: center;
      min-height: 48px;
      padding: 10px 12px;
    }

    .bb-item > summary::before,
    .section > summary::before {
      content: "›";
      display: inline-grid;
      place-items: center;
      width: 18px;
      height: 18px;
      color: var(--muted);
      transform: rotate(0deg);
      transition: transform 120ms ease;
    }

    .bb-item > summary {
      grid-template-columns: 18px auto minmax(0, 1fr) auto auto;
    }

    .section > summary {
      grid-template-columns: 18px minmax(0, 1fr) auto;
    }

    .bb-item[open] > summary::before,
    .section[open] > summary::before {
      transform: rotate(90deg);
    }

    .id {
      color: var(--accent);
      font-weight: 800;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }

    .item-title {
      min-width: 0;
      overflow-wrap: anywhere;
      font-weight: 650;
    }

    .status {
      min-width: 30px;
      text-align: center;
      border-radius: 999px;
      padding: 3px 8px;
      font-size: 12px;
      font-weight: 800;
      border: 1px solid transparent;
      white-space: nowrap;
    }

    .status.done {
      color: var(--done);
      background: #e8f6ef;
      border-color: #bfe8d0;
    }

    .status.partial {
      color: var(--partial);
      background: #fff4df;
      border-color: #f3cf91;
    }

    .status.todo {
      color: var(--todo);
      background: #ffebe8;
      border-color: #f7c0ba;
    }

    .status.review {
      color: var(--review);
      background: #f1edff;
      border-color: #d7ccff;
    }

    .item-body {
      border-top: 1px solid var(--line);
      padding: 12px;
      display: grid;
      gap: 10px;
      background: #fcfdff;
    }

    .children {
      display: grid;
      gap: 8px;
    }

    .depth-1,
    .depth-2,
    .depth-3,
    .depth-4,
    .depth-5,
    .depth-6 {
      margin-left: 12px;
    }

    .markdown {
      color: #2d3748;
      font-size: 14px;
    }

    .markdown p,
    .markdown ul,
    .markdown ol {
      margin: 0 0 8px;
    }

    .markdown p:last-child,
    .markdown ul:last-child,
    .markdown ol:last-child {
      margin-bottom: 0;
    }

    .markdown ul,
    .markdown ol {
      padding-left: 22px;
    }

    .markdown li + li {
      margin-top: 4px;
    }

    .label {
      color: #111827;
      font-weight: 800;
    }

    .inline-id {
      color: var(--accent);
      font-weight: 750;
    }

    code {
      border: 1px solid var(--line);
      border-radius: 5px;
      background: #f3f5f8;
      padding: 1px 5px;
      font-family: "Cascadia Code", Consolas, monospace;
      font-size: 0.92em;
    }

    .empty {
      margin: 0;
      color: var(--muted);
      font-size: 14px;
    }

    .footer-note {
      margin-top: 16px;
      color: var(--muted);
      font-size: 13px;
      text-align: right;
    }

    [hidden] {
      display: none !important;
    }

    @media (max-width: 760px) {
      .app {
        width: min(100% - 20px, 1180px);
        padding-top: 18px;
      }

      .toolbar {
        grid-template-columns: 1fr;
        position: static;
      }

      .actions {
        justify-content: start;
      }

      .bb-item > summary {
        grid-template-columns: 18px auto minmax(0, 1fr) auto;
      }

      .child-count {
        display: none;
      }

      .depth-1,
      .depth-2,
      .depth-3,
      .depth-4,
      .depth-5,
      .depth-6 {
        margin-left: 6px;
      }
    }
  </style>
</head>
<body>
  <div class="app">
    <header>
      <div class="topline">
        <div>
          <h1>${escapeHtml(model.title)}</h1>
          <p class="source">원본: document/Blackboard.md · 생성: ${escapeHtml(generatedAt)}</p>
        </div>
        <div class="stats" aria-label="상태 요약">
          <span class="stat"><strong>${stats.items}</strong> 전체</span>
          <span class="stat"><strong>${stats.done}</strong> O</span>
          <span class="stat"><strong>${stats.partial}</strong> △</span>
          <span class="stat"><strong>${stats.todo}</strong> X</span>
          <span class="stat"><strong>${stats.review}</strong> *</span>
        </div>
      </div>
      <div class="toolbar">
        <input class="search" id="search" type="search" placeholder="ID, 제목, 내용 검색" autocomplete="off">
        <div class="actions">
          <button type="button" data-filter="all" class="active">전체</button>
          <button type="button" data-filter="done">O</button>
          <button type="button" data-filter="partial">△</button>
          <button type="button" data-filter="todo">X</button>
          <button type="button" data-filter="review">*</button>
          <button type="button" id="expandAll">모두 펼침</button>
          <button type="button" id="collapseAll">모두 접기</button>
        </div>
      </div>
    </header>

    <main id="board">
      ${sections}
    </main>

    <p class="footer-note">이 파일은 자동 생성물입니다. 수정은 document/Blackboard.md에서 하고 npm run blackboard로 갱신하세요.</p>
  </div>

  <script>
    const search = document.querySelector("#search");
    const filterButtons = [...document.querySelectorAll("[data-filter]")];
    const items = [...document.querySelectorAll(".bb-item")];
    const sections = [...document.querySelectorAll(".section")];

    function activeFilter() {
      return document.querySelector("[data-filter].active")?.dataset.filter || "all";
    }

    function matchesItem(item, query, filter) {
      const status = item.dataset.status || "none";
      const statusMatches = filter === "all" || status === filter;
      const queryMatches = !query || item.dataset.search.includes(query);
      return statusMatches && queryMatches;
    }

    function showAncestors(item) {
      let current = item;
      while (current) {
        if (current.classList?.contains("bb-item") || current.classList?.contains("section")) {
          current.hidden = false;
          current.open = true;
        }
        current = current.parentElement?.closest("details");
      }
    }

    function applyFilters() {
      const query = search.value.trim().toLowerCase();
      const filter = activeFilter();
      const filtering = query || filter !== "all";

      if (!filtering) {
        items.forEach((item) => { item.hidden = false; });
        sections.forEach((section) => { section.hidden = false; });
        return;
      }

      items.forEach((item) => { item.hidden = true; });
      sections.forEach((section) => { section.hidden = true; });

      for (const item of items) {
        if (matchesItem(item, query, filter)) showAncestors(item);
      }
    }

    search.addEventListener("input", applyFilters);

    filterButtons.forEach((button) => {
      button.addEventListener("click", () => {
        filterButtons.forEach((candidate) => candidate.classList.remove("active"));
        button.classList.add("active");
        applyFilters();
      });
    });

    document.querySelector("#expandAll").addEventListener("click", () => {
      document.querySelectorAll("details").forEach((detail) => { detail.open = true; });
    });

    document.querySelector("#collapseAll").addEventListener("click", () => {
      document.querySelectorAll(".bb-item").forEach((detail) => { detail.open = false; });
      sections.forEach((section) => { section.open = true; });
    });
  </script>
</body>
</html>`;
}

function build() {
  const markdown = fs.readFileSync(sourcePath, "utf8");
  const model = parseBlackboard(markdown);
  const html = renderPage(model);
  fs.writeFileSync(targetPath, html, "utf8");
  console.log(`[blackboard] wrote ${path.relative(repoRoot, targetPath)} (${model.stats.items} items)`);
}

if (require.main === module) {
  build();
}

module.exports = {
  build,
  parseBlackboard,
  renderPage,
};
