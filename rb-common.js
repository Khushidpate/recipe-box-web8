/*
 * The Recipe Box – Version 8 shared web logic (rb-common.js)
 * Used by cook-mode.html and email-composer.html, and by the Node unit tests.
 * Generated with AI assistance (Claude, Anthropic) from the prompts in
 * docs/ai-prompts/PROMPT_LOG.md, then reviewed and tested by Khushi Patel.
 *
 * Rules here are ports of the existing app so the web pages and Power Apps agree:
 *   formatQty   = App.Formulas FormatQty   (V6 build guide C1)
 *   parseAmount = App.Formulas ParseAmount (V6 build guide C1)
 *   cleanLine   = btnSave line cleaning    (V6 build guide C5)
 *   validateRecipe limits = gateway Flow 4 + Make slices (V7)
 */
(function (root) {
  "use strict";

  var RB = {};

  /* ---------- quantities ---------- */

  // Same thresholds as Power Fx FormatQty: nearest common fraction within 0.04.
  RB.formatQty = function (a) {
    if (typeof a !== "number" || !isFinite(a)) return "";
    var w = Math.floor(a + 0.000000001);
    var r = a - w;
    var p = w > 0 ? w + " " : "";
    if (r < 0.02) return String(w);
    if (r > 0.98) return String(w + 1);
    var fracs = [[0.25, "1/4"], [1 / 3, "1/3"], [0.5, "1/2"], [2 / 3, "2/3"], [0.75, "3/4"]];
    for (var i = 0; i < fracs.length; i++) {
      if (Math.abs(r - fracs[i][0]) <= 0.04) return p + fracs[i][1];
    }
    return String(Math.round(a * 10) / 10);
  };

  // "1 1/2" -> 1.5, "1/4" -> 0.25, "2" -> 2, "½" -> 0.5. Returns null if not a number.
  RB.parseAmount = function (s) {
    if (s == null) return null;
    var t = String(s).trim()
      .replace(/½/g, " 1/2").replace(/¼/g, " 1/4").replace(/¾/g, " 3/4")
      .replace(/⅓/g, " 1/3").replace(/⅔/g, " 2/3").trim();
    var m = t.match(/^(\d+)\s+(\d+)\/(\d+)$/);
    if (m) return Number(m[3]) === 0 ? null : Number(m[1]) + Number(m[2]) / Number(m[3]);
    m = t.match(/^(\d+)\/(\d+)$/);
    if (m) return Number(m[2]) === 0 ? null : Number(m[1]) / Number(m[2]);
    m = t.match(/^\d+(?:\.\d+)?$/);
    return m ? Number(t) : null;
  };

  RB.scaleLine = function (ing, selected, base) {
    if (ing.a == null || !base) return ing.x;
    return RB.formatQty(ing.a * selected / base) + " " + ing.x;
  };

  /* ---------- the payload Power Apps sends in the URL hash ---------- */

  var MAX_HASH = 60000; // a recipe is ~2-6 KB; anything this big is not ours

  // Power Fx JSON() turns ForAll(..., {x: ...}) into [{"x": "..."}]; a plain
  // single-column table becomes [{"Value": "..."}]. Accept both and plain strings.
  function textOf(item) {
    if (item == null) return "";
    if (typeof item === "string") return item;
    if (typeof item === "object") {
      if (typeof item.x === "string") return item.x;
      if (typeof item.Value === "string") return item.Value;
    }
    return "";
  }

  function toInt(v, lo, hi, dflt) {
    var n = Math.round(Number(v));
    return isFinite(n) && n >= lo && n <= hi ? n : dflt;
  }

  // Returns {ok:true, recipe} or {ok:false, error}. Never throws.
  RB.decodeRecipeHash = function (hash) {
    var raw = String(hash || "").replace(/^#/, "");
    var m = raw.match(/(?:^|&)data=([^&]*)/);
    if (!m) return { ok: false, error: "none" };
    if (m[1].length > MAX_HASH) return { ok: false, error: "too_long" };
    var obj;
    try {
      obj = JSON.parse(decodeURIComponent(m[1].replace(/\+/g, "%20")));
    } catch (e) {
      return { ok: false, error: "bad_json" };
    }
    if (!obj || typeof obj !== "object") return { ok: false, error: "bad_json" };
    if (obj.v !== 1) return { ok: false, error: "bad_version" };

    var ingredients = (Array.isArray(obj.i) ? obj.i : []).map(function (it) {
      var a = it && typeof it === "object" && typeof it.a === "number" && isFinite(it.a) && it.a > 0 ? it.a : null;
      return { a: a, x: textOf(it).trim() };
    }).filter(function (it) { return it.x.length > 0; });

    var steps = (Array.isArray(obj.st) ? obj.st : []).map(function (s) { return textOf(s).trim(); })
      .filter(function (s) { return s.length > 0; });

    if (steps.length === 0) return { ok: false, error: "no_steps" };

    var base = toInt(obj.b, 1, 50, 2);
    var src = typeof obj.src === "string" && /^https:\/\//i.test(obj.src) ? obj.src : "";
    return {
      ok: true,
      recipe: {
        title: (typeof obj.t === "string" && obj.t.trim()) ? obj.t.trim().slice(0, 120) : "Untitled recipe",
        base: base,
        servings: toInt(obj.s, 1, 50, base),
        unit: typeof obj.u === "string" && obj.u.trim() ? obj.u.trim().slice(0, 30) : "serving",
        ingredients: ingredients,
        steps: steps,
        source: src,
        dark: obj.dark === true
      }
    };
  };

  /* ---------- timers found in step text ---------- */

  var WORDS = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
    eight: 8, nine: 9, ten: 10, fifteen: 15, twenty: 20, thirty: 30, forty: 40, "forty-five": 45 };
  var NUM = "(\\d+\\s+\\d+\\/\\d+|\\d+\\/\\d+|\\d+(?:\\.\\d+)?|a|an|one|two|three|four|five|six|seven|eight|nine|ten|fifteen|twenty|thirty|forty-five|forty)";
  var UNIT = "(hours?|hrs?|minutes?|mins?|seconds?|secs?)";
  // number, optional range ("10-12", "10 to 12"), unit; optional "and/, 15 minutes" after hours
  var DURATION = new RegExp(
    "\\b" + NUM + "(?:\\s*(?:-|–|to)\\s*" + NUM + ")?\\s*" + UNIT + "\\b" +
    "(?:,?\\s*(?:and\\s+)?(\\d+)\\s*(minutes?|mins?)\\b)?", "gi");
  var HALF_HOUR = /\bhalf an hour\b/gi;

  function numVal(s) {
    if (s == null) return null;
    var k = String(s).toLowerCase();
    if (Object.prototype.hasOwnProperty.call(WORDS, k)) return WORDS[k];
    return RB.parseAmount(k);
  }
  function unitSeconds(u) {
    u = u.toLowerCase();
    if (u.indexOf("h") === 0) return 3600;
    if (u.indexOf("m") === 0) return 60;
    return 1;
  }

  // Returns [{start, end, text, seconds, maxSeconds}] in text order.
  RB.findTimers = function (text) {
    var out = [];
    var s = String(text || "");
    var m;
    DURATION.lastIndex = 0;
    while ((m = DURATION.exec(s)) !== null) {
      var lo = numVal(m[1]);
      var hi = m[2] ? numVal(m[2]) : null;
      if (lo == null || lo <= 0) continue;
      var mult = unitSeconds(m[3]);
      var extra = m[4] ? Number(m[4]) * 60 : 0;
      var secs = Math.round(lo * mult) + extra;
      var maxSecs = hi != null && hi > lo ? Math.round(hi * mult) + extra : secs;
      if (secs < 5 || secs > 24 * 3600) continue; // ignore nonsense
      out.push({ start: m.index, end: m.index + m[0].length, text: m[0], seconds: secs, maxSeconds: maxSecs });
    }
    HALF_HOUR.lastIndex = 0;
    while ((m = HALF_HOUR.exec(s)) !== null) {
      out.push({ start: m.index, end: m.index + m[0].length, text: m[0], seconds: 1800, maxSeconds: 1800 });
    }
    // Drop matches inside an earlier one ("an hour" inside "half an hour", test U8).
    out.sort(function (x, y) { return x.start - y.start || (y.end - y.start) - (x.end - x.start); });
    var kept = [];
    out.forEach(function (t) {
      var prev = kept[kept.length - 1];
      if (!prev || t.start >= prev.end) kept.push(t);
    });
    return kept;
  };

  RB.formatClock = function (secs) {
    secs = Math.max(0, Math.ceil(secs));
    var h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60), s = secs % 60;
    var mm = h > 0 && m < 10 ? "0" + m : String(m);
    return (h > 0 ? h + ":" : "") + mm + ":" + (s < 10 ? "0" : "") + s;
  };

  RB.describeDuration = function (secs) {
    var h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60), s = secs % 60;
    var parts = [];
    if (h) parts.push(h + (h === 1 ? " hour" : " hours"));
    if (m) parts.push(m + (m === 1 ? " minute" : " minutes"));
    if (s) parts.push(s + (s === 1 ? " second" : " seconds"));
    return parts.join(" ") || "0 seconds";
  };

  /* ---------- email composer ---------- */

  // V6 btnSave: strip "- ", "* ", "• ", "1. ", "1) " from the start of a line.
  RB.cleanLine = function (line) {
    var t = String(line || "").trim();
    var m = t.match(/^(?:[-*•]|\d+[.)])\s+(.+)$/);
    return (m ? m[1] : t).trim();
  };
  RB.splitLines = function (block) {
    return String(block || "").replace(/\r/g, "").split("\n").map(RB.cleanLine)
      .filter(function (l) { return l.length > 0; });
  };

  RB.LIMITS = { title: 120, minutesMin: 1, minutesMax: 1440, servingsMin: 1, servingsMax: 50,
    ingredients: 40, steps: 30, ingredientChars: 300, stepChars: 600, mailtoChars: 1800 };

  // Multi-word phrases first: a regex alternation takes the first branch that matches,
  // so "fish" listed before "fish sauce" would name the wrong ingredient (test U15).
  var MEAT = /\b(fish sauce|oyster sauce|(?:chicken|beef|fish) (?:stock|broth)|chicken|beef|pork|lamb|mutton|bacon|ham|sausages?|turkey|duck|veal|prosciutto|salami|pepperoni|chorizo|fish|salmon|tuna|cod|anchov(?:y|ies)|shrimps?|prawns?|crab|lobster|clams?|mussels?|oysters?|scallops?|squid|gelatine?|lard)\b/i;
  var PRIVATE = [
    { re: /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i, what: "an email address" },
    { re: /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/, what: "a phone number" }
  ];

  function isWholeIn(text, lo, hi) {
    return /^\d+$/.test(String(text).trim()) && Number(text) >= lo && Number(text) <= hi;
  }

  // Same field names and messages as the V6 app validation (colErrors).
  RB.validateRecipe = function (f) {
    var L = RB.LIMITS;
    var errors = [], warnings = [];
    var ing = RB.splitLines(f.ingredients), steps = RB.splitLines(f.steps);
    var title = String(f.title || "").trim();

    if (!title) errors.push({ field: "title", msg: "Give your recipe a name." });
    else if (title.length > L.title) errors.push({ field: "title", msg: "Keep the name under " + L.title + " characters." });
    if (["breakfast", "dinner", "dessert"].indexOf(f.category) < 0) errors.push({ field: "category", msg: "Pick a category." });
    if (!isWholeIn(f.minutes, L.minutesMin, L.minutesMax)) errors.push({ field: "minutes", msg: "Enter the time in whole minutes (1 or more)." });
    if (!isWholeIn(f.servings, L.servingsMin, L.servingsMax)) errors.push({ field: "servings", msg: "Enter how many it serves (1-50)." });
    if (ing.length === 0) errors.push({ field: "ingredients", msg: "Add at least one ingredient (one per line)." });
    else if (ing.length > L.ingredients) errors.push({ field: "ingredients", msg: "The app keeps up to " + L.ingredients + " ingredients. Combine or remove " + (ing.length - L.ingredients) + "." });
    if (steps.length === 0) errors.push({ field: "steps", msg: "Add at least one step (one per line)." });
    else if (steps.length > L.steps) errors.push({ field: "steps", msg: "The app keeps up to " + L.steps + " steps. Combine or remove " + (steps.length - L.steps) + "." });

    ing.forEach(function (l, i) {
      if (l.length > L.ingredientChars) warnings.push({ field: "ingredients", msg: "Ingredient " + (i + 1) + " is long and will be cut at " + L.ingredientChars + " characters." });
    });
    steps.forEach(function (l, i) {
      if (l.length > L.stepChars) warnings.push({ field: "steps", msg: "Step " + (i + 1) + " is long and will be cut at " + L.stepChars + " characters. Split it into two steps." });
    });
    if (f.isVeg) {
      for (var i = 0; i < ing.length; i++) {
        var hit = ing[i].match(MEAT);
        if (hit) { warnings.push({ field: "isVeg", msg: "Marked vegetarian, but \u201C" + hit[0] + "\u201D is not vegetarian. The reviewer will check this." }); break; }
      }
    }
    var all = [title, f.ingredients, f.steps, f.note].join("\n");
    PRIVATE.forEach(function (p) {
      if (p.re.test(all)) warnings.push({ field: "privacy", msg: "Your recipe contains " + p.what + ". Remove it: the email text is read by Google Gemini." });
    });
    return { ok: errors.length === 0, errors: errors, warnings: warnings, ingredients: ing, steps: steps };
  };

  // The exact template shown on scrEmailRecipe (V7 F3) – the layout Gemini reads best.
  RB.buildEmail = function (f) {
    var v = RB.validateRecipe(f);
    var lines = [];
    var note = String(f.note || "").trim();
    if (note) { lines.push(note, ""); }
    lines.push("Category: " + (f.category || ""));
    lines.push("Time: " + String(f.minutes || "").trim() + " mins   Serves: " + String(f.servings || "").trim() +
      "   Vegetarian: " + (f.isVeg ? "yes" : "no"));
    lines.push("Ingredients:");
    v.ingredients.forEach(function (l) { lines.push("- " + l); });
    lines.push("Steps:");
    v.steps.forEach(function (l, i) { lines.push((i + 1) + ". " + l); });
    return { subject: String(f.title || "").trim(), body: lines.join("\n"), validation: v };
  };

  RB.buildMailto = function (to, subject, body) {
    return "mailto:" + encodeURIComponent(to).replace(/%40/g, "@") +
      "?subject=" + encodeURIComponent(subject) + "&body=" + encodeURIComponent(body.replace(/\n/g, "\r\n"));
  };

  RB.isMailhook = function (addr) {
    return /^[A-Z0-9._%+-]+@hook\.[a-z0-9-]+\.make\.com$/i.test(String(addr || "").trim());
  };

  // Reads "#to=<address>&theme=dark" set by the Power Apps Launch() call.
  RB.readHashParams = function (hash) {
    var out = {};
    String(hash || "").replace(/^#/, "").split("&").forEach(function (kv) {
      if (!kv) return;
      var i = kv.indexOf("=");
      var k = i < 0 ? kv : kv.slice(0, i), val = i < 0 ? "" : kv.slice(i + 1);
      try { out[decodeURIComponent(k)] = decodeURIComponent(val.replace(/\+/g, "%20")); } catch (e) { /* skip bad pair */ }
    });
    return out;
  };

  if (typeof module !== "undefined" && module.exports) module.exports = RB;
  else root.RB = RB;
})(typeof window !== "undefined" ? window : this);
