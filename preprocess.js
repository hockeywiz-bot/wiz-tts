// preprocess.js
// This module is the actual IP of the product: turning messy web-article text
// into clean, broadcast-ready narration text before it ever hits the TTS API.

// --- 1. Local Exceptions Dictionary -----------------------------------------
// Placeholder array for Manitoba-specific geography/street names that global
// TTS engines mispronounce. Extend this as you find more failure cases in testing.
// Each entry maps the raw text to a phonetic respelling the engine says correctly.
const LOCAL_EXCEPTIONS = [
  // { match: /Lagimodiere/gi, replace: "La-jim-oh-dee-air" },
  // { match: /Steinbach/gi, replace: "Stine-bahk" },
  // { match: /Portage/gi, replace: "Por-tij" },
];

// --- 2. Acronym Expansion Rule -----------------------------------------------
// Known league/org acronyms that the neural engine tries to pronounce as a
// single word ("Nihl") instead of spelling out. Add more as you hit them.
const ACRONYMS = ["NHL", "SHL", "AHL", "WHL", "OHL", "QMJHL", "USHL", "KHL", "IIHF"];

function expandAcronyms(text) {
  let out = text;
  for (const acro of ACRONYMS) {
    // Word-boundary match so we don't clobber acronyms inside other words.
    const pattern = new RegExp(`\\b${acro}\\b`, "g");
    const hyphenated = acro.split("").join("-");
    out = out.replace(pattern, hyphenated);
  }
  return out;
}

// --- 3. Strip Visual Clutter -------------------------------------------------
function stripPhotoCredits(text) {
  // Removes parenthetical/bracketed photo credit blocks, e.g.
  // "(Photo by Jane Doe / HockeyWiz)" or "[Photo: HockeyWiz]"
  return text
    .replace(/\(\s*photo[^)]*\)/gi, "")
    .replace(/\[\s*photo[^\]]*\]/gi, "");
}

function stripShareAndAdBlocks(text) {
  // Common boilerplate patterns: "Share this article", "Related:", ad placeholders.
  return text
    .replace(/^\s*related:.*$/gim, "")
    .replace(/^\s*share (this )?(article|story).*$/gim, "")
    .replace(/^\s*advertisement\s*$/gim, "")
    .replace(/^\s*\[ad\]\s*$/gim, "");
}

// --- 4. Stat Line Conversion --------------------------------------------------
// Turns "GP: 12 | G: 4 | A: 3" into fluid spoken text.
// Extend this map as you encounter more stat abbreviations in real articles.
const STAT_LABELS = {
  GP: "games played",
  G: "goals",
  A: "assists",
  PTS: "points",
  PIM: "penalty minutes",
  SOG: "shots on goal",
  W: "wins",
  L: "losses",
  OTL: "overtime losses",
  SV: "saves",
  "SV%": "save percentage",
  GAA: "goals against average",
};

function numberToWords(n) {
  // Minimal number-to-words for small integers (stat lines are almost always small).
  // Falls back to the digit string for anything out of range.
  const ones = ["zero","one","two","three","four","five","six","seven","eight","nine",
    "ten","eleven","twelve","thirteen","fourteen","fifteen","sixteen","seventeen",
    "eighteen","nineteen"];
  const tens = ["","","twenty","thirty","forty","fifty","sixty","seventy","eighty","ninety"];

  const num = Number(n);
  if (!Number.isInteger(num) || num < 0 || num > 999) return n;
  if (num < 20) return ones[num];
  if (num < 100) {
    const t = Math.floor(num / 10), o = num % 10;
    return tens[t] + (o ? "-" + ones[o] : "");
  }
  const h = Math.floor(num / 100), rest = num % 100;
  return ones[h] + " hundred" + (rest ? " " + numberToWords(rest) : "");
}

function convertStatLines(text) {
  // Matches lines like "GP: 12 | G: 4 | A: 3" (pipe- or comma-delimited key:value pairs)
  const statLinePattern = /^\s*((?:[A-Z%]+\s*:\s*[\d.]+\s*[|,]?\s*){2,})\s*$/gim;

  return text.replace(statLinePattern, (line) => {
    const pairs = line
      .split(/[|,]/)
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => {
        const [rawKey, rawVal] = p.split(":").map((s) => s.trim());
        const label = STAT_LABELS[rawKey.toUpperCase()] || rawKey;
        const spokenVal = /^\d+$/.test(rawVal) ? numberToWords(rawVal) : rawVal;
        return `${spokenVal} ${label}`;
      });

    if (pairs.length === 0) return line;
    if (pairs.length === 1) return `In ${pairs[0]}.`;

    const last = pairs.pop();
    return `In ${pairs.join(", ")}, and ${last}.`;
  });
}

// --- 5. Whitespace / punctuation cleanup -------------------------------------
function normalizeWhitespace(text) {
  return text
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n\s*\n/g, "\n\n")
    .trim();
}

// --- Public pipeline entry point ---------------------------------------------
function preprocessArticleText(rawText) {
  let text = rawText;

  text = stripPhotoCredits(text);
  text = stripShareAndAdBlocks(text);
  text = convertStatLines(text);
  text = expandAcronyms(text);

  for (const { match, replace } of LOCAL_EXCEPTIONS) {
    text = text.replace(match, replace);
  }

  text = normalizeWhitespace(text);
  return text;
}

export { preprocessArticleText, expandAcronyms, convertStatLines, ACRONYMS, LOCAL_EXCEPTIONS };
