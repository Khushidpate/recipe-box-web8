"""Builds the HTML that the two Power Apps HTML text controls produce (BUILD_GUIDE_V8 Part C and D),
using the same string concatenation, so the markup can be checked in a browser before it is
pasted into Power Apps. Each block below follows its Power Fx formula line by line.

Run: python3 prototypes/build_prototypes.py   (writes recipe-card*.html, integration-chart*.html)
"""
import math, os, datetime

HERE = os.path.dirname(os.path.abspath(__file__))

def html_esc(s):  # = HtmlEsc() named formula: & first, then < > " '
    return (s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
             .replace('"', "&quot;").replace("'", "&#39;"))

def format_qty(a):  # = FormatQty()
    w = math.floor(a + 1e-9); r = a - w; p = f"{w} " if w > 0 else ""
    if r < 0.02: return str(w)
    if r > 0.98: return str(w + 1)
    for v, t in [(0.25, "1/4"), (1/3, "1/3"), (0.5, "1/2"), (2/3, "2/3"), (0.75, "3/4")]:
        if abs(r - v) <= 0.04: return p + t
    x = round(a + 1e-9, 1)
    return str(int(x)) if x == int(x) else str(x)

def theme(dark):  # = the With({...}) colour block shared by both formulas
    return dict(ink="#f5f5f4" if dark else "#292524", muted="#b5ada6" if dark else "#6b635c",
                paper="#262220" if dark else "#ffffff", line="#3d3733" if dark else "#e7dfd3",
                accent="#e0a06a" if dark else "#a6602b", note="#3a2e14" if dark else "#fdf1e0")

# ---------- Part C: htmlCard.HtmlText ----------
def recipe_card(r, n, dark=False):
    t = theme(dark); base = r["base"]
    ing = "".join("<li>" + html_esc(i["x"] if i["a"] is None else format_qty(i["a"] * n / base) + " " + i["x"]) + "</li>"
                  for i in r["ingredients"])
    steps = "".join("<li style='margin-bottom:8px'>" + html_esc(s) + "</li>" for s in r["steps"])
    meta = (html_esc(r["category"].title()) + " &middot; " + html_esc(r["time_label"]) + " &middot; serves " + str(n)
            + (" &middot; vegetarian" if r["veg"] else ""))
    return ("<div style='font-family:Segoe UI,Arial,sans-serif;color:" + t["ink"] + ";background:" + t["paper"]
        + ";border:1px solid " + t["line"] + ";border-radius:12px;padding:20px 24px;max-width:760px'>"
        + "<div style='font-size:24px;font-weight:700;line-height:1.25'>" + html_esc(r["title"]) + "</div>"
        + "<div style='color:" + t["muted"] + ";font-size:14px;margin:6px 0 14px'>" + meta + "</div>"
        + ("<p style='margin:0 0 16px;font-size:15px;line-height:1.5'>" + html_esc(r["blurb"]) + "</p>" if r["blurb"] else "")
        + "<table role='presentation' style='width:100%;border-collapse:collapse'><tr>"
        + "<td style='vertical-align:top;width:38%;padding:0 20px 0 0'>"
        + "<div style='font-weight:700;color:" + t["accent"] + ";margin-bottom:6px'>Ingredients</div>"
        + "<ul style='margin:0;padding-left:18px;font-size:15px;line-height:1.6'>" + ing + "</ul></td>"
        + "<td style='vertical-align:top;border-left:1px solid " + t["line"] + ";padding:0 0 0 20px'>"
        + "<div style='font-weight:700;color:" + t["accent"] + ";margin-bottom:6px'>Method</div>"
        + "<ol style='margin:0;padding-left:20px;font-size:15px;line-height:1.5'>" + steps + "</ol></td></tr></table>"
        + ("<div style='margin-top:16px;padding:8px 12px;border-left:4px solid #b45309;background:" + t["note"]
           + ";font-size:13px'>Contains (AI-suggested, checked by a reviewer): " + html_esc(r["allergens"])
           + ". Always check labels yourself.</div>" if r["allergens"] else "")
        + ("<div style='margin-top:12px;font-size:12px;color:" + t["muted"] + "'>Source: " + html_esc(r["source"]) + "</div>"
           if r["source"].startswith("https://") else "")
        + "</div>")

# ---------- Part D: colChart (OnVisible) + htmlChart.HtmlText ----------
def chart_rows(log, today):
    rows = []
    for s in range(1, 8):  # ForAll(Sequence(7) As s, ... DateAdd(Today(), s.Value - 7, Days))
        d0 = today + datetime.timedelta(days=s - 7)
        day = [x for x in log if d0 <= x["on"].date() < d0 + datetime.timedelta(days=1)]
        rows.append(dict(DayStart=d0,
                         Ok=sum(x["status"] in ("success", "duplicate") for x in day),
                         Warn=sum(x["status"] in ("partial", "rejected", "stale") for x in day),
                         Bad=sum(x["status"] in ("failed", "unauthorized") for x in day)))
    return rows

