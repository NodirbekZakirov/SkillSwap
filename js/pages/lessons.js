// ============================================================================
// Файл: js/pages/lessons.js
// Зачем нужен: страница «Занятия» (pages/lessons.html):
//   • форма «Назначить занятие» с проверкой полей;
//   • списки: «Отметь, как прошло», «Предстоящие», «Проведённые», «Отменённые»;
//   • кнопки «Проведено» / «Не состоялось» / «Отменить»;
//   • оценка помощника звёздами 1–5 и короткий отзыв.
// Что делает база сама (sql/schema.sql): не даёт отметить «проведено» до
// начала занятия, начисляет очки и бейджи, присылает уведомления.
// Как связан с остальными: js/layout.js, js/partnerships.js, js/reviews.js,
// js/dialog.js, js/config.js, js/supabase.js, js/utils.js, js/validation.js.
// ============================================================================

// запуск страницы
import { initPage } from '../layout.js';
// подключение к Supabase
import { supabase } from '../supabase.js';
// места и статусы занятий
import { LESSON_PLACES, LESSON_STATUSES } from '../config.js';
// имя «Амир Т.»
import { formatName } from '../auth.js';
// партнёрства
import { loadPartnerships, partnershipTitle } from '../partnerships.js';
// звёзды
import { starsHtml, starPickerHtml, updateStarPicker } from '../reviews.js';
// окно подтверждения
import { confirmAction } from '../dialog.js';
// экранирование, тосты, кнопки, состояния, ошибки
import { escapeHtml, showToast, setButtonLoading, renderState, getErrorMessage, logError } from '../utils.js';
// ошибки полей
import { showFieldError, clearFormErrors, showFormError, focusFirstError } from '../validation.js';

// MAX_DAYS_AHEAD — насколько вперёд можно назначить занятие (в днях)
const MAX_DAYS_AHEAD = 180;
// MAX_COMMENT_LENGTH — максимальная длина отзыва (как в базе)
const MAX_COMMENT_LENGTH = 500;

// state — данные страницы
const state = {
  // мой id
  meId: null,
  // мои партнёрства: Map «id → партнёрство»
  partnerships: new Map(),
  // мои отзывы: Map «id занятия → отзыв»
  myReviews: new Map(),
// конец объекта
};

// форма нового занятия
const form = document.getElementById('lesson-form');

// ----------------------------------------------------------------------------
// toDateInputValue — дата в формате поля <input type="date">: «2026-09-25».
// Принимает: date — объект Date. Возвращает: строку.
// ----------------------------------------------------------------------------
// function
function toDateInputValue(date) {
  // padStart(2, '0') — дополняет число нулём слева до двух цифр: 5 → «05»
  const pad = (n) => String(n).padStart(2, '0');
  // getMonth() считает месяцы с 0, поэтому +1
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
// конец функции toDateInputValue
}

