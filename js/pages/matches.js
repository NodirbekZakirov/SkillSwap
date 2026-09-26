// ============================================================================
// Файл: js/pages/matches.js
// Зачем нужен: экран «Совпадения» (pages/matches.html):
//   1) загружает из Supabase учеников своей школы, их предметы и время,
//      свои блокировки и текущие партнёрства;
//   2) передаёт данные в алгоритм js/matching.js;
//   3) рисует карточки пар и троек, фильтры, понятные сообщения для
//      крайних случаев;
//   4) по кнопке «Предложить обмен» создаёт запрос (SQL-функция
//      create_partnership, которая ещё раз проверяет правила на сервере);
//   5) уведомляет учеников о новых совпадениях (SQL-функция notify_new_match).
// Как связан с остальными: js/layout.js, js/supabase.js, js/matching.js,
// js/config.js, js/ui.js, js/utils.js.
// ============================================================================

// запуск страницы
import { initPage } from '../layout.js';
// подключение к Supabase
import { supabase } from '../supabase.js';
// списки предметов и классов
import { SUBJECTS, GRADES } from '../config.js';
// алгоритм подбора
import { buildStudents, findMatchesForStudent, filterMatches, explainMatch, displayName, WEIGHTS } from '../matching.js';
// плашка предмета
import { subjectChipHtml, verifiedMarkHtml } from '../ui.js';
// экранирование, тосты, защита кнопки, состояния, ошибки
import { escapeHtml, showToast, setButtonLoading, renderState, getErrorMessage, logError } from '../utils.js';

// state — все данные страницы в одном объекте
const state = {
  // мой профиль
  me: null,
  // все ученики школы в формате алгоритма
  students: [],
  // id учеников, которых не предлагаем (уже партнёры, блокировки)
  excludedIds: [],
  // текущие фильтры
  filters: { subject: '', grade: '' },
  // совпадения, показанные сейчас: Map «id совпадения → совпадение» (нужен кнопке «Предложить»)
  shown: new Map(),
  // id совпадений, которым уже отправлен запрос в этот раз
  sent: new Set(),
// конец объекта state
};

// элемент для состояний (загрузка, пусто, ошибка)
const stateBox = document.getElementById('matches-state');
// блок с совпадениями
const content = document.getElementById('matches-content');

// ----------------------------------------------------------------------------
// loadSchoolData — загружает всё, что нужно алгоритму, пятью запросами сразу.
// RLS в базе сама ограничивает данные школой ученика.
// Принимает: profile — мой профиль.
// Возвращает: Promise с { students, excludedIds }.
// ----------------------------------------------------------------------------
// async function
async function loadSchoolData(profile) {
  // Promise.all — ждём, пока выполнятся ВСЕ запросы; результаты в том же порядке
  const [profilesRes, skillsRes, availabilityRes, blocksRes, partnershipsRes] = await Promise.all([
    // ученики моей школы: eq — «равно»
    supabase.from('profiles').select('id, first_name, last_initial, avatar, grade, is_blocked').eq('school_id', profile.school_id).eq('role', 'student'),
    // предметы всех учеников школы (RLS отдаёт только мою школу)
    supabase.from('skills').select('user_id, subject, kind, level, verified_at'),
    // удобное время учеников школы
    supabase.from('availability').select('user_id, day, part'),
    // блокировки, где я участвую с любой стороны
    supabase.from('blocks').select('blocker_id, blocked_id'),
    // мои незаконченные партнёрства с участниками; in — «одно из значений списка»
    supabase.from('partnerships').select('id, status, partnership_members(user_id)').in('status', ['pending', 'active']),
  // конец списка запросов
  ]);
  // первый ответ с ошибкой (если есть)
  const failed = [profilesRes, skillsRes, availabilityRes, blocksRes, partnershipsRes].find((res) => res.error);
  // бросаем ошибку — её поймает start
  if (failed) throw failed.error;
  // ученики в формате алгоритма
  const students = buildStudents(profilesRes.data, skillsRes.data, availabilityRes.data);
  // Set — без повторов; сюда соберём, кого не предлагать
  const excluded = new Set();
  // все участники моих партнёрств (кроме меня)
  partnershipsRes.data.forEach((partnership) => partnership.partnership_members.forEach((member) => {
    // себя не исключаем
    if (member.user_id !== profile.id) excluded.add(member.user_id);
  // конец forEach
  }));
  // вторая сторона каждой блокировки: кого заблокировал я или кто заблокировал меня
  blocksRes.data.forEach((block) => excluded.add(block.blocker_id === profile.id ? block.blocked_id : block.blocker_id));
  // возвращаем данные
  return { students, excludedIds: [...excluded] };
// конец функции loadSchoolData
}

