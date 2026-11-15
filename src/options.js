import { GROUP_COLORS, loadSettings } from "./lib/settings.js";

const COLOR_LABELS = {
  grey: "灰色",
  blue: "蓝色",
  red: "红色",
  yellow: "黄色",
  green: "绿色",
  pink: "粉色",
  purple: "紫色",
  cyan: "青色",
  orange: "橙色",
};

const CHECKBOX_KEYS = [
  "enabled",
  "groupsFirst",
  "defaultGroup",
  "singleExpanded",
  "keepLastWhenPinned",
  "externalNewTabInActiveGroup",
  "expandHeaderClick",
  "suppressCollapseNewTab",
];

const els = {
  enabled: document.getElementById("enabled"),
  groupsFirst: document.getElementById("groupsFirst"),
  defaultGroup: document.getElementById("defaultGroup"),
  singleExpanded: document.getElementById("singleExpanded"),
  keepLastWhenPinned: document.getElementById("keepLastWhenPinned"),
  externalNewTabInActiveGroup: document.getElementById("externalNewTabInActiveGroup"),
  expandHeaderClick: document.getElementById("expandHeaderClick"),
  suppressCollapseNewTab: document.getElementById("suppressCollapseNewTab"),
  defaultGroupTitle: document.getElementById("defaultGroupTitle"),
  defaultGroupColor: document.getElementById("defaultGroupColor"),
  pinnedList: document.getElementById("pinnedList"),
  emptyPinned: document.getElementById("emptyPinned"),
  openGroups: document.getElementById("openGroups"),
  pinButton: document.getElementById("pinButton"),
  normalizeButton: document.getElementById("normalizeButton"),
  status: document.getElementById("status"),
};

let currentSettings = null;
function setStatus(text, isError = false) {
  els.status.textContent = text;
  els.status.classList.toggle("error", isError);
}

async function savePatch(patch) {
  try {
    const response = await chrome.runtime.sendMessage({ type: "save-settings", patch });
    if (!response?.ok) throw new Error(response?.error ?? "保存失败");
    setStatus("已保存");
    await refresh();
  } catch (err) {
    setStatus(String(err?.message ?? err), true);
  }
}

function buildColorOptions() {
  for (const color of GROUP_COLORS) {
    const option = document.createElement("option");
    option.value = color;
    option.textContent = COLOR_LABELS[color];
    els.defaultGroupColor.append(option);
  }
}

function renderForm(settings) {
  for (const key of CHECKBOX_KEYS) els[key].checked = Boolean(settings[key]);
  els.defaultGroupTitle.value = settings.defaultGroupTitle;
  els.defaultGroupColor.value = settings.defaultGroupColor;
}

function openGroupsByTitle(groups) {
  const byTitle = new Map();
  for (const group of groups) {
    if (!group.title) continue;
    const entry = byTitle.get(group.title);
    if (entry) entry.count += 1;
    else byTitle.set(group.title, { count: 1, color: group.color });
  }
  return byTitle;
}

function pinnedRow(entry, index, pinnedGroups, byTitle) {
  const row = document.createElement("li");
  row.className = "pin-row";

  const dot = document.createElement("span");
  dot.className = `dot dot-${entry.color}`;
  row.append(dot);

  const title = document.createElement("span");
  title.className = "pin-title";
  title.textContent = entry.title;
  row.append(title);

  const live = byTitle.get(entry.title);
  const meta = document.createElement("span");
  meta.className = "pin-meta";
  if (!live) {
    meta.textContent = "未打开";
    meta.classList.add("warn");
  } else if (live.count > 1) {
    meta.textContent = `同名组会一起钉住（${live.count} 个）`;
  }
  row.append(meta);

  const actions = document.createElement("span");
  actions.className = "pin-actions";

  const up = document.createElement("button");
  up.type = "button";
  up.textContent = "↑";
  up.title = "上移";
  up.disabled = index === 0;
  up.addEventListener("click", () => {
    const next = pinnedGroups.slice();
    [next[index - 1], next[index]] = [next[index], next[index - 1]];
    void savePatch({ pinnedGroups: next });
  });
  actions.append(up);

  const down = document.createElement("button");
  down.type = "button";
  down.textContent = "↓";
  down.title = "下移";
  down.disabled = index === pinnedGroups.length - 1;
  down.addEventListener("click", () => {
    const next = pinnedGroups.slice();
    [next[index + 1], next[index]] = [next[index], next[index + 1]];
    void savePatch({ pinnedGroups: next });
  });
  actions.append(down);

  const unpin = document.createElement("button");
  unpin.type = "button";
  unpin.className = "unpin";
  unpin.textContent = "取消钉住";
  unpin.addEventListener("click", () => {
    const next = pinnedGroups.filter((_, entryIndex) => entryIndex !== index);
    void savePatch({ pinnedGroups: next });
  });
  actions.append(unpin);

  row.append(actions);
  return row;
}

async function renderPinned(settings) {
  let groups = [];
  try {
    groups = await chrome.tabGroups.query({});
  } catch (err) {
    setStatus(String(err?.message ?? err), true);
  }
  const byTitle = openGroupsByTitle(groups);
  const pinnedGroups = settings.pinnedGroups;

  els.pinnedList.replaceChildren(
    ...pinnedGroups.map((entry, index) => pinnedRow(entry, index, pinnedGroups, byTitle)),
  );
  els.emptyPinned.hidden = pinnedGroups.length > 0;

  const pinnedTitles = new Set(pinnedGroups.map((entry) => entry.title));
  const options = [];
  for (const [title, info] of byTitle) {
    if (pinnedTitles.has(title)) continue;
    const option = document.createElement("option");
    option.value = title;
    option.textContent = info.count > 1 ? `${title}（${info.count} 个）` : title;
    options.push(option);
  }
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = options.length ? "选择要钉住的分组…" : "没有可钉住的有名分组";
  els.openGroups.replaceChildren(placeholder, ...options);
  els.pinButton.disabled = options.length === 0;

  els.pinButton.onclick = () => {
    const title = els.openGroups.value;
    if (!title) return;
    const info = byTitle.get(title);
    if (!info) return;
    const next = pinnedGroups.concat({ title, color: info.color });
    void savePatch({ pinnedGroups: next });
  };
}

async function refresh() {
  const settings = await loadSettings();
  currentSettings = settings;
  renderForm(settings);
  await renderPinned(settings);
}

buildColorOptions();
for (const key of CHECKBOX_KEYS) {
  els[key].addEventListener("change", () => {
    void savePatch({ [key]: els[key].checked });
  });
}
els.defaultGroupTitle.addEventListener("change", () => {
  void savePatch({ defaultGroupTitle: els.defaultGroupTitle.value });
});
els.defaultGroupColor.addEventListener("change", () => {
  void savePatch({ defaultGroupColor: els.defaultGroupColor.value });
});

els.normalizeButton.addEventListener("click", async () => {
  els.normalizeButton.disabled = true;
  try {
    const response = await chrome.runtime.sendMessage({ type: "normalize-all-windows" });
    if (!response?.ok) throw new Error(response?.error ?? "整理失败");
    setStatus("已整理所有窗口");
    await refresh();
  } catch (err) {
    setStatus(String(err?.message ?? err), true);
  } finally {
    els.normalizeButton.disabled = false;
  }
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "sync" || !changes.settings) return;
  if (currentSettings == null) return;
  void refresh();
});

void refresh().catch((err) => setStatus(String(err?.message ?? err), true));
