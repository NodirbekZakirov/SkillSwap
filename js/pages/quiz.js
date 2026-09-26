// ============================================================================
// Файл: js/pages/quiz.js
// Зачем нужен: страница мини-теста pages/quiz.html?subject=<предмет>.
//   1) проверяет, что предмет отмечен «Знаю» на 4–5 и ещё не подтверждён;
//   2) по кнопке «Начать» просит у базы 5 случайных вопросов (start_quiz) —
//      БЕЗ правильных ответов;
//   3) показывает вопросы по одному: прогресс, варианты А–Г, «Назад/Дальше»,
//      оставшееся время (30 минут), выбор клавишами 1–4;
//   4) отправляет ответы в базу (submit_quiz): база считает результат,
//      ставит отметку «подтверждено» и начисляет очки;
//   5) показывает результат и разбор: где ошибся и почему.
// Как связан с остальными: js/layout.js, js/supabase.js, js/config.js
// (QUIZ_RULES, предметы), js/utils.js. Вход сюда — из профиля (раздел
// «Подтверди свои знания»). SQL-функции — в sql/schema.sql.
// ============================================================================

// запуск страницы
import { initPage } from '../layout.js';
// подключение к Supabase
import { supabase } from '../supabase.js';
// предмет по id и правила теста
import { getSubject, QUIZ_RULES } from '../config.js';
// экранирование, тосты, кнопки, состояния, ошибки
import { escapeHtml, showToast, setButtonLoading, renderState, getErrorMessage, logError } from '../utils.js';

// LETTERS — буквы вариантов ответа
const LETTERS = ['А', 'Б', 'В', 'Г'];

// state — данные страницы
const state = {
  // предмет из адреса (объект из config.js)
  subject: null,
  // номер попытки в базе
  attemptId: null,
  // вопросы попытки: [{ id, question, options }]
  questions: [],
  // выбранные варианты: номер варианта (0–3) или null для каждого вопроса
  answers: [],
  // номер текущего вопроса (с нуля)
  index: 0,
  // когда закончится время (миллисекунды)
  deadline: 0,
  // номер интервала обратного отсчёта (чтобы остановить)
  timerId: null,
  // идёт ли тест прямо сейчас (для предупреждения при уходе со страницы)
  inProgress: false,
// конец объекта state
};

// главная карточка
const card = document.getElementById('quiz-card');

// ----------------------------------------------------------------------------
// renderHero — шапка: иконка, название предмета и плашки с правилами.
// Принимает: ничего. Возвращает: ничего.
// ----------------------------------------------------------------------------
// function
function renderHero() {
  // иконка предмета
  document.getElementById('quiz-icon').textContent = state.subject.icon;
  // «Тест: Алгебра»
  document.getElementById('quiz-title').textContent = `Тест: ${state.subject.name}`;
  // плашки правил
  document.getElementById('quiz-rules').innerHTML = [
    // сколько вопросов
    `<span class="chip">❓ ${QUIZ_RULES.questions} вопросов</span>`,
    // сколько нужно
    `<span class="chip">✅ нужно ${QUIZ_RULES.toPass} верных</span>`,
    // время
    `<span class="chip">⏱ ${QUIZ_RULES.timeLimitMinutes} минут</span>`,
    // награда
    '<span class="chip chip-success">🎯 +10 очков</span>',
  // склеиваем
  ].join('');
  // показываем шапку
  document.getElementById('quiz-hero').hidden = false;
  // название вкладки
  document.title = `Тест: ${state.subject.name} — SkillSwap`;
// конец функции renderHero
}

// ----------------------------------------------------------------------------
// renderIntro — вступление: что будет и кнопка «Начать тест».
// Принимает: ничего. Возвращает: ничего.
// ----------------------------------------------------------------------------
// function
function renderIntro() {
  // HTML вступления
  card.innerHTML = [
    // заголовок
    '<h2 class="quiz-intro-title">Готов показать, что знаешь предмет? 💪</h2>',
    // список правил
    '<ul class="quiz-intro-list">',
    // вопросы
    `<li>Будет <strong>${QUIZ_RULES.questions} случайных вопросов</strong> с четырьмя вариантами ответа.</li>`,
    // порог
    `<li>Ответишь правильно минимум на <strong>${QUIZ_RULES.toPass}</strong> — уровень подтверждён: галочка ✔ в профиле и в подборе, <strong>+10 очков</strong>.</li>`,
    // время
    `<li>На попытку — ${QUIZ_RULES.timeLimitMinutes} минут. Можно возвращаться к прошлым вопросам.</li>`,
    // повтор
    `<li>Не получилось — повторить можно через ${QUIZ_RULES.cooldownMinutes} минут. После теста покажем разбор ошибок.</li>`,
    // конец списка
    '</ul>',
    // кнопка старта
    '<button class="btn btn-primary btn-lg" id="quiz-start" type="button">Начать тест</button>',
  // склеиваем
  ].join('');
  // клик по кнопке — начинаем
  document.getElementById('quiz-start').addEventListener('click', (event) => startQuiz(event.currentTarget));
// конец функции renderIntro
}

