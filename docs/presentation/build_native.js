// Редактируемая PPTX-версия deck.html: живой текст, нативные фигуры и таблица, брендбук МГТС.
//   cd docs/presentation && node build_native.js  → out/Радар_стажировки_МГТС.pptx
// Подставляется автоматически при повторном запуске, если файл появился:
//   demo.mp4 (+ shots/demo_poster.png как обложка) — видео на слайде 4;
//   shots/overview.png, shots/card.png — скриншоты на слайде 5.
// Заметки докладчика берутся из объекта NOTES в build_pptx.js (править там).
// Шрифты MTS (web/brand/fonts) должны быть установлены в системе у того, кто открывает файл.
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const pptxgen = require("pptxgenjs");
const JSZip = require("jszip");
const sizeOf = require("image-size").imageSize || require("image-size");

const DIR = __dirname;
const IMG = path.join(DIR, "img");
const BRAND = path.join(DIR, "..", "..", "web", "brand");
const OUT = path.join(DIR, "out", "Радар_стажировки_МГТС.pptx");
const p = (...a) => path.join(...a);

// ---------- бренд ----------
const C = {
  white: "FFFFFF", blue: "008AE0", navy: "134074", navy2: "102C51", orange: "FF7654",
  soft: "F2F7FC", line: "D9E5F1", mut: "5E7A99", onBlue: "EAF4FD",
  red: "E5484D", yellow: "F5A623", green: "2BAE66", // светофор (как в deck.html)
};
const F = {
  black: "MTS Extended Black",       // заголовки
  light: "MTS UltraExtended Light",  // лёгкая вторая строка заголовка
  num: "MTS Extended Medium",        // крупные числа, ссылки
  ext: "MTS Extended",               // подзаголовки (Bold)
  text: "MTS Text",                  // текст (Regular / Bold)
  textMed: "MTS Text Medium",
};
const W = 13.333, H = 7.5, ML = 0.833, CW = W - 2 * ML; // поля 120 px из deck.html

// ---------- заметки из build_pptx.js ----------
function loadNotes() {
  const src = fs.readFileSync(p(DIR, "build_pptx.js"), "utf8");
  const m = src.match(/const NOTES\s*=\s*(\{[\s\S]*?\n\});/);
  if (!m) throw new Error("NOTES не найден в build_pptx.js");
  return vm.runInNewContext("(" + m[1] + ")");
}
const NOTES = loadNotes();

// ---------- презентация, тема, макеты ----------
const pres = new pptxgen();
pres.layout = "LAYOUT_WIDE";
pres.title = "Радар стажировки — МГТС «Код города»";
pres.author = "Команда «Радар стажировки»";
pres.company = "МГТС";
pres.theme = { headFontFace: "MTS Extended", bodyFontFace: "MTS Text" };

const TITLE_PH = (o) => ({
  placeholder: {
    options: { name: "title", type: "title", x: ML, y: 0.7, w: 11.2, h: 1.4, margin: 0, valign: "top",
               fontFace: F.black, fontSize: 28, color: C.blue, lineSpacingMultiple: 0.95, align: "left", ...o },
    text: "",
  },
});

pres.defineSlideMaster({
  title: "MGTS Cover",
  background: { path: p(IMG, "cover.png") },
  objects: [TITLE_PH({ y: 1.0, w: 7.8, h: 1.5, fontSize: 48, color: C.white })],
});
pres.defineSlideMaster({
  title: "MGTS Content",
  background: { color: C.white },
  objects: [
    { image: { path: p(BRAND, "logos", "logo1.png"), x: ML, y: 6.806, w: 0.444, h: 0.444, altText: "МГТС" } },
    TITLE_PH(),
  ],
  slideNumber: { x: W - ML - 0.8, y: 6.9, w: 0.8, h: 0.3, align: "right", valign: "middle", margin: 0,
                 fontFace: F.text, fontSize: 11, color: C.mut },
});
pres.defineSlideMaster({
  title: "MGTS Final",
  background: { color: C.blue },
  objects: [
    { image: { path: p(IMG, "blue2.png"), x: 0, y: 0, w: W, h: H, transparency: 45 } },
    { image: { path: p(BRAND, "logos", "logo3.png"), x: ML, y: 6.917, w: 0.333, h: 0.333, altText: "МГТС" } },
    TITLE_PH({ color: C.white }),
  ],
});

