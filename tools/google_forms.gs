/**
 * Создаёт две Google Forms по структуре кейса (пульс-опрос стажёра и анкета наставника),
 * таблицу ответов и триггер, который шлёт каждый ответ на наш вебхук.
 *
 * Как запустить (5 минут):
 *  1. https://script.google.com → «Новый проект» → вставить этот файл целиком.
 *  2. Вписать WEBHOOK_URL (публичный адрес API из туннеля, без хвоста) и WEBHOOK_SECRET (как в .env).
 *     Если туннеля нет — оставить пустым: ответы всё равно заберёт опрос CSV (см. лог).
 *  3. Выбрать функцию createForms → «Выполнить» → разрешить доступ.
 *  4. В «Журнале выполнения» будут ссылки на формы и две строки SHEET_CSV_* — скопировать их в .env.
 *  Поменять адрес вебхука позже: вписать новый WEBHOOK_URL и запустить setWebhook.
 */
const WEBHOOK_URL = '';     // например https://xxxx.trycloudflare.com
const WEBHOOK_SECRET = '';  // тот же, что WEBHOOK_SECRET в .env

const INTERNS = ['СТ-001', 'СТ-002', 'СТ-003', 'СТ-004', 'СТ-005', 'СТ-006'];
const MENTORS = ['Н-001', 'Н-002', 'Н-003', 'Н-004', 'Н-005', 'Н-006'];
const DEPTS = ['Технический блок', 'Коммерческий блок', 'Административный блок', 'HR-блок', 'IT'];
const PERIODS = ['Месяц 1', 'Месяц 2', 'Месяц 3', 'Месяц 4', 'Месяц 5', 'Месяц 6', 'Месяц 7'];

// Заголовок вопроса = «<название столбца в датасете> — <вопрос из анкеты>»: бэк узнаёт столбец по началу.
const INTERN_SCALE = [
  ['Понятность задач', 'Мне понятно, каких результатов от меня ожидают по текущим задачам.'],
  ['Поддержка и обратная связь наставника', 'Я получаю достаточно поддержки и обратной связи от наставника.'],
  ['Комфортность нагрузки', 'Моя текущая загрузка комфортна и позволяет качественно выполнять задачи.'],
  ['Интерес к задачам', 'Мне интересны задачи, над которыми я работаю.'],
  ['Профессиональное развитие', 'Я чувствую, что в процессе стажировки развиваю полезные для себя навыки.'],
  ['Взаимодействие с командой', 'Мне комфортно взаимодействовать с командой.'],
  ['Общая удовлетворенность стажировкой', 'В целом я доволен тем, как проходит моя стажировка.'],
];
const INTERN_TEXT = [
  ['Сложности за период', 'С какими сложностями вы столкнулись за последний период стажировки?'],
  ['Что мешает работать и развиваться',
   'Есть ли что-то в задачах, взаимодействии с наставником или командой, что сейчас мешает вам эффективно работать и развиваться?'],
];
const MENTOR_SCALE = [
  ['Понимание задач и ожиданий', 'Насколько стажер понимает поставленные задачи и ожидаемый результат?',
   '1 — часто не понимает задачу и ожидаемый результат даже после пояснений; 3 — понимает типовые задачи, по новым или сложным требуются уточнения; 5 — быстро понимает цель и ожидаемый результат, задает необходимые уточняющие вопросы'],
  ['Качество выполнения задач', 'Насколько качественно стажер выполняет поставленные задачи?',
   '1 — результат регулярно требует существенной доработки; 3 — результат в целом соответствует требованиям, возможны отдельные доработки; 5 — стабильно выполняет задачи качественно, результат требует минимальных корректировок'],
  ['Самостоятельность', 'Насколько самостоятельно стажер выполняет поставленные задачи?',
   '1 — требуется постоянное сопровождение и контроль; 3 — самостоятельно выполняет типовые задачи, обращается за помощью в сложных ситуациях; 5 — самостоятельно организует работу и решает задачи в рамках своей зоны ответственности'],
  ['Соблюдение сроков и организация работы', 'Насколько стажер соблюдает сроки и организует свою работу?',
   '1 — регулярно нарушает сроки или не сообщает о рисках; 3 — в основном соблюдает сроки и сообщает о возникающих сложностях; 5 — стабильно соблюдает сроки, заранее обозначает риски и организует свою работу'],
  ['Вовлеченность и инициативность', 'Насколько стажер вовлечен в работу и проявляет инициативу?',
   '1 — включается в работу преимущественно после напоминаний; 3 — вовлечен в поставленные задачи и выполняет необходимый объем работы; 5 — проявляет инициативу, предлагает идеи и дополнительные способы решения задач'],
  ['Взаимодействие с наставником и командой', 'Насколько эффективно стажер взаимодействует с наставником и командой?',
   '1 — возникают регулярные сложности в коммуникации и работе с обратной связью; 3 — корректно взаимодействует с коллегами и воспринимает обратную связь; 5 — конструктивно взаимодействует с командой и использует обратную связь в работе'],
];
const MENTOR_TEXT = [
  ['Комментарий о работе за период',
   'Опишите, как стажер проявил себя за последний период: что получилось хорошо и с какими сложностями он столкнулся?'],
  ['Сложности / ситуации для внимания',
   'Есть ли сложности или ситуации, на которые, по вашему мнению, стоит обратить внимание? Если да, кратко опишите.'],
];