// ----------------------------------------------------------------------------
// startQuiz — просит у базы вопросы и показывает первый.
// Принимает: button — кнопка «Начать». Возвращает: Promise.
// ----------------------------------------------------------------------------
// async function
async function startQuiz(button) {
  // защита от двойного нажатия
  if (button.disabled) return;
  // «загрузка»
  setButtonLoading(button, true);
  // try — запрос
  try {
    // SQL-функция сама проверит все правила и выберет 5 случайных вопросов
    const { data, error } = await supabase.rpc('start_quiz', { p_subject: state.subject.id });
    // ошибка — в catch
    if (error) throw error;
    // номер попытки
    state.attemptId = data.attempt_id;
    // вопросы
    state.questions = data.questions;
    // пустые ответы: new Array(n).fill(null) — массив из n значений null
    state.answers = new Array(data.questions.length).fill(null);
    // первый вопрос
    state.index = 0;
    // конец времени: сейчас + 30 минут в миллисекундах
    state.deadline = Date.now() + QUIZ_RULES.timeLimitMinutes * 60 * 1000;
    // тест идёт
    state.inProgress = true;
    // запускаем обратный отсчёт
    startCountdown();
    // показываем вопрос
    renderQuestion();
  // catch — ошибка (например, «Повторить тест можно через 12 мин.»)
  } catch (error) {
    // в консоль
    logError(error);
    // сообщение
    showToast(getErrorMessage(error), 'error');
    // кнопка снова активна
    setButtonLoading(button, false);
  // конец try/catch
  }
// конец функции startQuiz
}

// ----------------------------------------------------------------------------
// formatLeft — «12:05» из количества миллисекунд.
// Принимает: ms. Возвращает: строку.
// ----------------------------------------------------------------------------
// function
function formatLeft(ms) {
  // Math.max(0, ...) — не меньше нуля; переводим в целые секунды
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  // минуты и секунды; padStart(2, '0') — «5» → «05»
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
// конец функции formatLeft
}

// ----------------------------------------------------------------------------
// startCountdown — раз в секунду обновляет оставшееся время; когда время
// вышло — останавливает тест.
// Принимает: ничего. Возвращает: ничего.
// ----------------------------------------------------------------------------
// function
function startCountdown() {
  // setInterval(функция, 1000) — вызывать функцию каждую секунду
  state.timerId = setInterval(() => {
    // сколько осталось
    const left = state.deadline - Date.now();
    // место для времени (есть только на экране вопроса)
    const timer = document.getElementById('quiz-timer');
    // обновляем текст
    if (timer) timer.textContent = `⏱ ${formatLeft(left)}`;
    // меньше минуты — красным
    if (timer) timer.classList.toggle('is-urgent', left < 60 * 1000);
    // время вышло
    if (left <= 0) {
      // останавливаем отсчёт
      clearInterval(state.timerId);
      // тест больше не идёт
      state.inProgress = false;
      // сообщение с кнопкой начать заново (перезагрузка страницы)
      renderState(card, 'error', 'Время вышло', 'На тест даётся 30 минут. Начни заново — вопросы будут другими.', { href: location.pathname + location.search, label: 'Начать заново' });
    // конец if
    }
  // конец функции интервала; 1000 мс = 1 секунда
  }, 1000);
// конец функции startCountdown
}