// ---------- помощники ----------
// заголовок: синяя «тяжёлая» строка + лёгкая тёмно-синяя (строки массива = переносы)
function title(slide, main, light, { inline = false } = {}) {
  const lines = [].concat(light || []);
  const runs = [{ text: main, options: { breakLine: !inline && lines.length > 0 } }];
  lines.forEach((t, i) => runs.push({
    text: (inline && i === 0 ? " " : "") + t,
    options: { fontFace: F.light, color: C.navy, breakLine: i < lines.length - 1 },
  }));
  slide.addText(runs, { placeholder: "title", align: "left" });
}
const body = (text, o = {}) => ({ text, options: { fontFace: F.text, fontSize: 14, color: C.navy, ...o } });
const bold = (text, o = {}) => body(text, { bold: true, ...o });
const h3 = (text, o = {}) => ({ text, options: { fontFace: F.ext, bold: true, fontSize: 16, color: C.navy,
                                                  breakLine: true, paraSpaceAfter: 6, ...o } });

// карточка: скруглённый прямоугольник #F2F7FC с текстом внутри (одна фигура — удобно править)
function card(slide, name, runs, x, y, w, h, o = {}) {
  slide.addText(runs, {
    shape: pres.shapes.ROUNDED_RECTANGLE, rectRadius: 0.19, x, y, w, h,
    fill: { color: o.fill || C.soft }, line: { type: "none" },
    margin: o.margin || [19, 19, 14, 18], valign: o.valign || "top", align: o.align || "left",
    lineSpacingMultiple: 1.1, objectName: name, fit: "none",
  });
}
function textBox(slide, name, runs, x, y, w, h, o = {}) {
  slide.addText(runs, { x, y, w, h, margin: 0, valign: "top", lineSpacingMultiple: 1.1, fit: "none",
                        isTextBox: true, objectName: name, ...o });
}
// картинка, обрезанная по краю слайда (как overflow:hidden в HTML)
function clippedImage(slide, file, X, Y, w, h, name) {
  const x0 = Math.max(X, 0), y0 = Math.max(Y, 0);
  const x1 = Math.min(X + w, W), y1 = Math.min(Y + h, H);
  slide.addImage({ path: file, x: x0, y: y0, w, h, altText: "", objectName: name,
                   sizing: { type: "crop", x: x0 - X, y: y0 - Y, w: x1 - x0, h: y1 - y0 } });
}
// скриншот «cover» с привязкой к левому верхнему углу
function coverTopLeft(slide, file, x, y, bw, bh, name) {
  const d = sizeOf(fs.readFileSync(file));
  const s = Math.max(bw / d.width, bh / d.height);
  slide.addImage({ path: file, x, y, w: d.width * s, h: d.height * s, objectName: name, altText: name,
                   sizing: { type: "crop", x: 0, y: 0, w: bw, h: bh } });
}
const content = () => pres.addSlide({ masterName: "MGTS Content" });

// ===== 1. Обложка =====
{
  const s = pres.addSlide({ masterName: "MGTS Cover" });
  s.addText([{ text: "Радар", options: { breakLine: true } },
             { text: "стажировки", options: { fontFace: F.light } }], { placeholder: "title", align: "left" });
  textBox(s, "Подзаголовок", [body(
    "ИИ-ассистент HR: анкеты стажёров и наставников приходят сами, система показывает, кому нужна помощь, почему и что сделать",
    { fontSize: 17, color: C.white })], ML, 2.75, 6.4, 1.2, { lineSpacingMultiple: 1.25 });
  textBox(s, "Команда", [
    body("«Код города» · МГТС · трек «ИИ в бизнес-процессах» · 26.11.2026", { color: C.white, breakLine: true }),
    body("Андрей — техлид · Савелий — аналитика · Артём — продукт и интерфейс", { color: C.white }),
  ], ML, 6.2, 8, 0.6);
  s.addNotes(NOTES[1] || "");
}

