const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const DRIVE_API = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";
const CONFIG = window.BLACKBOARD_CONFIG || {};
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const isLocalFileMode = LOCAL_HOSTS.has(window.location.hostname);
const localApiUrl = CONFIG.localApiUrl || "./api/blackboard";
const localFileName = CONFIG.localFileName || "document/Blackboard.json";
const STORAGE_KEYS = {
  clientId: "blackboard.googleClientId",
  driveFileId: "blackboard.driveFileId",
  driveFileName: "blackboard.driveFileName"
};

const statusOptions = [
  { value: "none", label: "-" },
  { value: "done", label: "O" },
  { value: "partial", label: "Partial" },
  { value: "todo", label: "X" },
  { value: "review", label: "*" }
];

const statusLabels = new Map(statusOptions.map((option) => [option.value, option.label]));

const boardElement = document.querySelector("#board");
const titleElement = document.querySelector("#boardTitle");
const metaElement = document.querySelector("#meta");
const statsElement = document.querySelector("#stats");
const searchInput = document.querySelector("#searchInput");
const saveState = document.querySelector("#saveState");
const driveInfo = document.querySelector("#driveInfo");
const clientIdInput = document.querySelector("#clientIdInput");
const saveClientButton = document.querySelector("#saveClientButton");
const signInButton = document.querySelector("#signInButton");
const findFileButton = document.querySelector("#findFileButton");
const createFileButton = document.querySelector("#createFileButton");
const saveNowButton = document.querySelector("#saveNowButton");
const importInput = document.querySelector("#importInput");
const exportButton = document.querySelector("#exportButton");
const unlinkButton = document.querySelector("#unlinkButton");
const itemDialog = document.querySelector("#itemDialog");
const itemForm = document.querySelector("#itemForm");
const newItemId = document.querySelector("#newItemId");
const newItemTitle = document.querySelector("#newItemTitle");
const newItemStatus = document.querySelector("#newItemStatus");
const dialogTarget = document.querySelector("#dialogTarget");
const reloadButton = document.querySelector("#reloadButton");

let board = createEmptyBoard();
let activeFilter = "all";
let saveTimer = null;
let addTarget = null;
let tokenClient = null;
let accessToken = "";
let driveFile = {
  id: localStorage.getItem(STORAGE_KEYS.driveFileId) || "",
  name: localStorage.getItem(STORAGE_KEYS.driveFileName) || CONFIG.driveFileName || "Blackboard.json",
  modifiedTime: ""
};

init();

function init() {
  clientIdInput.value = localStorage.getItem(STORAGE_KEYS.clientId) || CONFIG.googleClientId || "";
  if (isLocalFileMode) {
    document.body.classList.add("local-mode");
    saveNowButton.textContent = "Save File";
    reloadButton.textContent = "Reload File";
  }
  render();
  updateDriveInfo();
  updateDriveButtons();
  if (isLocalFileMode) loadLocalFile();
}

function createEmptyBoard() {
  return {
    version: 1,
    title: "Blackboard",
    updatedAt: new Date().toISOString(),
    sections: []
  };
}

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
  if (status === "△" || status === "??" || status === "~") return "partial";
  if (status === "X") return "todo";
  if (status === "*") return "review";
  return statusOptions.some((option) => option.value === status) ? status : "none";
}

function normalizeItem(item) {
  return {
    id: String(item?.id || "").trim(),
    title: String(item?.title || item?.id || "New item").trim(),
    status: normalizeStatus(item?.status),
    body: Array.isArray(item?.body) ? item.body.map(String) : [],
    children: Array.isArray(item?.children) ? item.children.map(normalizeItem) : []
  };
}