// ----------------------------------------------------------------------------
// renderQuestion — экран текущего вопроса.
// Принимает: ничего. Возвращает: ничего.
// ----------------------------------------------------------------------------
// function
function renderQuestion() {
  // текущий вопрос
  const question = state.questions[state.index];
  // сколько всего
  const total = state.questions.length;
  // выбранный вариант (или null)
  const chosen = state.answers[state.index];
  // последний ли вопрос
  const isLast = state.index === total - 1;
  // кнопки вариантов; aria-pressed — «нажата ли» для программ чтения с экрана
  const options = question.options.map((option, i) => [
    // кнопка варианта; data-option — номер варианта
    `<button class="quiz-option${chosen === i ? ' selected' : ''}" type="button" data-option="${i}" aria-pressed="${chosen === i}">`,
    // буква варианта
    `<span class="quiz-letter" aria-hidden="true">${LETTERS[i]}</span>`,
    // текст варианта — экранируем
    `<span class="quiz-option-text">${escapeHtml(option)}</span>`,
    // конец кнопки
    '</button>',
  // склеиваем части кнопки, потом все кнопки
  ].join('')).join('');
  // собираем экран
  card.innerHTML = [
    // верх: номер вопроса и время
    '<div class="quiz-top">',
    // «Вопрос 2 из 5»
    `<span class="quiz-counter">Вопрос ${state.index + 1} из ${total}</span>`,
    // время (обновляет startCountdown)
    `<span class="quiz-timer" id="quiz-timer">⏱ ${formatLeft(state.deadline - Date.now())}</span>`,
    // конец верха
    '</div>',
    // полоска прогресса: ширина — доля пройденных вопросов
    `<div class="progress quiz-progress" role="progressbar" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${state.index + 1}" aria-label="Прогресс теста"><div class="progress-bar" style="width: ${((state.index + 1) / total) * 100}%"></div></div>`,
    // текст вопроса — экранируем
    `<h2 class="quiz-question">${escapeHtml(question.question)}</h2>`,
    // варианты
    `<div class="quiz-options" role="group" aria-label="Варианты ответа">${options}</div>`,
    // подсказка про клавиши (на компьютере)
    '<p class="quiz-keys muted">Можно нажимать клавиши 1–4, Enter — дальше.</p>',
    // кнопки навигации
    '<div class="quiz-nav">',
    // «Назад» — со второго вопроса
    state.index > 0 ? '<button class="btn btn-ghost" id="quiz-back" type="button">← Назад</button>' : '<span></span>',
    // «Дальше» или «Проверить»; disabled — пока вариант не выбран
    `<button class="btn btn-primary" id="quiz-next" type="button"${chosen === null ? ' disabled' : ''}>${isLast ? 'Проверить ответы ✓' : 'Дальше →'}</button>`,
    // конец навигации
    '</div>',
  // склеиваем
  ].join('');
// конец функции renderQuestion
}

// ----------------------------------------------------------------------------
// choose — выбрать вариант текущего вопроса.
// Принимает: optionIndex — номер варианта 0–3. Возвращает: ничего.
// ----------------------------------------------------------------------------
// function
function choose(optionIndex) {
  // запоминаем ответ
  state.answers[state.index] = optionIndex;
  // перерисовываем (подсветка и активная кнопка «Дальше»)
  renderQuestion();
// конец функции choose
}

// ----------------------------------------------------------------------------
// goNext — следующий вопрос или отправка ответов на последнем.
// Принимает: ничего. Возвращает: ничего.
// ----------------------------------------------------------------------------
// function
function goNext() {
  // ответ не выбран — дальше нельзя
  if (state.answers[state.index] === null) return;
  // последний вопрос — отправляем
  if (state.index === state.questions.length - 1) {
    // отправка
    submitQuiz(document.getElementById('quiz-next'));
    // стоп
    return;
  // конец if
  }
  // следующий вопрос
  state.index += 1;
  // показываем
  renderQuestion();
// конец функции goNext
}

// ----------------------------------------------------------------------------
// submitQuiz — отправляет ответы в базу и показывает результат.
// Принимает: button — кнопка «Проверить». Возвращает: Promise.
// ----------------------------------------------------------------------------
// async function
async function submitQuiz(button) {
  // защита от двойного нажатия
  if (!button || button.disabled) return;
  // «загрузка»
  setButtonLoading(button, true);
  // try — запрос
  try {
    // проверяет база: ученик не знает правильных ответов
    const { data, error } = await supabase.rpc('submit_quiz', { p_attempt_id: state.attemptId, p_answers: state.answers });
    // ошибка — в catch
    if (error) throw error;
    // тест закончен: останавливаем время
    clearInterval(state.timerId);
    // больше не идёт
    state.inProgress = false;
    // результат
    renderResult(data);
  // catch — ошибка
  } catch (error) {
    // в консоль
    logError(error);
    // сообщение
    showToast(getErrorMessage(error), 'error');
    // кнопка снова активна
    setButtonLoading(button, false);
  // конец try/catch
  }
// конец функции submitQuiz
}