// ===== 2. Как мы поняли задачу =====
{
  const s = content();
  clippedImage(s, p(IMG, "cube.png"), 8.47, 2.29, 6.944, 3.906, "3D-куб");
  title(s, "Как мы поняли задачу", ["HR узнаёт о проблеме,", "когда стажёр уже ушёл"]);
  const cw = 3.15, gap = 0.25, y = 2.35, h = 2.45;
  card(s, "Карточка: мало данных", [h3("Мало данных"),
    body("5 пар «стажёр — наставник», 6 опросов. Обучать модель не на чем: нужны прозрачные правила.")], ML, y, cw, h);
  card(s, "Карточка: разные взгляды", [h3("Разные взгляды"),
    body("Стажёр оценивает свой опыт, наставник — его работу. Ценность в "), bold("расхождении"), body(" этих оценок.")],
    ML + cw + gap, y, cw, h);
  card(s, "Карточка: главное в тексте", [h3("Главное в тексте"),
    body("«Нагрузка слишком высокая» звучит в комментарии раньше, чем падает средний балл.")], ML + 2 * (cw + gap), y, cw, h);
  textBox(s, "Цель", [bold("Наша цель: ", { fontSize: 16 }),
    body("каждый новый ответ из формы за секунды попадает в историю стажёра. HR получает сигнал ", { fontSize: 16 }),
    bold("с основаниями", { fontSize: 16, color: C.orange }),
    body(" (какие оценки, какая цитата) и готовое действие.", { fontSize: 16 })], ML, 5.15, 9.7, 0.9);
  s.addNotes(NOTES[2] || "");
}

// ===== 3. Решение: цепочка =====
{
  const s = content();
  title(s, "Решение: от ответа в форме", ["до обновлённого дашборда", "без ручных шагов"]);
  const steps = [
    ["Анкета", "Две Google Forms по структуре кейса: стажёр и наставник"],
    ["Передача", "API таблицы ответов каждые 5 с + вебхук Apps Script"],
    ["Привязка", "ID стажёра + контрольный период; повтор заменяет старый ответ"],
    ["История", "6 месяцев из xlsx кейса + все новые ответы"],
    ["Анализ", "Правила по оценкам + ИИ по комментариям"],
    ["Дашборд", "Обновляется сам: светофор, карточка, действия"],
  ];
  const aw = 0.2, cw = (CW - aw * 5) / 6, y = 2.3, h = 2.75;
  steps.forEach(([t, d], i) => {
    const hot = i === 4, fg = hot ? C.white : C.navy;
    const x = ML + i * (cw + aw);
    card(s, `Шаг ${i + 1}: ${t}`, [
      { text: String(i + 1), options: { fontFace: F.black, fontSize: 24, color: hot ? C.white : C.blue, breakLine: true, paraSpaceAfter: 8 } },
      h3(t, { fontSize: 14, color: fg }),
      body(d, { color: fg }),
    ], x, y, cw, h, { fill: hot ? C.blue : C.soft, margin: [10, 5, 12, 16] });
    if (i < 5) s.addShape(pres.shapes.RIGHT_ARROW, { x: x + cw + 0.035, y: y + h / 2 - 0.08, w: aw - 0.07, h: 0.16,
      fill: { color: C.blue }, line: { type: "none" }, objectName: `Стрелка ${i + 1}` });
  });
  const colW = (CW - 0.25) / 2, y2 = 5.35;
  textBox(s, "Оценки → правила", [h3("Оценки → правила"),
    body("Сравниваем человека с его же нормой (у каждого своя «валюта» баллов), ищем падение, расхождение стажёр "),
    body("↔", { fontFace: "Arial" }), body(" наставник и пропуск опроса.")],
    ML, y2, colW, 1.3);
  textBox(s, "Комментарии → ИИ", [h3("Комментарии → ИИ"),
    body("YandexGPT размечает тему, тон, риск и находит цитату-основание. Без сети работает офлайн-словарь, поэтому демо не зависит от интернета.")],
    ML + colW + 0.25, y2, colW, 1.3);
  s.addNotes(NOTES[3] || "");
}

