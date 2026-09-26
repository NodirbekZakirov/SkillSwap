// ============================================================================
// Файл: js/pages/questions.js
// Зачем нужен: лента «Вопросы и ответы» (pages/questions.html):
//   • загружает вопросы ВСЕХ школ (лента общая) вместе со статусами ответов;
//     у автора из другой школы рядом показано название его школы;
//   • поиск, фильтр по предмету, «Без ответа», «Мои»;
//   • форма «Задать вопрос»: предмет, заголовок, подробности, фото задачи;
//     проверка длины и грубых слов; фото — в Storage (корзина qa-images).
// Как связан с остальными: js/layout.js, js/qa.js, js/config.js, js/ui.js,
// js/auth.js, js/supabase.js, js/utils.js, js/validation.js.
// ============================================================================

// запуск страницы
import { initPage } from '../layout.js';
// подключение к Supabase
import { supabase } from '../supabase.js';
// предметы и ограничения длины
import { SUBJECTS, QA_LIMITS } from '../config.js';
// имя «Амир Т.»
import { formatName } from '../auth.js';
// плашка предмета
import { subjectChipHtml } from '../ui.js';
// общие функции вопросов
import { checkText, uploadQaImage, removeQaImages, loadAuthors, schoolNoteHtml, setupPhotoPicker, setupCounters } from '../qa.js';
// экранирование, тосты, кнопки, состояния, время, ошибки
import { escapeHtml, setButtonLoading, renderState, formatRelative, getErrorMessage, logError, pluralRu } from '../utils.js';
// ошибки полей
import { showFieldError, clearFormErrors, showFormError, focusFirstError } from '../validation.js';

// state — данные страницы
const state = {
  // мой профиль
  me: null,
  // все загруженные вопросы
  questions: [],
  // авторы: Map «id → профиль»
  authors: new Map(),
  // выбор фото в форме
  photo: null,
// конец объекта
};

// форма вопроса
const form = document.getElementById('ask-form');
// поле «предмет»
const subjectInput = document.getElementById('ask-subject');
// поле «заголовок»
const titleInput = document.getElementById('ask-title-input');
// поле «подробности»
const bodyInput = document.getElementById('ask-body');
// контейнер списка
const listBox = document.getElementById('questions-list');

// ----------------------------------------------------------------------------
// visibleAnswers — ответы вопроса, которые видят все (не удалённые).
// Принимает: question. Возвращает: массив ответов.
// ----------------------------------------------------------------------------
// function
function visibleAnswers(question) {
  // удалённые админом не считаем
  return question.answers.filter((a) => a.status !== 'removed');
// конец функции visibleAnswers
}

// ----------------------------------------------------------------------------
// questionCardHtml — карточка вопроса в ленте.
// Принимает: q — вопрос. Возвращает: строку HTML.
// ----------------------------------------------------------------------------
// function
function questionCardHtml(q) {
  // автор
  const author = state.authors.get(q.author_id) ?? { first_name: 'Ученик', last_initial: '', avatar: '👤' };
  // видимые ответы
  const answers = visibleAnswers(q);
  // есть ли одобренный
  const approved = answers.some((a) => a.status === 'approved');
  // плашка статуса вопроса
  const status = approved
    // есть одобренный ответ
    ? '<span class="chip chip-success">✅ Есть одобренный ответ</span>'
    // есть ответы, но не одобренные
    : answers.length > 0 ? `<span class="chip chip-primary">💬 ${answers.length} ${pluralRu(answers.length, ['ответ', 'ответа', 'ответов'])}</span>`
      // ответов нет
      : '<span class="chip chip-warning">🙋 Ждёт ответа</span>';
  // короткий отрывок: первые 160 символов
  const excerpt = q.body.length > 160 ? `${q.body.slice(0, 160)}…` : q.body;
  // карточка — это ссылка на страницу вопроса
  return [
    // ссылка-карточка
    `<a class="card card-hover question-card fade-in" href="/pages/question.html?id=${q.id}">`,
    // предмет и статус
    `<div class="question-top">${subjectChipHtml(q.subject)}${status}</div>`,
    // заголовок; экранируем — текст ученика
    `<h3 class="question-title">${escapeHtml(q.title)}</h3>`,
    // отрывок подробностей
    excerpt ? `<p class="question-excerpt">${escapeHtml(excerpt)}</p>` : '',
    // автор, класс, школа (если другая), время, значок фото и пометка «мой вопрос»
    `<div class="question-meta"><span class="avatar avatar-sm" aria-hidden="true">${escapeHtml(author.avatar)}</span><span>${escapeHtml(formatName(author))}${author.grade ? ` · ${author.grade} класс` : ''} · ${formatRelative(q.created_at)}</span>${schoolNoteHtml(author, state.me)}${q.image_path ? '<span title="Есть фото">📷</span>' : ''}${q.author_id === state.me.id ? '<span class="chip">мой вопрос</span>' : ''}</div>`,
    // конец карточки
    '</a>',
  // склеиваем
  ].join('');
// конец функции questionCardHtml
}

