// ============================================================================
// Файл: js/board.js
// Зачем нужен: ОБЩАЯ ДОСКА в чате — партнёры рисуют на одном холсте
// одновременно: формулы, чертежи, схемы.
// Как это устроено:
//   • холст <canvas> 1600×1000 «точек доски»; на экране он уменьшается, а
//     координаты мыши/пальца пересчитываются в точки доски — поэтому рисунок
//     одинаковый на телефоне и компьютере;
//   • линия отправляется в базу КУСОЧКАМИ каждые ~120 мс, пока её рисуют
//     (таблица board_strokes), и партнёр видит её почти сразу через
//     Supabase Realtime;
//   • «Отменить» и «Очистить» — это тоже строки (undo / clear); триггер базы
//     удаляет то, что они отменяют, а экраны перерисовывают доску;
//   • доска сохраняется: открыл завтра — рисунок на месте.
// Инструменты: 6 цветов, 3 толщины, ластик, отмена своей линии (Ctrl+Z),
// очистка, скачивание картинки PNG.
// Как связан с остальными: вызывается из js/pages/chat.js; разметка — в
// pages/chat.html (#board); стили — css/pages.css; правила — sql/schema.sql.
// ============================================================================

// подключение к Supabase
import { supabase } from './supabase.js';
// окно подтверждения
import { confirmAction } from './dialog.js';
// тосты и ошибки
import { showToast, getErrorMessage, logError } from './utils.js';

// WIDTH и HEIGHT — размер доски в «точках доски» (соотношение 16 : 10)
const WIDTH = 1600;
// высота
const HEIGHT = 1000;
// COLORS — цвета карандаша: [цвет, название для подсказки]
const COLORS = [['#1f2937', 'Чёрный'], ['#2563eb', 'Синий'], ['#dc2626', 'Красный'], ['#16a34a', 'Зелёный'], ['#f59e0b', 'Оранжевый'], ['#7c3aed', 'Фиолетовый']];
// SIZES — толщина линии: [толщина, название]
const SIZES = [[4, 'Тонкая'], [9, 'Средняя'], [18, 'Толстая']];
// ERASER_SIZE — толщина ластика
const ERASER_SIZE = 40;
// FLUSH_MS — как часто отправлять кусочек рисуемой линии (миллисекунды)
const FLUSH_MS = 120;
// MAX_POINTS — сколько чисел помещается в один кусочек (так же ограничено в базе: 400)
const MAX_POINTS = 360;
// LOAD_LIMIT — сколько строк доски загружать при открытии
const LOAD_LIMIT = 5000;