// ===== 4. Демо =====
{
  const s = content();
  title(s, "Демо:", ["новый ответ → дашборд", "обновился сам"], { inline: true });
  const vx = ML, vy = 1.85, vw = 8.53, vh = 4.8;
  const mp4 = p(DIR, "demo.mp4"), poster = p(DIR, "shots", "demo_poster.png");
  if (fs.existsSync(mp4)) {
    s.addMedia({ type: "video", path: mp4, x: vx, y: vy, w: vw, h: vh, objectName: "Демо-видео",
                 ...(fs.existsSync(poster) ? { cover: "data:image/png;base64," + fs.readFileSync(poster).toString("base64") } : {}) });
  } else {
    s.addText([body("скринкаст 30–40 с", { color: C.white, fontSize: 18 })], {
      shape: pres.shapes.ROUNDED_RECTANGLE, rectRadius: 0.17, x: vx, y: vy, w: vw, h: vh,
      fill: { color: C.navy }, line: { type: "none" }, align: "center", valign: "middle",
      objectName: "Заглушка видео (demo.mp4)" });
  }
  const st = { paraSpaceAfter: 10, breakLine: true };
  textBox(s, "Что происходит на видео", [
    body("Что происходит на видео", { fontSize: 11, color: C.mut, ...st }),
    bold("1. ", { paraSpaceAfter: 10 }), body("Стажёр СТ-002 заполняет форму за «Месяц 7»: нагрузка 2, тревожный комментарий", st),
    bold("2. ", { paraSpaceAfter: 10 }), body("Через ~5 с ответ в системе: привязан к СТ-002 и периоду", st),
    bold("3. ", { paraSpaceAfter: 10 }), body("Анализ пересчитан, светофор стал "), bold("красным", { color: C.orange, ...st }),
    bold("4. "), body("Карточка: сигнал, на чём основан, что делать HR"),
  ], vx + vw + 0.36, vy + 0.05, CW - vw - 0.36, 3.6);
  s.addNotes(NOTES[4] || "");
}

// ===== 5. Что видит HR =====
{
  const s = content();
  title(s, "Что видит HR", ["кто требует внимания и почему —", "за 10 секунд"]);
  const cw = (CW - 0.25) / 2, y = 2.3, h = 2.95;
  [["overview.png", "Скриншот: обзор", "скриншот обзора: shots/overview.png"],
   ["card.png", "Скриншот: карточка", "скриншот карточки: shots/card.png"]].forEach(([f, name, ph], i) => {
    const x = ML + i * (cw + 0.25), file = p(DIR, "shots", f);
    if (fs.existsSync(file)) coverTopLeft(s, file, x, y, cw, h, name);
    else card(s, name, [body(ph, { color: C.mut })], x, y, cw, h, { align: "center", valign: "middle" });
  });
  textBox(s, "Подпись: обзор", [bold("Обзор: "),
    body("светофор по стажёрам, кто заполнил анкеты (стажёры и наставники), переключатель «на Месяц N»")],
    ML, y + h + 0.17, cw, 0.6);
  textBox(s, "Подпись: карточка", [bold("Карточка: "),
    body("динамика стажёр vs наставник, расхождения, анализ комментариев, сигналы с основаниями, резюме и действия", { breakLine: true, paraSpaceAfter: 4 }),
    body("+ чат «Спросить Радар»: HR спрашивает «почему СТ-004 в зоне риска?» и получает ответ с основаниями")],
    ML + cw + 0.25, y + h + 0.17, cw, 1.25);
  s.addNotes(NOTES[5] || "");
}

