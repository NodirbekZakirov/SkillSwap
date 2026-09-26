// ============================================================================
// Файл: js/pages/question.js
// Зачем нужен: страница одного вопроса (pages/question.html?id=15):
//   • показывает вопрос (текст, фото, автор) и ответы со статусом:
//     «✅ Одобрено администратором» / «⏳ Не проверено администратором»;
//     удалённый админом ответ видит только его автор — с комментарием;
//   • форма ответа: текст и/или фото решения, проверка длины и грубых слов;
//   • автор может удалить свой вопрос или свой ответ;
//   • блок «Подсказка от ИИ» (js/ai.js).
// Раздел общий для всех школ. Кто что может, решает база (RLS для answers в
// sql/schema.sql): отвечать может незаблокированный ученик из любой школы и
// не на свой вопрос; одобрить ответ может только администратор.
// Как связан с остальными: js/layout.js, js/qa.js, js/dialog.js, js/ui.js,
// js/auth.js, js/supabase.js, js/utils.js, js/validation.js.
// ============================================================================

// запуск страницы
import { initPage } from '../layout.js';
// подключение к Supabase
import { supabase } from '../supabase.js';
// ограничения длины
import { QA_LIMITS } from '../config.js';
// имя «Амир Т.»
import { formatName } from '../auth.js';
// плашка предмета
import { subjectChipHtml } from '../ui.js';
// общие функции вопросов
import { checkText, uploadQaImage, removeQaImages, imageUrls, photoHtml, loadAuthors, schoolNoteHtml, answerStatusHtml, setupPhotoPicker, setupCounters } from '../qa.js';
// окно подтверждения
import { confirmAction } from '../dialog.js';
// блок «Подсказка от ИИ»
import { initAiHint } from '../ai.js';
// экранирование, тосты, кнопки, состояния, время, ошибки
import { escapeHtml, showToast, setButtonLoading, renderState, formatRelative, formatDateTime, getErrorMessage, logError } from '../utils.js';
// ошибки полей
import { showFieldError, clearFormErrors, showFormError } from '../validation.js';

// STATUS_ORDER — порядок ответов: сначала одобренные, потом непроверенные, удалённые (только свои) — в конце
const STATUS_ORDER = { approved: 0, pending: 1, removed: 2 };

// state — данные страницы
const state = {
  // мой профиль
  me: null,
  // номер вопроса
  questionId: null,
  // вопрос
  question: null,
  // ответы
  answers: [],
  // авторы: Map «id → профиль»
  people: new Map(),
  // выбор фото в форме ответа
  photo: null,
// конец объекта
};

// ----------------------------------------------------------------------------
// personHtml — аватар и имя. Ссылка на профиль — только для своей школы
// (профили учеников других школ закрыты); для чужой школы — её название.
// Принимает: userId. Возвращает: строку HTML.
// ----------------------------------------------------------------------------
// function
function personHtml(userId) {
  // профиль; заглушка, если не загрузился
  const p = state.people.get(userId) ?? { first_name: 'Ученик', last_initial: '', avatar: '👤' };
  // «(ты)» для себя
  const me = userId === state.me.id ? ' (ты)' : '';
  // имя жирным; экранируем
  const name = `<strong>${escapeHtml(formatName(p))}${me}</strong>`;
  // профиль можно открыть: автор из моей школы или я администратор (ему видны все)
  const canOpen = p.school_id === state.me.school_id || state.me.role === 'admin';
  // ссылка на профиль или просто имя
  const nameHtml = canOpen ? `<a class="person-link" href="/pages/user.html?id=${encodeURIComponent(userId)}">${name}</a>` : name;
  // аватар, имя, класс и школа (если другая)
  return `<span class="avatar avatar-sm" aria-hidden="true">${escapeHtml(p.avatar)}</span>${nameHtml}${p.grade ? `<span class="muted">· ${p.grade} класс</span>` : ''}${schoolNoteHtml(p, state.me)}`;
// конец функции personHtml
}

// ----------------------------------------------------------------------------
// renderQuestion — карточка вопроса.
// Принимает: urls — Map ссылок на фото. Возвращает: ничего.
// ----------------------------------------------------------------------------
// function
function renderQuestion(urls) {
  // вопрос
  const q = state.question;
  // мой ли вопрос
  const mine = q.author_id === state.me.id;
  // собираем карточку
  document.getElementById('question-card').innerHTML = [
    // предмет и время
    `<div class="question-top">${subjectChipHtml(q.subject)}<span class="muted" title="${formatDateTime(q.created_at)}">${formatRelative(q.created_at)}</span></div>`,
    // заголовок (h1 — главный на странице); экранируем
    `<h1 class="question-heading">${escapeHtml(q.title)}</h1>`,
    // подробности
    q.body ? `<p class="qa-text">${escapeHtml(q.body)}</p>` : '',
    // фото задачи
    photoHtml(urls.get(q.image_path), 'Фото к вопросу'),
    // автор и кнопка удаления
    `<div class="qa-footer"><div class="qa-author">${personHtml(q.author_id)}</div>${mine ? '<button class="btn btn-ghost btn-sm" type="button" id="delete-question">🗑 Удалить вопрос</button>' : ''}</div>`,
  // склеиваем
  ].join('');
  // название вкладки
  document.title = `${q.title} — SkillSwap`;
// конец функции renderQuestion
}

