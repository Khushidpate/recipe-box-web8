/*
 * The Recipe Box – Version 8 Email-a-Recipe composer (email-composer.js)
 * Opened from scrEmailRecipe with Launch(gblWebBase & "/email-composer.html#to=" & EncodeUrl(gblInbox)
 *   & "&theme=" & If(varDark, "dark", "light")).
 * The inbox address travels in the URL fragment, so it never reaches the web server's logs.
 * Builds the email in the exact layout Scenario A (Make + Gemini) reads, and checks it with
 * the same rules as the app and the Integration Gateway before the cook sends it.
 * Generated with AI assistance (Claude, Anthropic) – see docs/ai-prompts/PROMPT_LOG.md.
 */
(function () {
  "use strict";
  var RB = window.RB;
  var $ = function (id) { return document.getElementById(id); };
  var FIELDS = ["title", "category", "minutes", "servings", "isVeg", "ingredients", "steps", "note", "to"];
  var DRAFT_KEY = "rb-email-draft";
  var touched = {};
  var current = null;
  var toastTimer = null;

  function read() {
    return {
      title: $("title").value, category: $("category").value, minutes: $("minutes").value,
      servings: $("servings").value, isVeg: $("isVeg").checked, ingredients: $("ingredients").value,
      steps: $("steps").value, note: $("note").value, to: $("to").value.trim()
    };
  }

  function update() {
    var f = read();
    var mail = RB.buildEmail(f);
    var v = mail.validation;
    var errors = v.errors.slice();
    if (!f.to) errors.push({ field: "to", msg: "Open this page from Email a recipe in the app, or paste the recipe inbox address." });
    else if (!RB.isMailhook(f.to)) errors.push({ field: "to", msg: "This is not the recipe inbox. It ends in @hook.<region>.make.com and is shown in the app." });

    // Field messages only after the person has used the field (or tried to send).
    ["title", "category", "minutes", "servings", "ingredients", "steps", "to"].forEach(function (name) {
      var e = errors.filter(function (x) { return x.field === name; })[0];
      var show = e && touched[name];
      $(name + "-err").textContent = show ? e.msg : "";
      $(name).setAttribute("aria-invalid", show ? "true" : "false");
    });

    var mailto = RB.buildMailto(f.to, mail.subject, mail.body);
    var tooLong = mailto.length > RB.LIMITS.mailtoChars;
    current = { form: f, mail: mail, errors: errors, warnings: v.warnings, mailto: mailto, tooLong: tooLong };

    $("pvTo").textContent = f.to || "—";
    $("pvSubject").textContent = mail.subject || "—";
    $("pvBody").textContent = mail.body;
    $("send").href = errors.length || tooLong ? "#" : mailto;
    // Not aria-disabled: selecting it is how the cook finds out what to fix (test C2).
    renderStatus();
    saveDraft(f);
  }

  function renderStatus() {
    var box = $("status");
    box.textContent = "";
    var c = current;
    var kind = c.errors.length ? "bad" : (c.warnings.length || c.tooLong) ? "warn" : "ok";
    box.dataset.kind = kind;
    var head = document.createElement("strong");
    head.textContent = c.errors.length
      ? c.errors.length + (c.errors.length === 1 ? " thing to fix before sending" : " things to fix before sending")
      : c.tooLong ? "Ready, but too long for an email link"
      : c.warnings.length ? "Ready to send. Please check:" : "Ready to send.";
    box.appendChild(head);
    var items = c.errors.map(function (e) { return e.msg; }).concat(c.warnings.map(function (w) { return w.msg; }));
    if (c.tooLong && !c.errors.length) items.push("Your email app may cut a recipe this long. Select Copy email text, then paste it into a new email to the inbox with the recipe name as the subject.");
    if (items.length) {
      var ul = document.createElement("ul");
      items.forEach(function (t) { var li = document.createElement("li"); li.textContent = t; ul.appendChild(li); });
      box.appendChild(ul);
    }
  }

  function trySend(e) {
    if (!current.errors.length && !current.tooLong) {
      toast("Opening your email app…");
      return; // the browser follows the mailto: link
    }
    e.preventDefault();
    FIELDS.forEach(function (n) { touched[n] = true; });
    update();
    var first = current.errors[0];
    if (first) $(first.field).focus();
    else $("copy").focus();
  }

  function copy() {
    var text = current.mail.body;
    var done = function () { toast("Email text copied. Use the recipe name as the subject."); };
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text) ? done() : toast("Copy did not work. Select the text in the preview and copy it."); });
    } else if (fallbackCopy(text)) done();
    else toast("Copy did not work. Select the text in the preview and copy it.");
  }

  function fallbackCopy(text) {
    var ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    var ok = false;
    try { ok = document.execCommand("copy"); } catch (err) { ok = false; }
    document.body.removeChild(ta);
    return ok;
  }

  function clearForm() {
    var keepTo = $("to").value;
    $("form").reset();
    $("to").value = keepTo;
    touched = {};
    try { localStorage.removeItem(DRAFT_KEY); } catch (e) { /* ignore */ }
    update();
    $("title").focus();
    toast("Started a new recipe.");
  }

  function toast(msg) {
    var t = $("toast");
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 3200);
  }

  function saveDraft(f) {
    try {
      var d = {};
      FIELDS.forEach(function (n) { if (n !== "to") d[n] = f[n]; });
      localStorage.setItem(DRAFT_KEY, JSON.stringify(d));
    } catch (e) { /* drafts are a convenience only */ }
  }

  function loadDraft() {
    try {
      var d = JSON.parse(localStorage.getItem(DRAFT_KEY) || "null");
      if (!d) return;
      FIELDS.forEach(function (n) {
        if (n === "to" || !(n in d)) return;
        if (n === "isVeg") $(n).checked = d[n] === true;
        else $(n).value = String(d[n] == null ? "" : d[n]);
      });
    } catch (e) { /* ignore a broken draft */ }
  }

  function start() {
    var params = RB.readHashParams(location.hash);
    if (params.theme === "dark" || params.theme === "light") document.documentElement.setAttribute("data-theme", params.theme);
    // The address is removed from the URL below, so keep it for this tab only (sessionStorage
    // is cleared when the tab closes) – otherwise a reload loses it (test C8).
    try {
      if (params.to) sessionStorage.setItem("rb-inbox", params.to);
      $("to").value = params.to || sessionStorage.getItem("rb-inbox") || "";
    } catch (e) { $("to").value = params.to || ""; }
    // Keep the address out of the visible URL and browser history once it is read.
    if (location.hash && history.replaceState) history.replaceState(null, "", location.pathname + location.search);
    loadDraft();

    FIELDS.forEach(function (n) {
      var el = $(n);
      el.addEventListener("input", update);
      if (n === "to") el.addEventListener("change", function () {
        try { sessionStorage.setItem("rb-inbox", el.value.trim()); } catch (e) { /* ignore */ }
      });
      el.addEventListener("change", function () { touched[n] = true; update(); });
      el.addEventListener("blur", function () { touched[n] = true; update(); });
    });
    $("form").addEventListener("submit", function (e) { e.preventDefault(); });
    $("send").addEventListener("click", trySend);
    $("copy").addEventListener("click", copy);
    $("clear").addEventListener("click", clearForm);
    if (params.to) touched.to = true; // show at once if the app passed a wrong address
    update();
  }

  start();
})();