// ----------------------------------------------------------------------------
// reviewHtml — разбор одного вопроса после теста.
// Принимает: item — { question, options, correct, chosen, explanation };
//   number — номер вопроса. Возвращает: строку HTML.
// ----------------------------------------------------------------------------
// function
function reviewHtml(item, number) {
  // верно ли ответил
  const right = item.chosen === item.correct;
  // собираем карточку разбора
  return [
    // пункт; right / wrong — зелёная или красная полоска
    `<li class="quiz-review-item ${right ? 'right' : 'wrong'}">`,
    // номер и вопрос
    `<p class="quiz-review-question"><span aria-hidden="true">${right ? '✅' : '❌'}</span> ${number}. ${escapeHtml(item.question)}</p>`,
    // мой ответ, если неверный
    right ? '' : `<p class="quiz-review-line"><span class="muted">Твой ответ:</span> ${LETTERS[item.chosen]}) ${escapeHtml(item.options[item.chosen] ?? '—')}</p>`,
    // правильный ответ
    `<p class="quiz-review-line"><span class="muted">Правильно:</span> <strong>${LETTERS[item.correct]}) ${escapeHtml(item.options[item.correct])}</strong></p>`,
    // пояснение
    item.explanation ? `<p class="quiz-review-explain">💡 ${escapeHtml(item.explanation)}</p>` : '',
    // конец пункта
    '</li>',
  // склеиваем
  ].join('');
// конец функции reviewHtml
}

// ----------------------------------------------------------------------------
// renderResult — экран результата: круг со счётом, итог и разбор.
// Принимает: result — { score, total, passed, results }. Возвращает: ничего.
// ----------------------------------------------------------------------------
// function
function renderResult(result) {
  // доля верных в процентах (для круга)
  const percent = Math.round((result.score / result.total) * 100);
  // собираем экран
  card.innerHTML = [
    // верхний блок результата; passed / failed — цвет
    `<div class="quiz-result ${result.passed ? 'passed' : 'failed'}">`,
    // круг: --score — переменная CSS, от неё зависит заполнение круга
    `<div class="quiz-score" style="--score: ${percent}"><span><strong>${result.score}</strong>/${result.total}</span></div>`,
    // заголовок: сдал / не хватило одного ответа / не получилось
    result.passed ? '<h2>🎉 Уровень подтверждён!</h2>' : result.score === QUIZ_RULES.toPass - 1 ? '<h2>Почти получилось!</h2>' : '<h2>Пока не получилось — это поправимо 💪</h2>',
    // пояснение
    result.passed
      // сдал
      ? `<p>Теперь у предмета «${escapeHtml(state.subject.name)}» стоит галочка ✔ — её видят в подборе и в твоём профиле. <strong>+10 очков!</strong></p>`
      // не сдал
      : `<p>Нужно ${QUIZ_RULES.toPass} верных ответа. Посмотри разбор ниже, повтори тему — и попробуй снова через ${QUIZ_RULES.cooldownMinutes} минут.</p>`,
    // кнопки
    '<div class="row quiz-result-actions">',
    // в профиль
    '<a class="btn btn-primary" href="/pages/profile.html#verify">К профилю</a>',
    // сдал — можно искать партнёров
    result.passed ? '<a class="btn btn-secondary" href="/pages/matches.html">🔍 К подбору</a>' : '',
    // конец кнопок
    '</div>',
    // конец верхнего блока
    '</div>',
    // заголовок разбора
    '<h3 class="quiz-review-title">Разбор ответов</h3>',
    // список разбора
    `<ol class="quiz-review">${result.results.map((item, i) => reviewHtml(item, i + 1)).join('')}</ol>`,
  // склеиваем
  ].join('');
  // сдал — празднуем всплывающим сообщением
  if (result.passed) showToast('Уровень подтверждён! +10 очков 🎯', 'success');
  // прокручиваем к началу результата
  card.scrollIntoView({ behavior: 'smooth', block: 'start' });
// конец функции renderResult
}

