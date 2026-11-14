// Run: node --test web/tests/   (Node 18+; no packages needed)
const test = require("node:test");
const assert = require("node:assert/strict");
const RB = require("../js/rb-common.js");

test("U1 formatQty matches Power Fx FormatQty", () => {
  const cases = [[4, "4"], [0.25, "1/4"], [0.5, "1/2"], [1.5, "1 1/2"], [1 / 3, "1/3"],
    [2 / 3, "2/3"], [0.75, "3/4"], [2.99, "3"], [3.01, "3"], [0.125, "0.1"], [1.6, "1.6"],
    [0.3, "1/3"], [8, "8"], [0.375, "0.4"]];
  for (const [a, want] of cases) assert.equal(RB.formatQty(a), want, `formatQty(${a})`);
});

test("U2 parseAmount", () => {
  assert.equal(RB.parseAmount("1 1/2"), 1.5);
  assert.equal(RB.parseAmount("1/4"), 0.25);
  assert.equal(RB.parseAmount("2"), 2);
  assert.equal(RB.parseAmount("½"), 0.5);
  assert.equal(RB.parseAmount("1½"), 1.5);
  assert.equal(RB.parseAmount("1/0"), null);
  assert.equal(RB.parseAmount("pinch"), null);
});

test("U3 scaling: 4 eggs for 2 servings -> 8 eggs for 4, 1/4 cup -> 1/2 cup", () => {
  assert.equal(RB.scaleLine({ a: 4, x: "eggs" }, 4, 2), "8 eggs");
  assert.equal(RB.scaleLine({ a: 0.25, x: "cup grated cheese" }, 4, 2), "1/2 cup grated cheese");
  assert.equal(RB.scaleLine({ a: null, x: "salt and pepper" }, 4, 2), "salt and pepper");
});

function hashOf(obj) { return "#data=" + encodeURIComponent(JSON.stringify(obj)); }

test("U4 decodeRecipeHash accepts the Power Fx JSON() shape", () => {
  const r = RB.decodeRecipeHash(hashOf({ v: 1, t: "Herb & Cheese Skillet Eggs", b: 2, s: 4, u: "serving",
    i: [{ a: 4, x: "eggs" }, { a: null, x: "salt and pepper" }], st: [{ x: "Melt butter." }, { x: "Whisk eggs." }],
    src: "", dark: false }));
  assert.equal(r.ok, true);
  assert.equal(r.recipe.title, "Herb & Cheese Skillet Eggs");
  assert.equal(r.recipe.servings, 4);
  assert.equal(r.recipe.ingredients.length, 2);
  assert.equal(r.recipe.steps[1], "Whisk eggs.");
});

test("U5 decodeRecipeHash accepts [{Value}] tables and plain strings", () => {
  const r = RB.decodeRecipeHash(hashOf({ v: 1, t: "X", b: 2, s: 2, i: [{ Value: "rice" }, "salt"], st: [{ Value: "Cook." }] }));
  assert.equal(r.ok, true);
  assert.deepEqual(r.recipe.ingredients.map(i => i.x), ["rice", "salt"]);
});

test("U6 decodeRecipeHash rejects bad input without throwing", () => {
  assert.equal(RB.decodeRecipeHash("").error, "none");
  assert.equal(RB.decodeRecipeHash("#data=%7Bnot json").error, "bad_json");
  assert.equal(RB.decodeRecipeHash(hashOf({ v: 2, st: ["a"] })).error, "bad_version");
  assert.equal(RB.decodeRecipeHash(hashOf({ v: 1, st: [] })).error, "no_steps");
  assert.equal(RB.decodeRecipeHash("#data=" + "a".repeat(70000)).error, "too_long");
});

test("U7 decodeRecipeHash clamps servings and drops non-https source links", () => {
  const r = RB.decodeRecipeHash(hashOf({ v: 1, t: "X", b: 999, s: -3, st: ["a"], src: "javascript:alert(1)" }));
  assert.equal(r.recipe.base, 2);
  assert.equal(r.recipe.servings, 2);
  assert.equal(r.recipe.source, "");
});

test("U8 findTimers: common phrasings", () => {
  const t = s => RB.findTimers(s).map(x => [x.text, x.seconds, x.maxSeconds]);
  assert.deepEqual(t("Add the peas and carrots and cook for 3 minutes."), [["3 minutes", 180, 180]]);
  assert.deepEqual(t("stir-fry for 4 minutes, top with green onions"), [["4 minutes", 240, 240]]);
  assert.deepEqual(t("Simmer 10-12 mins"), [["10-12 mins", 600, 720]]);
  assert.deepEqual(t("Bake for 1 hour 15 minutes"), [["1 hour 15 minutes", 4500, 4500]]);
  assert.deepEqual(t("Rest for 1 1/2 hours"), [["1 1/2 hours", 5400, 5400]]);
  assert.deepEqual(t("Microwave 90 seconds, then rest a minute"), [["90 seconds", 90, 90], ["a minute", 60, 60]]);
  assert.deepEqual(t("Chill for half an hour"), [["half an hour", 1800, 1800]]);
  assert.deepEqual(t("Microwave for 70 to 90 seconds"), [["70 to 90 seconds", 70, 90]]);
});

