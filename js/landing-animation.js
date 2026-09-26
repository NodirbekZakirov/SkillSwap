// ============================================================================
// Файл: js/landing-animation.js
// Зачем нужен: две анимации на главной странице (index.html), которые
// наглядно показывают, как работает подбор:
//   1) initPairDemo — «пара»: Амир и Лена обмениваются предметами, а круг
//      показывает процент совместимости;
//   2) initTriadDemo — «тройка»: Амир → Лена → Тимур → Амир.
// Как устроено: анимация разбита на ШАГИ. Каждый шаг длится несколько секунд,
// потом включается следующий, после последнего всё начинается сначала.
// Функция render каждого демо по номеру шага ставит классы show-1, show-2…
// (на них смотрит CSS в css/landing.css) и двигает кружки-предметы по линиям.
// Забота о пользователе: анимация стоит на паузе, когда её не видно (блок за
// краем экрана или вкладка свёрнута); если в настройках системы включено
// «уменьшить движение», сразу показывается готовый итог без движения.
// Как связан с остальными: функции вызывает js/pages/landing.js; разметка —
// в index.html (id="pair-demo", id="triad-demo" и id="triad-steps").
// ============================================================================

// REDUCED_MOTION — true, если человек попросил систему уменьшить движение; matchMedia проверяет медиа-запрос прямо из JavaScript
const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
// FLOW_DURATION — сколько миллисекунд предмет летит по линии (1.3 секунды)
const FLOW_DURATION = 1300;

// PAIR_STEPS — шаги анимации пары: text — подпись под рисунком, ms — сколько длится шаг
const PAIR_STEPS = [
  // шаг 0: поиск
  { text: '🔍 Ищем партнёра для Амира…', ms: 1800 },
  // шаг 1: английский летит от Амира к Лене
  { text: 'Амир знает английский, а Лене он как раз нужен', ms: 2200 },
  // шаг 2: алгебра летит от Лены к Амиру
  { text: 'Лена знает алгебру, а Амиру она как раз нужна', ms: 2200 },
  // шаг 3: считаем процент по весам алгоритма (знания 40, время 35, класс 25)
  { text: 'Совместимость: знания 40 + время 30 + класс 22 = 92%', ms: 2600 },
  // шаг 4: итог
  { text: '✅ Пара найдена! Амир поможет Лене с английским, а Лена ему — с алгеброй', ms: 3600 },
// конец массива
];
// PAIR_PERCENT — процент совместимости в примере
const PAIR_PERCENT = 92;
// PAIR_RING_STEP — на каком шаге заполняется круг совместимости
const PAIR_RING_STEP = 3;

// TRIAD_STEPS — шаги анимации тройки: text — надпись в центре схемы, ms — длительность
const TRIAD_STEPS = [
  // шаг 0: прямой пары нет
  { text: 'Прямой пары нет 🤔', ms: 2200 },
  // шаг 1: Амир → Лена
  { text: '🔤 Английский', ms: 2300 },
  // шаг 2: Лена → Тимур
  { text: '🧪 Химия', ms: 2300 },
  // шаг 3: Тимур → Амир
  { text: '📐 Геометрия', ms: 2300 },
  // шаг 4: круг замкнулся
  { text: 'Тройка найдена! 🎉', ms: 3600 },
// конец массива
];

// ----------------------------------------------------------------------------
// easeInOut — «плавность»: движение медленно начинается, разгоняется и
// плавно тормозит в конце (так выглядит естественнее, чем равномерно).
// Принимает: t — доля пути от 0 до 1. Возвращает: новую долю от 0 до 1.
// ----------------------------------------------------------------------------
// function — объявление функции
function easeInOut(t) {
  // ? : — короткое «если-иначе»; первая половина пути: 2·t² (медленный старт), вторая — зеркально; ** — возведение в степень
  return t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2;
// конец функции easeInOut
}