// ----------------------------------------------------------------------------
// answerCardHtml — карточка ответа.
// Принимает: a — ответ; urls — Map ссылок на фото. Возвращает: строку HTML.
// ----------------------------------------------------------------------------
// function
function answerCardHtml(a, urls) {
  // мой ли ответ
  const mine = a.author_id === state.me.id;
  // комментарий администратора: при удалении — причина, при одобрении — похвала
  const comment = a.admin_comment
    // блок комментария; экранируем
    ? `<p class="admin-comment${a.status === 'removed' ? ' removed' : ''}"><strong>${a.status === 'removed' ? 'Почему удалён:' : 'Комментарий администратора:'}</strong> ${escapeHtml(a.admin_comment)}</p>`
    // без комментария
    : '';
  // собираем карточку; класс status-… задаёт цвет полоски слева
  return [
    // карточка
    `<article class="card answer-card status-${a.status} fade-in">`,
    // автор, время, статус
    `<div class="answer-head"><div class="qa-author">${personHtml(a.author_id)}<span class="muted">· ${formatRelative(a.created_at)}</span></div>${answerStatusHtml(a.status)}</div>`,
    // удалённый ответ — пояснение, что его видишь только ты
    a.status === 'removed' ? '<p class="muted">Этот ответ видишь только ты.</p>' : '',
    // текст ответа; экранируем
    a.body ? `<p class="qa-text">${escapeHtml(a.body)}</p>` : '',
    // фото решения
    photoHtml(urls.get(a.image_path), 'Фото решения'),
    // комментарий администратора
    comment,
    // удалить свой ответ
    mine ? `<div class="partner-actions"><button class="btn btn-ghost btn-sm" type="button" data-delete-answer="${a.id}">🗑 Удалить мой ответ</button></div>` : '',
    // конец карточки
    '</article>',
  // склеиваем
  ].join('');
// конец функции answerCardHtml
}

// ----------------------------------------------------------------------------
// renderAnswers — список ответов.
// Принимает: urls — Map ссылок на фото. Возвращает: ничего.
// ----------------------------------------------------------------------------
// function
function renderAnswers(urls) {
  // сортировка: по статусу (STATUS_ORDER), внутри — по времени
  const list = [...state.answers].sort((x, y) => STATUS_ORDER[x.status] - STATUS_ORDER[y.status] || new Date(x.created_at) - new Date(y.created_at));
  // счётчик — только видимые всем ответы
  document.getElementById('answers-count').textContent = String(list.filter((a) => a.status !== 'removed').length);
  // контейнер
  const box = document.getElementById('answers-list');
  // ответов нет
  if (list.length === 0) {
    // пустое состояние
    renderState(box, 'empty', 'Ответов пока нет', state.question.author_id === state.me.id ? 'Как только кто-то ответит, придёт уведомление.' : 'Знаешь, как решить? Ответь первым!');
    // выход
    return;
  // конец if
  }
  // карточки
  box.innerHTML = list.map((a) => answerCardHtml(a, urls)).join('');
// конец функции renderAnswers
}

// ----------------------------------------------------------------------------
// setupAnswerForm — показывает форму ответа или объясняет, почему нельзя.
// Принимает: ничего. Возвращает: ничего.
// ----------------------------------------------------------------------------
// function
function setupAnswerForm() {
  // причина, почему отвечать нельзя ('' — можно)
  let reason = '';
  // свой вопрос
  if (state.question.author_id === state.me.id) reason = 'Это твой вопрос — дождись ответов других учеников.';
  // не ученик
  else if (state.me.role !== 'student') reason = 'Отвечать на вопросы могут только ученики.';
  // заблокирован
  else if (state.me.is_blocked) reason = 'Учитель ограничил твой аккаунт: отвечать на вопросы нельзя.';
  // блок с причиной
  const closed = document.getElementById('answer-closed');
  // текст
  closed.textContent = reason;
  // показываем причину или форму
  closed.hidden = !reason;
  // форма
  document.getElementById('answer-form').hidden = Boolean(reason);
// конец функции setupAnswerForm
}