// ----------------------------------------------------------------------------
// checkSkill — можно ли проходить тест по предмету (по сохранённым данным).
// Принимает: userId. Возвращает: Promise<boolean> — показано ли вступление.
// ----------------------------------------------------------------------------
// async function
async function checkSkill(userId) {
  // мой навык по этому предмету; maybeSingle — строка или null
  const { data, error } = await supabase.from('skills').select('kind, level, verified_at').eq('user_id', userId).eq('subject', state.subject.id).maybeSingle();
  // ошибка — бросаем
  if (error) throw error;
  // уже подтверждён
  if (data?.verified_at) {
    // радостное сообщение вместо теста
    renderState(card, 'success', 'Уровень уже подтверждён ✔', `Предмет «${state.subject.name}» отмечен галочкой в профиле и в подборе.`, { href: '/pages/profile.html#verify', label: 'К профилю' });
    // тест не нужен
    return false;
  // конец if
  }
  // не «знаю» или уровень ниже 4
  if (!data || data.kind !== 'know' || data.level < 4) {
    // объясняем, что сделать
    renderState(card, 'empty', 'Тест пока недоступен', `Отметь в профиле предмет «${state.subject.name}» как «Знаю» с уровнем 4 или 5 и сохрани — тогда можно будет подтвердить уровень.`, { href: '/pages/profile.html', label: 'Открыть профиль' });
    // тест недоступен
    return false;
  // конец if
  }
  // всё хорошо — вступление
  renderIntro();
  // тест доступен
  return true;
// конец функции checkSkill
}

// ----------------------------------------------------------------------------
// start — запуск страницы.
// Принимает: ничего. Возвращает: Promise.
// ----------------------------------------------------------------------------
// async function
async function start() {
  // только ученикам; в меню подсвечиваем «Профиль»
  const context = await initPage({ active: 'profile', roles: ['student'] });
  // нельзя показывать — выходим
  if (!context) return;
  // предмет из адреса ?subject=algebra
  const subjectId = new URLSearchParams(location.search).get('subject') ?? '';
  // находим предмет; неизвестный id getSubject вернёт «как есть»
  state.subject = getSubject(subjectId);
  // проверка: такой предмет есть в списке (для неизвестного id getSubject возвращает название, равное самому id)
  if (!subjectId || state.subject.name === subjectId) {
    // сообщение
    renderState(card, 'error', 'Предмет не найден', 'Открой тест из профиля, раздел «Подтверди свои знания».', { href: '/pages/profile.html#verify', label: 'К профилю' });
    // стоп
    return;
  // конец if
  }
  // шапка теста
  renderHero();
  // try — проверка навыка
  try {
    // вступление или объяснение, почему теста нет
    await checkSkill(context.user.id);
  // catch — ошибка
  } catch (error) {
    // в консоль
    logError(error);
    // сообщение
    renderState(card, 'error', 'Не удалось открыть тест', getErrorMessage(error), { href: location.pathname + location.search, label: 'Попробовать ещё раз' });
  // конец try/catch
  }
  // клики внутри карточки (делегирование): варианты и кнопки навигации
  card.addEventListener('click', (event) => {
    // кнопка варианта
    const option = event.target.closest('[data-option]');
    // выбрали вариант
    if (option) choose(Number(option.dataset.option));
    // «Назад»
    if (event.target.closest('#quiz-back')) {
      // предыдущий вопрос
      state.index -= 1;
      // показываем
      renderQuestion();
    // конец if
    }
    // «Дальше» / «Проверить»
    if (event.target.closest('#quiz-next')) goNext();
  // конец обработчика
  });
  // клавиши: 1–4 — выбор варианта, Enter — дальше (только во время теста)
  document.addEventListener('keydown', (event) => {
    // тест не идёт или фокус в поле ввода — не мешаем
    if (!state.inProgress || event.target.closest('input, textarea')) return;
    // «1»–«4» → 0–3; indexOf вернёт -1, если это другая клавиша
    const optionIndex = ['1', '2', '3', '4'].indexOf(event.key);
    // нажали цифру
    if (optionIndex >= 0) choose(optionIndex);
    // Enter — дальше (если фокус не на кнопке: там Enter и так нажмёт кнопку)
    if (event.key === 'Enter' && !event.target.closest('button')) goNext();
  // конец обработчика
  });
  // уходит со страницы во время теста — браузер спросит «Покинуть страницу?»
  window.addEventListener('beforeunload', (event) => {
    // тест не идёт — не мешаем
    if (!state.inProgress) return;
    // включаем стандартный вопрос браузера
    event.preventDefault();
  // конец обработчика
  });
// конец функции start
}

// запускаем страницу
start();
