// ============================================================================
// Файл: js/pages/admin.js
// Зачем нужен: панель администратора (pages/admin.html):
//   • модерация вопросов и ответов: одобрить ответ (+15 очков автору),
//     удалить с комментарием, вынести предупреждение, удалить вопрос;
//   • школы — добавить, изменить (прямо в строке таблицы), удалить;
//   • пользователи — поиск по email, имени и фамилии; «Сделать учителем»
//     (с выбором школы) и «Снять роль учителя».
// Защита: страница только для роли admin (initPage с roles), а база
// разрешает менять школы только админу (RLS-правила schools_*) и проверяет
// роль в SQL-функциях admin_list_users, admin_set_teacher,
// admin_remove_teacher.
// Как связан с остальными: js/layout.js, js/dialog.js, js/supabase.js,
// js/utils.js, js/validation.js.
// ============================================================================

// запуск страницы
import { initPage } from '../layout.js';
// подключение к Supabase
import { supabase } from '../supabase.js';
// окна подтверждения и ввода
import { confirmAction, openDialog } from '../dialog.js';
// имя «Амир Т.»
import { formatName } from '../auth.js';
// плашка предмета
import { subjectChipHtml } from '../ui.js';
// общие функции вопросов и ответов
import { loadProfiles, imageUrls, photoHtml, answerStatusHtml, removeQaImages } from '../qa.js';
// поиск и подсветка грубых слов
import { findBadWords, highlightBadWords } from '../moderation.js';
// экранирование, тосты, кнопки, состояния, ошибки
import { escapeHtml, showToast, setButtonLoading, renderState, getErrorMessage, logError, formatRelative } from '../utils.js';
// ошибки полей
import { showFieldError } from '../validation.js';

// ROLE_LABELS — роли по-русски и цвет плашки
const ROLE_LABELS = {
  // ученик
  student: { text: 'Ученик', variant: 'primary' },
  // учитель
  teacher: { text: 'Учитель', variant: 'success' },
  // администратор
  admin: { text: 'Админ', variant: 'accent' },
// конец объекта
};
// SEARCH_DELAY — пауза после ввода перед поиском (мс), чтобы не отправлять запрос на каждую букву
const SEARCH_DELAY = 350;

// state — данные страницы
const state = {
  // школы
  schools: [],
  // Map «id школы → число пользователей»
  schoolUsers: new Map(),
  // id школы, которую сейчас редактируют (null — никакую)
  editingId: null,
  // найденные пользователи
  users: [],
  // таймер поиска (для паузы)
  searchTimer: null,
  // модерация: ответы, вопросы, авторы и ссылки на фото
  mod: { answers: [], questions: [], people: new Map(), urls: new Map() },
// конец объекта
};

// ----------------------------------------------------------------------------
// validateSchool — проверяет название и город.
// Принимает: name, city. Возвращает: { name: ошибка, city: ошибка }.
// ----------------------------------------------------------------------------
// function
function validateSchool(name, city) {
  // ошибки по полям ('' — ошибки нет)
  return {
    // название от 2 до 120 символов (как в базе)
    name: name.length < 2 ? 'Название — минимум 2 символа' : name.length > 120 ? 'Название — максимум 120 символов' : '',
    // город до 60 символов
    city: city.length > 60 ? 'Город — максимум 60 символов' : '',
  // конец объекта
  };
// конец функции validateSchool
}

// ----------------------------------------------------------------------------
// loadSchools — загружает школы и считает, сколько в каждой пользователей.
// Принимает: ничего. Возвращает: Promise.
// ----------------------------------------------------------------------------
// async function
async function loadSchools() {
  // школы и школы всех пользователей параллельно (админу RLS отдаёт все профили)
  const [schoolsRes, profilesRes] = await Promise.all([
    // школы по алфавиту
    supabase.from('schools').select('id, name, city').order('name'),
    // у каждого пользователя — только номер школы
    supabase.from('profiles').select('school_id'),
  // конец списка
  ]);
  // ошибки
  if (schoolsRes.error) throw schoolsRes.error;
  // ошибка профилей
  if (profilesRes.error) throw profilesRes.error;
  // школы
  state.schools = schoolsRes.data;
  // пустой словарь для подсчёта
  const counts = new Map();
  // считаем: для каждого профиля +1 его школе
  profilesRes.data.forEach((p) => { if (p.school_id) counts.set(p.school_id, (counts.get(p.school_id) ?? 0) + 1); });
  // запоминаем
  state.schoolUsers = counts;
// конец функции loadSchools
}

