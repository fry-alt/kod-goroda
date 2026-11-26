"""Скриншоты прототипа для слайдов (docs/presentation/shots/*.jpg). Локальный API на :8000.
    python3 docs/presentation/shots.py
"""
import time
from pathlib import Path
from playwright.sync_api import sync_playwright

OUT = Path(__file__).resolve().parent / "shots"; OUT.mkdir(exist_ok=True)
B = "http://localhost:8000"
CSS = "*{animation:none!important;transition:none!important}.rise{opacity:1!important}::-webkit-scrollbar{width:0;height:0}"


def save(p, name, sel=None, clip=None):
    tmp = OUT / (name + ".png")
    if sel: p.locator(sel).first.screenshot(path=str(tmp))
    else: p.screenshot(path=str(tmp), clip=clip)
    from PIL import Image
    im = Image.open(tmp).convert("RGB"); im.thumbnail((1800, 1800)); im.save(OUT / (name + ".jpg"), quality=84); tmp.unlink()


def go(p, url, wait):
    p.goto(B + url); p.wait_for_selector(wait, timeout=20000); p.add_style_tag(content=CSS); time.sleep(1.2)


with sync_playwright() as pw:
    br = pw.chromium.launch(channel="chrome")
    d = br.new_context(viewport={"width": 1440, "height": 900}, device_scale_factor=2, locale="ru-RU"); p = d.new_page()
    import sys
    if "rest" not in sys.argv:
      go(p, "/index.html#/", "#heat table"); p.add_style_tag(content="#askbtn{display:none!important}")
      save(p, "hr_home")
      save(p, "hr_heat", "#heatBox")
      go(p, "/index.html#/intern/%D0%A1%D0%A2-002", "#tabBody .sum"); p.add_style_tag(content="#askbtn{display:none!important}")
      save(p, "hr_card")
      p.click("#aHF"); time.sleep(0.8); save(p, "hr_huntflow", "#dlg"); p.locator("#dlg [data-x]").first.click(); time.sleep(0.4)
    go(p, "/index.html?r=chat#/", "#heat table")
    p.click("#askbtn"); time.sleep(0.5); p.fill("#chatq", "Кто требует внимания и почему?"); p.press("#chatq", "Enter")
    time.sleep(9); save(p, "hr_chat", "#chat")
    go(p, "/index.html?mock=4#/talent", ".ht-box"); p.add_style_tag(content="#askbtn{display:none!important}")
    save(p, "hr_talent", ".ht-two")
    go(p, "/report.html?tpl=program&period=4", "#sheet .dh"); save(p, "hr_report")
    d.close()

    m = br.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, locale="ru-RU", is_mobile=True, has_touch=True); p = m.new_page()
    go(p, "/intern.html?id=%D0%A1%D0%A2-002", ".guide"); save(p, "in_home")
    p.locator("[data-act=chat]").first.click(); p.wait_for_selector("#askq"); time.sleep(0.4)
    p.fill("#askq", "Где получить пропуск?"); p.press("#askq", "Enter"); time.sleep(6); save(p, "in_cube")
    go(p, "/intern.html?id=%D0%A1%D0%A2-002#steps", ".wrap"); save(p, "in_steps")
    m.close(); br.close()
print(sorted(x.name for x in OUT.glob("*.jpg")))