// ----------------------------------------------------------------------------
// renderList — применяет поиск и фильтры и рисует ленту.
// Принимает: ничего. Возвращает: ничего.
// ----------------------------------------------------------------------------
// function
function renderList() {
  // текст поиска маленькими буквами
  const search = document.getElementById('q-search').value.trim().toLowerCase();
  // выбранный предмет
  const subject = document.getElementById('q-subject').value;
  // режим: all, unanswered или mine
  const mode = document.querySelector('input[name="q-mode"]:checked').value;
  // отбираем вопросы
  const list = state.questions.filter((q) => {
    // поиск по заголовку и подробностям
    if (search && !`${q.title} ${q.body}`.toLowerCase().includes(search)) return false;
    // предмет
    if (subject && q.subject !== subject) return false;
    // без ответа
    if (mode === 'unanswered' && visibleAnswers(q).length > 0) return false;
    // только мои
    if (mode === 'mine' && q.author_id !== state.me.id) return false;
    // подходит
    return true;
  // конец filter
  });
  // вопросов нет вообще
  if (state.questions.length === 0) {
    // пустое состояние
    renderState(listBox, 'empty', 'Вопросов пока нет', 'Будь первым — задай вопрос по предмету, который даётся трудно.');
    // выход
    return;
  // конец if
  }
  // по фильтрам ничего
  if (list.length === 0) {
    // сообщение
    renderState(listBox, 'empty', 'Ничего не нашли', 'Попробуй изменить поиск или фильтры.');
    // выход
    return;
  // конец if
  }
  // лента карточек
  listBox.innerHTML = `<div class="question-list">${list.map(questionCardHtml).join('')}</div>`;
// конец функции renderList
}

// ----------------------------------------------------------------------------
// loadQuestions — загружает вопросы и авторов.
// Принимает: ничего. Возвращает: Promise.
// ----------------------------------------------------------------------------
// async function
async function loadQuestions() {
  // вопросы с вложенными ответами (только id и статус — для счётчиков); новые сверху
  const { data, error } = await supabase.from('questions').select('id, subject, title, body, image_path, author_id, created_at, answers(id, status)').order('created_at', { ascending: false }).limit(200);
  // ошибка — бросаем
  if (error) throw error;
  // запоминаем
  state.questions = data;
  // авторы вопросов (из любой школы — через функцию базы get_qa_authors)
  state.authors = await loadAuthors(data.map((q) => q.author_id));
// конец функции loadQuestions
}

// ----------------------------------------------------------------------------
// toggleAskForm — открыть или закрыть форму вопроса.
// Принимает: open — true/false. Возвращает: ничего.
// ----------------------------------------------------------------------------
// function
function toggleAskForm(open) {
  // карточка формы
  const card = document.getElementById('ask-card');
  // показать или спрятать
  card.hidden = !open;
  // состояние кнопки для программ чтения с экрана
  document.getElementById('ask-toggle').setAttribute('aria-expanded', String(open));
  // при открытии — курсор в выбор предмета и прокрутка к форме
  if (open) {
    // прокрутка
    card.scrollIntoView({ behavior: 'smooth', block: 'start' });
    // курсор
    subjectInput.focus();
  // конец if
  }
// конец функции toggleAskForm
}