function normalizeBoard(data) {
  return {
    version: 1,
    title: String(data?.title || "Blackboard").trim(),
    updatedAt: data?.updatedAt || new Date().toISOString(),
    sections: Array.isArray(data?.sections)
      ? data.sections.map((section, index) => ({
        id: String(section?.id || `section-${index + 1}`).trim(),
        title: String(section?.title || `Section ${index + 1}`).trim(),
        body: Array.isArray(section?.body) ? section.body.map(String) : [],
        items: Array.isArray(section?.items) ? section.items.map(normalizeItem) : []
      }))
      : []
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
    ...item.children.flatMap((child) => itemSearchText(child))
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
    stat("All", count.total),
    stat("O", count.done),
    stat("Partial", count.partial),
    stat("X", count.todo),
    stat("*", count.review)
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

function updateDriveInfo() {
  if (isLocalFileMode) {
    driveInfo.textContent = `Local file mode. Reading and saving ${localFileName}.`;
    return;
  }

  const auth = accessToken ? "Connected" : "Not connected";
  const linked = driveFile.id ? `${driveFile.name} (${driveFile.id})` : "No Drive file linked.";
  driveInfo.textContent = `${auth}. ${linked}`;
}

function updateDriveButtons() {
  if (isLocalFileMode) {
    signInButton.disabled = true;
    findFileButton.disabled = true;
    createFileButton.disabled = true;
    saveNowButton.disabled = false;
    unlinkButton.disabled = true;
    return;
  }

  const hasClientId = Boolean(getClientId());
  const signedIn = Boolean(accessToken);
  signInButton.disabled = !hasClientId;
  findFileButton.disabled = !signedIn;
  createFileButton.disabled = !signedIn;
  saveNowButton.disabled = !signedIn || !driveFile.id;
  unlinkButton.disabled = !driveFile.id;
}

function getClientId() {
  return clientIdInput.value.trim();
}

function ensureClientId() {
  const clientId = getClientId();
  if (!clientId) {
    throw new Error("Set a Google OAuth Client ID first.");
  }
  return clientId;
}

function ensureGoogleLoaded() {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const timer = setInterval(() => {
      if (window.google?.accounts?.oauth2) {
        clearInterval(timer);
        resolve();
      } else if (Date.now() - startedAt > 8000) {
        clearInterval(timer);
        reject(new Error("Google Identity script did not load."));
      }
    }, 50);
  });
}

async function signIn() {
  try {
    const clientId = ensureClientId();
    await ensureGoogleLoaded();

    setSaveState("Connecting", "dirty");
    tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: DRIVE_SCOPE,
      callback: (response) => {
        if (response.error) {
          setSaveState("Auth failed", "error");
          console.error(response);
          return;
        }

        accessToken = response.access_token;
        updateDriveInfo();
        updateDriveButtons();
        setSaveState("Drive ready", "saved");
      }
    });

    tokenClient.requestAccessToken({ prompt: "consent" });
  } catch (error) {
    setSaveState("Auth failed", "error");
    console.error(error);
    window.alert(error.message);
  }
}

async function driveFetch(url, options = {}) {
  if (!accessToken) throw new Error("Connect Google first.");

  const headers = new Headers(options.headers || {});
  headers.set("Authorization", `Bearer ${accessToken}`);
  const response = await fetch(url, { ...options, headers });

  if (response.status === 401 || response.status === 403) {
    setSaveState("Reconnect Google", "error");
  }

  return response;
}

async function findDriveFile() {
  try {
    setSaveState("Finding", "dirty");
    const fileName = driveFile.name || CONFIG.driveFileName || "Blackboard.json";
    const query = encodeURIComponent(`name='${fileName.replaceAll("'", "\\'")}' and trashed=false`);
    const fields = encodeURIComponent("files(id,name,modifiedTime)");
    const response = await driveFetch(`${DRIVE_API}/files?q=${query}&fields=${fields}&orderBy=modifiedTime desc`);

    if (!response.ok) {
      throw new Error(await response.text());
    }

    const data = await response.json();
    const file = data.files?.[0];
    if (!file) {
      setSaveState("No file", "error");
      window.alert(`No ${fileName} file created by this app was found. Use Create Drive File or import JSON.`);
      return;
    }

    setLinkedFile(file);
    await loadDriveFile();
  } catch (error) {
    setSaveState("Find failed", "error");
    console.error(error);
    window.alert(error.message);
  }
}

async function createDriveFile() {
  try {
    setSaveState("Creating", "dirty");
    const now = new Date().toISOString();
    board.updatedAt = now;
    const content = JSON.stringify(normalizeBoard(board), null, 2);
    const metadata = {
      name: driveFile.name || CONFIG.driveFileName || "Blackboard.json",
      mimeType: "application/json"
    };
    const boundary = makeBoundary();

    const response = await driveFetch(`${DRIVE_UPLOAD_API}/files?uploadType=multipart&fields=id,name,modifiedTime`, {
      method: "POST",
      headers: multipartHeaders(boundary),
      body: multipartBody(boundary, metadata, content)
    });

    if (!response.ok) {
      throw new Error(await response.text());
    }

    const file = await response.json();
    setLinkedFile(file);
    setSaveState("Created", "saved");
    updateMeta();
  } catch (error) {
    setSaveState("Create failed", "error");
    console.error(error);
    window.alert(error.message);
  }
}