// ----------------------------------------------------------------------------
// percentClass — CSS-класс цвета процента: высокий, средний, низкий.
// Принимает: percent. Возвращает: строку класса.
// ----------------------------------------------------------------------------
// function
function percentClass(percent) {
  // 75 и выше — зелёный
  if (percent >= 75) return 'percent-high';
  // 50–74 — индиго
  if (percent >= 50) return 'percent-mid';
  // ниже 50 — янтарный
  return 'percent-low';
// конец функции percentClass
}

// ----------------------------------------------------------------------------
// detailsHtml — раскрывающийся блок «Из чего сложился процент».
// Принимает: match. Возвращает: строку HTML.
// ----------------------------------------------------------------------------
// function
function detailsHtml(match) {
  // <details> — стандартный раскрывающийся блок HTML, <summary> — его заголовок
  return [
    // начало блока
    '<details class="match-details">',
    // заголовок, по клику раскрывается
    '<summary>Из чего сложился процент</summary>',
    // список частей
    '<ul>',
    // знания
    `<li>📚 Знания: <strong>${match.parts.level}</strong> из ${WEIGHTS.level}</li>`,
    // время
    `<li>🕒 Общее время: <strong>${match.parts.time}</strong> из ${WEIGHTS.time}</li>`,
    // классы
    `<li>🎒 Близость классов: <strong>${match.parts.grade}</strong> из ${WEIGHTS.grade}</li>`,
    // конец списка
    '</ul>',
    // конец блока
    '</details>',
  // склеиваем
  ].join('');
// конец функции detailsHtml
}

// ----------------------------------------------------------------------------
// actionHtml — кнопка «Предложить обмен» или отметка «Запрос отправлен».
// Принимает: match; label — текст кнопки. Возвращает: строку HTML.
// ----------------------------------------------------------------------------
// function
function actionHtml(match, label) {
  // если запрос уже отправлен — зелёная плашка вместо кнопки
  if (state.sent.has(match.id)) return '<span class="chip chip-success match-sent">✓ Запрос отправлен — ждём ответа</span>';
  // data-propose хранит id совпадения; по нему обработчик клика найдёт совпадение
  return `<button class="btn btn-primary btn-block" type="button" data-propose="${escapeHtml(match.id)}">${label}</button>`;
// конец функции actionHtml
}