// ----------------------------------------------------------------------------
// load — загружает вопрос, ответы, авторов и ссылки на фото, рисует всё.
// Принимает: ничего. Возвращает: Promise<boolean> — найден ли вопрос.
// ----------------------------------------------------------------------------
// async function
async function load() {
  // вопрос и ответы параллельно
  const [qRes, aRes] = await Promise.all([
    // вопрос; maybeSingle — null, если не найден (например, удалён)
    supabase.from('questions').select('id, school_id, author_id, subject, title, body, image_path, created_at').eq('id', state.questionId).maybeSingle(),
    // ответы (RLS: удалённые — только свои)
    supabase.from('answers').select('id, author_id, body, image_path, status, admin_comment, created_at').eq('question_id', state.questionId),
  // конец списка
  ]);
  // ошибки
  if (qRes.error) throw qRes.error;
  // ошибка ответов
  if (aRes.error) throw aRes.error;
  // не нашли вопрос
  if (!qRes.data) return false;
  // запоминаем
  state.question = qRes.data;
  // ответы
  state.answers = aRes.data;
  // авторы и ссылки на фото параллельно
  const [people, urls] = await Promise.all([
    // автор вопроса и авторы ответов (из любой школы)
    loadAuthors([state.question.author_id, ...state.answers.map((a) => a.author_id)]),
    // ссылки на фото вопроса и ответов
    imageUrls([state.question.image_path, ...state.answers.map((a) => a.image_path)]),
  // конец списка
  ]);
  // запоминаем профили
  state.people = people;
  // рисуем
  renderQuestion(urls);
  // ответы
  renderAnswers(urls);
  // форма ответа
  setupAnswerForm();
  // найден
  return true;
// конец функции load
}

// ----------------------------------------------------------------------------
// submitAnswer — публикация ответа.
// Принимает: event. Возвращает: Promise.
// ----------------------------------------------------------------------------
// async function
async function submitAnswer(event) {
  // не перезагружаем страницу
  event.preventDefault();
  // форма
  const form = event.currentTarget;
  // кнопка
  const button = document.getElementById('answer-submit');
  // защита от двойного нажатия
  if (button.disabled) return;
  // убираем старые ошибки
  clearFormErrors(form);
  // поле ответа
  const bodyInput = document.getElementById('answer-body');
  // текст
  const body = bodyInput.value.trim();
  // пустой ответ без фото — нельзя
  let error = body === '' && !state.photo.file ? 'Напиши ответ или прикрепи фото решения' : '';
  // иначе проверяем длину и грубые слова
  if (!error) error = checkText(body, { label: 'Ответ', max: QA_LIMITS.answerMax });
  // показываем ошибку под полем
  showFieldError(bodyInput, error);
  // есть ошибка — стоп
  if (error) {
    // курсор в поле
    bodyInput.focus();
    // стоп
    return;
  // конец if
  }
  // «загрузка»
  setButtonLoading(button, true);
  // путь фото
  let imagePath = null;
  // try — запросы
  try {
    // фото (если выбрано) — в папку МОЕЙ школы (загружать можно только туда, а видят фото все)
    if (state.photo.file) imagePath = await uploadQaImage(state.photo.file, state.me.school_id);
    // insert — новый ответ со статусом по умолчанию pending
    const { error: insertError } = await supabase.from('answers').insert({ question_id: state.questionId, author_id: state.me.id, body, image_path: imagePath });
    // ошибка — в catch
    if (insertError) throw insertError;
    // очищаем форму
    bodyInput.value = '';
    // событие input обновит счётчик символов
    bodyInput.dispatchEvent(new Event('input'));
    // сбрасываем фото
    state.photo.reset();
    // спасибо
    showToast('Ответ опубликован! Когда администратор его одобрит, ты получишь +15 очков', 'success');
    // перерисовываем
    await load();
  // catch — ошибка
  } catch (err) {
    // в консоль
    logError(err);
    // удаляем загруженное фото, если ответ не сохранился
    if (imagePath) await removeQaImages([imagePath]);
    // сообщение
    showFormError(form, getErrorMessage(err));
  // finally — всегда
  } finally {
    // кнопка снова активна
    setButtonLoading(button, false);
  // конец try/catch/finally
  }
// конец функции submitAnswer
}

