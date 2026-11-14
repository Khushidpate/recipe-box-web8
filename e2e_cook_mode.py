"""End-to-end tests for cook-mode.html in a real Chromium browser.

Run from the web/ folder:
    python3 -m http.server 8765 &        # serve the pages (CSP 'self' needs http://, not file://)
    python3 tests/e2e_cook_mode.py
Needs: pip install playwright && playwright install chromium
"""
import json, sys, urllib.parse, os
from playwright.sync_api import sync_playwright

BASE = os.environ.get("RB_BASE", "http://localhost:8765")
SHOTS = os.path.join(os.path.dirname(__file__), "screenshots")
os.makedirs(SHOTS, exist_ok=True)

# Exactly the shape Power Fx JSON() produces for the payload in BUILD_GUIDE_V8 (B2).
EGGS = {"v": 1, "t": "Herb & Cheese Skillet Eggs", "b": 2, "s": 2, "u": "serving",
        "i": [{"a": 4, "x": "eggs"}, {"a": 0.25, "x": "cup grated cheese"},
              {"a": 2, "x": "tbsp chopped soft herbs"}, {"a": 1, "x": "tbsp butter"},
              {"a": None, "x": "salt and pepper"}],
        "st": [{"x": "Melt butter in a skillet over medium-low heat."},
               {"x": "Whisk eggs with salt and pepper, pour into the skillet and cook for 3 minutes."},
               {"x": "Sprinkle cheese and herbs <img src=x onerror=alert(1)> as the eggs set."},
               {"x": "Fold gently and remove while still soft. Serve at once."}],
        "src": "", "dark": False}

def url(payload):
    # Power Fx EncodeUrl() percent-encodes like encodeURIComponent
    return BASE + "/cook-mode.html#data=" + urllib.parse.quote(json.dumps(payload, separators=(",", ":")), safe="")

def open_page(pg, u):
    pg.goto("about:blank")   # a fresh load, not a same-page hash change
    pg.goto(u)

results = []
def check(tid, name, cond, detail=""):
    results.append((tid, name, bool(cond), detail))
    print(("PASS " if cond else "FAIL ") + tid + " " + name + ((" – " + detail) if detail and not cond else ""))