// ----------------------------------------------------------------------------
// pairCardHtml — карточка пары.
// Принимает: match — совпадение типа 'pair'. Возвращает: строку HTML.
// ----------------------------------------------------------------------------
// function
function pairCardHtml(match) {
  // партнёр — второй участник
  const partner = match.members[1];
  // связи: первая — я учу партнёра, вторая — партнёр учит меня
  const [iTeach, theyTeach] = match.links;
  // собираем карточку
  return [
    // article — самостоятельный блок содержимого
    '<article class="card card-hover match-card fade-in">',
    // верхняя строка: аватар, имя, процент
    '<div class="match-head">',
    // аватар
    `<span class="avatar" aria-hidden="true">${escapeHtml(partner.avatar)}</span>`,
    // имя и класс
    `<div class="match-person"><h3><a class="person-link" href="/pages/user.html?id=${encodeURIComponent(partner.id)}">${escapeHtml(displayName(partner))}</a></h3><span class="muted">${partner.grade ?? '?'} класс</span></div>`,
    // процент совместимости
    `<div class="match-percent ${percentClass(match.percent)}" title="Совместимость"><strong>${match.percent}%</strong><span>совпадение</span></div>`,
    // конец верхней строки
    '</div>',
    // что получаю и что даю
    '<div class="match-exchange">',
    // что получаю: предмет, уровень помощника и отметка «подтверждено тестом», если она есть
    `<div class="match-line"><span class="match-line-label">Тебе помогут</span>${subjectChipHtml(theyTeach.subject, null, 'success')}<span class="muted">уровень партнёра ${theyTeach.helperLevel}, твой ${theyTeach.learnerLevel}</span>${theyTeach.verified ? verifiedMarkHtml() : ''}</div>`,
    // что даю
    `<div class="match-line"><span class="match-line-label">Ты поможешь</span>${subjectChipHtml(iTeach.subject, null, 'primary')}<span class="muted">твой уровень ${iTeach.helperLevel}, у партнёра ${iTeach.learnerLevel}</span></div>`,
    // конец блока обмена
    '</div>',
    // объяснение простыми словами
    `<p class="match-explain">💬 ${escapeHtml(explainMatch(match))}</p>`,
    // из чего сложился процент
    detailsHtml(match),
    // кнопка
    actionHtml(match, 'Предложить обмен'),
    // конец карточки
    '</article>',
  // склеиваем
  ].join('');
// конец функции pairCardHtml
}

// ----------------------------------------------------------------------------
// tripleCardHtml — карточка тройки.
// Принимает: match — совпадение типа 'triple'. Возвращает: строку HTML.
// ----------------------------------------------------------------------------
// function
function tripleCardHtml(match) {
  // имя участника: «Ты» для себя
  const nameOf = (student) => (student.id === state.me.id ? 'Ты' : displayName(student));
  // строки «кто → кому: предмет»
  const steps = match.links.map((link) => [
    // пункт списка
    '<li class="triple-step">',
    // кто помогает
    `<span class="avatar avatar-sm" aria-hidden="true">${escapeHtml(link.teacher.avatar)}</span><strong>${escapeHtml(nameOf(link.teacher))}</strong>`,
    // стрелка
    '<span aria-hidden="true">→</span>',
    // кому
    `<span class="avatar avatar-sm" aria-hidden="true">${escapeHtml(link.learner.avatar)}</span><strong>${escapeHtml(nameOf(link.learner))}</strong>`,
    // предмет
    subjectChipHtml(link.subject, null, 'primary'),
    // галочка, если уровень помощника подтверждён тестом
    link.verified ? verifiedMarkHtml(true) : '',
    // конец пункта
    '</li>',
  // склеиваем части одного пункта
  ].join('')).join('');
  // собираем карточку
  return [
    // карточка
    '<article class="card card-hover match-card fade-in">',
    // верхняя строка
    '<div class="match-head">',
    // три аватара по кругу
    `<div class="triple-avatars" aria-hidden="true">${match.members.map((m) => `<span class="avatar">${escapeHtml(m.avatar)}</span>`).join('')}</div>`,
    // подпись
    `<div class="match-person"><h3>Тройка</h3><span class="muted">${escapeHtml(match.members.slice(1).map(displayName).join(' и '))}</span></div>`,
    // процент
    `<div class="match-percent ${percentClass(match.percent)}" title="Совместимость"><strong>${match.percent}%</strong><span>совпадение</span></div>`,
    // конец верхней строки
    '</div>',
    // шаги круга
    `<ol class="triple-steps">${steps}</ol>`,
    // объяснение
    `<p class="match-explain">💬 ${escapeHtml(explainMatch(match))}</p>`,
    // из чего сложился процент
    detailsHtml(match),
    // кнопка
    actionHtml(match, 'Предложить обмен втроём'),
    // конец карточки
    '</article>',
  // склеиваем
  ].join('');
// конец функции tripleCardHtml
}