// ----------------------------------------------------------------------------
// deleteQuestion — удалить свой вопрос (ответы удалятся вместе с ним).
// Принимает: button. Возвращает: Promise.
// ----------------------------------------------------------------------------
// async function
async function deleteQuestion(button) {
  // подтверждение
  const ok = await confirmAction({ title: 'Удалить вопрос?', text: 'Вопрос и все ответы на него пропадут навсегда.', confirmLabel: 'Удалить', danger: true });
  // передумал
  if (!ok) return;
  // «загрузка»
  setButtonLoading(button, true);
  // try — запрос
  try {
    // delete; RLS разрешит только автору
    const { error } = await supabase.from('questions').delete().eq('id', state.questionId);
    // ошибка — в catch
    if (error) throw error;
    // удаляем фото вопроса и ответов, которые я вижу
    await removeQaImages([state.question.image_path, ...state.answers.map((a) => a.image_path)]);
    // в ленту
    location.href = '/pages/questions.html';
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
// конец функции deleteQuestion
}

// ----------------------------------------------------------------------------
// deleteAnswer — удалить свой ответ.
// Принимает: button — кнопка с data-delete-answer. Возвращает: Promise.
// ----------------------------------------------------------------------------
// async function
async function deleteAnswer(button) {
  // ответ
  const answer = state.answers.find((a) => a.id === Number(button.dataset.deleteAnswer));
  // не нашли
  if (!answer) return;
  // подтверждение
  const ok = await confirmAction({ title: 'Удалить ответ?', text: 'Ответ пропадёт навсегда.', confirmLabel: 'Удалить', danger: true });
  // передумал
  if (!ok) return;
  // «загрузка»
  setButtonLoading(button, true);
  // try — запрос
  try {
    // delete; RLS разрешит только автору
    const { error } = await supabase.from('answers').delete().eq('id', answer.id);
    // ошибка — в catch
    if (error) throw error;
    // фото ответа
    await removeQaImages([answer.image_path]);
    // сообщение
    showToast('Ответ удалён', 'success');
    // перерисовываем
    await load();
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
// конец функции deleteAnswer
}

// ----------------------------------------------------------------------------
// start — запуск страницы.
// Принимает: ничего. Возвращает: Promise.
// ----------------------------------------------------------------------------
// async function
async function start() {
  // страница для всех ролей; в меню подсвечиваем «Вопросы»
  const context = await initPage({ active: 'questions' });
  // нельзя показывать — выходим
  if (!context) return;
  // мой профиль
  state.me = context.profile;
  // параметры адреса
  const params = new URLSearchParams(location.search);
  // номер вопроса
  state.questionId = Number(params.get('id'));
  // блок состояний
  const stateBox = document.getElementById('question-state');
  // неправильный номер
  if (!Number.isInteger(state.questionId) || state.questionId <= 0) {
    // сообщение
    renderState(stateBox, 'error', 'Вопрос не найден', 'Проверь ссылку.', { href: '/pages/questions.html', label: 'Все вопросы' });
    // стоп
    return;
  // конец if
  }
  // try — загрузка
  try {
    // загружаем
    const found = await load();
    // не нашли
    if (!found) {
      // сообщение
      renderState(stateBox, 'error', 'Вопрос не найден', 'Возможно, его удалили.', { href: '/pages/questions.html', label: 'Все вопросы' });
      // стоп
      return;
    // конец if
    }
    // прячем «загрузку»
    stateBox.innerHTML = '';
    // показываем содержимое
    document.getElementById('question-content').hidden = false;
    // «вопрос опубликован» после создания (?new=1)
    document.getElementById('new-question-alert').hidden = params.get('new') !== '1';
    // блок подсказки ИИ; без await — вопрос уже показан, блок появится, когда загрузится; catch — ошибку только в консоль
    initAiHint(document.getElementById('ai-card'), { questionId: state.questionId, me: state.me }).catch(logError);
  // catch — ошибка
  } catch (error) {
    // в консоль
    logError(error);
    // сообщение
    renderState(stateBox, 'error', 'Не удалось загрузить вопрос', getErrorMessage(error), { href: location.pathname + location.search, label: 'Попробовать ещё раз' });
    // стоп
    return;
  // конец try/catch
  }
  // счётчик символов ответа
  setupCounters(document.getElementById('answer-form'));
  // выбор фото решения
  state.photo = setupPhotoPicker(document.getElementById('answer-photo'));
  // отправка ответа
  document.getElementById('answer-form').addEventListener('submit', submitAnswer);
  // клики в карточке вопроса (кнопка удаления появляется после отрисовки)
  document.getElementById('question-card').addEventListener('click', (event) => {
    // кнопка удаления вопроса
    const button = event.target.closest('#delete-question');
    // если нашли и не занята
    if (button && !button.disabled) deleteQuestion(button);
  // конец обработчика
  });
  // клики по «Удалить мой ответ»
  document.getElementById('answers-list').addEventListener('click', (event) => {
    // кнопка
    const button = event.target.closest('[data-delete-answer]');
    // если нашли и не занята
    if (button && !button.disabled) deleteAnswer(button);
  // конец обработчика
  });
// конец функции start
}

// запускаем страницу
start();
