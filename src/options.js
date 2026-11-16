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
];

const els = {
  enabled: document.getElementById("enabled"),
  groupsFirst: document.getElementById("groupsFirst"),
  defaultGroup: document.getElementById("defaultGroup"),
  singleExpanded: document.getElementById("singleExpanded"),
  keepLastWhenPinned: document.getElementById("keepLastWhenPinned"),
  externalNewTabInActiveGroup: document.getElementById("externalNewTabInActiveGroup"),
  expandHeaderClick: document.getElementById("expandHeaderClick"),
  expandedGroupHeaderClick: document.getElementById("expandedGroupHeaderClick"),
  defaultGroupTitle: document.getElementById("defaultGroupTitle"),
  defaultGroupColor: document.getElementById("defaultGroupColor"),
  pinnedList: document.getElementById("pinnedList"),
  emptyPinned: document.getElementById("emptyPinned"),
  openGroups: document.getElementById("openGroups"),
  pinButton: document.getElementById("pinButton"),
  normalizeButton: document.getElementById("normalizeButton"),
  status: document.getElementById("status"),
  version: document.getElementById("version"),
  defaultGroupShortcut: document.getElementById("defaultGroupShortcut"),
  changeShortcutButton: document.getElementById("changeShortcutButton"),
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
    // Show what is actually stored, not the rejected input.
    await refresh().catch(() => {});
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
  els.expandedGroupHeaderClick.value = settings.expandedGroupHeaderClick;
  els.defaultGroupTitle.value = settings.defaultGroupTitle;
  els.defaultGroupColor.value = settings.defaultGroupColor;
}

const groupKey = (title, color) => `${title}\u0000${color}`;

function openGroupsByTitle(groups) {
  const byKey = new Map();
  for (const group of groups) {
    if (!group.title) continue;
    const key = groupKey(group.title, group.color);
    const entry = byKey.get(key);
    if (entry) entry.count += 1;
    else byKey.set(key, { title: group.title, color: group.color, count: 1 });
  }
  return byKey;
}

function pinnedRow(entry, index, pinnedGroups, byKey) {
  const row = document.createElement("li");
  row.className = "pin-row";

  const dot = document.createElement("span");
  dot.className = `dot dot-${entry.color}`;
  row.append(dot);

  const title = document.createElement("span");
  title.className = "pin-title";
  title.textContent = entry.title;
  row.append(title);

  const live = byKey.get(groupKey(entry.title, entry.color));
  const meta = document.createElement("span");
  meta.className = "pin-meta";
  if (!live) {
    meta.textContent = "未打开";
    meta.classList.add("warn");
  } else if (live.count > 1) {
    meta.textContent = `同标题同色分组会一起钉住（${live.count} 个）`;
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
  const byKey = openGroupsByTitle(groups);
  const pinnedGroups = settings.pinnedGroups;

  els.pinnedList.replaceChildren(
    ...pinnedGroups.map((entry, index) => pinnedRow(entry, index, pinnedGroups, byKey)),
  );
  els.emptyPinned.hidden = pinnedGroups.length > 0;

  const pinnedKeys = new Set(
    pinnedGroups.map((entry) => groupKey(entry.title, entry.color)),
  );
  const options = [];
  for (const [key, info] of byKey) {
    if (pinnedKeys.has(key)) continue;
    const option = document.createElement("option");
    option.value = key;
    option.dataset.title = info.title;
    option.dataset.color = info.color;
    const colorLabel = COLOR_LABELS[info.color] ?? info.color;
    option.textContent =
      info.count > 1
        ? `${info.title}（${colorLabel}，${info.count} 个）`
        : `${info.title}（${colorLabel}）`;
    options.push(option);
  }
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = options.length ? "选择要钉住的分组…" : "没有可钉住的有名分组";
  els.openGroups.replaceChildren(placeholder, ...options);
  els.pinButton.disabled = options.length === 0;

  els.pinButton.onclick = () => {
    const option = els.openGroups.selectedOptions[0];
    const title = option?.dataset.title;
    const color = option?.dataset.color;
    if (!title || !color) return;
    const next = pinnedGroups.concat({ title, color });
    void savePatch({ pinnedGroups: next });
  };
}

async function renderShortcut() {
  try {
    const commands = await chrome.commands.getAll();
    const command = commands.find((entry) => entry.name === "switch-to-default-group");
    els.defaultGroupShortcut.textContent = command?.shortcut || "未设置";
  } catch (err) {
    els.defaultGroupShortcut.textContent = "不可用";
    setStatus(String(err?.message ?? err), true);
  }
}

async function refresh() {
  const settings = await loadSettings();
  currentSettings = settings;
  renderForm(settings);
  await renderPinned(settings);
  await renderShortcut();
}

buildColorOptions();
for (const key of CHECKBOX_KEYS) {
  els[key].addEventListener("change", () => {
    void savePatch({ [key]: els[key].checked });
  });
}
els.expandedGroupHeaderClick.addEventListener("change", () => {
  void savePatch({ expandedGroupHeaderClick: els.expandedGroupHeaderClick.value });
});
els.defaultGroupTitle.addEventListener("change", () => {
  void savePatch({ defaultGroupTitle: els.defaultGroupTitle.value });
});
els.defaultGroupColor.addEventListener("change", () => {
  void savePatch({ defaultGroupColor: els.defaultGroupColor.value });
});

els.changeShortcutButton.addEventListener("click", () => {
  void chrome.tabs.create({ url: "chrome://extensions/shortcuts" }).catch((err) => {
    setStatus("请手动打开 chrome://extensions/shortcuts", true);
    console.warn("[gtm] open shortcuts failed", err);
  });
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

window.addEventListener("focus", () => {
  void renderShortcut();
});

els.version.textContent = `v${chrome.runtime.getManifest().version}`;
void refresh().catch((err) => setStatus(String(err?.message ?? err), true));
