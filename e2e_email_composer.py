"""End-to-end tests for email-composer.html in Chromium. Run via tests/run_all.sh."""
import json, os, sys, urllib.parse
from playwright.sync_api import sync_playwright

BASE = os.environ.get("RB_BASE", "http://localhost:8765")
SHOTS = os.path.join(os.path.dirname(__file__), "screenshots")
os.makedirs(SHOTS, exist_ok=True)
INBOX = "rb7x2k9q@hook.us2.make.com"   # fake mailhook address for tests

# test-data/emails/A1_valid_recipe.txt, typed the way a cook would (bullets and numbers kept)
A1_ING = """- 2 cups cooked rice (day-old is best)
- 2 eggs
- 1 cup frozen peas and carrots
- 2 tbsp soy sauce
- 1 tbsp sesame oil
- 2 green onions, sliced"""
A1_STEPS = """1. Heat the sesame oil in a large pan over medium-high heat.
2. Add the peas and carrots and cook for 3 minutes.
3. Push everything to one side, scramble the eggs in the empty space.
4. Add the rice and soy sauce, stir-fry for 4 minutes, top with green onions."""
EXPECTED_BODY = """Category: dinner
Time: 15 mins   Serves: 2   Vegetarian: yes
Ingredients:
- 2 cups cooked rice (day-old is best)
- 2 eggs
- 1 cup frozen peas and carrots
- 2 tbsp soy sauce
- 1 tbsp sesame oil
- 2 green onions, sliced
Steps:
1. Heat the sesame oil in a large pan over medium-high heat.
2. Add the peas and carrots and cook for 3 minutes.
3. Push everything to one side, scramble the eggs in the empty space.
4. Add the rice and soy sauce, stir-fry for 4 minutes, top with green onions."""

results = []
def check(tid, name, cond, detail=""):
    results.append((tid, name, bool(cond), detail))
    print(("PASS " if cond else "FAIL ") + tid + " " + name + ((" – " + detail) if detail and not cond else ""))

def open_page(pg, u):
    pg.goto("about:blank"); pg.goto(u)

def fill_a1(pg):
    pg.fill("#title", "Weekday Veggie Fried Rice")
    pg.select_option("#category", "dinner")
    pg.fill("#minutes", "15"); pg.fill("#servings", "2")
    pg.check("#isVeg")
    pg.fill("#ingredients", A1_ING); pg.fill("#steps", A1_STEPS)

