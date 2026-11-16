// First run in an English browser: the default group is called "Other", and
// the title is written to storage so it never changes with the UI language.

import test from "node:test";
import assert from "node:assert/strict";

import { installFakeChrome, sleep } from "./fake-chrome.js";

const env = installFakeChrome({
  locale: "en",
  settings: null,
  tabs: [
    { id: 1, windowId: 1, index: 0, groupId: -1, pinned: false, active: true, lastAccessed: 100, url: "https://example.com/a" },
  ],
});

await import("../src/background.js");
await sleep(300);

test("a fresh English install names and stores the default group 'Other'", () => {
  assert.equal(env.state.settings?.defaultGroupTitle, "Other");
  const group = env.groups.find((entry) => entry.id === env.findTab(1).groupId);
  assert.equal(group?.title, "Other");
});