with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={"width": 1280, "height": 820})
    # The sandbox/CI has no internet: answer Google Fonts with an empty stylesheet so
    # only real page errors reach the console check (the page falls back to system fonts).
    ctx.route(lambda u: "fonts.googleapis.com" in u or "fonts.gstatic.com" in u,
              lambda r: r.fulfill(status=200, content_type="text/css", body=""))
    page = ctx.new_page()
    errors = []
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.on("pageerror", lambda e: errors.append(str(e)))
    dialogs = []
    page.on("dialog", lambda d: (dialogs.append(d.message), d.dismiss()))

    # E1 empty state and sample recipe
    page.goto(BASE + "/cook-mode.html")
    check("E1", "No recipe in the link shows the help screen", page.is_visible("#empty") and not page.is_visible("#cook"))
    page.click("#sampleLink")
    page.wait_for_selector("#cook:not([hidden])")
    check("E1", "Sample recipe link opens Cook Mode", page.inner_text("#title") == "Weekday Veggie Fried Rice")

    # E2 Power Fx payload, ampersand title, HTML in step text stays text
    page.clock.install()
    open_page(page, url(EGGS))
    page.wait_for_selector("#cook:not([hidden])")
    check("E2", "Title with & renders correctly", page.inner_text("#title") == "Herb & Cheese Skillet Eggs")
    page.evaluate("localStorage.clear()"); page.reload(); page.wait_for_selector("#cook:not([hidden])")
    check("E2", "Step 1 shown with progress", page.inner_text("#progressText") == "Step 1 of 4")
    page.keyboard.press("ArrowRight"); page.keyboard.press("ArrowRight")
    step3 = page.inner_text("#stepText")
    check("E2", "HTML inside step text is shown as text, not run", "<img src=x" in step3 and page.locator("#stepText img").count() == 0 and not dialogs)
    page.keyboard.press("ArrowLeft")

    # E3 scaling
    ings = page.locator("#ingList li").all_inner_texts()
    check("E3", "2 servings: 4 eggs, 1/4 cup", ings[0] == "4 eggs" and ings[1] == "1/4 cup grated cheese", str(ings))
    page.click("#more"); page.click("#more")
    ings = page.locator("#ingList li").all_inner_texts()
    check("E3", "4 servings: 8 eggs, 1/2 cup, untouched 'salt and pepper'",
          ings[0] == "8 eggs" and ings[1] == "1/2 cup grated cheese" and ings[4] == "salt and pepper", str(ings))
    page.click("#more")
    check("E3", "5 servings: 1/4 cup x 2.5 -> 0.6 (FormatQty rounding)", page.locator("#ingList li").nth(1).inner_text() == "0.6 cup grated cheese",
          page.locator("#ingList li").nth(1).inner_text())
    page.click("#less")

    # E4 timers
    check("E4", "Step 2 shows a timer button for '3 minutes'", page.locator(".timer-word").inner_text().startswith("3 minutes"))
    page.screenshot(path=os.path.join(SHOTS, "cook_desktop_step2.png"))
    page.click(".timer-word")
    check("E4", "Timer chip appears at 3:00", page.inner_text(".chip strong") == "3:00", page.inner_text(".chip strong"))
    page.clock.run_for(61_000)
    check("E4", "After 61 s the timer shows 1:59", page.inner_text(".chip strong") == "1:59", page.inner_text(".chip strong"))
    page.click(".chip button[aria-label='Pause timer']")
    page.clock.run_for(30_000)
    check("E4", "Paused timer does not move", page.inner_text(".chip strong") == "1:59", page.inner_text(".chip strong"))
    page.click(".timer-word")  # tapping the time again resumes
    page.keyboard.press("ArrowRight")
    check("E4", "Timer keeps running on the next step", page.locator(".chip").count() == 1)
    page.clock.run_for(120_000)
    check("E4", "Timer finishes: chip says Done, tab title shows alarm",
          page.inner_text(".chip strong") == "Done" and page.title().startswith("⏰"), page.title())
    page.screenshot(path=os.path.join(SHOTS, "cook_desktop_timer_done.png"))
    page.click(".chip button[aria-label='Dismiss timer']")
    check("E4", "Dismissed timer disappears and the title resets", page.locator(".chip").count() == 0 and not page.title().startswith("⏰"))

    # E5 finish and restart
    page.keyboard.press("ArrowRight"); page.click("#next")
    check("E5", "Finish shows the done screen", page.is_visible("#doneView") and "Enjoy your Herb & Cheese Skillet Eggs" in page.inner_text("#doneTitle"))
    page.click("#restart")
    check("E5", "Start over returns to step 1", page.inner_text("#progressText") == "Step 1 of 4")

    # E6 progress is remembered on reload
    page.locator("#ingList input").nth(0).check(); page.keyboard.press("ArrowRight")
    page.reload(); page.wait_for_selector("#cook:not([hidden])")
    check("E6", "Reload keeps the step and ticked ingredients",
          page.inner_text("#progressText") == "Step 2 of 4" and page.locator("#ingList input").nth(0).is_checked()
          and "1 of 5 ready" in page.inner_text("#ingSummary"))

    # E7 broken links
    open_page(page, BASE + "/cook-mode.html#data=%7Bbroken")
    check("E7", "Damaged link explains what to do", "damaged" in page.inner_text("#emptyMsg"))
    open_page(page, url({**EGGS, "st": []}))
    check("E7", "Recipe without steps explains what to do", "no steps" in page.inner_text("#emptyMsg"))

    # E8 dark theme from the app's varDark
    open_page(page, url({**EGGS, "dark": True})); page.wait_for_selector("#cook:not([hidden])")
    bg = page.evaluate("getComputedStyle(document.body).backgroundColor")
    check("E8", "dark=true uses the app's dark fill RGBA(28,25,23)", bg == "rgb(28, 25, 23)", bg)
    page.screenshot(path=os.path.join(SHOTS, "cook_desktop_dark.png"))

    # E9 phone layout
    m = browser.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
    m.route(lambda u: "fonts.g" in u, lambda r: r.fulfill(status=200, content_type="text/css", body=""))
    mp = m.new_page()
    mp.goto(url(EGGS)); mp.wait_for_selector("#cook:not([hidden])")
    sw = mp.evaluate("document.documentElement.scrollWidth")
    check("E9", "No sideways scrolling at 390 px", sw <= 390, f"scrollWidth={sw}")
    check("E9", "Ingredients collapse on a phone", not mp.evaluate("document.getElementById('ingPanel').open"))
    mp.tap("#next")
    mp.screenshot(path=os.path.join(SHOTS, "cook_phone_step2.png"))
    m.close()

    check("E10", "No JavaScript or CSP errors in the console", not errors, "; ".join(errors[:3]))
    browser.close()

failed = [r for r in results if not r[2]]
print(f"\n{len(results) - len(failed)}/{len(results)} checks passed")
with open(os.path.join(os.path.dirname(__file__), "e2e_cook_mode_results.json"), "w") as f:
    json.dump([{"id": a, "check": b, "pass": c, "detail": d} for a, b, c, d in results], f, indent=1)
sys.exit(1 if failed else 0)