with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={"width": 1280, "height": 900}, permissions=["clipboard-read", "clipboard-write"])
    ctx.route(lambda u: "fonts.g" in u, lambda r: r.fulfill(status=200, content_type="text/css", body=""))
    page = ctx.new_page()
    errors = []
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.on("pageerror", lambda e: errors.append(str(e)))
    link = BASE + "/email-composer.html#to=" + urllib.parse.quote(INBOX, safe="") + "&theme=light"

    # C1 inbox from the app's Launch() link
    open_page(page, link)
    page.evaluate("localStorage.clear()"); open_page(page, link)
    check("C1", "Inbox address filled in from the link", page.input_value("#to") == INBOX)
    check("C1", "Address removed from the address bar after reading", "#" not in page.url and INBOX not in page.url, page.url)

    # C2 empty form: quiet until the cook tries to send
    check("C2", "No error messages before the cook types", page.locator(".err:not(:empty)").count() == 0)
    page.click("#send")
    shown = page.locator(".err:not(:empty)").count()
    check("C2", "Selecting send on an empty form shows the 6 field errors", shown == 6, f"shown={shown}")
    check("C2", "Focus moves to the first problem (recipe name)", page.evaluate("document.activeElement.id") == "title")
    check("C2", "Send link stays disabled", page.get_attribute("#send", "href") == "#")
    check("C2", "Error text matches the app", page.inner_text("#minutes-err") == "Enter the time in whole minutes (1 or more).")
    page.screenshot(path=os.path.join(SHOTS, "email_errors.png"), full_page=True)

    # C3 the A1 test recipe produces exactly the V7 template
    fill_a1(page)
    body = page.inner_text("#pvBody")
    check("C3", "Preview matches the template Scenario A expects", body == EXPECTED_BODY, body[:120])
    check("C3", "Status says ready, no warnings", page.inner_text("#status strong") == "Ready to send.")
    href = page.get_attribute("#send", "href")
    q = urllib.parse.parse_qs(urllib.parse.urlparse(href).query)
    check("C3", "mailto link: right inbox, subject and body", href.startswith("mailto:" + INBOX + "?")
          and q["subject"][0] == "Weekday Veggie Fried Rice" and q["body"][0].replace("\r\n", "\n") == EXPECTED_BODY)
    page.screenshot(path=os.path.join(SHOTS, "email_ready.png"), full_page=True)

    # C4 / C5 warnings never block sending
    page.fill("#ingredients", A1_ING + "\n- 1 tbsp fish sauce")
    st = page.inner_text("#status")
    check("C4", "Vegetarian conflict is a warning naming the ingredient", "“fish sauce”" in st and "Ready to send" in st, st)
    page.fill("#ingredients", A1_ING)
    page.fill("#note", "Text me on 416-555-0199 if it fails")
    check("C5", "Phone number triggers a privacy warning", "phone number" in page.inner_text("#status"))
    page.fill("#note", "")

    # C6 wrong inbox
    page.fill("#to", "khushi@gmail.com"); page.locator("#to").blur()
    check("C6", "A personal address is refused as the inbox", "not the recipe inbox" in page.inner_text("#to-err"))
    page.fill("#to", INBOX); page.locator("#to").blur()

    # C7 a long recipe: mailto would be cut, copy still works
    long_steps = "\n".join(f"{i}. Stir the pot slowly and taste for seasoning, adding a splash of water if it looks dry." for i in range(1, 26))
    page.fill("#steps", long_steps)
    check("C7", "Long recipe: send link disabled with an explanation",
          page.get_attribute("#send", "href") == "#" and "too long for an email link" in page.inner_text("#status"))
    page.click("#copy")
    clip = page.evaluate("navigator.clipboard.readText()")
    check("C7", "Copy email text puts the full body on the clipboard", clip.startswith("Category: dinner") and "25. Stir" in clip)
    page.fill("#steps", A1_STEPS)

    # C8 draft survives a reload; Start a new recipe clears it but keeps the inbox
    page.reload()
    check("C8", "Draft is kept after a reload", page.input_value("#title") == "Weekday Veggie Fried Rice" and page.is_checked("#isVeg"))
    check("C8", "Inbox address survives a reload in the same tab", page.input_value("#to") == INBOX, page.input_value("#to"))
    page.click("#clear")
    check("C8", "Start a new recipe clears the form, keeps the inbox",
          page.input_value("#title") == "" and page.input_value("#to") == INBOX)

    # C9 dark theme and phone layout
    open_page(page, link.replace("theme=light", "theme=dark"))
    bg = page.evaluate("getComputedStyle(document.body).backgroundColor")
    check("C9", "theme=dark uses the app's dark fill", bg == "rgb(28, 25, 23)", bg)
    m = browser.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
    m.route(lambda u: "fonts.g" in u, lambda r: r.fulfill(status=200, content_type="text/css", body=""))
    mp = m.new_page()
    open_page(mp, link)
    fill_a1(mp)
    sw = mp.evaluate("document.documentElement.scrollWidth")
    check("C9", "No sideways scrolling at 390 px", sw <= 390, f"scrollWidth={sw}")
    mp.screenshot(path=os.path.join(SHOTS, "email_phone.png"), full_page=True)
    m.close()

    check("C10", "No JavaScript or CSP errors in the console", not errors, "; ".join(errors[:3]))
    browser.close()

failed = [r for r in results if not r[2]]
print(f"\n{len(results) - len(failed)}/{len(results)} checks passed")
with open(os.path.join(os.path.dirname(__file__), "e2e_email_composer_results.json"), "w") as f:
    json.dump([{"id": a, "check": b, "pass": c, "detail": d} for a, b, c, d in results], f, indent=1)
sys.exit(1 if failed else 0)
