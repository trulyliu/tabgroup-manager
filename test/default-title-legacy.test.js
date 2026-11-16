// Upgrade from <= 0.3.x in an English browser. Those versions always used
// "其他" and never stored it unless a setting was changed. Switching to the
// localized "Other" would orphan the existing group and create a second
// default group, so the legacy title is kept and stored.

import test from "node:test";
import assert from "node:assert/strict";

import { installFakeChrome, sleep } from "./fake-chrome.js";

const env = installFakeChrome({
  locale: "en",
  settings: null,
  groups: [{ id: 100, windowId: 1, title: "其他", color: "grey", collapsed: false }],
  tabs: [
    { id: 1, windowId: 1, index: 0, groupId: 100, pinned: false, active: true, lastAccessed: 100, url: "https://example.com/a" },
    { id: 2, windowId: 1, index: 1, groupId: -1, pinned: false, active: false, lastAccessed: 50, url: "https://example.com/b" },
  ],
});

await import("../src/background.js");
await sleep(300);

test("an upgrading user keeps the legacy default group", () => {
  assert.equal(env.state.settings?.defaultGroupTitle, "其他");
  assert.equal(env.findTab(2).groupId, 100, "loose tabs join the existing group");
  assert.equal(env.groups.length, 1, "no second default group");
});