// ----------------------------------------------------------------------------
// renderEmptyStatus — понятное сообщение для крайних случаев алгоритма.
// Принимает: result — ответ findMatchesForStudent. Возвращает: ничего.
// ----------------------------------------------------------------------------
// function
function renderEmptyStatus(result) {
  // прячем блок совпадений
  content.hidden = true;
  // ссылка на профиль (используется в нескольких сообщениях)
  const toProfile = { href: '/pages/profile.html', label: 'Заполнить профиль' };
  // switch — выбор действия по значению (как несколько if подряд)
  switch (result.status) {
    // заблокирован учителем
    case 'blocked':
      // сообщение
      renderState(stateBox, 'error', 'Подбор недоступен', 'Учитель ограничил твой аккаунт. Обратись к учителю своей школы.');
      // break — выйти из switch
      break;
    // профиль не заполнен
    case 'incomplete': {
      // собираем, чего не хватает
      const needs = [];
      // нет «хочу подтянуть»
      if (result.missing.includes('learn')) needs.push('предмет, который хочешь подтянуть');
      // нет «знаю на 4–5»
      if (result.missing.includes('know')) needs.push('предмет, который знаешь на 4–5');
      // сообщение со списком
      renderState(stateBox, 'empty', 'Пока нет совпадений — заполни профиль', `Отметь в профиле ${needs.join(' и ')}. Тогда мы сможем найти тебе партнёра.`, toProfile);
      // выход
      break;
    // конец case
    }
    // мало учеников
    case 'few-students':
      // сообщение
      renderState(stateBox, 'empty', 'В твоей школе пока мало учеников', 'Как только одноклассники зарегистрируются и заполнят профили, здесь появятся совпадения. Позови друзей!');
      // выход
      break;
    // нет профиля в списке учеников школы
    case 'no-profile':
      // сообщение
      renderState(stateBox, 'error', 'Не удалось найти тебя среди учеников школы', 'Проверь, что в профиле указана школа, или обратись к администратору.');
      // выход
      break;
    // default — все остальные случаи: совпадений нет
    default:
      // сообщение с подсказкой
      renderState(stateBox, 'empty', 'Пока нет совпадений', 'Попробуй отметить больше предметов или удобного времени. Мы сообщим, когда появится подходящий партнёр.', { href: '/pages/profile.html', label: 'Изменить профиль' });
  // конец switch
  }
// конец функции renderEmptyStatus
}

// ----------------------------------------------------------------------------
// render — запускает алгоритм с текущими фильтрами и рисует результат.
// Принимает: ничего. Возвращает: ничего.
// ----------------------------------------------------------------------------
// function
function render() {
  // алгоритм; предмет из фильтра выбирается для связи, если подходит
  const result = findMatchesForStudent(state.me.id, state.students, { excludedIds: state.excludedIds, preferredSubject: state.filters.subject });
  // крайние случаи — сообщение вместо карточек
  if (result.status !== 'ok') {
    // рисуем сообщение
    renderEmptyStatus(result);
    // выход
    return;
  // конец if
  }
  // очищаем блок состояний
  stateBox.innerHTML = '';
  // показываем совпадения
  content.hidden = false;
  // подсказка про время
  document.getElementById('time-hint').hidden = !result.noTime;
  // применяем фильтры
  const pairs = filterMatches(result.pairs, state.filters);
  // и к тройкам
  const triples = filterMatches(result.triples, state.filters);
  // запоминаем показанные совпадения по id; new Map([[ключ, значение], ...])
  state.shown = new Map([...pairs, ...triples].map((match) => [match.id, match]));
  // счётчики
  document.getElementById('pairs-count').textContent = String(pairs.length);
  // счётчик троек
  document.getElementById('triples-count').textContent = String(triples.length);
  // список пар
  const pairsList = document.getElementById('pairs-list');
  // список троек
  const triplesList = document.getElementById('triples-list');
  // карточки пар или сообщение
  if (pairs.length > 0) pairsList.innerHTML = pairs.map(pairCardHtml).join('');
  // если пар нет: при фильтрах — «по фильтрам ничего», без фильтров — «пар нет, смотри тройки»
  else renderState(pairsList, 'empty', result.pairs.length > 0 ? 'По этим фильтрам пар нет' : 'Прямых пар пока нет', result.pairs.length > 0 ? 'Попробуй сбросить фильтры.' : 'Посмотри тройки ниже.');
  // карточки троек или сообщение
  if (triples.length > 0) triplesList.innerHTML = triples.map(tripleCardHtml).join('');
  // тройки не искали, потому что пары есть
  else if (result.pairs.length > 0) renderState(triplesList, 'empty', 'Тройки не нужны', 'У тебя есть прямые пары — это удобнее.');
  // тройки искали, но по фильтрам их нет или нет совсем
  else renderState(triplesList, 'empty', result.triples.length > 0 ? 'По этим фильтрам троек нет' : 'Троек тоже нет');
// конец функции render
}

