const statusOptions = [
  { value: "none", label: "-" },
  { value: "done", label: "O" },
  { value: "partial", label: "△" },
  { value: "todo", label: "X" },
  { value: "review", label: "*" },
];

const statusLabels = new Map(statusOptions.map((option) => [option.value, option.label]));
const boardElement = document.querySelector("#board");
const titleElement = document.querySelector("#boardTitle");
const metaElement = document.querySelector("#meta");
const statsElement = document.querySelector("#stats");
const searchInput = document.querySelector("#searchInput");
const saveState = document.querySelector("#saveState");
const itemDialog = document.querySelector("#itemDialog");
const itemForm = document.querySelector("#itemForm");
const newItemId = document.querySelector("#newItemId");
const newItemTitle = document.querySelector("#newItemTitle");
const newItemStatus = document.querySelector("#newItemStatus");
const dialogTarget = document.querySelector("#dialogTarget");

let board = null;
let activeFilter = "all";
let saveTimer = null;
let addTarget = null;

function makeElement(tagName, options = {}) {
  const element = document.createElement(tagName);
  if (options.className) element.className = options.className;
  if (options.text != null) element.textContent = options.text;
  if (options.type) element.type = options.type;
  if (options.value != null) element.value = options.value;
  if (options.placeholder) element.placeholder = options.placeholder;
  return element;
}

function normalizeStatus(status) {
  if (status === "O") return "done";
  if (status === "△" || status === "??") return "partial";
  if (status === "X") return "todo";
  if (status === "*") return "review";
  return statusOptions.some((option) => option.value === status) ? status : "none";
}

function normalizeItem(item) {
  return {
    id: String(item.id || "").trim(),
    title: String(item.title || item.id || "새 항목").trim(),
    status: normalizeStatus(item.status),
    body: Array.isArray(item.body) ? item.body.map(String) : [],
    children: Array.isArray(item.children) ? item.children.map(normalizeItem) : [],
  };
}

function normalizeBoard(data) {
  return {
    version: 1,
    title: String(data.title || "Blackboard").trim(),
    updatedAt: data.updatedAt || "",
    sections: Array.isArray(data.sections)
      ? data.sections.map((section, index) => ({
        id: String(section.id || `section-${index + 1}`).trim(),
        title: String(section.title || `Section ${index + 1}`).trim(),
        body: Array.isArray(section.body) ? section.body.map(String) : [],
        items: Array.isArray(section.items) ? section.items.map(normalizeItem) : [],
      }))
      : [],
  };
}

function flattenItems(items, output = []) {
  for (const item of items) {
    output.push(item);
    flattenItems(item.children, output);
  }
  return output;
}

function allItems() {
  return board.sections.flatMap((section) => flattenItems(section.items));
}

function itemSearchText(item) {
  return [
    item.id,
    item.title,
    statusLabels.get(item.status) || "",
    ...item.body,
    ...item.children.flatMap((child) => itemSearchText(child)),
  ].join(" ").toLowerCase();
}

function stats() {
  const result = { total: 0, done: 0, partial: 0, todo: 0, review: 0, none: 0 };
  for (const item of allItems()) {
    result.total += 1;
    result[item.status] = (result[item.status] || 0) + 1;
  }
  return result;
}

function updateStats() {
  const count = stats();
  statsElement.replaceChildren(
    stat("전체", count.total),
    stat("O", count.done),
    stat("△", count.partial),
    stat("X", count.todo),
    stat("*", count.review),
  );
}

function stat(label, value) {
  const element = makeElement("span", { className: "stat" });
  const number = makeElement("strong", { text: value });
  element.append(number, document.createTextNode(` ${label}`));
  return element;
}

function setSaveState(text, className = "") {
  saveState.textContent = text;
  saveState.className = `save-state ${className}`.trim();
}

async function loadBoard() {
  setSaveState("불러오는 중");
  const response = await fetch("/api/blackboard", { cache: "no-store" });
  if (!response.ok) {
    throw new Error(await response.text());
  }
  board = normalizeBoard(await response.json());
  render();
  setSaveState("대기 중");
}

function scheduleSave() {
  setSaveState("저장 대기", "dirty");
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveBoard, 500);
}

async function saveBoard() {
  clearTimeout(saveTimer);
  saveTimer = null;
  setSaveState("저장 중", "dirty");

  try {
    const response = await fetch("/api/blackboard", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(board),
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      throw new Error(payload?.error || response.statusText);
    }

    board = normalizeBoard(await response.json());
    metaElement.textContent = `원본: document/Blackboard.json · 갱신: ${formatUpdatedAt(board.updatedAt)}`;
    updateStats();
    setSaveState("저장됨", "saved");
  } catch (error) {
    setSaveState("저장 실패", "error");
    console.error(error);
  }
}

