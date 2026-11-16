// Renaming the default group from the options page.
//
// - A pinned default group used to lose its pin (pins are title + color).
// - Choosing the title of an existing group made the duplicate-default merge
//   swallow that group's tabs.
// - With the extension paused the old group was not renamed, so re-enabling
//   left it behind next to a brand-new default group.
// - A remembered default group the user had renamed was renamed back.

import test from "node:test";
import assert from "node:assert/strict";

import { clone, installFakeChrome, sleep } from "./fake-chrome.js";

const env = installFakeChrome({
  settings: { pinnedGroups: [{ title: "其他", color: "grey" }, { title: "Alpha", color: "blue" }] },
  session: { bootReady: true, runtimeState: { defaultGroups: { 1: 100 } } },
  groups: [
    { id: 100, windowId: 1, title: "其他", color: "grey", collapsed: false },
    { id: 300, windowId: 1, title: "Alpha", color: "blue", collapsed: true },
  ],
  tabs: [
    { id: 1, windowId: 1, index: 0, groupId: 100, pinned: false, active: true, lastAccessed: 900, url: "https://example.com/a" },
    { id: 4, windowId: 1, index: 1, groupId: 300, pinned: false, active: false, lastAccessed: 300, url: "https://example.com/alpha" },
  ],
});
const { chrome, findGroup, findTab } = env;

await import("../src/background.js");
await sleep(200);

function save(patch) {
  return new Promise((resolve) => {
    chrome.runtime.onMessage.fire({ type: "save-settings", patch }, {}, resolve);
  });
}

test("renaming a pinned default group keeps it pinned", async () => {
  const response = await save({ defaultGroupTitle: "杂项" });
  assert.equal(response.ok, true);
  assert.equal(findGroup(100).title, "杂项");
  assert.deepEqual(clone(env.settings.pinnedGroups), [
    { title: "杂项", color: "grey" },
    { title: "Alpha", color: "blue" },
  ]);
});

test("the default title cannot take an existing group's title", async () => {
  const response = await save({ defaultGroupTitle: "Alpha" });
  assert.equal(response.ok, false);
  assert.match(response.error, /Alpha/);
  assert.equal(env.settings.defaultGroupTitle, "杂项");
  assert.equal(findGroup(100).title, "杂项");
  await sleep(200);
  assert.equal(findTab(4).groupId, 300, "Alpha's tabs were not merged away");
});

test("renaming while paused still renames the existing default group", async () => {
  assert.equal((await save({ enabled: false })).ok, true);
  assert.equal((await save({ defaultGroupTitle: "Misc", defaultGroupColor: "cyan" })).ok, true);
  assert.equal(findGroup(100).title, "Misc");
  assert.equal(findGroup(100).color, "cyan");
  assert.equal((await save({ enabled: true })).ok, true);
  await sleep(200);
  assert.equal(env.groups.filter((group) => group.title === "Misc").length, 1);
});

test("a remembered default group renamed by the user is left alone", async () => {
  // The user renames the default group in Chrome.
  findGroup(100).title = "Mine";
  chrome.tabGroups.onUpdated.fire(clone(findGroup(100)));
  await sleep(150);

  // A loose tab must go to a fresh default group, not into "Mine".
  const loose = await chrome.tabs.create({ windowId: 1, url: "https://example.com/loose", active: false });
  chrome.tabs.onUpdated.fire(loose.id, { pinned: false }, loose);
  await sleep(300);
  const misc = env.groups.find((group) => group.title === "Misc");
  assert.ok(misc, "a new default group was created");
  assert.equal(findTab(loose.id).groupId, misc.id);

  // And changing the default title later does not rename "Mine".
  assert.equal((await save({ defaultGroupTitle: "Rest" })).ok, true);
  assert.equal(findGroup(100).title, "Mine");
  assert.equal(findGroup(misc.id).title, "Rest");
});