// ----------------------------------------------------------------------------
// fillFilters — заполняет списки фильтров и подписывается на их изменения.
// Принимает: ничего. Возвращает: ничего.
// ----------------------------------------------------------------------------
// function
function fillFilters() {
  // список предметов
  const subjectSelect = document.getElementById('filter-subject');
  // список классов
  const gradeSelect = document.getElementById('filter-grade');
  // пункты предметов: первый — «Все предметы»
  subjectSelect.innerHTML = '<option value="">Все предметы</option>' + SUBJECTS.map((s) => `<option value="${s.id}">${s.icon} ${escapeHtml(s.name)}</option>`).join('');
  // пункты классов
  gradeSelect.innerHTML = '<option value="">Любой класс</option>' + GRADES.map((g) => `<option value="${g}">${g} класс</option>`).join('');
  // при смене предмета — новый фильтр и перерисовка
  subjectSelect.addEventListener('change', () => { state.filters.subject = subjectSelect.value; render(); });
  // при смене класса — то же
  gradeSelect.addEventListener('change', () => { state.filters.grade = gradeSelect.value; render(); });
  // кнопка «Сбросить»
  document.getElementById('filter-reset').addEventListener('click', () => {
    // очищаем списки
    subjectSelect.value = '';
    // и класс
    gradeSelect.value = '';
    // очищаем фильтры
    state.filters = { subject: '', grade: '' };
    // перерисовываем
    render();
  // конец обработчика
  });
// конец функции fillFilters
}

// ----------------------------------------------------------------------------
// proposeExchange — «Предложить обмен»: создаёт запрос через SQL-функцию.
// Принимает: button — нажатая кнопка. Возвращает: Promise.
// ----------------------------------------------------------------------------
// async function
async function proposeExchange(button) {
  // защита от двойного нажатия
  if (button.disabled) return;
  // находим совпадение по id из data-propose
  const match = state.shown.get(button.dataset.propose);
  // не нашли — ничего не делаем
  if (!match) return;
  // «загрузка»
  setButtonLoading(button, true);
  // try — запрос
  try {
    // связи для базы: только id учеников и предмет
    const links = match.links.map((link) => ({ teacher: link.teacher.id, learner: link.learner.id, subject: link.subject }));
    // rpc — вызов SQL-функции create_partnership с параметром p_links
    const { error } = await supabase.rpc('create_partnership', { p_links: links });
    // ошибка — в catch
    if (error) throw error;
    // запоминаем, что запрос отправлен
    state.sent.add(match.id);
    // всплывающее сообщение
    showToast(match.type === 'pair' ? 'Запрос отправлен! Ждём ответа партнёра' : 'Запрос отправлен! Ждём ответа обоих участников', 'success');
    // перерисовываем — вместо кнопки появится «Запрос отправлен»
    render();
  // catch — ошибка
  } catch (error) {
    // в консоль
    logError(error);
    // понятное сообщение (например, «С этим учеником уже есть обмен или запрос»)
    showToast(getErrorMessage(error), 'error');
    // кнопка снова активна
    setButtonLoading(button, false);
  // конец try/catch
  }
// конец функции proposeExchange
}