// ----------------------------------------------------------------------------
// tween — плавно меняет долю от 0 до 1 за duration миллисекунд и на каждом
// кадре экрана вызывает onFrame с текущей долей.
// Принимает: duration — длительность (мс); onFrame(t) — что делать с долей t.
// Возвращает: функцию, которая отменяет анимацию.
// ----------------------------------------------------------------------------
// function — объявление функции
function tween(duration, onFrame) {
  // performance.now() — точное текущее время в миллисекундах; запоминаем момент старта
  const start = performance.now();
  // let — переменная, которую можно менять; тут будет номер запрошенного кадра (нужен для отмены)
  let frameId = 0;
  // frame — эту функцию браузер вызывает перед каждой перерисовкой экрана (примерно 60 раз в секунду); now — время кадра
  const frame = (now) => {
    // сколько прошло, делённое на длительность = доля; Math.min — не больше 1
    const t = Math.min((now - start) / duration, 1);
    // передаём сглаженную долю
    onFrame(easeInOut(t));
    // если ещё не дошли до конца — просим следующий кадр
    if (t < 1) frameId = requestAnimationFrame(frame);
  // конец функции frame
  };
  // requestAnimationFrame — попросить браузер вызвать frame на следующем кадре
  frameId = requestAnimationFrame(frame);
  // возвращаем функцию отмены; cancelAnimationFrame отменяет запрошенный кадр
  return () => cancelAnimationFrame(frameId);
// конец функции tween
}

// ----------------------------------------------------------------------------
// setFlow — рисует часть линии (долю t) и ставит кружок-предмет в конец
// нарисованной части: кажется, что предмет «тянет» линию за собой.
// Принимает: path — линия <path>; token — кружок <g>; t — доля от 0 до 1.
// Возвращает: ничего.
// ----------------------------------------------------------------------------
// function — объявление функции
function setFlow(path, token, t) {
  // getTotalLength — полная длина линии в единицах рисунка
  const length = path.getTotalLength();
  // stroke-dasharray — линия рисуется «штрихами»: штрих во всю длину и такой же промежуток
  path.style.strokeDasharray = `${length} ${length}`;
  // stroke-dashoffset — сдвиг штриха: при t = 0 линия не видна, при t = 1 видна целиком
  path.style.strokeDashoffset = String(length * (1 - t));
  // getPointAtLength — точка на линии на нужном расстоянии от начала (у неё есть x и y)
  const point = path.getPointAtLength(length * t);
  // переносим кружок в эту точку; translate(x y) — сдвиг в SVG
  token.setAttribute('transform', `translate(${point.x} ${point.y})`);
// конец функции setFlow
}

// ----------------------------------------------------------------------------
// setStepClasses — отмечает номер шага для CSS: атрибут data-step и классы
// show-1…show-N (класс show-2 значит «шаг 2 уже был или идёт сейчас»).
// Принимает: root — блок демо; step — текущий шаг; lastStep — последний шаг.
// Возвращает: ничего.
// ----------------------------------------------------------------------------
// function — объявление функции
function setStepClasses(root, step, lastStep) {
  // dataset.step — это атрибут data-step в HTML; CSS может выбрать, например, [data-step="1"]
  root.dataset.step = String(step);
  // for — цикл по номерам от 1 до последнего шага; i += 1 — увеличиваем на 1
  for (let i = 1; i <= lastStep; i += 1) {
    // classList.toggle(имя, условие) — добавляет класс, если условие true, и убирает, если false
    root.classList.toggle(`show-${i}`, step >= i);
  // конец цикла
  }
// конец функции setStepClasses
}

// ----------------------------------------------------------------------------
// setStatus — меняет подпись и плавно её показывает.
// Принимает: element — где подпись; text — новый текст; instant — true, если
//   без анимации. Возвращает: ничего.
// ----------------------------------------------------------------------------
// function — объявление функции
function setStatus(element, text, instant) {
  // текст тот же — ничего не делаем
  if (element.textContent === text) return;
  // textContent — вставляем как обычный текст (не HTML), так безопасно
  element.textContent = text;
  // без анимации — выходим
  if (instant) return;
  // animate — встроенная в браузер анимация (Web Animations API): от прозрачного и сдвинутого вниз к обычному виду за 0.35 с;
  // свойство translate (а не transform) — чтобы не сбить центрирование, которое у надписи задано через transform в CSS
  element.animate([{ opacity: 0, translate: '0 6px' }, { opacity: 1, translate: '0 0' }], { duration: 350, easing: 'ease-out' });
// конец функции setStatus
}