// ----------------------------------------------------------------------------
// renderSchools — таблица школ (строка в режиме просмотра или редактирования).
// Принимает: ничего. Возвращает: ничего.
// ----------------------------------------------------------------------------
// function
function renderSchools() {
  // контейнер
  const box = document.getElementById('schools-table');
  // школ нет
  if (state.schools.length === 0) {
    // сообщение
    renderState(box, 'empty', 'Школ пока нет', 'Добавь первую школу — без неё ученики не смогут зарегистрироваться.');
    // выход
    return;
  // конец if
  }
  // строки таблицы
  const rows = state.schools.map((s) => {
    // сколько пользователей в школе
    const users = state.schoolUsers.get(s.id) ?? 0;
    // строка в режиме редактирования: поля и кнопки «Сохранить» / «Отмена»
    if (s.id === state.editingId) {
      // HTML строки; aria-label — подписи полей для программ чтения с экрана
      return `<tr><td><input class="input" data-edit="name" value="${escapeHtml(s.name)}" maxlength="120" aria-label="Название школы"></td><td><input class="input" data-edit="city" value="${escapeHtml(s.city)}" maxlength="60" aria-label="Город"></td><td>${users}</td><td><div class="table-actions"><button class="btn btn-primary btn-sm" type="button" data-school-save="${s.id}">Сохранить</button><button class="btn btn-ghost btn-sm" type="button" data-school-cancel>Отмена</button></div></td></tr>`;
    // конец if
    }
    // обычная строка: название, город, пользователи, кнопки
    return `<tr><td><strong>${escapeHtml(s.name)}</strong></td><td>${escapeHtml(s.city) || '—'}</td><td>${users}</td><td><div class="table-actions"><button class="btn btn-ghost btn-sm" type="button" data-school-edit="${s.id}">Изменить</button><button class="btn btn-danger btn-sm" type="button" data-school-delete="${s.id}"${users > 0 ? ' title="В школе есть пользователи — удалить нельзя"' : ''}>Удалить</button></div></td></tr>`;
  // конец map
  }).join('');
  // таблица: thead — заголовки столбцов, tbody — строки; scope="col" — заголовок столбца (для программ чтения с экрана)
  box.innerHTML = `<table class="table"><thead><tr><th scope="col">Название</th><th scope="col">Город</th><th scope="col">Пользователей</th><th scope="col"><span class="visually-hidden">Действия</span></th></tr></thead><tbody>${rows}</tbody></table>`;
// конец функции renderSchools
}

// ----------------------------------------------------------------------------
// addSchool — отправка формы «Добавить школу».
// Принимает: event. Возвращает: Promise.
// ----------------------------------------------------------------------------
// async function
async function addSchool(event) {
  // не перезагружаем страницу
  event.preventDefault();
  // форма
  const form = event.currentTarget;
  // кнопка
  const button = document.getElementById('school-button');
  // защита от двойного нажатия
  if (button.disabled) return;
  // общая ошибка
  const formError = document.getElementById('school-form-error');
  // прячем
  formError.hidden = true;
  // значения без пробелов по краям
  const name = form.school_name.value.trim();
  // город
  const city = form.school_city.value.trim();
  // проверка
  const errors = validateSchool(name, city);
  // ошибка под названием
  showFieldError(form.school_name, errors.name);
  // ошибка под городом
  showFieldError(form.school_city, errors.city);
  // есть ошибки — стоп
  if (errors.name || errors.city) return;
  // «загрузка»
  setButtonLoading(button, true);
  // try — запрос
  try {
    // insert — добавить школу (RLS пустит только админа)
    const { error } = await supabase.from('schools').insert({ name, city });
    // ошибка — в catch
    if (error) throw error;
    // очищаем форму
    form.reset();
    // сообщение
    showToast('Школа добавлена', 'success');
    // обновляем таблицу
    await loadSchools();
    // рисуем
    renderSchools();
  // catch — ошибка (например, такая школа уже есть)
  } catch (error) {
    // в консоль
    logError(error);
    // текст ошибки
    formError.textContent = getErrorMessage(error);
    // показываем
    formError.hidden = false;
  // finally — всегда
  } finally {
    // кнопка снова активна
    setButtonLoading(button, false);
  // конец try/catch/finally
  }
// конец функции addSchool
}

