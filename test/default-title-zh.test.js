// First run in a Simplified Chinese browser: the default group is "其他".

import test from "node:test";
import assert from "node:assert/strict";

import { installFakeChrome, sleep } from "./fake-chrome.js";

const env = installFakeChrome({
  locale: "zh_CN",
  settings: null,
  tabs: [
    { id: 1, windowId: 1, index: 0, groupId: -1, pinned: false, active: true, lastAccessed: 100, url: "https://example.com/a" },
  ],
});

await import("../src/background.js");
await sleep(300);

test("a fresh Chinese install names and stores the default group '其他'", () => {
  assert.equal(env.state.settings?.defaultGroupTitle, "其他");
  const group = env.groups.find((entry) => entry.id === env.findTab(1).groupId);
  assert.equal(group?.title, "其他");
});
