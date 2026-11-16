// Localization integrity: every locale has every message, every message the
// code or markup asks for exists, and no user-visible string is hardcoded.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const manifest = JSON.parse(read("manifest.json"));
const locales = readdirSync(new URL("_locales/", root));
const messages = Object.fromEntries(
  locales.map((locale) => [locale, JSON.parse(read(`_locales/${locale}/messages.json`))]),
);
const defaultMessages = messages[manifest.default_locale];
const keyOf = (name) => name.toLowerCase();
const defaultKeys = new Set(Object.keys(defaultMessages).map(keyOf));

const SOURCE_FILES = readdirSync(new URL("src/", root))
  .filter((name) => /\.(js|html)$/.test(name))
  .map((name) => `src/${name}`)
  .concat(readdirSync(new URL("src/lib/", root)).map((name) => `src/lib/${name}`));

test("the manifest declares a default locale that exists", () => {
  assert.equal(manifest.default_locale, "en");
  assert.ok(defaultMessages, "_locales/en/messages.json exists");
  assert.ok(locales.includes("zh_CN"));
  assert.ok(locales.includes("zh_TW"));
});

test("every locale has exactly the default locale's messages", () => {
  for (const [locale, table] of Object.entries(messages)) {
    const keys = new Set(Object.keys(table).map(keyOf));
    const missing = [...defaultKeys].filter((key) => !keys.has(key));
    const extra = [...keys].filter((key) => !defaultKeys.has(key));
    assert.deepEqual(missing, [], `${locale} is missing messages`);
    assert.deepEqual(extra, [], `${locale} has messages en does not`);
  }
});

test("messages are well formed and placeholders match across locales", () => {
  for (const [locale, table] of Object.entries(messages)) {
    for (const [name, entry] of Object.entries(table)) {
      assert.match(name, /^[A-Za-z0-9_@]+$/, `${locale}.${name}: invalid name`);
      assert.equal(typeof entry.message, "string", `${locale}.${name}: message`);
      assert.ok(entry.message.trim() !== "", `${locale}.${name}: empty`);
      const declared = Object.keys(entry.placeholders ?? {}).map(keyOf).sort();
      const used = [...entry.message.matchAll(/\$([A-Za-z0-9_@]+)\$/g)].map((m) => keyOf(m[1]));
      for (const placeholder of used) {
        assert.ok(declared.includes(placeholder), `${locale}.${name}: $${placeholder}$ undeclared`);
      }
      const reference = Object.keys(defaultMessages[name]?.placeholders ?? {}).map(keyOf).sort();
      assert.deepEqual(declared, reference, `${locale}.${name}: placeholders differ from en`);
    }
  }
});

test("store listing limits hold in every locale", () => {
  for (const [locale, table] of Object.entries(messages)) {
    assert.ok(table.extName.message.length <= 75, `${locale}: name longer than 75`);
    assert.ok(table.extDescription.message.length <= 132, `${locale}: description longer than 132`);
    assert.ok(table.defaultGroupTitle.message.length <= 30, `${locale}: default title longer than 30`);
  }
});

test("every __MSG_*__ in the manifest exists", () => {
  const used = [...JSON.stringify(manifest).matchAll(/__MSG_([A-Za-z0-9_@]+)__/g)].map((m) => m[1]);
  assert.ok(used.includes("extName") && used.includes("extDescription"));
  for (const key of used) assert.ok(defaultKeys.has(keyOf(key)), `manifest uses missing ${key}`);
});

test("every message referenced from pages and scripts exists", () => {
  const referenced = new Set();
  for (const file of SOURCE_FILES) {
    const source = read(file);
    if (file.endsWith(".html")) {
      for (const m of source.matchAll(/data-i18n="([^"]+)"/g)) referenced.add(m[1]);
      for (const m of source.matchAll(/data-i18n-attr="([^"]+)"/g)) {
        for (const pair of m[1].split(";")) referenced.add(pair.split(":")[1].trim());
      }
    }
    for (const m of source.matchAll(/\b(?:t|msg)\(\s*"([A-Za-z0-9_@]+)"/g)) referenced.add(m[1]);
    for (const m of source.matchAll(/getMessage\(\s*"([A-Za-z0-9_@]+)"/g)) referenced.add(m[1]);
  }
  assert.ok(referenced.size > 50, "the scan found the references");
  for (const key of referenced) assert.ok(defaultKeys.has(keyOf(key)), `missing message ${key}`);
});

test("no CJK text is hardcoded in src/", () => {
  for (const file of SOURCE_FILES) {
    const lines = read(file).split("\n");
    lines.forEach((line, i) => {
      assert.doesNotMatch(line, /[\u3400-\u9fff\uff00-\uffef]/, `${file}:${i + 1} hardcodes CJK text`);
    });
  }
});

test("pages load the localizer", () => {
  for (const page of ["src/options.js", "src/popup.js"]) {
    assert.match(read(page), /localizePage\(\)/, `${page} calls localizePage()`);
  }
});