// ===== 6. Проверка на данных кейса (нативная таблица) =====
{
  const s = content();
  title(s, "Проверили на истории кейса", ["система поймала бы каждый эпизод", "в тот же месяц"]);
  const none = { type: "none" }, rule = { type: "solid", pt: 1.25, color: C.line };
  const border = [none, none, rule, none];
  const cell = (text, o = {}) => ({ text, options: { border, ...o } });
  const th = (t) => cell(t, { fontFace: F.textMed, fontSize: 12, color: C.mut });
  const who = (id, dept) => cell(dept
    ? [bold(id, { breakLine: true }), body(dept, { color: C.mut })]
    : [bold(id)]);
  const sig = (color, t) => cell([body("●", { color, fontSize: 18, fontFace: "Arial" }), body("  " + t)]);
  const rows = [
    [th("Стажёр"), th("Что было"), th("Основание"), th("Сигнал")],
    [who("СТ-004", "HR-блок"), cell("перегрузка, мес. 4"),
     cell("«Комфортность нагрузки» 2 при норме 4,7; «нагрузка слишком высокая»; наставник подтверждает: «нужно снизить нагрузку»"),
     sig(C.red, "мес. 4")],
    [who("СТ-005", "IT"), cell("непонимание задач, мес. 1–3"),
     cell("«Понятность задач» 2, наставник: «понимание задач» 4 — разрыв 2 балла"), sig(C.red, "мес. 2")],
    [who("СТ-003", "Административный"), cell("нет поддержки, мес. 2–3"),
     cell("«Поддержка наставника» 2, «понятность» 2, общая удовлетворённость 2"), sig(C.red, "мес. 2")],
    [who("СТ-001, СТ-002"), cell("стабильно хорошо"), cell("без ложных тревог во всех 6 периодах"), sig(C.green, "—")],
  ];
  s.addTable(rows, { x: ML, y: 2.3, w: CW, colW: [2.3, 2.2, 5.92, 1.247], fontFace: F.text, fontSize: 14,
                     color: C.navy, valign: "top", margin: [8, 9, 8, 9], objectName: "Таблица: проверка на истории" });
  s.addNotes(NOTES[6] || "");
}

// ===== 7. Архитектура и ИИ =====
{
  const s = content();
  title(s, "Архитектура и ИИ-технологии", ["работает и в закрытом контуре"]);
  const cw = (CW - 0.5) / 3, y = 1.95, h = 2.3;
  card(s, "Карточка: интеграция", [h3("Интеграция"),
    body("Google Forms → Google Sheets → API (опрос раз в 5 с) и вебхук Apps Script → FastAPI. Можно заменить на Яндекс Формы: меняется только адаптер.")],
    ML, y, cw, h);
  card(s, "Карточка: анализ", [h3("Анализ"),
    body("Python, pandas: личная норма, динамика, разрывы пар, пропуски. Каждый вывод хранит свои основания.")],
    ML + cw + 0.25, y, cw, h);
  card(s, "Карточка: ИИ", [h3("ИИ"), bold("YandexGPT 5.1"),
    body(" (Yandex AI Studio): тема, тон, риск, цитата, резюме, действия для HR. Запасной вариант — офлайн-правила без внешней модели.")],
    ML + 2 * (cw + 0.25), y, cw, h);
  const colW = (CW - 0.25) / 2, y2 = 4.55;
  textBox(s, "Данные о людях", [h3("Данные о людях"),
    body("Только ID (СТ-00X, Н-00X), без ФИО. В модель уходит текст комментария без персональных данных. Решение о человеке принимает HR: система лишь подсвечивает.")],
    ML, y2, colW, 1.3);
  textBox(s, "Инструменты разработки", [h3("Инструменты разработки"),
    body("Claude Code — ассистент при написании кода и документации. Весь код в репозитории, тесты — pytest.")],
    ML + colW + 0.25, y2, colW, 1.3);
  s.addNotes(NOTES[7] || "");
}