def chart(rows, dark=False):
    t = theme(dark); h = 120
    mx = max(max(r["Ok"] + r["Warn"] + r["Bad"] for r in rows), 1)
    def bar(v, color):  # If(v > 0, "<div style='height:" & Max(Round(v / mx * h, 0), 3) & "px;...'></div>", "")
        return "<div style='height:" + str(max(round(v / mx * h), 3)) + "px;background:" + color + "'></div>" if v > 0 else ""
    cells = "".join(
        "<td style='vertical-align:bottom;text-align:center;height:" + str(h + 24) + "px;padding:0 6px;border-bottom:1px solid " + t["line"] + "'>"
        + "<div style='font-size:12px;color:" + t["muted"] + ";margin-bottom:3px'>" + str(r["Ok"] + r["Warn"] + r["Bad"]) + "</div>"
        + bar(r["Bad"], "#dc2626") + bar(r["Warn"], "#d97706") + bar(r["Ok"], "#16a34a")
        + ("<div style='height:2px;background:" + t["line"] + "'></div>" if r["Ok"] + r["Warn"] + r["Bad"] == 0 else "")
        + "</td>" for r in rows)
    days = "".join("<td style='text-align:center;font-size:12px;color:" + t["muted"] + ";padding-top:6px'>"
                   + r["DayStart"].strftime("%a %-d") + "</td>" for r in rows)
    key = lambda c, label: ("<span style='display:inline-block;width:10px;height:10px;background:" + c
                            + ";margin:0 5px 0 14px;vertical-align:middle'></span>" + label)
    return ("<div style='font-family:Segoe UI,Arial,sans-serif;color:" + t["ink"] + "'>"
        + "<table role='presentation' style='width:100%;border-collapse:collapse;table-layout:fixed'><tr>" + cells + "</tr>"
        + "<tr>" + days + "</tr></table>"
        + "<div style='font-size:12px;color:" + t["muted"] + ";margin-top:10px'>"
        + key("#16a34a", "OK").replace("margin:0 5px 0 14px", "margin:0 5px 0 0") + key("#d97706", "Needs a look") + key("#dc2626", "Failed")
        + "</div></div>")

# ---------- sample data (from lcnc-data and test-data) ----------
EGGS = dict(title="Herb & Cheese Skillet Eggs", category="breakfast", time_label="10 mins", veg=True, base=2,
            blurb="Ten minutes, one pan, and whatever herbs are still alive on your windowsill.",
            ingredients=[{"a": 4, "x": "eggs"}, {"a": 0.25, "x": "cup grated cheese"}, {"a": 2, "x": "tbsp chopped soft herbs"},
                         {"a": 1, "x": "tbsp butter"}, {"a": None, "x": "salt and pepper"}],
            steps=["Melt butter in a skillet over medium-low heat.", "Whisk eggs with salt and pepper, pour into the skillet.",
                   "Sprinkle cheese and herbs as the eggs set.", "Fold gently and remove while still soft. Serve at once."],
            allergens="eggs, milk", source="")
HOSTILE = dict(EGGS, title="Mac 'n' <b>Cheese</b> & \"Peas\" <script>alert(1)</script>",
               steps=["Boil <img src=x onerror=alert(1)> water."], allergens="", source="javascript:alert(1)")

def page(title, body, dark=False):
    bg = "#1c1917" if dark else "#fffbf5"
    return ("<!doctype html><html lang='en'><head><meta charset='utf-8'><meta name='viewport' content='width=device-width, initial-scale=1'>"
            "<title>" + title + "</title></head><body style='margin:0;padding:24px;background:" + bg + "'>"
            "<!-- Generated by build_prototypes.py: the same string the Power Apps HTML text control receives. -->\n"
            + body + "</body></html>")

if __name__ == "__main__":
    today = datetime.date(2026, 11, 13)
    def at(days_ago, status): return {"on": datetime.datetime.combine(today - datetime.timedelta(days=days_ago), datetime.time(6, 2)), "status": status}
    log = ([at(6, "success"), at(6, "success"), at(5, "success"), at(5, "duplicate"), at(5, "success"),
            at(4, "partial"), at(4, "success"), at(3, "failed"), at(3, "failed"), at(3, "success"),
            at(1, "success"), at(1, "rejected"), at(1, "success"), at(1, "success"), at(0, "success"), at(0, "success")])
    rows = chart_rows(log, today)
    out = {
        "recipe-card.html": page("Recipe card prototype", recipe_card(EGGS, 4)),
        "recipe-card-dark.html": page("Recipe card prototype (dark)", recipe_card(EGGS, 4, True), True),
        "recipe-card-hostile.html": page("Recipe card escaping test", recipe_card(HOSTILE, 2)),
        "integration-chart.html": page("Integration chart prototype", chart(rows)),
        "integration-chart-dark.html": page("Integration chart prototype (dark)", chart(rows, True), True),
        "integration-chart-empty.html": page("Integration chart, no runs", chart(chart_rows([], today))),
    }
    for name, html in out.items():
        with open(os.path.join(HERE, name), "w", encoding="utf-8") as f: f.write(html)
    print("rows:", [(r["DayStart"].isoformat(), r["Ok"], r["Warn"], r["Bad"]) for r in rows])
    print("wrote", ", ".join(out))
