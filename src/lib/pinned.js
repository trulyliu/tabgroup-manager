// Pure pinned-group decisions. No chrome.* calls.

/** Pinned identity is the exact, case-sensitive title plus group color. */
export function isPinnedGroup(pinnedGroups, title, color) {
  if (typeof title !== "string" || title === "") return false;
  return (pinnedGroups ?? []).some(
    (pinned) => pinned?.title === title && pinned?.color === color,
  );
}

/**
 * Decide how to resurrect a pinned group after it disappeared.
 * `aliveTabs` are tabs that survived the removal, `snapshot` the pre-removal
 * membership, `closing` whether the window is going away, and
 * `movedToOtherWindow` whether a same-title group already exists elsewhere.
 */
export function choosePinnedRestore({ aliveTabs, snapshot, closing, movedToOtherWindow }) {
  if (closing || movedToOtherWindow) return { mode: "skip", tabIds: [] };
  const windowId = snapshot?.windowId;
  const ungrouped = (aliveTabs ?? []).filter(
    (tab) => tab != null && tab.id != null && tab.groupId === -1 && tab.windowId === windowId,
  );
  if (ungrouped.length > 0) {
    return { mode: "regroup", tabIds: ungrouped.map((tab) => tab.id) };
  }
  return { mode: "blank", tabIds: [] };
}