// ----------------------------------------------------------------------------
// randomKey — случайный ключ линии (все кусочки одной линии получают его).
// Принимает: ничего. Возвращает: строку вроде «k1x7f9a2».
// ----------------------------------------------------------------------------
// function
function randomKey() {
  // время + случайные буквы; toString(36) — запись числа цифрами и буквами
  return `k${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
// конец функции randomKey
}

// ----------------------------------------------------------------------------
// drawSegment — рисует один кусочек линии на холсте.
// Принимает: ctx — «кисть» холста; segment — { kind, color, size, points }.
// Возвращает: ничего.
// ----------------------------------------------------------------------------
// function
function drawSegment(ctx, segment) {
  // точки [x1, y1, x2, y2, ...]
  const points = segment.points;
  // меньше одной точки — рисовать нечего
  if (points.length < 2) return;
  // ластик «стирает» (destination-out — делает пиксели прозрачными), карандаш — рисует поверх
  ctx.globalCompositeOperation = segment.kind === 'eraser' ? 'destination-out' : 'source-over';
  // цвет линии
  ctx.strokeStyle = segment.color;
  // цвет заливки (для точки)
  ctx.fillStyle = segment.color;
  // толщина
  ctx.lineWidth = segment.size;
  // скруглённые концы
  ctx.lineCap = 'round';
  // скруглённые изгибы
  ctx.lineJoin = 'round';
  // одна точка — рисуем кружок
  if (points.length === 2) {
    // начинаем фигуру
    ctx.beginPath();
    // arc(x, y, радиус, от угла, до угла) — круг
    ctx.arc(points[0], points[1], segment.size / 2, 0, Math.PI * 2);
    // заливаем
    ctx.fill();
    // стоп
    return;
  // конец if
  }
  // начинаем линию
  ctx.beginPath();
  // первая точка
  ctx.moveTo(points[0], points[1]);
  // остальные точки: шаг 2 — берём пары x, y
  for (let i = 2; i < points.length; i += 2) ctx.lineTo(points[i], points[i + 1]);
  // рисуем
  ctx.stroke();
// конец функции drawSegment
}

// ----------------------------------------------------------------------------
// initBoard — подключает доску к странице чата.
// Принимает объект:
//   partnershipId — номер партнёрства; me — мой профиль;
//   canDraw — можно ли рисовать (иначе только смотреть);
//   openButton — кнопка «🎨 Доска» в шапке чата;
//   nameOf(userId) — имя участника («Лена К.»).
// Возвращает: ничего.
// ----------------------------------------------------------------------------
// export function
export function initBoard({ partnershipId, me, canDraw, openButton, nameOf }) {
  // вся доска (оверлей поверх страницы)
  const root = document.getElementById('board');
  // холст
  const canvas = document.getElementById('board-canvas');
  // «кисть» для рисования на холсте
  const ctx = canvas.getContext('2d');
  // строка статуса («Лена рисует…»)
  const status = document.getElementById('board-status');
  // панель инструментов
  const tools = document.getElementById('board-tools');
  // размер холста в точках доски
  canvas.width = WIDTH;
  // высота
  canvas.height = HEIGHT;

  // все кусочки на доске по порядку: { id, key, author, kind, color, size, points }
  let segments = [];
  // id строк, которые уже учтены (чтобы Realtime не нарисовал их второй раз)
  const seenIds = new Set();
  // загружена ли доска из базы
  let loaded = false;
  // идёт ли загрузка
  let loading = false;
  // события Realtime, пришедшие во время загрузки (применим после)
  let buffered = [];
  // текущий инструмент: 'pen' или 'eraser'
  let tool = 'pen';
  // текущий цвет
  let color = COLORS[1][0];
  // текущая толщина
  let size = SIZES[0][0];
  // рисуемая сейчас линия: { key, kind, color, size, last: [x, y] } или null
  let drawing = null;
  // точки, ещё не отправленные в базу
  let pending = [];
  // таймер отправки кусочков
  let flushId = null;
  // мои линии по порядку (для «Отменить»)
  const myKeys = [];
  // таймер, прячущий «Лена рисует…»
  let statusId = null;
  // было ли уже сообщение об ошибке отправки (не спамим)
  let sendErrorShown = false;

  // redraw — перерисовать всю доску с нуля
  const redraw = () => {
    // clearRect — очистить холст
    ctx.clearRect(0, 0, WIDTH, HEIGHT);
    // рисуем все кусочки по порядку
    for (const segment of segments) drawSegment(ctx, segment);
  // конец redraw
  };

  // applyRow — учесть строку из базы (загрузка или Realtime)
  const applyRow = (row, { draw = true } = {}) => {
    // уже учтена — пропускаем
    if (seenIds.has(row.id)) return;
    // запоминаем id
    seenIds.add(row.id);
    // очистка — убираем всё
    if (row.kind === 'clear') {
      // пусто
      segments = [];
      // перерисовываем
      if (draw) redraw();
    // отмена линии — убираем кусочки этой линии этого автора
    } else if (row.kind === 'undo') {
      // filter оставляет всё, кроме отменённой линии
      segments = segments.filter((s) => !(s.key === row.stroke_key && s.author === row.author_id));
      // перерисовываем
      if (draw) redraw();
    // карандаш или ластик — добавляем кусочек
    } else {
      // кусочек
      const segment = { id: row.id, key: row.stroke_key, author: row.author_id, kind: row.kind, color: row.color, size: row.size, points: row.points };
      // добавляем в конец
      segments.push(segment);
      // рисуем только его (быстрее, чем перерисовывать всё)
      if (draw) drawSegment(ctx, segment);
    // конец условия
    }
  // конец applyRow
  };

  // showDrawer — «✏️ Лена рисует…» на полторы секунды
  const showDrawer = (userId) => {
    // текст статуса
    status.textContent = `✏️ ${nameOf(userId)} рисует…`;
    // сбрасываем старый таймер
    clearTimeout(statusId);
    // через 1,5 секунды — обычный текст
    statusId = setTimeout(() => { status.textContent = canDraw ? 'Рисуйте вместе — всё сохраняется' : 'Только просмотр'; }, 1500);
  // конец showDrawer
  };

  // send — отправить строку доски в базу (без ожидания ответа)
  const send = (row) => {
    // insert — вставить; then — когда база ответит
    supabase.from('board_strokes').insert({ partnership_id: partnershipId, author_id: me.id, ...row }).then(({ error }) => {
      // ошибки нет — всё хорошо
      if (!error) return;
      // в консоль
      logError(error);
      // сообщение показываем один раз
      if (!sendErrorShown) showToast(`Рисунок не сохранился: ${getErrorMessage(error)}`, 'error');
      // запоминаем, что показали
      sendErrorShown = true;
    // конец then
    });
  // конец send
  };

  // flush — отправить накопленные точки рисуемой линии
  const flush = () => {
    // линии нет, отправлять нечего или в кусочке только «стыковая» точка (палец стоит на месте)
    if (!drawing || pending.length === 0 || drawing.fresh) return;
    // отправляем кусочек
    send({ stroke_key: drawing.key, kind: drawing.kind, color: drawing.color, size: drawing.size, points: pending });
    // следующий кусочек начнётся с последней точки — линия не разорвётся
    pending = [...drawing.last];
    // отмечаем, что в нём пока только «стыковая» точка
    drawing.fresh = true;
  // конец flush
  };

  // toBoard — координаты указателя на экране → точки доски
  const toBoard = (event) => {
    // прямоугольник холста на экране
    const rect = canvas.getBoundingClientRect();
    // пропорция: где на холсте, умножить на размер доски; Math.round — целые числа (меньше данных)
    return [Math.round(((event.clientX - rect.left) / rect.width) * WIDTH), Math.round(((event.clientY - rect.top) / rect.height) * HEIGHT)];
  // конец toBoard
  };

  // addPoint — добавить точку к рисуемой линии и сразу нарисовать её у себя
  const addPoint = ([x, y]) => {
    // предыдущая точка
    const [px, py] = drawing.last;
    // Math.hypot — расстояние; слишком близкие точки пропускаем (меньше данных)
    if (Math.hypot(x - px, y - py) < 2) return;
    // рисуем отрезок у себя
    drawSegment(ctx, { kind: drawing.kind, color: drawing.color, size: drawing.size, points: [px, py, x, y] });
    // копим точку для отправки
    pending.push(x, y);
    // и для локальной копии линии
    drawing.local.push(x, y);
    // запоминаем последнюю
    drawing.last = [x, y];
    // кусочек теперь с настоящими точками
    drawing.fresh = false;
    // кусочек слишком длинный — отправляем досрочно
    if (pending.length >= MAX_POINTS) flush();
  // конец addPoint
  };

  // pointerdown — начали рисовать (мышь, палец или стилус)
  canvas.addEventListener('pointerdown', (event) => {
    // смотреть можно, рисовать нельзя
    if (!canDraw) return;
    // только основная кнопка мыши
    if (event.button !== 0) return;
    // setPointerCapture — продолжаем получать движения, даже если палец вышел за холст
    canvas.setPointerCapture(event.pointerId);
    // первая точка
    const point = toBoard(event);
    // ластик или карандаш
    const kind = tool === 'eraser' ? 'eraser' : 'pen';
    // новая линия
    drawing = { key: randomKey(), kind, color, size: kind === 'eraser' ? ERASER_SIZE : size, last: point, local: [...point], fresh: false };
    // первая точка в очередь
    pending = [...point];
    // рисуем точку сразу
    drawSegment(ctx, { kind, color, size: drawing.size, points: point });
    // запоминаем ключ для «Отменить»
    myKeys.push(drawing.key);
    // раз в FLUSH_MS отправляем кусочки
    flushId = setInterval(flush, FLUSH_MS);
  // конец обработчика
  });

  // pointermove — рисуем
  canvas.addEventListener('pointermove', (event) => {
    // не рисуем — ничего не делаем
    if (!drawing) return;
    // getCoalescedEvents — все промежуточные точки (линия плавнее); ?. — не во всех браузерах есть
    const events = event.getCoalescedEvents?.() ?? [event];
    // добавляем каждую точку; если список пуст — хотя бы само событие
    for (const item of events.length ? events : [event]) addPoint(toBoard(item));
  // конец обработчика
  });

  // finish — закончили линию (отпустили кнопку или палец)
  const finish = () => {
    // не рисовали — выходим
    if (!drawing) return;
    // останавливаем отправку по таймеру
    clearInterval(flushId);
    // отправляем остаток (если в кусочке есть новые точки или это одиночная точка)
    if (!drawing.fresh) flush();
    // сохраняем линию в своей копии доски (id пока нет — её строки придут из базы, но мы их пропустим как свои)
    segments.push({ id: null, key: drawing.key, author: me.id, kind: drawing.kind, color: drawing.color, size: drawing.size, points: drawing.local });
    // линия закончена
    drawing = null;
    // очередь пуста
    pending = [];
  // конец finish
  };
  // pointerup — отпустили
  canvas.addEventListener('pointerup', finish);
  // pointercancel — система прервала (например, пришёл звонок)
  canvas.addEventListener('pointercancel', finish);

  // undo — отменить мою последнюю линию
  const undo = () => {
    // pop — достать последний ключ
    const key = myKeys.pop();
    // моих линий нет
    if (!key) {
      // подсказка
      showToast('Отменять пока нечего', 'info');
      // стоп
      return;
    // конец if
    }
    // убираем её у себя
    segments = segments.filter((s) => !(s.key === key && s.author === me.id));
    // перерисовываем
    redraw();
    // сообщаем базе: триггер удалит кусочки этой линии, партнёр перерисует
    send({ stroke_key: key, kind: 'undo', points: [] });
  // конец undo
  };

  // clearBoard — очистить доску для всех
  const clearBoard = async () => {
    // подтверждение: это действие для всех участников
    const ok = await confirmAction({ title: 'Очистить доску?', text: 'Рисунок исчезнет у всех участников. Если он нужен — сначала скачай картинку.', confirmLabel: 'Очистить', danger: true });
    // передумал
    if (!ok) return;
    // у себя — пусто
    segments = [];
    // моих линий больше нет
    myKeys.length = 0;
    // перерисовываем
    redraw();
    // сообщаем базе: триггер удалит всё, партнёр очистит доску
    send({ stroke_key: randomKey(), kind: 'clear', points: [] });
  // конец clearBoard
  };

  // download — скачать рисунок как картинку PNG
  const download = () => {
    // временный холст того же размера
    const out = document.createElement('canvas');
    // ширина
    out.width = WIDTH;
    // высота
    out.height = HEIGHT;
    // его «кисть»
    const outCtx = out.getContext('2d');
    // белый фон (на доске фон — клетка из CSS, в картинку он не попадает)
    outCtx.fillStyle = '#ffffff';
    // заливаем
    outCtx.fillRect(0, 0, WIDTH, HEIGHT);
    // копируем рисунок поверх фона
    outCtx.drawImage(canvas, 0, 0);
    // ссылка для скачивания
    const link = document.createElement('a');
    // toDataURL — картинка в виде строки-адреса
    link.href = out.toDataURL('image/png');
    // имя файла с датой: toISOString().slice(0, 10) — «2026-09-26»
    link.download = `doska-${new Date().toISOString().slice(0, 10)}.png`;
    // «нажимаем» ссылку — браузер сохранит файл
    link.click();
  // конец download
  };

  // load — загрузить доску из базы при первом открытии
  const load = async () => {
    // уже загружено или грузится
    if (loaded || loading) return;
    // грузится
    loading = true;
    // статус
    status.textContent = 'Загружаем доску…';
    // try — запрос
    try {
      // все строки доски по порядку (RLS отдаст только участнику)
      const { data, error } = await supabase.from('board_strokes').select('id, author_id, stroke_key, kind, color, size, points').eq('partnership_id', partnershipId).order('id', { ascending: true }).limit(LOAD_LIMIT);
      // ошибка — в catch
      if (error) throw error;
      // учитываем строки без рисования (нарисуем всё разом)
      for (const row of data) applyRow(row, { draw: false });
      // доска загружена
      loaded = true;
      // события, пришедшие во время загрузки (повторы отсеет seenIds)
      for (const row of buffered) applyRow(row, { draw: false });
      // очередь пуста
      buffered = [];
      // рисуем всё
      redraw();
      // обычный статус
      status.textContent = canDraw ? 'Рисуйте вместе — всё сохраняется' : 'Только просмотр';
    // catch — ошибка
    } catch (error) {
      // в консоль
      logError(error);
      // статус с ошибкой
      status.textContent = `Не удалось загрузить доску: ${getErrorMessage(error)}`;
    // finally — всегда
    } finally {
      // загрузка закончена
      loading = false;
    // конец try/catch/finally
    }
  // конец load
  };

  // open — открыть доску
  const open = () => {
    // показываем
    root.hidden = false;
    // body без прокрутки под доской
    document.body.classList.add('board-open');
    // значок «есть новое» больше не нужен
    openButton.classList.remove('has-news');
    // грузим (один раз)
    load();
    // фокус на кнопку закрытия — удобно с клавиатуры
    document.getElementById('board-close').focus();
  // конец open
  };

  // close — закрыть доску
  const close = () => {
    // если рисуем — заканчиваем линию
    finish();
    // прячем
    root.hidden = true;
    // возвращаем прокрутку
    document.body.classList.remove('board-open');
    // фокус обратно на кнопку «Доска»
    openButton.focus();
  // конец close
  };

  // панель инструментов: цвета, толщины, ластик и действия
  tools.innerHTML = [
    // группа цветов
    `<div class="board-group" role="radiogroup" aria-label="Цвет">${COLORS.map(([value, name], i) => `<button class="board-color${i === 1 ? ' active' : ''}" type="button" data-color="${value}" style="--swatch: ${value}" aria-label="${name}" title="${name}"></button>`).join('')}</div>`,
    // группа толщин: кружок нужного размера
    `<div class="board-group" role="radiogroup" aria-label="Толщина">${SIZES.map(([value, name], i) => `<button class="board-size${i === 0 ? ' active' : ''}" type="button" data-size="${value}" aria-label="${name}" title="${name}"><span style="--dot: ${Math.max(4, value / 1.4)}px"></span></button>`).join('')}</div>`,
    // ластик
    '<div class="board-group"><button class="board-tool" type="button" data-tool="eraser" aria-pressed="false" title="Ластик">🧽<span>Ластик</span></button></div>',
    // действия
    '<div class="board-group board-actions">',
    // отменить
    '<button class="board-tool" type="button" data-action="undo" title="Отменить мою линию (Ctrl+Z)">↶<span>Отменить</span></button>',
    // очистить
    '<button class="board-tool" type="button" data-action="clear" title="Очистить доску для всех">🗑<span>Очистить</span></button>',
    // скачать
    '<button class="board-tool" type="button" data-action="download" title="Скачать картинку">⬇<span>Скачать</span></button>',
    // конец действий
    '</div>',
  // склеиваем
  ].join('');
  // если рисовать нельзя — прячем инструменты рисования, остаётся только «Скачать»
  if (!canDraw) tools.querySelectorAll('.board-color, .board-size, [data-tool], [data-action="undo"], [data-action="clear"]').forEach((el) => { el.hidden = true; });

  // клики по инструментам (делегирование)
  tools.addEventListener('click', (event) => {
    // кнопка цвета
    const colorButton = event.target.closest('[data-color]');
    // выбрали цвет
    if (colorButton) {
      // запоминаем цвет
      color = colorButton.dataset.color;
      // цвет выбирают для карандаша — выключаем ластик
      tool = 'pen';
      // подсветка выбранного цвета
      tools.querySelectorAll('[data-color]').forEach((b) => b.classList.toggle('active', b === colorButton));
      // ластик не нажат
      tools.querySelector('[data-tool]').setAttribute('aria-pressed', 'false');
    // конец if
    }
    // кнопка толщины
    const sizeButton = event.target.closest('[data-size]');
    // выбрали толщину
    if (sizeButton) {
      // запоминаем (Number — строку в число)
      size = Number(sizeButton.dataset.size);
      // подсветка
      tools.querySelectorAll('[data-size]').forEach((b) => b.classList.toggle('active', b === sizeButton));
    // конец if
    }
    // ластик — включить/выключить
    if (event.target.closest('[data-tool="eraser"]')) {
      // переключаем инструмент
      tool = tool === 'eraser' ? 'pen' : 'eraser';
      // aria-pressed — «нажата ли кнопка»
      tools.querySelector('[data-tool]').setAttribute('aria-pressed', String(tool === 'eraser'));
    // конец if
    }
    // действие (отменить, очистить, скачать)
    const action = event.target.closest('[data-action]')?.dataset.action;
    // отменить
    if (action === 'undo') undo();
    // очистить
    if (action === 'clear') clearBoard();
    // скачать
    if (action === 'download') download();
  // конец обработчика
  });

  // кнопка «🎨 Доска» открывает
  openButton.addEventListener('click', open);
  // кнопка ✕ закрывает
  document.getElementById('board-close').addEventListener('click', close);
  // клавиши, пока доска открыта: Esc — закрыть, Ctrl+Z — отменить
  document.addEventListener('keydown', (event) => {
    // доска закрыта или открыто окно подтверждения — не мешаем
    if (root.hidden || document.querySelector('dialog[open]')) return;
    // Esc
    if (event.key === 'Escape') close();
    // Ctrl+Z (или Cmd+Z на Mac); toLowerCase — «Z» и «z»
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && canDraw) {
      // не даём браузеру сделать своё «отменить»
      event.preventDefault();
      // отменяем линию
      undo();
    // конец if
    }
  // конец обработчика
  });

  // Realtime: новые строки доски этого партнёрства
  const channel = supabase
    // отдельный канал для доски
    .channel(`board-${partnershipId}`)
    // только вставки в board_strokes с нашим partnership_id
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'board_strokes', filter: `partnership_id=eq.${partnershipId}` }, (payload) => {
      // новая строка
      const row = payload.new;
      // свои строки уже нарисованы у себя — только запоминаем id
      if (row.author_id === me.id) {
        // запоминаем
        seenIds.add(row.id);
        // стоп
        return;
      // конец if
      }
      // доска закрыта — показываем точку «есть новое» на кнопке
      if (root.hidden) openButton.classList.add('has-news');
      // доска ещё грузится — отложим
      if (loading) {
        // в очередь
        buffered.push(row);
        // стоп
        return;
      // конец if
      }
      // доска ещё не загружалась — при открытии загрузим всё из базы
      if (!loaded) return;
      // рисуем
      applyRow(row);
      // «Лена рисует…»
      if (row.kind === 'pen' || row.kind === 'eraser') showDrawer(row.author_id);
      // партнёр очистил доску — сообщаем
      if (row.kind === 'clear') showToast(`${nameOf(row.author_id)} очистил(а) доску`, 'info');
    // конец обработчика
    })
    // включаем подписку
    .subscribe();
  // уходим со страницы — закрываем канал
  window.addEventListener('pagehide', () => supabase.removeChannel(channel));
  // подсказка для просмотра
  if (!canDraw) document.getElementById('board-readonly').hidden = false;
// конец функции initBoard
}