// ----------------------------------------------------------------------------
// startLoop — запускает смену шагов по кругу. Ставит на паузу, когда блок не
// виден на экране или вкладка свёрнута, и продолжает, когда снова виден.
// Принимает: root — блок демо; durations — длительности шагов (мс);
//   render(step, instant) — рисует шаг (instant = true — сразу итог шага).
// Возвращает: ничего.
// ----------------------------------------------------------------------------
// function — объявление функции
function startLoop(root, durations, render) {
  // номер последнего шага (нумерация с 0)
  const lastStep = durations.length - 1;
  // если просили уменьшить движение — сразу рисуем итог и больше ничего не запускаем
  if (REDUCED_MOTION) {
    // последний шаг без движения
    render(lastStep, true);
    // return — выходим из функции
    return;
  // конец if
  }
  // текущий шаг
  let step = 0;
  // таймер следующего шага; null значит «анимация на паузе»
  let timer = null;
  // виден ли блок на экране
  let visible = false;
  // play — показать текущий шаг и завести таймер на следующий
  const play = () => {
    // рисуем шаг с движением
    render(step, false);
    // setTimeout — выполнить функцию один раз через durations[step] миллисекунд
    timer = setTimeout(() => {
      // % — остаток от деления: после последнего шага снова получится 0
      step = (step + 1) % durations.length;
      // показываем следующий шаг
      play();
    // закрываем setTimeout
    }, durations[step]);
  // конец функции play
  };
  // pause — остановить смену шагов
  const pause = () => {
    // clearTimeout — отменить таймер
    clearTimeout(timer);
    // отмечаем паузу
    timer = null;
  // конец функции pause
  };
  // resume — продолжить, если блок виден, вкладка открыта и анимация сейчас на паузе
  const resume = () => {
    // document.hidden — true, если вкладка свёрнута; === null — таймер не идёт
    if (visible && !document.hidden && timer === null) play();
  // конец функции resume
  };
  // сразу рисуем первый шаг без движения, чтобы до запуска рисунок не был пустым
  render(step, true);
  // IntersectionObserver — «наблюдатель», сообщает, виден ли элемент на экране; threshold: 0.35 — виден хотя бы на 35%
  const observer = new IntersectionObserver(([entry]) => {
    // [entry] — берём первую запись из массива; isIntersecting — true, если блок в поле зрения
    visible = entry.isIntersecting;
    // виден — продолжаем, не виден — пауза
    if (visible) resume(); else pause();
  // закрываем функцию наблюдателя и передаём настройки
  }, { threshold: 0.35 });
  // observe — начинаем следить за блоком
  observer.observe(root);
  // addEventListener('visibilitychange') — событие «вкладку свернули или развернули»
  document.addEventListener('visibilitychange', () => {
    // свернули — пауза, развернули — продолжаем
    if (document.hidden) pause(); else resume();
  // конец обработчика
  });
// конец функции startLoop
}