function formatUpdatedAt(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function render() {
  titleElement.textContent = board.title;
  document.title = board.title;
  metaElement.textContent = `원본: document/Blackboard.json · 갱신: ${formatUpdatedAt(board.updatedAt)}`;
  updateStats();

  const fragment = document.createDocumentFragment();
  board.sections.forEach((section, sectionIndex) => {
    fragment.append(renderSection(section, sectionIndex));
  });
  boardElement.replaceChildren(fragment);
  applyFilters();
}

function renderSection(section, sectionIndex) {
  const details = makeElement("details", { className: "section" });
  details.open = true;
  details.dataset.search = [
    section.id,
    section.title,
    ...section.body,
    ...section.items.flatMap((item) => itemSearchText(item)),
  ].join(" ").toLowerCase();

  const summary = makeElement("summary");
  const title = makeElement("span", { className: "section-title", text: section.title });
  const count = makeElement("span", {
    className: "section-count",
    text: `${flattenItems(section.items).length}개 항목`,
  });
  const addRoot = makeElement("button", { type: "button", text: "루트 항목 추가" });
  addRoot.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    openAddDialog({ section, parent: null });
  });
  stopSummaryToggle(addRoot);
  summary.append(title, count, addRoot);

  const body = makeElement("div", { className: "section-body" });
  const note = makeElement("textarea", { className: "section-note", value: section.body.join("\n") });
  note.placeholder = "섹션 메모";
  note.addEventListener("input", () => {
    section.body = note.value.split("\n");
    scheduleSave();
  });

  const list = makeElement("div", { className: "item-list" });
  section.items.forEach((item) => {
    list.append(renderItem(item, section, null, 0));
  });

  body.append(note, list);
  details.append(summary, body);
  details.dataset.sectionIndex = sectionIndex;
  return details;
}

function renderItem(item, section, parent, depth) {
  const details = makeElement("details", { className: `item depth-${Math.min(depth, 6)}` });
  details.dataset.id = item.id;
  details.dataset.status = item.status;
  details.dataset.search = itemSearchText(item);

  const summary = makeElement("summary");
  const id = makeElement("span", { className: "item-id", text: `[${item.id}]` });
  const title = makeElement("span", { className: "item-title", text: item.title });
  const status = renderStatusSelect(item);
  const childCount = makeElement("span", { className: "child-count", text: `${item.children.length}개 하위` });
  const addChild = makeElement("button", { className: "summary-add", type: "button", text: "하위 추가" });
  addChild.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    openAddDialog({ section, parent: item });
  });
  stopSummaryToggle(addChild);
  summary.append(id, title, status, childCount, addChild);

  const body = makeElement("div", { className: "item-body" });
  const editorGrid = makeElement("div", { className: "editor-grid" });
  const idField = renderInputField("ID", item.id, (value) => {
    item.id = value.trim();
    id.textContent = `[${item.id || "ID"}]`;
    scheduleSave();
  });
  const titleField = renderInputField("제목", item.title, (value) => {
    item.title = value;
    title.textContent = value || "새 항목";
    scheduleSave();
  });
  editorGrid.append(idField, titleField);

  const bodyEditor = makeElement("textarea", { className: "body-editor", value: item.body.join("\n") });
  bodyEditor.placeholder = "완료 조건, 근거, 현재 판단 등을 적습니다.";
  bodyEditor.addEventListener("input", () => {
    item.body = bodyEditor.value.split("\n");
    details.dataset.search = itemSearchText(item);
    scheduleSave();
  });

  const actions = makeElement("div", { className: "item-actions" });
  const addChildBody = makeElement("button", { type: "button", text: "하위 추가" });
  addChildBody.addEventListener("click", () => openAddDialog({ section, parent: item }));
  const deleteButton = makeElement("button", { className: "danger", type: "button", text: "삭제" });
  deleteButton.addEventListener("click", () => deleteItem(section, parent, item));
  actions.append(addChildBody, deleteButton);

  const children = makeElement("div", { className: "children" });
  item.children.forEach((child) => {
    children.append(renderItem(child, section, item, depth + 1));
  });

  body.append(editorGrid, bodyEditor, actions, children);
  details.append(summary, body);
  return details;
}

function renderInputField(labelText, value, onInput) {
  const label = makeElement("label", { className: "editor-field", text: labelText });
  const input = makeElement("input", { value });
  input.addEventListener("input", () => onInput(input.value));
  label.append(input);
  return label;
}