async function loadDriveFile() {
  if (!driveFile.id) {
    setSaveState("No file", "error");
    return;
  }

  try {
    setSaveState("Loading", "dirty");
    const response = await driveFetch(`${DRIVE_API}/files/${driveFile.id}?alt=media`);
    if (!response.ok) {
      throw new Error(await response.text());
    }

    board = normalizeBoard(await response.json());
    render();
    setSaveState("Loaded", "saved");
  } catch (error) {
    setSaveState("Load failed", "error");
    console.error(error);
    window.alert(error.message);
  }
}

async function loadCurrentBoard() {
  if (isLocalFileMode) {
    await loadLocalFile();
    return;
  }
  await loadDriveFile();
}

async function loadLocalFile() {
  try {
    setSaveState("Loading file", "dirty");
    const response = await fetch(localApiUrl, { cache: "no-store" });

    if (response.status === 404) {
      board = createEmptyBoard();
      render();
      setSaveState("File missing", "dirty");
      return;
    }

    if (!response.ok) {
      throw new Error(await response.text());
    }

    board = normalizeBoard(await response.json());
    render();
    setSaveState("Loaded file", "saved");
  } catch (error) {
    setSaveState("Load failed", "error");
    console.error(error);
    window.alert(`Could not load ${localFileName}. Run npm run serve and check the local JSON file.`);
  }
}

function scheduleSave() {
  if (isLocalFileMode) {
    setSaveState("Save queued", "dirty");
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveBoard, 700);
    return;
  }

  if (!driveFile.id || !accessToken) {
    setSaveState("Local only", "dirty");
    return;
  }

  setSaveState("Save queued", "dirty");
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveBoard, 700);
}

async function saveBoard() {
  clearTimeout(saveTimer);
  saveTimer = null;

  if (isLocalFileMode) {
    await saveLocalFile();
    return;
  }

  if (!driveFile.id || !accessToken) {
    setSaveState("Local only", "dirty");
    return;
  }

  try {
    setSaveState("Saving", "dirty");
    board.updatedAt = new Date().toISOString();
    const content = JSON.stringify(normalizeBoard(board), null, 2);
    const response = await driveFetch(`${DRIVE_UPLOAD_API}/files/${driveFile.id}?uploadType=media`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: `${content}\n`
    });

    if (!response.ok) {
      throw new Error(await response.text());
    }

    setSaveState("Saved", "saved");
    updateMeta();
  } catch (error) {
    setSaveState("Save failed", "error");
    console.error(error);
    window.alert(error.message);
  }
}

async function saveLocalFile() {
  try {
    setSaveState("Saving file", "dirty");
    board.updatedAt = new Date().toISOString();
    const content = JSON.stringify(normalizeBoard(board), null, 2);
    const response = await fetch(localApiUrl, {
      method: "PUT",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: `${content}\n`
    });

    if (!response.ok) {
      throw new Error(await response.text());
    }

    setSaveState("Saved file", "saved");
    updateMeta();
  } catch (error) {
    setSaveState("Save failed", "error");
    console.error(error);
    window.alert(`Could not save ${localFileName}. Run npm run serve and check the local server.`);
  }
}

function multipartHeaders(boundary) {
  return { "Content-Type": `multipart/related; boundary=${boundary}` };
}

function multipartBody(boundary, metadata, content) {
  return [
    `--${boundary}`,
    "Content-Type: application/json; charset=UTF-8",
    "",
    JSON.stringify(metadata),
    `--${boundary}`,
    "Content-Type: application/json; charset=UTF-8",
    "",
    content,
    `--${boundary}--`,
    ""
  ].join("\r\n");
}

