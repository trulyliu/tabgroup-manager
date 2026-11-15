import { loadSettings } from "./lib/settings.js";

const els = {
  enabled: document.getElementById("enabled"),
  groupCount: document.getElementById("groupCount"),
  activeGroup: document.getElementById("activeGroup"),
  normalizeButton: document.getElementById("normalizeButton"),
  optionsButton: document.getElementById("optionsButton"),
  status: document.getElementById("status"),
};

function setStatus(text, isError = false) {
  els.status.textContent = text;
  els.status.classList.toggle("error", isError);
}

async function render() {
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const settings = await loadSettings();
  els.enabled.checked = settings.enabled;

  if (!activeTab) {
    els.groupCount.textContent = "–";
    els.activeGroup.textContent = "–";
    return;
  }
  const [groups, tabs] = await Promise.all([
    chrome.tabGroups.query({ windowId: activeTab.windowId }),
    chrome.tabs.query({ windowId: activeTab.windowId, active: true }),
  ]);
  const current = tabs[0] ?? activeTab;
  const group =
    current.groupId !== -1 ? groups.find((entry) => entry.id === current.groupId) : null;
  els.groupCount.textContent = String(groups.length);
  els.activeGroup.textContent = group ? group.title || "未命名" : "无";
}

els.enabled.addEventListener("change", async () => {
  try {
    const response = await chrome.runtime.sendMessage({
      type: "save-settings",
      patch: { enabled: els.enabled.checked },
    });
    if (!response?.ok) throw new Error(response?.error ?? "保存失败");
    setStatus(els.enabled.checked ? "已启用" : "已停用");
  } catch (err) {
    setStatus(String(err?.message ?? err), true);
  }
});

els.normalizeButton.addEventListener("click", async () => {
  els.normalizeButton.disabled = true;
  try {
    const response = await chrome.runtime.sendMessage({ type: "normalize-all-windows" });
    if (!response?.ok) throw new Error(response?.error ?? "整理失败");
    setStatus("已整理");
    await render();
  } catch (err) {
    setStatus(String(err?.message ?? err), true);
  } finally {
    els.normalizeButton.disabled = false;
  }
});

els.optionsButton.addEventListener("click", () => {
  void chrome.runtime.openOptionsPage();
  window.close();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "sync" || !changes.settings) return;
  void render().catch((err) => setStatus(String(err?.message ?? err), true));
});

void render().catch((err) => setStatus(String(err?.message ?? err), true));