function createForms() {
  const ss = SpreadsheetApp.create('Код города — ответы на анкеты');

  const fi = FormApp.create('Пульс-опрос стажера');
  fi.setDescription('Ежемесячный пульс-опрос стажировки МГТС. Оцените, насколько вы согласны с каждым утверждением: ' +
                    '1 — совсем не согласен; 2 — скорее не согласен; 3 — частично согласен / частично не согласен; ' +
                    '4 — скорее согласен; 5 — полностью согласен.');
  addList(fi, 'ID стажера', INTERNS);
  addList(fi, 'Подразделение / направление стажировки', DEPTS);
  addList(fi, 'Контрольный период', PERIODS);
  INTERN_SCALE.forEach(([col, q]) => addScale(fi, col + ' — ' + q, '', 'совсем не согласен', 'полностью согласен'));
  INTERN_TEXT.forEach(([col, q]) => fi.addParagraphTextItem().setTitle(col + ' — ' + q));

  const fm = FormApp.create('Анкета наставника');
  fm.setDescription('Ежемесячная оценка стажера наставником. Шкала 1–5, оценки 2 и 4 — промежуточные между описанными уровнями.');
  addList(fm, 'ID наставника', MENTORS);
  addList(fm, 'ID стажера', INTERNS);
  addList(fm, 'Подразделение / направление стажировки', DEPTS);
  addList(fm, 'Контрольный период', PERIODS);
  MENTOR_SCALE.forEach(([col, q, help]) => addScale(fm, col + ' — ' + q, help, '', ''));
  MENTOR_TEXT.forEach(([col, q]) => fm.addParagraphTextItem().setTitle(col + ' — ' + q));

  fi.setDestination(FormApp.DestinationType.SPREADSHEET, ss.getId());
  fm.setDestination(FormApp.DestinationType.SPREADSHEET, ss.getId());
  SpreadsheetApp.flush();
  Utilities.sleep(3000);

  // листы ответов: переименовать и выдать CSV-ссылки для опроса
  const csv = {};
  ss.getSheets().forEach(sh => {
    const url = sh.getFormUrl() || '';
    if (url.indexOf(fi.getId()) >= 0) { sh.setName('Стажеры'); csv.intern = sh.getSheetId(); }
    if (url.indexOf(fm.getId()) >= 0) { sh.setName('Наставники'); csv.mentor = sh.getSheetId(); }
  });
  ss.getSheets().filter(sh => !sh.getFormUrl() && ss.getSheets().length > 2).forEach(sh => ss.deleteSheet(sh));
  // Только тестовые ответы: таблицу видно по ссылке, чтобы бэк мог читать CSV без ключей.
  DriveApp.getFileById(ss.getId()).setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

  const props = PropertiesService.getScriptProperties();
  props.setProperties({ INTERN_FORM: fi.getId(), MENTOR_FORM: fm.getId(), SHEET: ss.getId() });
  setWebhook();

  const base = 'https://docs.google.com/spreadsheets/d/' + ss.getId() + '/export?format=csv&gid=';
  Logger.log('Форма стажёра (ссылка для заполнения): ' + fi.getPublishedUrl());
  Logger.log('Форма наставника (ссылка для заполнения): ' + fm.getPublishedUrl());
  Logger.log('Таблица ответов: ' + ss.getUrl());
  Logger.log('В .env:\nSHEET_CSV_INTERN=' + base + csv.intern + '\nSHEET_CSV_MENTOR=' + base + csv.mentor);
}

/** (Пере)создать триггеры отправки на вебхук. Запускать после смены WEBHOOK_URL. */
function setWebhook() {
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  if (!WEBHOOK_URL) { Logger.log('WEBHOOK_URL пуст — вебхук выключен, работает опрос CSV'); return; }
  const p = PropertiesService.getScriptProperties();
  ScriptApp.newTrigger('onInternSubmit').forForm(p.getProperty('INTERN_FORM')).onFormSubmit().create();
  ScriptApp.newTrigger('onMentorSubmit').forForm(p.getProperty('MENTOR_FORM')).onFormSubmit().create();
  Logger.log('Вебхук: ' + WEBHOOK_URL + '/api/webhook/{intern|mentor}');
}

function onInternSubmit(e) { send_('intern', e); }
function onMentorSubmit(e) { send_('mentor', e); }

function send_(form, e) {
  const answers = {};
  e.response.getItemResponses().forEach(r => { answers[r.getItem().getTitle()] = r.getResponse(); });
  const res = UrlFetchApp.fetch(WEBHOOK_URL + '/api/webhook/' + form, {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { 'X-Webhook-Secret': WEBHOOK_SECRET, 'ngrok-skip-browser-warning': '1' },
    payload: JSON.stringify({ answers: answers }),
  });
  console.log(form + ' → ' + res.getResponseCode() + ' ' + res.getContentText().slice(0, 300));
}

function addList(form, title, values) {
  form.addListItem().setTitle(title).setChoiceValues(values).setRequired(true);
}

function addScale(form, title, help, left, right) {
  const it = form.addScaleItem().setTitle(title).setBounds(1, 5).setRequired(true);
  if (help) it.setHelpText(help);
  if (left || right) it.setLabels(left, right);
}
