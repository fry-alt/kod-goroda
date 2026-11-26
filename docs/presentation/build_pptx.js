// PPTX из отрендеренных слайдов (out/slide-N.png) + видео demo.mp4 на слайде 4 + заметки докладчика.
// Сначала ./render.sh final, потом: node build_pptx.js  → out/Радар_стажировки_МГТС.pptx
const fs = require("fs");
const path = require("path");
let pptxgen;
try { pptxgen = require("pptxgenjs"); } catch { pptxgen = require(require("child_process").execSync("npm root -g").toString().trim() + "/pptxgenjs"); }

const dir = __dirname, out = path.join(dir, "out");
const PX = 1 / 192; // 1920 px = 10 in
const VIDEO = { slide: 4, x: 120, y: 184.5, w: 1228.8, h: 720 }; // рамка #demo в deck.html
const NOTES = {
  1: "Добрый день. Мы — команда … Сделали «Радар стажировки»: HR видит, кому из стажёров нужна помощь, ещё до того, как человек решил уйти.",
  2: "Как мы поняли задачу. Данных мало: 5 пар, 6 опросов, поэтому модель не обучаем — правила прозрачные. Стажёр и наставник отвечают на разные вопросы, ценность в расхождении. Самое раннее предупреждение — в комментариях.",
  3: "Цепочка из кейса целиком: анкета → передача → привязка к ID и периоду → история → анализ → дашборд. Оценки считают правила относительно личной нормы человека, комментарии размечает YandexGPT.",
  4: "Демо. Стажёр отправляет анкету, через несколько секунд система привязала ответ к СТ-002 и «Месяцу 7», пересчитала анализ, и стажёр стал красным. В карточке — почему: конкретные оценки и цитата, и что делать HR.",
  5: "Что видит HR: обзор со светофором и статусом анкет, переключатель периода и карточка стажёра с основаниями.",
  6: "Проверка на истории кейса: три реальных эпизода — перегрузка СТ-004, непонимание задач СТ-005, отсутствие поддержки СТ-003 — система ловит в тот же месяц, по стабильным стажёрам ложных тревог нет.",
  7: "Архитектура: Google Forms и Sheets, FastAPI, pandas, YandexGPT; без сети работает офлайн. Персональные данные в модель не уходят, решение принимает HR.",
  8: "Эффект: секунды от анкеты до сигнала, ноль ручных выгрузок. Дальше — уведомления, обратная связь HR для калибровки и масштаб на все потоки. Спасибо!",
  9: "Ссылки на код, прототип, формы и документацию.",
};

const pres = new pptxgen();
pres.layout = "LAYOUT_16x9";
pres.title = "Радар стажировки — МГТС «Код города»";
const n = fs.readdirSync(out).filter(f => /^slide-\d+\.png$/.test(f)).length;
for (let i = 1; i <= n; i++) {
  const s = pres.addSlide();
  s.addImage({ path: path.join(out, `slide-${i}.png`), x: 0, y: 0, w: 10, h: 5.625, altText: `Слайд ${i}` });
  const mp4 = path.join(dir, "demo.mp4");
  if (i === VIDEO.slide && fs.existsSync(mp4)) {
    const poster = path.join(dir, "shots", "demo_poster.png");
    s.addMedia({ type: "video", path: mp4, x: VIDEO.x * PX, y: VIDEO.y * PX, w: VIDEO.w * PX, h: VIDEO.h * PX,
                 ...(fs.existsSync(poster) ? { cover: "data:image/png;base64," + fs.readFileSync(poster).toString("base64") } : {}) });
  }
  if (NOTES[i]) s.addNotes(NOTES[i]);
}
pres.writeFile({ fileName: path.join(out, "Радар_стажировки_МГТС.pptx") }).then(f => console.log("ok", f));