function makeBoundary() {
  return `blackboard_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function setLinkedFile(file) {
  driveFile = {
    id: file.id,
    name: file.name || driveFile.name || "Blackboard.json",
    modifiedTime: file.modifiedTime || ""
  };
  localStorage.setItem(STORAGE_KEYS.driveFileId, driveFile.id);
  localStorage.setItem(STORAGE_KEYS.driveFileName, driveFile.name);
  updateDriveInfo();
  updateDriveButtons();
}

function unlinkDriveFile() {
  driveFile.id = "";
  localStorage.removeItem(STORAGE_KEYS.driveFileId);
  updateDriveInfo();
  updateDriveButtons();
  setSaveState("Local", "");
}

function importJsonFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      board = normalizeBoard(JSON.parse(String(reader.result)));
      render();
      setSaveState("Imported", "dirty");
      scheduleSave();
    } catch (error) {
      setSaveState("Import failed", "error");
      window.alert(error.message);
    }
  };
  reader.readAsText(file, "utf-8");
}

function exportJsonFile() {
  const blob = new Blob([`${JSON.stringify(normalizeBoard(board), null, 2)}\n`], {
    type: "application/json"
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = (isLocalFileMode ? localFileName.split("/").pop() : driveFile.name) || "Blackboard.json";
  link.click();
  URL.revokeObjectURL(url);
}

function updateMeta() {
  titleElement.textContent = board.title;
  document.title = board.title;
  const source = isLocalFileMode
    ? `Local file: ${localFileName}`
    : driveFile.id ? `Drive: ${driveFile.name}` : "Local board";
  metaElement.textContent = `${source} | Updated: ${formatUpdatedAt(board.updatedAt)}`;
  updateDriveInfo();
}

function formatUpdatedAt(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

function render() {
  updateMeta();
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
    ...section.items.flatMap((item) => itemSearchText(item))
  ].join(" ").toLowerCase();

  const summary = makeElement("summary");
  const title = makeElement("span", { className: "section-title", text: section.title });
  const count = makeElement("span", {
    className: "section-count",
    text: `${flattenItems(section.items).length} items`
  });
  const addRoot = makeElement("button", { type: "button", text: "Add Root Item" });
  addRoot.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    openAddDialog({ section, parent: null });
  });
  stopSummaryToggle(addRoot);
  summary.append(title, count, addRoot);

  const body = makeElement("div", { className: "section-body" });
  const note = makeElement("textarea", { className: "section-note", value: section.body.join("\n") });
  note.placeholder = "Section notes";
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
  const childCount = makeElement("span", { className: "child-count", text: `${item.children.length} children` });
  const addChild = makeElement("button", { className: "summary-add", type: "button", text: "Add Child" });
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
    details.dataset.search = itemSearchText(item);
    scheduleSave();
  });
  const titleField = renderInputField("Title", item.title, (value) => {
    item.title = value;
    title.textContent = value || "New item";
    details.dataset.search = itemSearchText(item);
    scheduleSave();
  });
  editorGrid.append(idField, titleField);

  const bodyEditor = makeElement("textarea", { className: "body-editor", value: item.body.join("\n") });
  bodyEditor.placeholder = "Completion conditions, reasons, notes";
  bodyEditor.addEventListener("input", () => {
    item.body = bodyEditor.value.split("\n");
    details.dataset.search = itemSearchText(item);
    scheduleSave();
  });

  const actions = makeElement("div", { className: "item-actions" });
  const addChildBody = makeElement("button", { type: "button", text: "Add Child" });
  addChildBody.addEventListener("click", () => openAddDialog({ section, parent: item }));
  const deleteButton = makeElement("button", { className: "danger", type: "button", text: "Delete" });
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
  dialogTarget.textContent = `Target: ${parentLabel}`;
  newItemId.value = suggestChildId(target.section, target.parent);
  newItemTitle.value = "New item";
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
    children: []
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
  if (!window.confirm(`Delete [${item.id}] and all children?`)) return;
  const list = parent ? parent.children : section.items;
  const index = list.indexOf(item);
  if (index >= 0) list.splice(index, 1);
  render();
  scheduleSave();
}

function addSection() {
  const title = window.prompt("New section title");
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

saveClientButton.addEventListener("click", () => {
  localStorage.setItem(STORAGE_KEYS.clientId, getClientId());
  tokenClient = null;
  accessToken = "";
  updateDriveInfo();
  updateDriveButtons();
  setSaveState("Client saved", "saved");
});

signInButton.addEventListener("click", signIn);
findFileButton.addEventListener("click", findDriveFile);
createFileButton.addEventListener("click", createDriveFile);
saveNowButton.addEventListener("click", saveBoard);
exportButton.addEventListener("click", exportJsonFile);
unlinkButton.addEventListener("click", unlinkDriveFile);
importInput.addEventListener("change", () => {
  const file = importInput.files?.[0];
  if (file) importJsonFile(file);
  importInput.value = "";
});

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
reloadButton.addEventListener("click", loadCurrentBoard);
document.querySelector("#expandButton").addEventListener("click", () => {
  document.querySelectorAll("details").forEach((details) => { details.open = true; });
});
document.querySelector("#collapseButton").addEventListener("click", () => {
  document.querySelectorAll(".item").forEach((details) => { details.open = false; });
  document.querySelectorAll(".section").forEach((details) => { details.open = true; });
});