function renderStatusSelect(item) {
  const select = makeElement("select", { className: "status-select" });
  for (const option of statusOptions) {
    const element = makeElement("option", { value: option.value, text: option.label });
    select.append(element);
  }
  select.value = item.status;
  select.addEventListener("change", () => {
    item.status = normalizeStatus(select.value);
    select.closest(".item").dataset.status = item.status;
    updateStats();
    scheduleSave();
    applyFilters();
  });
  stopSummaryToggle(select);
  return select;
}

function stopSummaryToggle(element) {
  ["click", "mousedown", "keydown"].forEach((eventName) => {
    element.addEventListener(eventName, (event) => event.stopPropagation());
  });
}

function openAddDialog(target) {
  addTarget = target;
  const parentLabel = target.parent ? `[${target.parent.id}] ${target.parent.title}` : target.section.title;
  dialogTarget.textContent = `추가 위치: ${parentLabel}`;
  newItemId.value = suggestChildId(target.section, target.parent);
  newItemTitle.value = "새 항목";
  newItemStatus.value = "todo";
  itemDialog.showModal();
  newItemTitle.focus();
  newItemTitle.select();
}

function suggestChildId(section, parent) {
  const siblings = parent ? parent.children : section.items;
  const prefix = parent ? `${parent.id}-` : `${section.id.toUpperCase()}-`;
  let index = siblings.length + 1;
  const used = new Set(siblings.map((item) => item.id));
  while (used.has(`${prefix}${index}`)) index += 1;
  return `${prefix}${index}`;
}

itemForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!addTarget) return;

  const item = normalizeItem({
    id: newItemId.value,
    title: newItemTitle.value,
    status: newItemStatus.value,
    body: [],
    children: [],
  });

  if (addTarget.parent) addTarget.parent.children.push(item);
  else addTarget.section.items.push(item);

  itemDialog.close();
  addTarget = null;
  render();
  scheduleSave();
});

document.querySelector("#cancelItemButton").addEventListener("click", () => {
  itemDialog.close();
  addTarget = null;
});

function deleteItem(section, parent, item) {
  if (!window.confirm(`[${item.id}] 항목과 모든 하위 항목을 삭제할까요?`)) return;
  const list = parent ? parent.children : section.items;
  const index = list.indexOf(item);
  if (index >= 0) list.splice(index, 1);
  render();
  scheduleSave();
}

function addSection() {
  const title = window.prompt("새 섹션 제목");
  if (!title) return;
  const id = `section-${board.sections.length + 1}`;
  board.sections.push({ id, title: title.trim(), body: [], items: [] });
  render();
  scheduleSave();
}

function applyFilters() {
  const query = searchInput.value.trim().toLowerCase();
  const filtering = query || activeFilter !== "all";
  const items = [...document.querySelectorAll(".item")];
  const sections = [...document.querySelectorAll(".section")];

  if (!filtering) {
    items.forEach((item) => { item.hidden = false; });
    sections.forEach((section) => { section.hidden = false; });
    return;
  }

  items.forEach((item) => { item.hidden = true; });
  sections.forEach((section) => { section.hidden = true; });

  for (const item of items) {
    const statusMatches = activeFilter === "all" || item.dataset.status === activeFilter;
    const queryMatches = !query || item.dataset.search.includes(query);
    if (statusMatches && queryMatches) {
      let current = item;
      while (current) {
        if (current.matches?.(".item, .section")) {
          current.hidden = false;
          current.open = true;
        }
        current = current.parentElement?.closest("details");
      }
    }
  }
}

document.querySelectorAll("[data-filter]").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll("[data-filter]").forEach((candidate) => candidate.classList.remove("active"));
    button.classList.add("active");
    activeFilter = button.dataset.filter;
    applyFilters();
  });
});

searchInput.addEventListener("input", applyFilters);
document.querySelector("#addSectionButton").addEventListener("click", addSection);
document.querySelector("#reloadButton").addEventListener("click", () => loadBoard().catch((error) => {
  setSaveState("불러오기 실패", "error");
  console.error(error);
}));
document.querySelector("#expandButton").addEventListener("click", () => {
  document.querySelectorAll("details").forEach((details) => { details.open = true; });
});
document.querySelector("#collapseButton").addEventListener("click", () => {
  document.querySelectorAll(".item").forEach((details) => { details.open = false; });
  document.querySelectorAll(".section").forEach((details) => { details.open = true; });
});

loadBoard().catch((error) => {
  setSaveState("불러오기 실패", "error");
  boardElement.textContent = error.message;
  console.error(error);
});