// ----------------------------------------------------------------------------
// formatLessonTime — «ср, 15:30» (день недели и время).
// Принимает: value — дата из базы. Возвращает: строку.
// ----------------------------------------------------------------------------
// function
function formatLessonTime(value) {
  // weekday: 'short' — короткий день недели
  return new Intl.DateTimeFormat('ru-RU', { weekday: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
// конец функции formatLessonTime
}

// ----------------------------------------------------------------------------
// helperFor — кто помогает мне в этом партнёрстве (его я оцениваю).
// Принимает: partnership. Возвращает: профиль помощника или null.
// ----------------------------------------------------------------------------
// function
function helperFor(partnership) {
  // участник, у которого teaches_to — это я
  return partnership.members.find((member) => member.teaches_to === state.meId)?.profile ?? null;
// конец функции helperFor
}

// ----------------------------------------------------------------------------
// actionsHtml — кнопки или форма оценки для занятия в зависимости от группы.
// Принимает: lesson; group — 'to-mark', 'upcoming', 'done', 'cancelled'.
// Возвращает: строку HTML.
// ----------------------------------------------------------------------------
// function
function actionsHtml(lesson, group) {
  // занятие прошло, но не отмечено
  if (group === 'to-mark') return `<div class="partner-actions"><button class="btn btn-primary btn-sm" type="button" data-status="done" data-id="${lesson.id}">✓ Проведено</button><button class="btn btn-ghost btn-sm" type="button" data-status="cancelled" data-id="${lesson.id}">Не состоялось</button></div>`;
  // будущее занятие можно только отменить
  if (group === 'upcoming') return `<div class="partner-actions"><button class="btn btn-ghost btn-sm" type="button" data-status="cancelled" data-id="${lesson.id}">Отменить</button></div>`;
  // отменённые — без действий
  if (group !== 'done') return '';
  // мой отзыв на это занятие
  const review = state.myReviews.get(lesson.id);
  // уже оценил — показываем оценку
  if (review) return `<p class="lesson-review">Твоя оценка: ${starsHtml(review.rating)}${review.comment ? ` «${escapeHtml(review.comment)}»` : ''}</p>`;
  // помощник, которого нужно оценить
  const helper = helperFor(state.partnerships.get(lesson.partnership_id));
  // форма оценки
  return [
    // форма; data-lesson — номер занятия
    `<form class="review-form" data-lesson="${lesson.id}" novalidate>`,
    // подпись
    `<p class="field-label">Оцени помощь${helper ? `: ${escapeHtml(formatName(helper))}` : ''}</p>`,
    // звёзды; имя группы уникально для занятия
    starPickerHtml(`rating-${lesson.id}`),
    // подпись поля отзыва для программ чтения с экрана
    `<label class="visually-hidden" for="comment-${lesson.id}">Отзыв</label>`,
    // поле отзыва
    `<textarea class="input review-comment" id="comment-${lesson.id}" maxlength="${MAX_COMMENT_LENGTH}" placeholder="Короткий отзыв (необязательно): что понравилось?"></textarea>`,
    // место для ошибки
    '<p class="field-error" data-review-error hidden></p>',
    // кнопка
    '<button class="btn btn-primary btn-sm" type="submit">Отправить оценку</button>',
    // конец формы
    '</form>',
  // склеиваем
  ].join('');
// конец функции actionsHtml
}

// ----------------------------------------------------------------------------
// lessonCardHtml — карточка занятия.
// Принимает: lesson; group. Возвращает: строку HTML.
// ----------------------------------------------------------------------------
// function
function lessonCardHtml(lesson, group) {
  // дата занятия
  const date = new Date(lesson.scheduled_at);
  // партнёрство занятия
  const partnership = state.partnerships.get(lesson.partnership_id);
  // место: ищем в списке; ?? — на случай неизвестного значения
  const place = LESSON_PLACES.find((p) => p.id === lesson.place) ?? { icon: '📍', name: lesson.place };
  // статус
  const status = LESSON_STATUSES[lesson.status];
  // собираем карточку
  return [
    // карточка
    `<article class="card lesson-card fade-in" data-lesson-card="${lesson.id}">`,
    // «листок календаря»: число и месяц
    `<div class="lesson-date" aria-hidden="true"><span class="lesson-day">${date.getDate()}</span><span class="lesson-month">${new Intl.DateTimeFormat('ru-RU', { month: 'short' }).format(date)}</span></div>`,
    // основная часть
    '<div class="lesson-body">',
    // тема и статус
    `<div class="lesson-top"><h3>${escapeHtml(lesson.topic)}</h3><span class="chip chip-${status.variant}">${status.text}</span></div>`,
    // время, место, с кем
    `<p class="muted lesson-meta">⏰ ${formatLessonTime(lesson.scheduled_at)} · ${place.icon} ${place.name}${partnership ? ` · 👥 ${escapeHtml(partnershipTitle(partnership, state.meId))}` : ''}</p>`,
    // кнопки или оценка
    actionsHtml(lesson, group),
    // конец основной части
    '</div>',
    // конец карточки
    '</article>',
  // склеиваем
  ].join('');
// конец функции lessonCardHtml
}

// ----------------------------------------------------------------------------
// fillForm — заполняет форму: активные партнёрства, места, ограничения дат.
// Принимает: ничего. Возвращает: ничего.
// ----------------------------------------------------------------------------
// function
function fillForm() {
  // только активные партнёрства: в них можно назначать занятия
  const active = [...state.partnerships.values()].filter((p) => p.status === 'active');
  // нет активных — вместо формы подсказка
  if (active.length === 0) {
    // прячем форму
    form.hidden = true;
    // показываем пустое состояние со ссылкой
    const box = document.getElementById('no-partners');
    // делаем видимым
    box.hidden = false;
    // сообщение
    renderState(box, 'empty', 'Сначала найди партнёра', 'Занятие можно назначить, когда обмен активен.', { href: '/pages/matches.html', label: 'К совпадениям' });
    // выход
    return;
  // конец if
  }
  // партнёрство из адреса ?p=12 (со страницы чата)
  const preselected = Number(new URLSearchParams(location.search).get('p'));
  // пункты списка
  form.partnership.innerHTML = '<option value="">Выбери партнёра</option>' + active.map((p) => `<option value="${p.id}"${p.id === preselected ? ' selected' : ''}>${escapeHtml(partnershipTitle(p, state.meId))}</option>`).join('');
  // кнопки мест (радиокнопки в переключателе)
  document.getElementById('lesson-places').innerHTML = LESSON_PLACES.map((p) => `<label><input type="radio" name="place" value="${p.id}"><span>${p.icon} ${p.name}</span></label>`).join('');
  // min — самая ранняя дата в календаре: сегодня
  form.date.min = toDateInputValue(new Date());
  // max — самая поздняя: через MAX_DAYS_AHEAD дней (86400000 мс в сутках)
  form.date.max = toDateInputValue(new Date(Date.now() + MAX_DAYS_AHEAD * 86400000));
// конец функции fillForm
}

// ----------------------------------------------------------------------------
// createLesson — отправка формы «Назначить занятие».
// Принимает: event. Возвращает: Promise.
// ----------------------------------------------------------------------------
// async function
async function createLesson(event) {
  // не перезагружаем страницу
  event.preventDefault();
  // кнопка
  const button = document.getElementById('lesson-button');
  // защита от двойного нажатия
  if (button.disabled) return;
  // убираем старые ошибки
  clearFormErrors(form);
  // место для ошибки выбора места
  const placeError = document.getElementById('lesson-place-error');
  // прячем её
  placeError.hidden = true;
  // значения полей
  const partnershipId = Number(form.partnership.value);
  // тема без пробелов по краям
  const topic = form.topic.value.trim();
  // выбранное место; ?. — если не выбрано
  const place = form.querySelector('input[name="place"]:checked')?.value ?? '';
  // new Date('2026-09-25T15:30') — дата и время в часовом поясе компьютера
  const scheduledAt = new Date(`${form.date.value}T${form.time.value}`);
  // ошибки по полям
  const errors = {
    // партнёр
    partnership: partnershipId ? '' : 'Выбери, с кем занятие',
    // дата
    date: form.date.value ? '' : 'Выбери дату',
    // время
    time: form.time.value ? '' : 'Выбери время',
    // тема: от 2 до 120 символов
    topic: topic.length < 2 ? 'Напиши тему занятия' : '',
  // конец объекта
  };
  // если дата и время заполнены — проверяем, что это будущее и не слишком далеко
  if (!errors.date && !errors.time) {
    // isNaN — «не число»: неправильная дата
    if (Number.isNaN(scheduledAt.getTime())) errors.date = 'Дата выглядит неправильно';
    // время уже прошло (getTime — миллисекунды с 1970 года; Date.now — сейчас)
    else if (scheduledAt.getTime() <= Date.now()) errors.time = 'Это время уже прошло — выбери будущее';
    // слишком далеко
    else if (scheduledAt.getTime() > Date.now() + MAX_DAYS_AHEAD * 86400000) errors.date = 'Можно назначить не дальше чем на полгода вперёд';
  // конец if
  }
  // показываем ошибки под полями
  showFieldError(form.partnership, errors.partnership);
  // дата
  showFieldError(form.date, errors.date);
  // время
  showFieldError(form.time, errors.time);
  // тема
  showFieldError(form.topic, errors.topic);
  // место не выбрано
  if (!place) {
    // текст
    placeError.textContent = 'Выбери, где пройдёт занятие';
    // показываем
    placeError.hidden = false;
  // конец if
  }
  // если есть хоть одна ошибка — стоп
  if (Object.values(errors).some(Boolean) || !place) {
    // курсор в первое поле с ошибкой
    focusFirstError(form);
    // стоп
    return;
  // конец if
  }
  // «загрузка»
  setButtonLoading(button, true);
  // try — запрос
  try {
    // toISOString — дата в стандартном формате с часовым поясом UTC, база сохранит её правильно
    const { error } = await supabase.from('lessons').insert({ partnership_id: partnershipId, created_by: state.meId, scheduled_at: scheduledAt.toISOString(), topic, place });
    // ошибка — в catch
    if (error) throw error;
    // успех
    showToast('Занятие назначено! Партнёр получит уведомление', 'success');
    // reset — очистить форму
    form.reset();
    // перерисовываем списки
    await loadAndRender();
  // catch — ошибка
  } catch (error) {
    // в консоль
    logError(error);
    // понятный текст над кнопкой
    showFormError(form, getErrorMessage(error));
  // finally — всегда
  } finally {
    // кнопка снова активна
    setButtonLoading(button, false);
  // конец try/catch/finally
  }
// конец функции createLesson
}

// ----------------------------------------------------------------------------
// setLessonStatus — «Проведено» или «Отменить / Не состоялось».
// Принимает: button — кнопка с data-status и data-id. Возвращает: Promise.
// ----------------------------------------------------------------------------
// async function
async function setLessonStatus(button) {
  // новый статус
  const status = button.dataset.status;
  // для отмены спрашиваем подтверждение
  if (status === 'cancelled') {
    // окно
    const ok = await confirmAction({ title: 'Отменить занятие?', text: 'Партнёр получит уведомление об отмене.', confirmLabel: 'Отменить занятие', cancelLabel: 'Не надо', danger: true });
    // передумал
    if (!ok) return;
  // конец if
  }
  // «загрузка»
  setButtonLoading(button, true);
  // try — запрос
  try {
    // меняем только столбец status (другие менять ученикам запрещено правами в базе)
    const { error } = await supabase.from('lessons').update({ status }).eq('id', Number(button.dataset.id));
    // ошибка — в catch (например, «Отметить можно только после начала занятия»)
    if (error) throw error;
    // сообщение
    showToast(status === 'done' ? 'Отлично! Очки начислены. Не забудь оценить партнёра' : 'Занятие отменено', 'success');
    // перерисовываем
    await loadAndRender();
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
// конец функции setLessonStatus
}

// ----------------------------------------------------------------------------
// submitReview — отправка оценки после занятия.
// Принимает: reviewForm — форма оценки. Возвращает: Promise.
// ----------------------------------------------------------------------------
// async function
async function submitReview(reviewForm) {
  // кнопка формы
  const button = reviewForm.querySelector('button[type="submit"]');
  // защита от двойного нажатия
  if (button.disabled) return;
  // номер занятия
  const lessonId = Number(reviewForm.dataset.lesson);
  // выбранная оценка (0 — не выбрана)
  const rating = Number(reviewForm.querySelector('input:checked')?.value ?? 0);
  // текст отзыва
  const comment = reviewForm.querySelector('textarea').value.trim();
  // место для ошибки
  const errorBox = reviewForm.querySelector('[data-review-error]');
  // проверка: оценка обязательна, отзыв не длиннее 500 символов
  const error = rating < 1 ? 'Поставь оценку от 1 до 5 звёзд' : comment.length > MAX_COMMENT_LENGTH ? `Отзыв слишком длинный: максимум ${MAX_COMMENT_LENGTH} символов` : '';
  // текст ошибки
  errorBox.textContent = error;
  // показываем, если есть
  errorBox.hidden = !error;
  // есть ошибка — стоп
  if (error) return;
  // «загрузка»
  setButtonLoading(button, true);
  // try — запрос
  try {
    // SQL-функция leave_review сама найдёт, кого оцениваем, и проверит права
    const { error: rpcError } = await supabase.rpc('leave_review', { p_lesson_id: lessonId, p_rating: rating, p_comment: comment });
    // ошибка — в catch
    if (rpcError) throw rpcError;
    // спасибо
    showToast('Спасибо за оценку!', 'success');
    // перерисовываем
    await loadAndRender();
  // catch — ошибка
  } catch (err) {
    // в консоль
    logError(err);
    // сообщение в форме
    errorBox.textContent = getErrorMessage(err);
    // показываем
    errorBox.hidden = false;
    // кнопка снова активна
    setButtonLoading(button, false);
  // конец try/catch
  }
// конец функции submitReview
}

// ----------------------------------------------------------------------------
// fillList — заполняет список занятий или пустое состояние.
// Принимает: listId; lessons; group; emptyTitle. Возвращает: ничего.
// ----------------------------------------------------------------------------
// function
function fillList(listId, lessons, group, emptyTitle) {
  // контейнер
  const list = document.getElementById(listId);
  // есть занятия — карточки
  if (lessons.length > 0) list.innerHTML = lessons.map((lesson) => lessonCardHtml(lesson, group)).join('');
  // иначе — пустое состояние
  else renderState(list, 'empty', emptyTitle);
// конец функции fillList
}

// ----------------------------------------------------------------------------
// loadAndRender — загружает партнёрства, занятия и мои отзывы и рисует всё.
// Принимает: ничего. Возвращает: Promise.
// ----------------------------------------------------------------------------
// async function
async function loadAndRender() {
  // все мои партнёрства (нужны имена)
  const partnerships = await loadPartnerships();
  // словарь «id → партнёрство»
  state.partnerships = new Map(partnerships.map((p) => [p.id, p]));
  // занятия и мои отзывы параллельно
  const [lessonsRes, reviewsRes] = await Promise.all([
    // занятия моих партнёрств (RLS), по времени
    supabase.from('lessons').select('id, partnership_id, created_by, scheduled_at, topic, place, status').order('scheduled_at', { ascending: true }),
    // мои отзывы
    supabase.from('reviews').select('lesson_id, rating, comment').eq('author_id', state.meId),
  // конец списка запросов
  ]);
  // ошибки
  if (lessonsRes.error) throw lessonsRes.error;
  // ошибка отзывов
  if (reviewsRes.error) throw reviewsRes.error;
  // словарь «занятие → мой отзыв»
  state.myReviews = new Map(reviewsRes.data.map((r) => [r.lesson_id, r]));
  // текущее время
  const now = Date.now();
  // все занятия
  const lessons = lessonsRes.data;
  // время занятия в миллисекундах
  const time = (lesson) => new Date(lesson.scheduled_at).getTime();
  // прошли, но не отмечены
  const toMark = lessons.filter((l) => l.status === 'planned' && time(l) <= now);
  // будущие
  const upcoming = lessons.filter((l) => l.status === 'planned' && time(l) > now);
  // проведённые — новые сверху (reverse переворачивает массив)
  const done = lessons.filter((l) => l.status === 'done').reverse();
  // отменённые — новые сверху
  const cancelled = lessons.filter((l) => l.status === 'cancelled').reverse();
  // заполняем списки
  fillList('to-mark-list', toMark, 'to-mark', '');
  // предстоящие
  fillList('upcoming-list', upcoming, 'upcoming', 'Предстоящих занятий нет');
  // проведённые
  fillList('done-list', done, 'done', 'Проведённых занятий пока нет');
  // отменённые
  fillList('cancelled-list', cancelled, 'cancelled', '');
  // раздел «Отметь» виден, только если есть что отметить
  document.getElementById('to-mark-section').hidden = toMark.length === 0;
  // отменённые — только если есть
  document.getElementById('cancelled-section').hidden = cancelled.length === 0;
// конец функции loadAndRender
}

// ----------------------------------------------------------------------------
// start — запуск страницы.
// Принимает: ничего. Возвращает: Promise.
// ----------------------------------------------------------------------------
// async function
async function start() {
  // только для учеников
  const context = await initPage({ active: 'lessons', roles: ['student'] });
  // нельзя показывать — выходим
  if (!context) return;
  // мой id
  state.meId = context.user.id;
  // блок состояний
  const stateBox = document.getElementById('lessons-state');
  // try — загрузка
  try {
    // загружаем и рисуем списки
    await loadAndRender();
    // заполняем форму
    fillForm();
    // прячем «загрузку»
    stateBox.innerHTML = '';
    // показываем содержимое
    document.getElementById('lessons-content').hidden = false;
  // catch — ошибка
  } catch (error) {
    // в консоль
    logError(error);
    // сообщение
    renderState(stateBox, 'error', 'Не удалось загрузить занятия', getErrorMessage(error), { href: location.pathname, label: 'Попробовать ещё раз' });
    // стоп
    return;
  // конец try/catch
  }
  // отправка формы нового занятия
  form.addEventListener('submit', createLesson);
  // содержимое страницы
  const content = document.getElementById('lessons-content');
  // клики по кнопкам статуса (делегирование)
  content.addEventListener('click', (event) => {
    // кнопка с data-status
    const button = event.target.closest('button[data-status]');
    // если нашли и не занята
    if (button && !button.disabled) setLessonStatus(button);
  // конец обработчика
  });
  // change — выбор звезды: закрашиваем звёзды
  content.addEventListener('change', (event) => {
    // группа звёзд, внутри которой изменение
    const picker = event.target.closest('.star-picker');
    // если нашли — обновляем
    if (picker) updateStarPicker(picker);
  // конец обработчика
  });
  // submit форм оценки (событие «всплывает» до content)
  content.addEventListener('submit', (event) => {
    // форма оценки
    const reviewForm = event.target.closest('.review-form');
    // если это не она — выходим (форму занятия обрабатывает createLesson)
    if (!reviewForm) return;
    // не перезагружаем страницу
    event.preventDefault();
    // отправляем оценку
    submitReview(reviewForm);
  // конец обработчика
  });
// конец функции start
}

// запускаем страницу
start();