// ----------------------------------------------------------------------------
// submitQuestion — публикация вопроса.
// Принимает: event. Возвращает: Promise.
// ----------------------------------------------------------------------------
// async function
async function submitQuestion(event) {
  // не перезагружаем страницу
  event.preventDefault();
  // кнопка
  const button = document.getElementById('ask-submit');
  // защита от двойного нажатия
  if (button.disabled) return;
  // убираем старые ошибки
  clearFormErrors(form);
  // значения
  const subject = subjectInput.value;
  // заголовок
  const title = titleInput.value.trim();
  // подробности
  const body = bodyInput.value.trim();
  // ошибки
  const errors = {
    // предмет
    subject: subject ? '' : 'Выбери предмет',
    // заголовок: длина и грубые слова
    title: checkText(title, { label: 'Заголовок', min: QA_LIMITS.titleMin, max: QA_LIMITS.titleMax }),
    // подробности
    body: checkText(body, { label: 'Подробности', max: QA_LIMITS.bodyMax }),
  // конец объекта
  };
  // показываем ошибки под полями
  showFieldError(subjectInput, errors.subject);
  // заголовок
  showFieldError(titleInput, errors.title);
  // подробности
  showFieldError(bodyInput, errors.body);
  // есть ошибки — стоп
  if (errors.subject || errors.title || errors.body) {
    // курсор в первое поле с ошибкой
    focusFirstError(form);
    // стоп
    return;
  // конец if
  }
  // «загрузка»
  setButtonLoading(button, true);
  // путь фото (если загрузим)
  let imagePath = null;
  // try — запросы
  try {
    // сначала фото (если выбрано)
    if (state.photo.file) imagePath = await uploadQaImage(state.photo.file, state.me.school_id);
    // insert — новый вопрос; select('id').single() — сразу получить его номер
    const { data, error } = await supabase.from('questions').insert({ school_id: state.me.school_id, author_id: state.me.id, subject, title, body, image_path: imagePath }).select('id').single();
    // ошибка — в catch
    if (error) throw error;
    // переходим на страницу нового вопроса
    location.href = `/pages/question.html?id=${data.id}&new=1`;
  // catch — ошибка
  } catch (error) {
    // в консоль
    logError(error);
    // если фото уже загрузилось, а вопрос не сохранился — удаляем фото
    if (imagePath) await removeQaImages([imagePath]);
    // понятное сообщение
    showFormError(form, getErrorMessage(error));
    // кнопка снова активна
    setButtonLoading(button, false);
  // конец try/catch
  }
// конец функции submitQuestion
}

// ----------------------------------------------------------------------------
// start — запуск страницы.
// Принимает: ничего. Возвращает: Promise.
// ----------------------------------------------------------------------------
// async function
async function start() {
  // страница для всех ролей (учитель и админ — только читают)
  const context = await initPage({ active: 'questions' });
  // нельзя показывать — выходим
  if (!context) return;
  // мой профиль
  state.me = context.profile;
  // задавать вопросы может только незаблокированный ученик
  const canAsk = state.me.role === 'student' && !state.me.is_blocked;
  // кнопка «Задать вопрос»
  document.getElementById('ask-toggle').hidden = !canAsk;
  // список предметов в фильтре
  document.getElementById('q-subject').innerHTML = '<option value="">Все предметы</option>' + SUBJECTS.map((s) => `<option value="${s.id}">${s.icon} ${escapeHtml(s.name)}</option>`).join('');
  // список предметов в форме
  subjectInput.innerHTML = '<option value="">Выбери предмет</option>' + SUBJECTS.map((s) => `<option value="${s.id}">${s.icon} ${escapeHtml(s.name)}</option>`).join('');
  // счётчики символов
  setupCounters(form);
  // выбор фото
  state.photo = setupPhotoPicker(document.getElementById('ask-photo'));
  // try — загрузка
  try {
    // вопросы
    await loadQuestions();
    // лента
    renderList();
  // catch — ошибка
  } catch (error) {
    // в консоль
    logError(error);
    // сообщение
    renderState(listBox, 'error', 'Не удалось загрузить вопросы', getErrorMessage(error), { href: location.pathname, label: 'Попробовать ещё раз' });
  // конец try/catch
  }
  // кнопка «Задать вопрос» открывает или закрывает форму
  document.getElementById('ask-toggle').addEventListener('click', () => toggleAskForm(document.getElementById('ask-card').hidden));
  // «Отмена» — закрыть форму
  document.getElementById('ask-cancel').addEventListener('click', () => toggleAskForm(false));
  // отправка вопроса
  form.addEventListener('submit', submitQuestion);
  // поиск — при каждом вводе
  document.getElementById('q-search').addEventListener('input', renderList);
  // фильтр по предмету
  document.getElementById('q-subject').addEventListener('change', renderList);
  // режим «Все / Без ответа / Мои»
  document.querySelectorAll('input[name="q-mode"]').forEach((input) => input.addEventListener('change', renderList));
// конец функции start
}

// запускаем страницу
start();