// ----------------------------------------------------------------------------
// notifyNewMatches — сообщает партнёрам по прямым парам о новом совпадении.
// Чтобы не звать сервер при каждом открытии страницы, запоминаем в браузере
// (localStorage), о ком уже сообщили. База тоже не создаст повторное
// уведомление (ключ повтора 'match:<id>').
// Принимает: pairs — найденные пары. Возвращает: Promise.
// ----------------------------------------------------------------------------
// async function
async function notifyNewMatches(pairs) {
  // ключ хранилища для текущего ученика
  const key = `skillswap-notified-${state.me.id}`;
  // уже уведомлённые
  let notified = [];
  // try — чтение хранилища может не сработать
  try {
    // JSON.parse превращает строку обратно в массив; || '[]' — если записи нет
    notified = JSON.parse(localStorage.getItem(key) || '[]');
  // catch — считаем, что никого не уведомляли
  } catch (error) {
    // пустой список
    notified = [];
  // конец try/catch
  }
  // партнёры, о которых ещё не сообщали
  const fresh = pairs.map((pair) => pair.members[1].id).filter((id) => !notified.includes(id));
  // for...of с await внутри — отправляем по одному
  for (const otherId of fresh) {
    // вызываем SQL-функцию; она сама проверит, что совпадение настоящее
    const { error } = await supabase.rpc('notify_new_match', { p_other: otherId });
    // при ошибке — предупреждение и выходим (попробуем в следующий раз)
    if (error) {
      // в консоль
      logError(error);
      // стоп
      return;
    // конец if
    }
    // запоминаем
    notified.push(otherId);
  // конец цикла
  }
  // try — запись в хранилище
  try {
    // JSON.stringify превращает массив в строку для хранения
    localStorage.setItem(key, JSON.stringify(notified));
  // catch — не страшно, просто уведомим ещё раз (база не создаст дубль)
  } catch (error) {
    // в консоль
    logError(error);
  // конец try/catch
  }
// конец функции notifyNewMatches
}

// ----------------------------------------------------------------------------
// start — запуск страницы.
// Принимает: ничего. Возвращает: Promise.
// ----------------------------------------------------------------------------
// async function
async function start() {
  // только для учеников
  const context = await initPage({ active: 'matches', roles: ['student'] });
  // нельзя показывать — выходим
  if (!context) return;
  // запоминаем свой профиль
  state.me = context.profile;
  // try — загрузка данных
  try {
    // данные школы
    const data = await loadSchoolData(state.me);
    // ученики
    state.students = data.students;
    // исключения
    state.excludedIds = data.excludedIds;
  // catch — ошибка загрузки
  } catch (error) {
    // в консоль
    logError(error);
    // понятное сообщение с кнопкой «Обновить»
    renderState(stateBox, 'error', 'Не удалось загрузить совпадения', getErrorMessage(error), { href: location.pathname, label: 'Попробовать ещё раз' });
    // стоп
    return;
  // конец try/catch
  }
  // заполняем фильтры
  fillFilters();
  // рисуем совпадения
  render();
  // делегирование событий: один обработчик клика на весь блок; closest находит нажатую кнопку «Предложить»
  content.addEventListener('click', (event) => {
    // кнопка с атрибутом data-propose, на которую (или внутрь которой) нажали
    const button = event.target.closest('[data-propose]');
    // если нажали на неё — отправляем запрос
    if (button) proposeExchange(button);
  // конец обработчика
  });
  // уведомления о новых парах — без фильтров
  const { pairs } = findMatchesForStudent(state.me.id, state.students, { excludedIds: state.excludedIds });
  // запускаем в фоне (без await — страница уже показана)
  notifyNewMatches(pairs);
// конец функции start
}

// запускаем страницу
start();