// ----------------------------------------------------------------------------
// initPairDemo — анимация «как находится пара» на первом экране.
// Принимает: root — блок id="pair-demo" (или null). Возвращает: ничего.
// ----------------------------------------------------------------------------
// export — функцию можно импортировать в других файлах
export function initPairDemo(root) {
  // блока нет на странице — выходим
  if (!root) return;
  // две линии обмена: для каждой находим линию [data-flow] и кружок [data-token] с тем же номером
  const flows = [1, 2].map((n) => ({ path: root.querySelector(`[data-flow="${n}"]`), token: root.querySelector(`[data-token="${n}"]`) }));
  // цветная дуга круга совместимости
  const ring = root.querySelector('.ring-fill');
  // текст в центре круга
  const value = root.querySelector('.match-value');
  // подпись под рисунком
  const status = root.querySelector('.demo-status');
  // cancels — функции отмены анимаций, которые сейчас идут
  let cancels = [];
  // setPercent — заполняет круг на p процентов и пишет число
  const setPercent = (p) => {
    // у дуги pathLength="100", поэтому сдвиг 100 − p оставляет видимыми ровно p «процентов» окружности
    ring.style.strokeDashoffset = String(100 - p);
    // Math.round — округляем до целого
    value.textContent = `${Math.round(p)}%`;
  // конец функции setPercent
  };
  // render — рисует шаг step; instant — сразу конечное состояние шага
  const render = (step, instant) => {
    // останавливаем анимации прошлого шага
    cancels.forEach((cancel) => cancel());
    // очищаем список
    cancels = [];
    // классы show-N и data-step для CSS
    setStepClasses(root, step, PAIR_STEPS.length - 1);
    // подпись шага
    setStatus(status, PAIR_STEPS[step].text, instant);
    // forEach — для каждой линии; index — её номер в массиве (0 или 1)
    flows.forEach((flow, index) => {
      // линия 1 летит на шаге 1, линия 2 — на шаге 2
      const flowStep = index + 1;
      // сейчас её шаг и нужна анимация — запускаем полёт и запоминаем функцию отмены
      if (step === flowStep && !instant) cancels.push(tween(FLOW_DURATION, (t) => setFlow(flow.path, flow.token, t)));
      // иначе ставим сразу: линия уже нарисована (1) или ещё нет (0)
      else setFlow(flow.path, flow.token, step >= flowStep ? 1 : 0);
    // конец forEach
    });
    // до шага с процентом круг пустой
    if (step < PAIR_RING_STEP) {
      // пустая дуга
      ring.style.strokeDashoffset = '100';
      // в центре: лупа во время поиска, потом значок обмена
      value.textContent = step === 0 ? '🔍' : '⇄';
    // шаг с процентом и нужна анимация — число и дуга растут от 0 до 92
    } else if (step === PAIR_RING_STEP && !instant) {
      // tween на 1.4 с; t — доля от 0 до 1
      cancels.push(tween(1400, (t) => setPercent(PAIR_PERCENT * t)));
    // иначе — сразу 92%
    } else {
      // полный процент
      setPercent(PAIR_PERCENT);
    // конец условия
    }
  // конец функции render
  };
  // map — берём из шагов только длительности и запускаем круг шагов
  startLoop(root, PAIR_STEPS.map((s) => s.ms), render);
// конец функции initPairDemo
}

// ----------------------------------------------------------------------------
// initTriadDemo — анимация «как находится тройка».
// Принимает: root — схема id="triad-demo"; list — список шагов id="triad-steps"
//   (его пункты подсвечиваются вместе со схемой). Возвращает: ничего.
// ----------------------------------------------------------------------------
// export — функцию можно импортировать в других файлах
export function initTriadDemo(root, list) {
  // схемы нет — выходим
  if (!root) return;
  // три стрелки: Амир → Лена, Лена → Тимур, Тимур → Амир
  const flows = [1, 2, 3].map((n) => ({ path: root.querySelector(`[data-flow="${n}"]`), token: root.querySelector(`[data-token="${n}"]`) }));
  // надпись в центре схемы
  const center = root.querySelector('.cycle-center');
  // пункты списка; ?? [] — если списка нет, берём пустой массив; [...] превращает список элементов в обычный массив
  const items = [...(list?.querySelectorAll('li') ?? [])];
  // функции отмены идущих анимаций
  let cancels = [];
  // render — рисует шаг step
  const render = (step, instant) => {
    // останавливаем анимации прошлого шага
    cancels.forEach((cancel) => cancel());
    // очищаем список
    cancels = [];
    // классы show-N и data-step для CSS
    setStepClasses(root, step, TRIAD_STEPS.length - 1);
    // надпись в центре
    setStatus(center, TRIAD_STEPS[step].text, instant);
    // для каждой стрелки
    flows.forEach((flow, index) => {
      // стрелка 1 рисуется на шаге 1, 2 — на шаге 2, 3 — на шаге 3
      const flowStep = index + 1;
      // её шаг — анимируем полёт предмета
      if (step === flowStep && !instant) cancels.push(tween(FLOW_DURATION, (t) => setFlow(flow.path, flow.token, t)));
      // иначе сразу нарисована или спрятана
      else setFlow(flow.path, flow.token, step >= flowStep ? 1 : 0);
    // конец forEach
    });
    // подсветка пунктов списка
    items.forEach((item) => {
      // Number — номер шага, к которому относится пункт (атрибут data-for)
      const itemStep = Number(item.dataset.for);
      // is-active — пункт текущего шага
      item.classList.toggle('is-active', itemStep === step);
      // is-done — пункт уже пройден
      item.classList.toggle('is-done', itemStep < step);
    // конец forEach
    });
  // конец функции render
  };
  // запускаем круг шагов
  startLoop(root, TRIAD_STEPS.map((s) => s.ms), render);
// конец функции initTriadDemo
}