test("U9 findTimers: no false positives", () => {
  assert.deepEqual(RB.findTimers("Heat oven to 350 degrees and add 2 cups flour."), []);
  assert.deepEqual(RB.findTimers("Serve at once."), []);
  assert.deepEqual(RB.findTimers("Use 2 mints leaves"), []);
});

test("U10 formatClock", () => {
  assert.equal(RB.formatClock(180), "3:00");
  assert.equal(RB.formatClock(59.2), "1:00");
  assert.equal(RB.formatClock(4500), "1:15:00");
  assert.equal(RB.formatClock(3605), "1:00:05");
  assert.equal(RB.formatClock(-4), "0:00");
});

test("U11 cleanLine / splitLines match V6 btnSave", () => {
  assert.deepEqual(RB.splitLines("- 2 cups rice\r\n* 2 eggs\n\n• 1 tbsp oil\n1. Heat oil\n2) Add rice\n  plain  "),
    ["2 cups rice", "2 eggs", "1 tbsp oil", "Heat oil", "Add rice", "plain"]);
  assert.equal(RB.cleanLine("1/2 cup milk"), "1/2 cup milk", "a fraction is not a list number");
});

const good = { title: "Weekday Veggie Fried Rice", category: "dinner", minutes: "15", servings: "2", isVeg: true,
  ingredients: "- 2 cups cooked rice\n- 2 eggs", steps: "1. Heat oil.\n2. Add rice." };

test("U12 validateRecipe: a good recipe passes", () => {
  const v = RB.validateRecipe(good);
  assert.equal(v.ok, true);
  assert.equal(v.warnings.length, 0);
});

test("U13 validateRecipe: same messages as the app", () => {
  const v = RB.validateRecipe({ title: " ", category: "", minutes: "0", servings: "51", ingredients: "", steps: "" });
  assert.deepEqual(v.errors.map(e => e.field), ["title", "category", "minutes", "servings", "ingredients", "steps"]);
  assert.equal(v.errors[2].msg, "Enter the time in whole minutes (1 or more).");
  assert.equal(RB.validateRecipe({ ...good, minutes: "12.5" }).ok, false);
  assert.equal(RB.validateRecipe({ ...good, minutes: "1441" }).ok, false);
});

test("U14 validateRecipe: limits from the gateway and Make", () => {
  const many = Array.from({ length: 41 }, (_, i) => "item " + i).join("\n");
  assert.match(RB.validateRecipe({ ...good, ingredients: many }).errors[0].msg, /up to 40 ingredients/);
  assert.match(RB.validateRecipe({ ...good, steps: "x".repeat(700) }).warnings[0].msg, /cut at 600/);
});

test("U15 validateRecipe: vegetarian conflict and privacy warnings", () => {
  const v = RB.validateRecipe({ ...good, ingredients: "2 cups rice\n1 tbsp fish sauce" });
  assert.equal(v.ok, true);
  assert.match(v.warnings[0].msg, /fish sauce/);
  assert.equal(RB.validateRecipe({ ...good, isVeg: false, ingredients: "1 lb chicken" }).warnings.length, 0);
  const p = RB.validateRecipe({ ...good, note: "Call me at 416-555-0199 or khushi@example.com" });
  assert.deepEqual(p.warnings.map(w => w.field), ["privacy", "privacy"]);
});

test("U16 buildEmail produces the V7 template Gemini reads", () => {
  const e = RB.buildEmail(good);
  assert.equal(e.subject, "Weekday Veggie Fried Rice");
  assert.equal(e.body, [
    "Category: dinner",
    "Time: 15 mins   Serves: 2   Vegetarian: yes",
    "Ingredients:", "- 2 cups cooked rice", "- 2 eggs",
    "Steps:", "1. Heat oil.", "2. Add rice."].join("\n"));
});

test("U17 buildMailto encodes safely and uses CRLF", () => {
  const u = RB.buildMailto("abc123@hook.us2.make.com", "Mac & Cheese", "Line 1\nLine 2");
  assert.equal(u, "mailto:abc123@hook.us2.make.com?subject=Mac%20%26%20Cheese&body=Line%201%0D%0ALine%202");
});

test("U18 isMailhook and readHashParams", () => {
  assert.equal(RB.isMailhook("abc123@hook.us2.make.com"), true);
  assert.equal(RB.isMailhook("me@gmail.com"), false);
  assert.deepEqual(RB.readHashParams("#to=abc%40hook.us2.make.com&theme=dark"), { to: "abc@hook.us2.make.com", theme: "dark" });
});
