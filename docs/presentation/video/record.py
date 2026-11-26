"""Запись скринкаста демо «Радар стажировки» (Playwright, headless Chromium).

Сцены пишутся отдельными роликами webm в video/raw/, тайминги — в video/raw/cuts.json;
монтаж, титры и музыка — video/build.sh (ffmpeg).
Перед записью: локальный API на :8000 в исходном состоянии (`python -m feedback.store --reset` + перезапуск);
после — снова сброс (сцена 1 отправляет тестовый ответ СТ-002 за Месяц 6).

    python3 docs/presentation/video/record.py
"""
import json, subprocess, sys, time
from pathlib import Path
from playwright.sync_api import sync_playwright

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
RAW = HERE / "raw"; RAW.mkdir(exist_ok=True)
BASE = "http://localhost:8000"
W, H = 1286, 810
PY = str(REPO / ".venv/bin/python")
FF = "/Users/tematarasov/Library/Python/3.9/lib/python/site-packages/imageio_ffmpeg/binaries/ffmpeg-macos-aarch64-v7.1"
CUR = None


def sleep(sec):  # ждём через Playwright, чтобы приходили кадры скринкаста
    CUR.page.wait_for_timeout(int(sec * 1000))

INJECT = r"""
(() => {
  const css = `
  #__cap{pointer-events:none;position:fixed;left:50%;top:18px;margin-left:-470px;width:940px;z-index:99999;max-width:980px;background:rgba(19,64,116,.95);color:#fff;
    border-radius:20px;padding:18px 26px;font:500 25px/1.3 MTSText,Arial,sans-serif;box-shadow:0 16px 44px rgba(0,0,0,.28);
    transform:translateY(-24px);opacity:0;transition:transform .45s cubic-bezier(.2,.8,.2,1),opacity .35s}
  #__cap.on{transform:none;opacity:1}
  #__cap b{display:block;font:900 15px MTSExtended,Arial,sans-serif;color:#8fd0ff;letter-spacing:.08em;text-transform:uppercase;margin-bottom:6px}
  #__cur{position:fixed;left:0;top:0;z-index:100000;pointer-events:none;will-change:transform}
  #__cur svg{display:block;filter:drop-shadow(0 2px 3px rgba(0,0,0,.4))}
  #__ring{position:fixed;z-index:99999;width:46px;height:46px;margin:-23px 0 0 -23px;border-radius:50%;border:3px solid #FF7654;pointer-events:none;opacity:0}
  #__ring.go{animation:__p .55s ease-out}
  @keyframes __p{from{transform:scale(.3);opacity:1}to{transform:scale(1.5);opacity:0}}
  #chatFab{display:none!important}
  ::-webkit-scrollbar{width:0;height:0}`;
  const add = () => {
    if(document.getElementById('__cap')) return;
    const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
    const cap = document.createElement('div'); cap.id = '__cap'; document.body.appendChild(cap);
    const cur = document.createElement('div'); cur.id = '__cur';
    cur.innerHTML = '<svg width="28" height="34" viewBox="0 0 28 34"><path d="M2 2 L2 27 L8.5 21 L13 31 L17.5 29 L13 19.5 L22 19.5 Z" fill="#fff" stroke="#134074" stroke-width="2.2" stroke-linejoin="round"/></svg>';
    document.body.appendChild(cur);
    const ring = document.createElement('div'); ring.id = '__ring'; document.body.appendChild(ring);
    const p = window.__curPos || [W0, H0]; cur.style.transform = `translate(${p[0]}px,${p[1]}px)`;
    addEventListener('mousemove', e => { window.__curPos = [e.clientX, e.clientY]; cur.style.transform = `translate(${e.clientX}px,${e.clientY}px)`; }, true);
  };
  if(document.readyState === 'loading') addEventListener('DOMContentLoaded', add); else add();
})();
""".replace("W0", str(W // 2)).replace("H0", str(H // 2))


class Scene:
    def __init__(self, browser, name):
        self.name = name
        self.ctx = browser.new_context(viewport={"width": W, "height": H}, device_scale_factor=1, locale="ru-RU")
        self.ctx.add_init_script(INJECT)
        self.t0 = time.time()
        self.page = self.ctx.new_page()
        global CUR; CUR = self
        # кадры через CDP-скринкаст (встроенная запись Playwright тут не работает)
        self.dir = RAW / name; self.dir.mkdir(parents=True, exist_ok=True); self.frames = []
        self.cdp = self.ctx.new_cdp_session(self.page)
        def on_frame(ev):
            k = len(self.frames); f = self.dir / f"f{k:05d}.jpg"
            import base64; f.write_bytes(base64.b64decode(ev["data"]))
            self.frames.append((ev["metadata"]["timestamp"] - self.t0, f.name))
            try: self.cdp.send("Page.screencastFrameAck", {"sessionId": ev["sessionId"]})
            except Exception: pass
        self.cdp.on("Page.screencastFrame", on_frame)
        self.cdp.send("Page.startScreencast", {"format": "jpeg", "quality": 88, "maxWidth": W, "maxHeight": H, "everyNthFrame": 1})
        self.marks = {}
        self.pos = (W // 2, H // 2)

    def mark(self, k): self.marks[k] = round(time.time() - self.t0, 2)

    def cap(self, title, text, hold=0.0):
        self.page.evaluate("""([t, x]) => { const c = document.getElementById('__cap'); if(!c) return;
            c.classList.remove('on'); setTimeout(() => { c.innerHTML = '<b>' + t + '</b>' + x; c.classList.add('on'); }, 180); }""", [title, text])
        if hold: sleep(hold)

    def uncap(self): self.page.evaluate("() => document.getElementById('__cap')?.classList.remove('on')")

    def move_to(self, x, y, steps=28):
        self.page.mouse.move(x, y, steps=steps); self.pos = (x, y)

    def box(self, sel):
        el = self.page.locator(sel).first; el.scroll_into_view_if_needed(timeout=4000)
        b = el.bounding_box(); return el, b

    def hover(self, sel, dx=0.5, dy=0.5):
        el, b = self.box(sel); self.move_to(b["x"] + b["width"] * dx, b["y"] + b["height"] * dy); return el

    def click(self, sel, pause=0.35):
        el = self.hover(sel); sleep(pause)
        self.page.evaluate("""([x, y]) => { const r = document.getElementById('__ring'); if(!r) return; r.style.left = x + 'px'; r.style.top = y + 'px';
            r.classList.remove('go'); void r.offsetWidth; r.classList.add('go'); }""", list(self.pos))
        el.click(); sleep(0.25)

    def scroll(self, dy, steps=12, pause=0.03):
        for _ in range(steps): self.page.mouse.wheel(0, dy / steps); sleep(pause)

    def calm(self):  # без анимации появления разделов: в ролике она выглядит как мигание
        self.page.add_style_tag(content=".rise{animation:none!important;opacity:1!important}")

    def close(self):
        self.mark("end"); sleep(0.3)
        try: self.cdp.send("Page.stopScreencast")
        except Exception: pass
        self.ctx.close()
        # склейка кадров в ролик с реальными интервалами
        fr = self.frames; lines = ["ffconcat version 1.0"]
        for k, (t, f) in enumerate(fr):
            nxt = fr[k + 1][0] if k + 1 < len(fr) else self.marks["end"]
            dur = max(0.001, nxt - (0 if k == 0 else t))
            lines += [f"file {f}", f"duration {dur:.3f}"]
        lines.append(f"file {fr[-1][1]}")
        (self.dir / "list.txt").write_text("\n".join(lines))
        out = self.dir / "clip.mp4"
        subprocess.run([FF, "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", str(self.dir / "list.txt"),
                        "-vf", "scale=1440:810:force_original_aspect_ratio=decrease,pad=1440:810:(ow-iw)/2:(oh-ih)/2:white,fps=30,format=yuv420p", "-c:v", "libx264", "-crf", "16", "-preset", "veryfast", str(out)], check=True)
        return {"name": self.name, "file": str(out.relative_to(HERE)), "frames": len(fr), **self.marks}


def send_demo_answer():
    return subprocess.Popen([PY, "tools/send_test_answer.py", "demo"], cwd=REPO, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def main():
    want = set(sys.argv[1:]) or {"s1", "s2", "s3"}
    old = json.loads((RAW / "cuts.json").read_text()) if (RAW / "cuts.json").exists() else []
    cuts = [c for c in old if c["name"][:2] not in want]
    with sync_playwright() as pw:
        br = pw.chromium.launch(channel="chrome", args=[f"--window-size={W},{H + 140}"])
        # ---------- 1. Живой ответ → дашборд обновился сам → карточка → основания → Huntflow ----------
        if "s1" in want: scene1(br, cuts)
        if "s2" in want: scene2(br, cuts)
        if "s3" in want: scene3(br, cuts)
        br.close()
    cuts.sort(key=lambda c: c["name"])
    (RAW / "cuts.json").write_text(json.dumps(cuts, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps(cuts, ensure_ascii=False, indent=1))


def scene1(br, cuts):
        s = Scene(br, "s1_live"); p = s.page
        p.goto(BASE + "/index.html?r=v1#/"); p.wait_for_selector("#heat table", timeout=15000); s.calm(); sleep(1.2)
        s.mark("start")
        s.cap("Месяц 6 · дашборд HR", "Все пять стажёров в норме. Анкеты приходят сами — HR ничего не выгружает", hold=3.2)
        s.hover("#heatBox h2", 0.3, 0.5); sleep(0.6)
        s.cap("Новый ответ из формы", "Стажёр СТ-002 повторно прошёл пульс-опрос: нагрузка 2 из 5 и тревожный комментарий")
        proc = send_demo_answer(); s.mark("sent")
        try: p.wait_for_function("() => /СТ-002/.test(document.getElementById('toast')?.innerText || '')", timeout=15000)
        except Exception: pass
        s.mark("toast"); sleep(0.6)
        s.cap("Через 5 секунд — без перезагрузки", "Ответ привязан к СТ-002 и Месяцу 6, история и анализ пересчитаны: светофор — «Критично»", hold=4.2)
        proc.wait(timeout=10)
        p.evaluate("scrollTo({top:0, behavior:'smooth'})"); sleep(0.8)
        s.click(".hero .cta a.btn"); p.wait_for_selector("#tabBody .sum", timeout=10000); sleep(0.8)
        s.mark("card")
        s.hover("#tabBody .sum", 0.15, 0.5)
        s.cap("Почему он в зоне внимания", "Вывод одной фразой: нагрузка — это отмечают и стажёр, и наставник", hold=3.6)
        s.hover("#tabBody .sig", 0.3, 0.12); s.scroll(260, steps=14); sleep(0.4)
        s.cap("Основания вывода", "Конкретные оценки и цитаты из анкет обеих сторон — ИИ не «чёрный ящик»", hold=4.0)
        s.click("#tabBody .rev .lnk"); sleep(1.0)
        p.evaluate("document.querySelector('.chartbox')?.scrollIntoView({block:'center', behavior:'smooth'})"); sleep(0.8)
        s.hover(".chartbox", 0.85, 0.6)
        s.cap("Динамика по 6 месяцам", "Комфортность нагрузки упала с 5 до 2 — месяцы-основания выделены", hold=3.8)
        p.evaluate("scrollTo({top:0, behavior:'smooth'})"); sleep(0.7)
        s.click("#aHF"); sleep(0.9)
        s.cap("Действие HR", "Комментарий и метки — в карточку кандидата в Huntflow в один клик", hold=3.4)
        s.click("#dlg [data-x]"); sleep(0.4)
        p.evaluate("location.hash = '#/'")
        p.wait_for_selector("#heat table", timeout=10000); s.calm(); sleep(0.4)
        p.evaluate("document.getElementById('heatBox').scrollIntoView({block:'start', behavior:'smooth'})"); sleep(0.9)
        s.hover("#heat tr:nth-child(4) td:nth-child(4) .hc")
        s.cap("Светофор по месяцам", "На истории кейса система поймала бы каждый эпизод в тот же месяц", hold=4.0)
        s.uncap(); sleep(0.4)
        cuts.append(s.close())

def scene2(br, cuts):
        s = Scene(br, "s2_report"); p = s.page
        p.goto(BASE + "/report.html?tpl=program&period=4&r=v1"); p.wait_for_selector("#sheet .dh", timeout=15000); sleep(1.2)
        s.mark("start")
        s.hover(".fmt[data-fmt=xlsx]")
        s.cap("Отчёты для HR", "Шаблоны: программа, подразделение, статус, стажёр — в PDF, Excel, PowerPoint и CSV", hold=2.4)
        s.hover(".fmt[data-fmt=pptx]"); sleep(0.6)
        s.scroll(420, steps=16); sleep(1.6)
        cuts.append(s.close())

def scene3(br, cuts):
        s = Scene(br, "s3_intern"); p = s.page
        p.goto(BASE + "/intern.html?id=%D0%A1%D0%A2-001&r=v1"); p.wait_for_load_state("networkidle"); sleep(1.2)
        s.mark("start")
        s.cap("Кабинет стажёра", "Памятка, шаги адаптации, команда и обратная связь — с телефона", hold=2.2)
        s.click("[data-act=chat]"); p.wait_for_selector("#askq", timeout=8000); sleep(0.5)
        s.cap("Куб — гид по адаптации", "Отвечает по базе знаний программы и показывает источник")
        s.click("#askq"); p.keyboard.type("где получить пропуск?", delay=55); sleep(0.3)
        p.keyboard.press("Enter"); sleep(3.2)
        s.uncap(); sleep(0.6)
        cuts.append(s.close())


if __name__ == "__main__":
    main()
