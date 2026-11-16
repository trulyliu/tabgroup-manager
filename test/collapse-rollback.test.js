// Regression: a failed tabGroups.update must not leave a stale collapsed record.
//
// The bug: updateCollapsed() wrote collapsedStates before calling Chrome and
// never undid it on failure. The record then disagreed with the real group, so
// the next genuine user collapse looked like "already collapsed" and the
// expanded-header action was skipped (or an expand was misread as a click).

import test from "node:test";
import assert from "node:assert/strict";

import { clone, installFakeChrome, sleep } from "./fake-chrome.js";

const env = installFakeChrome({
  settings: { expandedGroupHeaderClick: "noaction" },
  groups: [
    { id: 100, windowId: 1, title: "其他", color: "grey", collapsed: true },
    { id: 300, windowId: 1, title: "Alpha", color: "blue", collapsed: false },
  ],
  tabs: [
    { id: 1, windowId: 1, index: 0, groupId: 100, pinned: false, active: false, lastAccessed: 100, url: "https://example.com/a" },
    { id: 4, windowId: 1, index: 1, groupId: 300, pinned: false, active: true, lastAccessed: 900, url: "https://example.com/alpha" },
    { id: 5, windowId: 1, index: 2, groupId: 300, pinned: false, active: false, lastAccessed: 800, url: "https://example.com/alpha-2" },
  ],
});
const { chrome, failures, findGroup, findTab } = env;

await import("../src/background.js");
await sleep(200);

test("a failed collapse keeps the group recorded as expanded", async () => {
  // The user switches to the default group; collapsing Alpha fails once with a
  // non-retryable error, so Alpha really stays expanded.
  failures.update.push({
    match: ({ groupId, properties }) => groupId === 300 && properties.collapsed === true,
    message: "Grouping is not supported by tabs in this window.",
  });
  await chrome.tabs.update(1, { active: true });
  findGroup(100).collapsed = false;
  chrome.tabs.onActivated.fire({ tabId: 1, windowId: 1 });
  await sleep(200);
  assert.equal(findGroup(300).collapsed, false, "Chrome left Alpha expanded");
  assert.equal(env.session.runtimeState.collapsed[300], false, "record matches Chrome");

  // Now the user really collapses Alpha with its header: noaction must
  // re-expand it and focus its MRU tab instead of ignoring the click.
  findGroup(300).collapsed = true;
  chrome.tabGroups.onUpdated.fire(clone(findGroup(300)));
  await sleep(300);
  assert.equal(findGroup(300).collapsed, false, "header action ran");
  assert.equal(findTab(4).active, true);
});
