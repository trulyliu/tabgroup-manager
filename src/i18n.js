// UI localization for extension pages. Strings live in _locales/*/messages.json
// and are resolved by chrome.i18n from the browser's UI language, falling back
// to the manifest's default_locale (en).

/** Localized message, or the key itself so a missing string is visible. */
export function t(key, substitutions) {
  const message = chrome.i18n.getMessage(key, substitutions);
  return message || key;
}

/**
 * Localize static markup:
 *   data-i18n="key"                     -> textContent
 *   data-i18n-attr="title:key;aria-label:key2" -> attributes
 */
export function localizePage(root = document) {
  document.documentElement.lang = chrome.i18n.getUILanguage();
  for (const el of root.querySelectorAll("[data-i18n]")) {
    el.textContent = t(el.dataset.i18n);
  }
  for (const el of root.querySelectorAll("[data-i18n-attr]")) {
    for (const pair of el.dataset.i18nAttr.split(";")) {
      const [attr, key] = pair.split(":").map((part) => part.trim());
      if (attr && key) el.setAttribute(attr, t(key));
    }
  }
}

const COLOR_KEYS = {
  grey: "colorGrey",
  blue: "colorBlue",
  red: "colorRed",
  yellow: "colorYellow",
  green: "colorGreen",
  pink: "colorPink",
  purple: "colorPurple",
  cyan: "colorCyan",
  orange: "colorOrange",
};

export function colorLabel(color) {
  return COLOR_KEYS[color] ? t(COLOR_KEYS[color]) : color;
}