// ===== 8. Эффект и шаги =====
{
  const s = content();
  clippedImage(s, p(IMG, "cube2.png"), 8.889, 1.111, 5.278, 5.278, "3D-кубы");
  title(s, "Что это даёт МГТС", ["и что дальше"]);
  const nw = 2.64, gap = 0.25, y = 1.95;
  [["~5 с", "от отправки анкеты до обновления дашборда", C.blue],
   ["0", "ручных выгрузок: HR не сводит Excel каждый месяц", C.blue],
   ["3 из 3", "эпизода истории пойманы в тот же месяц", C.orange]].forEach(([n, t, col], i) => {
    const x = ML + i * (nw + gap);
    textBox(s, `Число ${i + 1}`, [{ text: n, options: { fontFace: F.num, fontSize: 46, color: col } }], x, y, nw + 0.3, 0.75,
            { valign: "bottom", lineSpacingMultiple: 1.0 });
    textBox(s, `Подпись к числу ${i + 1}`, [body(t)], x, y + 0.85, nw, 0.6);
  });
  textBox(s, "Следующие шаги", [h3("Следующие шаги", { paraSpaceAfter: 8 }),
    body("Уведомление HR и наставнику в корпоративный мессенджер при красном сигнале", { bullet: { indent: 14 }, breakLine: true, paraSpaceAfter: 4 }),
    body("Отметка «HR подтвердил / ложная тревога» — на ней калибруем пороги", { bullet: { indent: 14 }, breakLine: true, paraSpaceAfter: 4 }),
    body("Масштаб на все потоки стажёров и на адаптацию новых сотрудников", { bullet: { indent: 14 } })],
    ML, 3.75, 8.3, 1.6);
  s.addNotes(NOTES[8] || "");
}

// ===== 9. Дополнительные материалы =====
{
  const s = pres.addSlide({ masterName: "MGTS Final" });
  s.addText("Дополнительные материалы", { placeholder: "title", align: "left" });
  const lab = (t) => body(t, { fontSize: 12, color: C.onBlue, breakLine: true, paraSpaceAfter: 3 });
  const link = (t, o = {}) => ({ text: t, options: { fontFace: F.num, fontSize: 15, color: C.white, ...o } });
  const items = [
    ["Репозиторий с кодом", ["github.com/fry-alt/kod-goroda"]],
    ["Прототип (дашборд)", ["radar-stazhirovki.vercel.app"]],
    ["Формы для тестового ответа", ["ССЫЛКА_НА_ФОРМУ_СТАЖЁРА", "ССЫЛКА_НА_ФОРМУ_НАСТАВНИКА"]],
    ["Документация: архитектура, запуск, API", ["github.com/fry-alt/kod-goroda/blob/main/README.md"]],
  ];
  let y = 1.55;
  items.forEach(([l, links], i) => {
    const h = 0.32 + links.length * 0.3;
    textBox(s, `Ссылка: ${l}`, [lab(l), ...links.map((t, j) => link(t, { breakLine: j < links.length - 1 }))],
            ML, y, 9.0, h);
    y += h + 0.28;
  });
  s.addNotes(NOTES[9] || "");
}

// ---------- запись + фирменная палитра в тему ----------
async function brandTheme(file) {
  const zip = await JSZip.loadAsync(fs.readFileSync(file));
  const part = "ppt/theme/theme1.xml";
  const cols = { dk1: C.navy, lt1: C.white, dk2: C.navy2, lt2: C.soft, accent1: C.blue, accent2: C.orange,
                 accent3: C.navy, accent4: C.line, accent5: C.mut, accent6: C.green, hlink: C.blue, folHlink: C.navy };
  const scheme = `<a:clrScheme name="МГТС">` +
    Object.entries(cols).map(([k, v]) => `<a:${k}><a:srgbClr val="${v}"/></a:${k}>`).join("") + "</a:clrScheme>";
  const xml = (await zip.file(part).async("string"))
    .replace(/<a:clrScheme\b[\s\S]*?<\/a:clrScheme>/, scheme)
    .replace(/(<a:(?:theme|fontScheme)\b[^>]*?\bname=")[^"]*"/g, (_, h) => `${h}МГТС"`);
  zip.file(part, xml);
  for (const n of Object.keys(zip.files)) if (zip.files[n].dir) delete zip.files[n];
  fs.writeFileSync(file, await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
}

(async () => {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  await pres.writeFile({ fileName: OUT });
  await brandTheme(OUT);
  console.log("ok", OUT, fs.existsSync(p(DIR, "demo.mp4")) ? "(с видео demo.mp4)" : "(без видео: заглушка)");
})().catch((e) => { console.error(e); process.exit(1); });
