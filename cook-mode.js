/*
 * The Recipe Box – Version 8 Cook Mode (cook-mode.js)
 * Opened from scrDetail with Launch(gblWebBase & "/cook-mode.html#data=" & EncodeUrl(JSON(...))).
 * The recipe travels in the URL fragment, which browsers never send to the web server,
 * so the page needs no back end and no sign-in.
 * Generated with AI assistance (Claude, Anthropic) – see docs/ai-prompts/PROMPT_LOG.md.
 */
(function () {
  "use strict";
  var RB = window.RB;
  var $ = function (id) { return document.getElementById(id); };

  var SAMPLE = { v: 1, t: "Weekday Veggie Fried Rice", b: 2, s: 2, u: "serving", dark: false, src: "",
    i: [{ a: 2, x: "cups cooked rice (day-old is best)" }, { a: 2, x: "eggs" }, { a: 1, x: "cup frozen peas and carrots" },
        { a: 2, x: "tbsp soy sauce" }, { a: 1, x: "tbsp sesame oil" }, { a: 2, x: "green onions, sliced" }],
    st: [{ x: "Heat the sesame oil in a large pan over medium-high heat." },
         { x: "Add the peas and carrots and cook for 3 minutes." },
         { x: "Push everything to one side, scramble the eggs in the empty space." },
         { x: "Add the rice and soy sauce, stir-fry for 4 minutes, top with green onions." }] };

  var recipe, state, storeKey;
  var timers = [];          // {id, step, label, total, endAt, left, state}
  var nextTimerId = 1;
  var audio = null, wakeLock = null, tickHandle = null;

  /* ---------- start-up ---------- */

  function start() {
    // Registered before anything else: the help screen's sample link and a second
    // Launch() from the app into an open tab both only change the hash (test E1).
    window.addEventListener("hashchange", function () { location.reload(); });
    var res = RB.decodeRecipeHash(location.hash);
    $("sampleLink").href = "#data=" + encodeURIComponent(JSON.stringify(SAMPLE));
    if (!res.ok) { showEmpty(res.error); return; }

    recipe = res.recipe;
    document.documentElement.setAttribute("data-theme", recipe.dark ? "dark" : "light");
    document.title = recipe.title + " – Cook Mode";
    storeKey = "rb-cook:" + recipe.title + ":" + recipe.steps.length;
    state = load() || { step: 0, servings: recipe.servings, checked: [] };
    if (state.step > recipe.steps.length) state.step = 0;
    // A fresh launch from the app wins over a remembered serving size.
    state.servings = recipe.servings;

    $("empty").hidden = true;
    $("cook").hidden = false;
    $("title").textContent = recipe.title;
    if (recipe.source) { $("sourceLink").href = recipe.source; $("source").hidden = false; }
    if (window.matchMedia("(max-width: 760px)").matches) $("ingPanel").open = false;

    wireEvents();
    setupWakeLock();
    renderIngredients();
    renderStep();
  }

  function showEmpty(error) {
    var msg = {
      bad_json: "This Cook Mode link is damaged, so the recipe could not be read. Open Cook Mode again from the recipe in the app.",
      bad_version: "This link was made by a different version of the app. Open Cook Mode again from the recipe in the app.",
      too_long: "This link is too long to be a recipe from the app. Open Cook Mode again from the recipe.",
      no_steps: "This recipe has no steps yet. Add steps in the app, then open Cook Mode again."
    }[error];
    if (msg) $("emptyMsg").textContent = msg;
    $("cook").hidden = true;
    $("empty").hidden = false;
  }

  function wireEvents() {
    $("prev").addEventListener("click", function () { go(state.step - 1); });
    $("next").addEventListener("click", function () { go(state.step + 1); });
    $("back").addEventListener("click", function () { go(recipe.steps.length - 1); });
    $("restart").addEventListener("click", function () { state.checked = []; renderIngredients(); go(0); });
    $("less").addEventListener("click", function () { setServings(state.servings - 1); });
    $("more").addEventListener("click", function () { setServings(state.servings + 1); });
    document.addEventListener("keydown", function (e) {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      // Only typing fields keep the arrow keys; a ticked ingredient checkbox must not
      // swallow them (test E6).
      var el = e.target || {};
      var typing = el.tagName === "TEXTAREA" || el.tagName === "SELECT" ||
        (el.tagName === "INPUT" && el.type !== "checkbox" && el.type !== "radio");
      if (typing) return;
      if (e.key === "ArrowRight") { e.preventDefault(); go(state.step + 1); }
      if (e.key === "ArrowLeft") { e.preventDefault(); go(state.step - 1); }
    });
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "visible") { tick(); if ($("wake").checked) requestWake(); }
    });
  }

  /* ---------- ingredients and servings ---------- */

  function setServings(n) {
    state.servings = Math.max(1, Math.min(50, n));
    renderIngredients();
    save();
  }

  function renderIngredients() {
    $("servings").textContent = state.servings;
    $("unit").textContent = recipe.unit + (state.servings === 1 ? "" : "s");
    $("less").disabled = state.servings <= 1;
    $("more").disabled = state.servings >= 50;
    var list = $("ingList");
    list.textContent = "";
    recipe.ingredients.forEach(function (ing, i) {
      var li = document.createElement("li");
      var label = document.createElement("label");
      var box = document.createElement("input");
      box.type = "checkbox";
      box.checked = state.checked.indexOf(i) >= 0;
      box.addEventListener("change", function () {
        var at = state.checked.indexOf(i);
        if (box.checked && at < 0) state.checked.push(i);
        if (!box.checked && at >= 0) state.checked.splice(at, 1);
        updateIngSummary();
        save();
      });
      var span = document.createElement("span");
      span.textContent = RB.scaleLine(ing, state.servings, recipe.base);
      label.appendChild(box);
      label.appendChild(span);
      li.appendChild(label);
      list.appendChild(li);
    });
    updateIngSummary();
  }

  function updateIngSummary() {
    var n = recipe.ingredients.length;
    $("ingSummary").textContent = n === 0 ? "No ingredients listed"
      : "Ingredients · " + state.checked.length + " of " + n + " ready";
  }

  /* ---------- steps ---------- */

  function go(i) {
    var max = recipe.steps.length; // index max = finished screen
    i = Math.max(0, Math.min(max, i));
    if (i === state.step) return;
    state.step = i;
    save();
    renderStep(true);
  }

  function renderStep(moveFocus) {
    var n = recipe.steps.length;
    var finished = state.step >= n;
    $("stepView").hidden = finished;
    $("doneView").hidden = !finished;
    $("progressBar").style.width = (Math.min(state.step + 1, n) / n * 100) + "%";
    if (finished) {
      $("doneTitle").textContent = "All steps done. Enjoy your " + recipe.title + ".";
      if (moveFocus) $("doneTitle").focus();
      return;
    }
    $("progressText").textContent = "Step " + (state.step + 1) + " of " + n;
    $("prev").disabled = state.step === 0;
    $("next").textContent = state.step === n - 1 ? "Finish" : "Next step";

    var text = recipe.steps[state.step];
    var found = RB.findTimers(text);
    var p = $("stepText");
    p.textContent = "";
    var at = 0;
    found.forEach(function (t, k) {
      p.appendChild(document.createTextNode(text.slice(at, t.start)));
      p.appendChild(timerButton(t, k));
      at = t.end;
    });
    p.appendChild(document.createTextNode(text.slice(at)));
    $("stepHint").hidden = found.length === 0;
    if (moveFocus) p.focus();
    paintTimerWords();
  }

  function timerButton(t, k) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "timer-word";
    b.dataset.key = state.step + ":" + k;
    b.dataset.seconds = String(t.maxSeconds);
    b.appendChild(document.createTextNode(t.text));
    var clock = document.createElement("span");
    clock.className = "clock";
    b.appendChild(clock);
    b.setAttribute("aria-label", "Start a " + RB.describeDuration(t.maxSeconds) + " timer");
    b.addEventListener("click", function () {
      var existing = findTimer(b.dataset.key);
      if (existing && existing.state !== "done") { togglePause(existing); return; }
      if (existing) removeTimer(existing.id);
      addTimer(b.dataset.key, "Step " + (state.step + 1) + ": " + t.text, t.maxSeconds);
    });
    return b;
  }

  /* ---------- timers ----------
     Each timer stores the moment it ends (endAt), not a counter, so it stays correct
     when the phone locks or the tab is in the background and setInterval slows down. */

  function findTimer(key) {
    for (var i = 0; i < timers.length; i++) if (timers[i].key === key) return timers[i];
    return null;
  }

  function addTimer(key, label, seconds) {
    unlockAudio();
    askNotify();
    timers.push({ id: nextTimerId++, key: key, label: label, total: seconds,
      endAt: Date.now() + seconds * 1000, left: seconds, state: "running", rings: 0 });
    say("Timer started: " + RB.describeDuration(seconds) + ".");
    ensureTicking();
    tick();
  }

  function togglePause(t) {
    if (t.state === "running") { t.left = Math.max(0, (t.endAt - Date.now()) / 1000); t.state = "paused"; say("Timer paused."); }
    else if (t.state === "paused") { t.endAt = Date.now() + t.left * 1000; t.state = "running"; say("Timer resumed."); }
    // The interval stops when every timer is paused, so resuming must restart it (test E4).
    ensureTicking();
    tick();
  }

  function removeTimer(id) {
    timers = timers.filter(function (t) { return t.id !== id; });
    tick();
  }

  function ensureTicking() {
    if (!tickHandle) tickHandle = setInterval(tick, 250);
  }

  function tick() {
    var now = Date.now();
    var anyDone = false;
    timers.forEach(function (t) {
      if (t.state === "running") {
        t.left = Math.max(0, (t.endAt - now) / 1000);
        if (t.left <= 0) { t.state = "done"; t.doneAt = now; ring(t); }
      }
      if (t.state === "done") {
        anyDone = true;
        // ring again every 4 s, at most 8 times, until dismissed
        if (t.rings < 8 && now - t.doneAt >= t.rings * 4000) ring(t);
      }
    });
    if (!timers.some(function (t) { return t.state !== "paused"; }) && tickHandle) {
      clearInterval(tickHandle); tickHandle = null;
    }
    document.title = (anyDone ? "⏰ Time’s up – " : "") + recipe.title + " – Cook Mode";
    renderTray();
    paintTimerWords();
  }

  function renderTray() {
    var tray = $("tray");
    // Rebuild only when the set of timers or their states change, so focus is not lost.
    var sig = timers.map(function (t) { return t.id + t.state; }).join(",");
    if (tray.dataset.sig !== sig) {
      tray.dataset.sig = sig;
      tray.textContent = "";
      timers.forEach(function (t) { tray.appendChild(chip(t)); });
    }
    timers.forEach(function (t) {
      var el = tray.querySelector('[data-id="' + t.id + '"] strong');
      if (el) el.textContent = t.state === "done" ? "Done" : RB.formatClock(t.left);
    });
  }

  function chip(t) {
    var c = document.createElement("div");
    c.className = "chip";
    c.dataset.id = String(t.id);
    c.dataset.state = t.state;
    c.setAttribute("role", "group");
    c.setAttribute("aria-label", t.label);
    var time = document.createElement("strong");
    var label = document.createElement("small");
    label.textContent = t.label;
    c.appendChild(time);
    c.appendChild(label);
    if (t.state !== "done") {
      var pause = document.createElement("button");
      pause.type = "button";
      pause.textContent = t.state === "paused" ? "▶" : "❚❚";
      pause.setAttribute("aria-label", t.state === "paused" ? "Resume timer" : "Pause timer");
      pause.addEventListener("click", function () { togglePause(t); });
      c.appendChild(pause);
    }
    var x = document.createElement("button");
    x.type = "button";
    x.textContent = "✕";
    x.setAttribute("aria-label", t.state === "done" ? "Dismiss timer" : "Cancel timer");
    x.addEventListener("click", function () { removeTimer(t.id); });
    c.appendChild(x);
    return c;
  }

  function paintTimerWords() {
    var words = document.querySelectorAll(".timer-word");
    for (var i = 0; i < words.length; i++) {
      var b = words[i];
      var t = findTimer(b.dataset.key);
      var clock = b.querySelector(".clock");
      b.dataset.state = t ? t.state : "idle";
      clock.textContent = !t ? "" : t.state === "done" ? "done" : RB.formatClock(t.left);
      b.setAttribute("aria-label", !t ? "Start a " + RB.describeDuration(Number(b.dataset.seconds)) + " timer"
        : t.state === "running" ? "Pause timer, " + RB.formatClock(t.left) + " left"
        : t.state === "paused" ? "Resume timer" : "Timer done, start again");
    }
  }

  /* ---------- alerts: sound, vibration, notification ---------- */

  function unlockAudio() {
    // Browsers only allow sound after a tap, so the first timer tap creates the context.
    try {
      if (!audio) { var C = window.AudioContext || window.webkitAudioContext; if (C) audio = new C(); }
      if (audio && audio.state === "suspended") audio.resume();
    } catch (e) { audio = null; }
  }

  function ring(t) {
    t.rings += 1;
    if (t.rings === 1) {
      say("Time’s up: " + t.label);
      if (navigator.vibrate) navigator.vibrate([300, 150, 300]);
      if (document.visibilityState !== "visible" && "Notification" in window && Notification.permission === "granted") {
        try { new Notification("Time’s up", { body: t.label, tag: "rb-timer-" + t.id }); } catch (e) { /* ignore */ }
      }
    }
    if (!audio) return;
    try {
      var now = audio.currentTime;
      [0, 0.25, 0.5].forEach(function (d, i) {
        var o = audio.createOscillator(), g = audio.createGain();
        o.type = "sine";
        o.frequency.value = i === 2 ? 1046.5 : 880;
        g.gain.setValueAtTime(0.0001, now + d);
        g.gain.exponentialRampToValueAtTime(0.3, now + d + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, now + d + 0.22);
        o.connect(g); g.connect(audio.destination);
        o.start(now + d); o.stop(now + d + 0.25);
      });
    } catch (e) { /* sound is a bonus, never an error */ }
  }

  function askNotify() {
    if ("Notification" in window && Notification.permission === "default") {
      try { Notification.requestPermission(); } catch (e) { /* older Safari */ }
    }
  }

  /* ---------- keep the screen on ---------- */

  function setupWakeLock() {
    if (!("wakeLock" in navigator)) return;   // unsupported: the switch stays hidden
    $("wakeWrap").hidden = false;
    $("wake").addEventListener("change", function () {
      if ($("wake").checked) requestWake();
      else if (wakeLock) { wakeLock.release(); wakeLock = null; }
    });
  }

  function requestWake() {
    navigator.wakeLock.request("screen").then(function (lock) {
      wakeLock = lock;
      lock.addEventListener("release", function () { wakeLock = null; });
    }).catch(function () {
      $("wake").checked = false;
      say("This browser did not allow keeping the screen on.");
    });
  }

  /* ---------- small helpers ---------- */

  function say(msg) {
    var a = $("announce");
    a.textContent = "";
    setTimeout(function () { a.textContent = msg; }, 30);
  }

  function load() {
    try {
      var s = JSON.parse(localStorage.getItem(storeKey) || "null");
      if (s && typeof s.step === "number" && Array.isArray(s.checked)) return s;
    } catch (e) { /* private mode or blocked storage */ }
    return null;
  }
  function save() {
    try { localStorage.setItem(storeKey, JSON.stringify(state)); } catch (e) { /* not essential */ }
  }

  start();
})();