// ----------------------------------------------------------------------------
// saveSchool — сохранить изменения школы из строки таблицы.
// Принимает: button — кнопка «Сохранить». Возвращает: Promise.
// ----------------------------------------------------------------------------
// async function
async function saveSchool(button) {
  // строка таблицы, в которой кнопка
  const row = button.closest('tr');
  // новое название
  const name = row.querySelector('[data-edit="name"]').value.trim();
  // новый город
  const city = row.querySelector('[data-edit="city"]').value.trim();
  // проверка
  const errors = validateSchool(name, city);
  // есть ошибка — показываем тостом и выходим
  if (errors.name || errors.city) {
    // сообщение
    showToast(errors.name || errors.city, 'error');
    // стоп
    return;
  // конец if
  }
  // «загрузка»
  setButtonLoading(button, true);
  // try — запрос
  try {
    // update — изменить школу с этим id
    const { error } = await supabase.from('schools').update({ name, city }).eq('id', Number(button.dataset.schoolSave));
    // ошибка — в catch
    if (error) throw error;
    // выходим из режима редактирования
    state.editingId = null;
    // сообщение
    showToast('Школа сохранена', 'success');
    // обновляем
    await loadSchools();
    // рисуем
    renderSchools();
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
// конец функции saveSchool
}

// ----------------------------------------------------------------------------
// deleteSchool — удалить школу (только пустую: база не даст удалить школу
// с пользователями — «on delete restrict» в schema.sql).
// Принимает: button — кнопка «Удалить». Возвращает: Promise.
// ----------------------------------------------------------------------------
// async function
async function deleteSchool(button) {
  // id школы
  const id = Number(button.dataset.schoolDelete);
  // школа
  const school = state.schools.find((s) => s.id === id);
  // если в школе есть пользователи — сразу понятное сообщение, без запроса
  if ((state.schoolUsers.get(id) ?? 0) > 0) {
    // сообщение
    showToast('В этой школе есть пользователи — удалить её нельзя', 'error');
    // стоп
    return;
  // конец if
  }
  // подтверждение
  const ok = await confirmAction({ title: 'Удалить школу?', text: `«${school?.name ?? ''}» будет удалена навсегда.`, confirmLabel: 'Удалить', danger: true });
  // передумал
  if (!ok) return;
  // «загрузка»
  setButtonLoading(button, true);
  // try — запрос
  try {
    // delete — удалить школу с этим id
    const { error } = await supabase.from('schools').delete().eq('id', id);
    // ошибка — в catch
    if (error) throw error;
    // сообщение
    showToast('Школа удалена', 'success');
    // обновляем
    await loadSchools();
    // рисуем
    renderSchools();
  // catch — ошибка
  } catch (error) {
    // в консоль
    logError(error);
    // сообщение («Нельзя удалить: к этой записи привязаны пользователи…»)
    showToast(getErrorMessage(error), 'error');
    // кнопка снова активна
    setButtonLoading(button, false);
  // конец try/catch
  }
// конец функции deleteSchool
}

// ----------------------------------------------------------------------------
// schoolOptions — пункты выпадающего списка школ.
// Принимает: selectedId — какая школа выбрана. Возвращает: строку HTML.
// ----------------------------------------------------------------------------
// function
function schoolOptions(selectedId) {
  // пункт на каждую школу; selected — выбрана
  return state.schools.map((s) => `<option value="${s.id}"${s.id === selectedId ? ' selected' : ''}>${escapeHtml(s.name)}</option>`).join('');
// конец функции schoolOptions
}

// ----------------------------------------------------------------------------
// renderUsers — таблица найденных пользователей.
// Принимает: ничего. Возвращает: ничего.
// ----------------------------------------------------------------------------
// function
function renderUsers() {
  // контейнер
  const box = document.getElementById('users-table');
  // никого не нашли
  if (state.users.length === 0) {
    // сообщение
    renderState(box, 'empty', 'Никого не нашли', 'Попробуй другой запрос.');
    // выход
    return;
  // конец if
  }
  // строки
  const rows = state.users.map((u) => {
    // роль по-русски
    const role = ROLE_LABELS[u.role] ?? ROLE_LABELS.student;
    // действия зависят от роли
    let actions = '<span class="muted">—</span>';
    // ученика можно сделать учителем выбранной школы
    if (u.role === 'student') actions = `<select class="input input-sm" data-teacher-school="${u.id}" aria-label="Школа для учителя">${schoolOptions(u.school_id)}</select><button class="btn btn-secondary btn-sm" type="button" data-make-teacher="${u.id}">Сделать учителем</button>`;
    // у учителя можно снять роль
    if (u.role === 'teacher') actions = `<button class="btn btn-ghost btn-sm" type="button" data-remove-teacher="${u.id}">Снять роль учителя</button>`;
    // строка: имя и фамилия, email, роль, школа, класс, действия
    return `<tr><td><strong>${escapeHtml(`${u.first_name} ${u.last_name ?? ''}`)}</strong>${u.is_blocked ? ' <span class="chip chip-danger">заблокирован(а)</span>' : ''}</td><td>${escapeHtml(u.email)}</td><td><span class="chip chip-${role.variant}">${role.text}</span></td><td>${escapeHtml(u.school_name ?? '—')}</td><td>${u.grade ?? '—'}</td><td><div class="table-actions">${actions}</div></td></tr>`;
  // конец map
  }).join('');
  // таблица
  box.innerHTML = `<table class="table"><thead><tr><th scope="col">Имя</th><th scope="col">Email</th><th scope="col">Роль</th><th scope="col">Школа</th><th scope="col">Класс</th><th scope="col"><span class="visually-hidden">Действия</span></th></tr></thead><tbody>${rows}</tbody></table>`;
// конец функции renderUsers
}

// ----------------------------------------------------------------------------
// searchUsers — поиск пользователей через SQL-функцию admin_list_users.
// Принимает: text — строка поиска. Возвращает: Promise.
// ----------------------------------------------------------------------------
// async function
async function searchUsers(text) {
  // контейнер
  const box = document.getElementById('users-table');
  // try — запрос
  try {
    // функция вернёт до 200 пользователей, подходящих под поиск
    const { data, error } = await supabase.rpc('admin_list_users', { p_search: text });
    // ошибка — в catch
    if (error) throw error;
    // запоминаем
    state.users = data;
    // рисуем
    renderUsers();
  // catch — ошибка
  } catch (error) {
    // в консоль
    logError(error);
    // сообщение
    renderState(box, 'error', 'Не удалось загрузить пользователей', getErrorMessage(error));
  // конец try/catch
  }
// конец функции searchUsers
}

// ----------------------------------------------------------------------------
// changeRole — «Сделать учителем» или «Снять роль учителя».
// Принимает: button — нажатая кнопка. Возвращает: Promise.
// ----------------------------------------------------------------------------
// async function
async function changeRole(button) {
  // назначаем или снимаем
  const makeTeacher = Boolean(button.dataset.makeTeacher);
  // id пользователя
  const userId = button.dataset.makeTeacher ?? button.dataset.removeTeacher;
  // пользователь
  const user = state.users.find((u) => u.id === userId);
  // выбранная школа (только для назначения); querySelector по атрибуту с id пользователя
  const schoolId = makeTeacher ? Number(document.querySelector(`[data-teacher-school="${userId}"]`).value) : null;
  // название школы для окна
  const schoolName = state.schools.find((s) => s.id === schoolId)?.name ?? '';
  // подтверждение
  const ok = await confirmAction(makeTeacher
    // назначить
    ? { title: 'Назначить учителем?', text: `${user.first_name} ${user.last_name ?? ''} станет учителем школы «${schoolName}» и будет разбирать жалобы её учеников.`, confirmLabel: 'Назначить' }
    // снять
    : { title: 'Снять роль учителя?', text: `${user.first_name} ${user.last_name ?? ''} станет обычным учеником.`, confirmLabel: 'Снять роль', danger: true });
  // передумал
  if (!ok) return;
  // «загрузка»
  setButtonLoading(button, true);
  // try — запрос
  try {
    // нужная SQL-функция
    const { error } = makeTeacher
      // назначить учителем школы
      ? await supabase.rpc('admin_set_teacher', { p_user_id: userId, p_school_id: schoolId })
      // снять роль
      : await supabase.rpc('admin_remove_teacher', { p_user_id: userId });
    // ошибка — в catch
    if (error) throw error;
    // сообщение
    showToast(makeTeacher ? 'Учитель назначен' : 'Роль учителя снята', 'success');
    // обновляем таблицу с тем же поиском
    await searchUsers(document.getElementById('user-search').value.trim());
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
// конец функции changeRole
}

// ----------------------------------------------------------------------------
// schoolName — название школы по номеру (для карточек модерации).
// Принимает: schoolId. Возвращает: строку.
// ----------------------------------------------------------------------------
// function
function schoolName(schoolId) {
  // ищем среди загруженных школ; ?? — если не нашли
  return state.schools.find((s) => s.id === schoolId)?.name ?? 'школа не указана';
// конец функции schoolName
}

// ----------------------------------------------------------------------------
// modAuthorHtml — автор в карточке модерации: имя, школа, предупреждения.
// Принимает: userId. Возвращает: строку HTML.
// ----------------------------------------------------------------------------
// function
function modAuthorHtml(userId) {
  // профиль автора
  const p = state.mod.people.get(userId) ?? { first_name: 'Ученик', last_initial: '', avatar: '👤', warnings_count: 0 };
  // аватар, имя-ссылка, школа и число предупреждений
  return `<span class="avatar avatar-sm" aria-hidden="true">${escapeHtml(p.avatar)}</span><a class="person-link" href="/pages/user.html?id=${encodeURIComponent(userId)}"><strong>${escapeHtml(formatName(p))}</strong></a><span class="muted">· ${escapeHtml(schoolName(p.school_id))}${p.warnings_count ? ` · ⚠️ предупреждений: ${p.warnings_count}` : ''}</span>`;
// конец функции modAuthorHtml
}

// ----------------------------------------------------------------------------
// badWordsHtml — плашка «Грубые слова: …», если они есть в тексте.
// Принимает: texts — массив текстов. Возвращает: строку HTML или ''.
// ----------------------------------------------------------------------------
// function
function badWordsHtml(texts) {
  // все найденные слова без повторов
  const bad = [...new Set(texts.flatMap((t) => findBadWords(t)))];
  // нет — ничего
  if (bad.length === 0) return '';
  // есть — красная плашка
  return `<p class="chip chip-danger bad-words-flag">⚠️ Грубые слова: ${escapeHtml(bad.join(', '))}</p>`;
// конец функции badWordsHtml
}

// ----------------------------------------------------------------------------
// modAnswerCardHtml — карточка ответа для модерации.
// Принимает: a — ответ вместе с вопросом (a.questions). Возвращает: HTML.
// ----------------------------------------------------------------------------
// function
function modAnswerCardHtml(a) {
  // вопрос, к которому ответ
  const q = a.questions ?? { id: a.question_id, title: 'Вопрос удалён', subject: 'math', body: '', school_id: null };
  // кнопки зависят от статуса: непроверенный — одобрить/удалить, одобренный — удалить, удалённый — восстановить
  const buttons = [
    // одобрить (или восстановить удалённый)
    a.status !== 'approved' ? `<button class="btn btn-primary btn-sm" type="button" data-mod="approve" data-id="${a.id}">${a.status === 'removed' ? '↩️ Восстановить и одобрить' : '✅ Одобрить'}</button>` : '',
    // удалить с комментарием
    a.status !== 'removed' ? `<button class="btn btn-danger btn-sm" type="button" data-mod="remove" data-id="${a.id}">🗑 Удалить</button>` : '',
    // предупреждение автору
    `<button class="btn btn-secondary btn-sm" type="button" data-mod="warn" data-user="${a.author_id}">⚠️ Предупреждение</button>`,
  // склеиваем
  ].join('');
  // карточка
  return [
    // начало; класс status-… — цветная полоска слева
    `<article class="card mod-card answer-card status-${a.status} fade-in">`,
    // контекст: школа, предмет, вопрос (ссылка)
    `<div class="mod-context"><span class="muted">🏫 ${escapeHtml(schoolName(q.school_id))}</span>${subjectChipHtml(q.subject)}<a href="/pages/question.html?id=${q.id}">${escapeHtml(q.title)}</a></div>`,
    // текст вопроса кратко
    q.body ? `<p class="muted mod-question">Вопрос: ${escapeHtml(q.body.length > 200 ? `${q.body.slice(0, 200)}…` : q.body)}</p>` : '',
    // автор ответа, время, статус
    `<div class="answer-head"><div class="qa-author">${modAuthorHtml(a.author_id)}<span class="muted">· ${formatRelative(a.created_at)}</span></div>${answerStatusHtml(a.status)}</div>`,
    // плашка грубых слов
    badWordsHtml([a.body]),
    // текст ответа с подсветкой грубых слов (highlightBadWords сам экранирует текст)
    a.body ? `<p class="qa-text">${highlightBadWords(a.body, escapeHtml)}</p>` : '',
    // фото решения
    photoHtml(state.mod.urls.get(a.image_path), 'Фото решения'),
    // комментарий администратора (если был)
    a.admin_comment ? `<p class="admin-comment${a.status === 'removed' ? ' removed' : ''}"><strong>Комментарий:</strong> ${escapeHtml(a.admin_comment)}</p>` : '',
    // кнопки
    `<div class="partner-actions">${buttons}</div>`,
    // конец карточки
    '</article>',
  // склеиваем
  ].join('');
// конец функции modAnswerCardHtml
}

// ----------------------------------------------------------------------------
// modQuestionCardHtml — карточка вопроса для модерации.
// Принимает: q — вопрос. Возвращает: HTML.
// ----------------------------------------------------------------------------
// function
function modQuestionCardHtml(q) {
  // карточка
  return [
    // начало
    '<article class="card mod-card fade-in">',
    // школа, предмет, число ответов
    `<div class="mod-context"><span class="muted">🏫 ${escapeHtml(schoolName(q.school_id))}</span>${subjectChipHtml(q.subject)}<span class="muted">💬 ответов: ${q.answers.length}</span></div>`,
    // заголовок с подсветкой грубых слов
    `<h3 class="question-title"><a class="person-link" href="/pages/question.html?id=${q.id}">${highlightBadWords(q.title, escapeHtml)}</a></h3>`,
    // плашка грубых слов
    badWordsHtml([q.title, q.body]),
    // подробности с подсветкой
    q.body ? `<p class="qa-text">${highlightBadWords(q.body, escapeHtml)}</p>` : '',
    // фото задачи
    photoHtml(state.mod.urls.get(q.image_path), 'Фото к вопросу'),
    // автор и время
    `<div class="qa-author">${modAuthorHtml(q.author_id)}<span class="muted">· ${formatRelative(q.created_at)}</span></div>`,
    // кнопки
    `<div class="partner-actions"><button class="btn btn-danger btn-sm" type="button" data-mod="delete-question" data-id="${q.id}">🗑 Удалить вопрос</button><button class="btn btn-secondary btn-sm" type="button" data-mod="warn" data-user="${q.author_id}">⚠️ Предупреждение</button></div>`,
    // конец карточки
    '</article>',
  // склеиваем
  ].join('');
// конец функции modQuestionCardHtml
}

// ----------------------------------------------------------------------------
// loadModeration — загружает ответы и вопросы всех школ (админу RLS отдаёт всё),
// авторов и ссылки на фото.
// Принимает: ничего. Возвращает: Promise.
// ----------------------------------------------------------------------------
// async function
async function loadModeration() {
  // ответы и вопросы параллельно
  const [answersRes, questionsRes] = await Promise.all([
    // ответы с вопросом (questions(...) — вложенная выборка по связи question_id), новые сверху
    supabase.from('answers').select('id, question_id, author_id, body, image_path, status, admin_comment, created_at, questions(id, title, subject, body, school_id)').order('created_at', { ascending: false }).limit(300),
    // вопросы с количеством ответов
    supabase.from('questions').select('id, title, subject, body, image_path, author_id, school_id, created_at, answers(id)').order('created_at', { ascending: false }).limit(100),
  // конец списка
  ]);
  // ошибки
  if (answersRes.error) throw answersRes.error;
  // ошибка вопросов
  if (questionsRes.error) throw questionsRes.error;
  // запоминаем
  state.mod.answers = answersRes.data;
  // вопросы
  state.mod.questions = questionsRes.data;
  // авторы и ссылки на фото параллельно
  const [people, urls] = await Promise.all([
    // все авторы ответов и вопросов
    loadProfiles([...state.mod.answers.map((a) => a.author_id), ...state.mod.questions.map((q) => q.author_id)]),
    // все фото
    imageUrls([...state.mod.answers.map((a) => a.image_path), ...state.mod.questions.map((q) => q.image_path)]),
  // конец списка
  ]);
  // запоминаем
  state.mod.people = people;
  // ссылки
  state.mod.urls = urls;
  // сколько ответов ждёт проверки — в названии вкладки
  const pending = state.mod.answers.filter((a) => a.status === 'pending').length;
  // «(3)» или пусто
  document.getElementById('mod-count-pending').textContent = pending ? `(${pending})` : '';
// конец функции loadModeration
}

// ----------------------------------------------------------------------------
// showModeration — загружает и рисует модерацию; ошибку показывает только
// внутри раздела модерации (остальная панель продолжает работать).
// Принимает: ничего. Возвращает: Promise.
// ----------------------------------------------------------------------------
// async function
async function showModeration() {
  // try — пробуем загрузить
  try {
    // вопросы и ответы
    await loadModeration();
    // вкладка «На проверке»
    renderModeration();
  // catch — ошибка
  } catch (error) {
    // в консоль (предупреждение)
    logError(error);
    // сообщение в разделе модерации
    renderState(document.getElementById('mod-list'), 'error', 'Не удалось загрузить вопросы и ответы', getErrorMessage(error), { href: location.pathname, label: 'Попробовать ещё раз' });
  // конец try/catch
  }
// конец функции showModeration
}

// ----------------------------------------------------------------------------
// renderModeration — рисует выбранную вкладку модерации.
// Принимает: ничего. Возвращает: ничего.
// ----------------------------------------------------------------------------
// function
function renderModeration() {
  // выбранная вкладка
  const tab = document.querySelector('input[name="mod-tab"]:checked').value;
  // контейнер
  const box = document.getElementById('mod-list');
  // вкладка «Вопросы»
  if (tab === 'questions') {
    // вопросов нет
    if (state.mod.questions.length === 0) renderState(box, 'empty', 'Вопросов пока нет');
    // карточки вопросов
    else box.innerHTML = state.mod.questions.map(modQuestionCardHtml).join('');
    // выход
    return;
  // конец if
  }
  // ответы с нужным статусом; для «непроверенных» — старые сверху (кто дольше ждёт)
  const list = state.mod.answers.filter((a) => a.status === tab);
  // непроверенные — по возрастанию времени
  if (tab === 'pending') list.reverse();
  // тексты для пустых вкладок
  const empty = { pending: 'Все ответы проверены 🎉', approved: 'Одобренных ответов пока нет', removed: 'Удалённых ответов нет' };
  // пусто
  if (list.length === 0) renderState(box, 'empty', empty[tab]);
  // карточки
  else box.innerHTML = list.map(modAnswerCardHtml).join('');
// конец функции renderModeration
}

// ----------------------------------------------------------------------------
// handleModeration — кнопки модерации: одобрить, удалить, предупреждение,
// удалить вопрос.
// Принимает: button — кнопка с data-mod. Возвращает: Promise.
// ----------------------------------------------------------------------------
// async function
async function handleModeration(button) {
  // действие
  const action = button.dataset.mod;
  // try — всё, что ниже, может закончиться ошибкой
  try {
    // одобрить
    if (action === 'approve') {
      // окно с необязательным комментарием
      const { confirmed, value } = await openDialog({ title: 'Одобрить ответ?', text: 'Под ответом появится «✅ Одобрено администратором», автор получит +15 очков и уведомление.', confirmLabel: 'Одобрить', input: { label: 'Комментарий для автора (необязательно)', placeholder: 'Например: Отличное объяснение!', maxLength: 500 } });
      // передумал
      if (!confirmed) return;
      // «загрузка»
      setButtonLoading(button, true);
      // SQL-функция проверки ответа
      const { error } = await supabase.rpc('admin_review_answer', { p_answer_id: Number(button.dataset.id), p_action: 'approve', p_comment: value });
      // ошибка — в catch
      if (error) throw error;
      // сообщение
      showToast('Ответ одобрен', 'success');
    // удалить ответ
    } else if (action === 'remove') {
      // окно с обязательным комментарием
      const { confirmed, value } = await openDialog({ title: 'Удалить ответ?', text: 'Ответ пропадёт у всех, кроме автора. Автор увидит твой комментарий — объясни, в чём ошибка.', confirmLabel: 'Удалить', danger: true, input: { label: 'Почему ответ удалён (обязательно)', placeholder: 'Например: Ошибка в вычислениях: дискриминант равен 1, а не 4', maxLength: 500, minLength: 3, requiredMessage: 'Напиши комментарий: почему ответ удалён (минимум 3 символа)' } });
      // передумал (пустой комментарий окно не пропустит — minLength)
      if (!confirmed) return;
      // «загрузка»
      setButtonLoading(button, true);
      // SQL-функция
      const { error } = await supabase.rpc('admin_review_answer', { p_answer_id: Number(button.dataset.id), p_action: 'remove', p_comment: value });
      // ошибка — в catch
      if (error) throw error;
      // сообщение
      showToast('Ответ удалён, автор получил уведомление', 'success');
    // предупреждение
    } else if (action === 'warn') {
      // окно; текст по умолчанию уже в поле — можно поправить
      const { confirmed, value } = await openDialog({ title: 'Вынести предупреждение?', text: 'Ученик получит уведомление, счётчик его предупреждений увеличится.', confirmLabel: 'Вынести', input: { label: 'Текст предупреждения', maxLength: 500, value: 'Пожалуйста, соблюдай правила: без грубых слов и оскорблений.' } });
      // передумал
      if (!confirmed) return;
      // «загрузка»
      setButtonLoading(button, true);
      // SQL-функция
      const { error } = await supabase.rpc('admin_warn_user', { p_user_id: button.dataset.user, p_comment: value });
      // ошибка — в catch
      if (error) throw error;
      // сообщение
      showToast('Предупреждение вынесено', 'success');
    // удалить вопрос
    } else if (action === 'delete-question') {
      // окно с обязательной причиной
      const { confirmed, value } = await openDialog({ title: 'Удалить вопрос?', text: 'Вопрос и все ответы на него будут удалены. Автор получит уведомление с причиной.', confirmLabel: 'Удалить вопрос', danger: true, input: { label: 'Причина (обязательно)', placeholder: 'Например: Вопрос не относится к учёбе', maxLength: 400, minLength: 3, requiredMessage: 'Напиши причину удаления (минимум 3 символа)' } });
      // передумал (пустую причину окно не пропустит — minLength)
      if (!confirmed) return;
      // «загрузка»
      setButtonLoading(button, true);
      // SQL-функция возвращает пути фото вопроса и ответов
      const { data, error } = await supabase.rpc('admin_delete_question', { p_question_id: Number(button.dataset.id), p_comment: value });
      // ошибка — в catch
      if (error) throw error;
      // удаляем фото из хранилища
      await removeQaImages(data ?? []);
      // сообщение
      showToast('Вопрос удалён', 'success');
    // конец if/else
    }
    // перезагружаем данные модерации
    await loadModeration();
    // перерисовываем
    renderModeration();
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
// конец функции handleModeration
}

// ----------------------------------------------------------------------------
// start — запуск страницы.
// Принимает: ничего. Возвращает: Promise.
// ----------------------------------------------------------------------------
// async function
async function start() {
  // только для администратора
  const context = await initPage({ active: 'admin', roles: ['admin'] });
  // нельзя показывать — выходим
  if (!context) return;
  // блок состояний
  const stateBox = document.getElementById('admin-state');
  // try — загрузка
  try {
    // школы
    await loadSchools();
    // таблица школ
    renderSchools();
    // все пользователи (пустой поиск)
    await searchUsers('');
    // прячем «загрузку»
    stateBox.innerHTML = '';
    // показываем содержимое
    document.getElementById('admin-content').hidden = false;
  // catch — ошибка
  } catch (error) {
    // в консоль
    logError(error);
    // сообщение
    renderState(stateBox, 'error', 'Не удалось загрузить панель', getErrorMessage(error), { href: location.pathname, label: 'Попробовать ещё раз' });
    // стоп
    return;
  // конец try/catch
  }
  // модерация грузится отдельно: если с ней проблема, школы и пользователи всё равно работают
  await showModeration();
  // вкладки модерации
  document.querySelectorAll('input[name="mod-tab"]').forEach((input) => input.addEventListener('change', renderModeration));
  // кнопки в карточках модерации (делегирование)
  document.getElementById('mod-list').addEventListener('click', (event) => {
    // кнопка с data-mod
    const button = event.target.closest('button[data-mod]');
    // если нашли и не занята
    if (button && !button.disabled) handleModeration(button);
  // конец обработчика
  });
  // форма добавления школы
  document.getElementById('school-form').addEventListener('submit', addSchool);
  // кнопки в таблице школ (делегирование)
  document.getElementById('schools-table').addEventListener('click', (event) => {
    // кнопка, по которой кликнули
    const button = event.target.closest('button');
    // не кнопка или занята — выходим
    if (!button || button.disabled) return;
    // «Изменить» — включаем режим редактирования строки
    if (button.dataset.schoolEdit) {
      // запоминаем id
      state.editingId = Number(button.dataset.schoolEdit);
      // перерисовываем
      renderSchools();
      // курсор в поле названия
      document.querySelector('[data-edit="name"]')?.focus();
    // «Отмена»
    } else if (button.hasAttribute('data-school-cancel')) {
      // выходим из редактирования
      state.editingId = null;
      // перерисовываем
      renderSchools();
    // «Сохранить»
    } else if (button.dataset.schoolSave) {
      // сохраняем
      saveSchool(button);
    // «Удалить»
    } else if (button.dataset.schoolDelete) {
      // удаляем
      deleteSchool(button);
    // конец if/else
    }
  // конец обработчика
  });
  // поиск: input — срабатывает при каждом изменении текста
  document.getElementById('user-search').addEventListener('input', (event) => {
    // clearTimeout — отменяем предыдущий запланированный поиск
    clearTimeout(state.searchTimer);
    // текст поиска
    const text = event.target.value.trim();
    // setTimeout — ищем, только когда ученик перестал печатать на SEARCH_DELAY мс
    state.searchTimer = setTimeout(() => searchUsers(text), SEARCH_DELAY);
  // конец обработчика
  });
  // кнопки в таблице пользователей
  document.getElementById('users-table').addEventListener('click', (event) => {
    // кнопка назначения или снятия роли
    const button = event.target.closest('[data-make-teacher], [data-remove-teacher]');
    // если нашли и не занята
    if (button && !button.disabled) changeRole(button);
  // конец обработчика
  });
// конец функции start
}

// запускаем страницу
start();
