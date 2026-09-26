// ============================================================================
// Файл: js/pages/profile.js
// Зачем нужен: логика страницы «Мой профиль» (pages/profile.html):
//   1) загружает профиль, фамилию, предметы и удобное время;
//   2) рисует карточки предметов, сетку времени, выбор аватара;
//   3) считает, насколько заполнен профиль;
//   4) проверяет форму и сохраняет всё в базу;
//   5) показывает серию «недель подряд помогаешь» и список предметов,
//      уровень которых можно подтвердить мини-тестом (pages/quiz.html).
// Как связан с остальными: использует js/layout.js (проверка входа и шапка),
// js/supabase.js, js/config.js (списки), js/ui.js, js/utils.js,
// js/validation.js. Данные сохраняются в таблицы profiles, profile_private,
// skills и availability (sql/schema.sql). За заполненный профиль база сама
// начисляет очки (триггер on_skill_added / on_availability_added).
// ============================================================================

// запуск страницы
import { initPage } from '../layout.js';
// подключение к Supabase
import { supabase } from '../supabase.js';
// списки и поиск предмета
import { SUBJECTS, WEEK_DAYS, DAY_PARTS, GRADES } from '../config.js';
// имя «Амир Т.»
import { formatName } from '../auth.js';
// выбор аватара и выбранная радиокнопка
import { avatarPickerHtml, getCheckedValue, subjectChipHtml, verifiedMarkHtml } from '../ui.js';
// экранирование, тосты, защита кнопки, понятные ошибки
import { escapeHtml, showToast, setButtonLoading, getErrorMessage, renderState, logError } from '../utils.js';
// проверки
import { validateName, showFieldError, clearFormErrors, showFormError, focusFirstError } from '../validation.js';
// отзывы обо мне
import { loadReviewsAbout, ratingSummary, reviewsListHtml } from '../reviews.js';
// партнёрства (имена для истории занятий)
import { loadPartnerships, partnershipTitle } from '../partnerships.js';
// бейджи и правила очков
import { loadBadges, badgesHtml, pointsRulesHtml } from '../badges.js';
// серия «недель подряд помогаешь»
import { loadStreak, streakCardHtml } from '../streaks.js';

// MIN_HELP_LEVEL — с какого уровня ученик может помогать (то же число в js/matching.js и в SQL-функции can_teach)
const MIN_HELP_LEVEL = 4;
// DEFAULT_LEVELS — какой уровень выбрать сразу, когда ученик нажал «Знаю» или «Подтянуть»
const DEFAULT_LEVELS = { know: 4, learn: 2 };
// ROLE_NAMES — названия ролей для показа
const ROLE_NAMES = { student: 'Ученик', teacher: 'Учитель', admin: 'Администратор' };

// форма профиля
const form = document.getElementById('profile-form');
// state — объект с данными страницы; const запрещает заменить сам объект, но его поля менять можно
const state = {
  // текущий пользователь (из Supabase Auth)
  user: null,
  // профиль из таблицы profiles
  profile: null,
  // есть ли несохранённые изменения
  isDirty: false,
  // сохранённые в базе предметы (с отметкой verified_at) — для раздела «Подтверди свои знания»
  skills: [],
// конец объекта state
};

// ----------------------------------------------------------------------------
// subjectCardHtml — HTML карточки одного предмета.
// Принимает: subject — { id, name, icon }; skill — строка из skills или undefined.
// Возвращает: строку HTML.
// ----------------------------------------------------------------------------
// function
function subjectCardHtml(subject, skill) {
  // выбранный вариант: 'know', 'learn' или '' (не выбрано)
  const kind = skill?.kind ?? '';
  // выбранный уровень (или null)
  const level = skill?.level ?? null;
  // три кнопки переключателя: [значение, подпись]
  const kindOptions = [['', '—'], ['know', 'Знаю'], ['learn', 'Подтянуть']];
  // HTML переключателя; name="kind-math" — у каждого предмета своя группа радиокнопок
  const kindHtml = kindOptions.map(([value, label]) => `<label><input type="radio" name="kind-${subject.id}" value="${value}"${value === kind ? ' checked' : ''}><span>${label}</span></label>`).join('');
  // пять кнопок уровня 1–5
  const levelHtml = [1, 2, 3, 4, 5].map((value) => `<label><input type="radio" name="level-${subject.id}" value="${value}"${value === level ? ' checked' : ''} aria-label="Уровень ${value}"><span>${value}</span></label>`).join('');
  // собираем карточку; data-subject и data-kind — атрибуты, по ним работают скрипт и CSS
  return [
    // начало карточки
    `<div class="subject-card" data-subject="${subject.id}" data-kind="${kind}">`,
    // название с иконкой и галочкой, если уровень подтверждён тестом
    `<div class="subject-title"><span class="subject-icon" aria-hidden="true">${subject.icon}</span>${escapeHtml(subject.name)}${skill?.verified_at ? verifiedMarkHtml(true) : ''}</div>`,
    // переключатель «— / Знаю / Подтянуть»
    `<div class="segmented" role="radiogroup" aria-label="${escapeHtml(subject.name)}: знаю или хочу подтянуть">${kindHtml}</div>`,
    // строка уровня; скрыта, если предмет не выбран
    `<div class="level-row"${kind ? '' : ' hidden'}>`,
    // подпись уровня (текст поменяет updateSubjectCard)
    `<span class="muted" id="level-label-${subject.id}">Уровень</span>`,
    // кнопки уровня
    `<div class="level-picker" role="radiogroup" aria-labelledby="level-label-${subject.id}">${levelHtml}</div>`,
    // конец строки уровня
    '</div>',
    // подсказка, если «Знаю» с уровнем ниже 4
    '<p class="field-hint subject-note" hidden>С уровнем ниже 4 помогать другим пока не получится.</p>',
    // конец карточки
    '</div>',
  // склеиваем
  ].join('');
// конец функции subjectCardHtml
}

// ----------------------------------------------------------------------------
// renderSubjects — рисует карточки всех 13 предметов.
// Принимает: skills — массив строк из таблицы skills. Возвращает: ничего.
// ----------------------------------------------------------------------------
// function
function renderSubjects(skills) {
  // контейнер для карточек
  const grid = document.getElementById('subject-grid');
  // для каждого предмета ищем его навык у ученика и строим карточку
  grid.innerHTML = SUBJECTS.map((subject) => subjectCardHtml(subject, skills.find((skill) => skill.subject === subject.id))).join('');
  // обновляем подписи и подсказки во всех карточках
  grid.querySelectorAll('.subject-card').forEach(updateSubjectCard);
// конец функции renderSubjects
}

// ----------------------------------------------------------------------------
// updateSubjectCard — обновляет вид карточки после выбора «Знаю/Подтянуть»
// и уровня: цвет, видимость строки уровня, подпись, подсказку.
// Принимает: card — элемент карточки. Возвращает: ничего.
// ----------------------------------------------------------------------------
// function
function updateSubjectCard(card) {
  // id предмета из атрибута data-subject; dataset — доступ к атрибутам data-*
  const subjectId = card.dataset.subject;
  // что выбрано: '', 'know' или 'learn'
  const kind = getCheckedValue(card, `kind-${subjectId}`) ?? '';
  // выбранный уровень (строка) или null
  let level = getCheckedValue(card, `level-${subjectId}`);
  // если предмет выбран, а уровень ещё нет — ставим уровень по умолчанию
  if (kind && !level) {
    // находим нужную кнопку уровня и отмечаем её
    card.querySelector(`input[name="level-${subjectId}"][value="${DEFAULT_LEVELS[kind]}"]`).checked = true;
    // запоминаем уровень
    level = String(DEFAULT_LEVELS[kind]);
  // конец if
  }
  // data-kind меняет цвет карточки через CSS
  card.dataset.kind = kind;
  // строка уровня видна только если предмет выбран
  card.querySelector('.level-row').hidden = !kind;
  // подпись уровня зависит от выбора
  card.querySelector(`#level-label-${subjectId}`).textContent = kind === 'know' ? 'Мой уровень' : 'Сейчас мой уровень';
  // Number превращает строку в число; подсказка видна, если «Знаю» с уровнем ниже 4
  card.querySelector('.subject-note').hidden = !(kind === 'know' && Number(level) < MIN_HELP_LEVEL);
// конец функции updateSubjectCard
}

// ----------------------------------------------------------------------------
// renderVerifyList — раздел «Подтверди свои знания»: предметы «знаю» с
// уровнем 4–5 из БАЗЫ (сохранённые), у каждого — отметка или кнопка теста.
// Принимает: ничего (берёт state.skills). Возвращает: ничего.
// ----------------------------------------------------------------------------
// function
function renderVerifyList() {
  // список на странице
  const list = document.getElementById('verify-list');
  // подходящие предметы: «знаю» и уровень не ниже MIN_HELP_LEVEL; сначала неподтверждённые
  const skills = state.skills.filter((skill) => skill.kind === 'know' && skill.level >= MIN_HELP_LEVEL).sort((a, b) => Number(Boolean(a.verified_at)) - Number(Boolean(b.verified_at)));
  // таких предметов нет — подсказка
  if (skills.length === 0) {
    // текст вместо списка
    list.innerHTML = '<li class="muted">Отметь в разделе «Предметы» что-нибудь как «Знаю» с уровнем 4 или 5 и сохрани профиль — здесь появится тест.</li>';
    // стоп
    return;
  // конец if
  }
  // формат даты «24 сент.»
  const dateFormat = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' });
  // строки списка
  list.innerHTML = skills.map((skill) => [
    // строка; verified — зелёная
    `<li class="verify-item${skill.verified_at ? ' verified' : ''}">`,
    // предмет с уровнем
    subjectChipHtml(skill.subject, skill.level, 'success'),
    // подтверждён — отметка с датой; иначе — кнопка-ссылка на тест
    skill.verified_at
      // отметка
      ? `<span class="verify-status">${verifiedMarkHtml()} <span class="muted">${dateFormat.format(new Date(skill.verified_at))}</span></span>`
      // ссылка на страницу теста; encodeURIComponent — безопасно вставить в адрес
      : `<a class="btn btn-secondary btn-sm" href="/pages/quiz.html?subject=${encodeURIComponent(skill.subject)}">Пройти тест →</a>`,
    // конец строки
    '</li>',
  // склеиваем строку, потом все строки
  ].join('')).join('');
// конец функции renderVerifyList
}

// ----------------------------------------------------------------------------
// refreshSavedSkills — перечитывает свои предметы из базы после сохранения:
// если уровень опустили ниже 4, база сама сняла отметку «подтверждено».
// Принимает: ничего. Возвращает: Promise.
// ----------------------------------------------------------------------------
// async function
async function refreshSavedSkills() {
  // свои предметы
  const { data, error } = await supabase.from('skills').select('subject, kind, level, verified_at').eq('user_id', state.user.id);
  // ошибка — бросаем
  if (error) throw error;
  // запоминаем
  state.skills = data;
  // обновляем раздел теста
  renderVerifyList();
  // обновляем галочки в карточках предметов
  document.querySelectorAll('.subject-card').forEach((card) => {
    // сохранённый предмет этой карточки
    const skill = data.find((item) => item.subject === card.dataset.subject);
    // старая галочка (если была)
    const mark = card.querySelector('.subject-title .verified-mark');
    // нужна ли галочка сейчас
    const verified = Boolean(skill?.verified_at);
    // галочки нет, а нужна — добавляем в конец заголовка
    if (verified && !mark) card.querySelector('.subject-title').insertAdjacentHTML('beforeend', verifiedMarkHtml(true));
    // галочка есть, а не нужна — убираем
    if (!verified && mark) mark.remove();
  // конец перебора карточек
  });
// конец функции refreshSavedSkills
}

// ----------------------------------------------------------------------------
// loadStreakSection — карточка серии в профиле.
// Принимает: ничего. Возвращает: Promise.
// ----------------------------------------------------------------------------
// async function
async function loadStreakSection() {
  // место для карточки
  const box = document.getElementById('my-streak');
  // try — запрос
  try {
    // моя серия
    const streak = await loadStreak();
    // рисуем карточку
    box.innerHTML = streakCardHtml(streak, { own: true });
    // пришли по значку 🔥 из шапки — прокручиваем к серии
    if (location.hash === '#streak') document.getElementById('streak').scrollIntoView({ behavior: 'smooth' });
  // catch — ошибка
  } catch (error) {
    // в консоль
    logError(error);
    // короткое сообщение вместо карточки
    box.innerHTML = `<p class="muted">Не удалось загрузить серию: ${escapeHtml(getErrorMessage(error))}</p>`;
  // конец try/catch
  }
// конец функции loadStreakSection
}

// ----------------------------------------------------------------------------
// renderTimeGrid — рисует сетку «день недели × часть дня».
// Принимает: availability — массив строк { day, part }. Возвращает: ничего.
// ----------------------------------------------------------------------------
// function
function renderTimeGrid(availability) {
  // Set — «множество»: набор уникальных значений с быстрой проверкой has(); храним строки вида «1:morning»
  const selected = new Set(availability.map((slot) => `${slot.day}:${slot.part}`));
  // первая строка: пустая ячейка и названия частей дня
  const head = ['<span></span>', ...DAY_PARTS.map((part) => `<span class="time-grid-head"><span aria-hidden="true">${part.icon}</span> ${part.name}</span>`)];
  // строки дней: flatMap превращает каждый день в несколько ячеек и склеивает всё в один массив
  const rows = WEEK_DAYS.flatMap((day) => [
    // название дня; title — полное название при наведении
    `<span class="time-day" title="${day.name}">${day.short}</span>`,
    // три переключателя; value="1:morning" — день и часть дня
    ...DAY_PARTS.map((part) => {
      // значение ячейки
      const value = `${day.id}:${part.id}`;
      // чекбокс (можно выбрать несколько); aria-label — полное название для программ чтения с экрана
      return `<label class="time-toggle"><input type="checkbox" name="time" value="${value}"${selected.has(value) ? ' checked' : ''} aria-label="${day.name}, ${part.name.toLowerCase()}"><span></span></label>`;
    // конец map по частям дня
    }),
  // конец flatMap
  ]);
  // вставляем всё в сетку
  document.getElementById('time-grid').innerHTML = [...head, ...rows].join('');
// конец функции renderTimeGrid
}

// ----------------------------------------------------------------------------
// collectSkills — собирает выбранные предметы из карточек.
// Принимает: ничего. Возвращает: массив { subject, kind, level }.
// ----------------------------------------------------------------------------
// function
function collectSkills() {
  // Array.from превращает список элементов в настоящий массив, чтобы использовать map и filter
  return Array.from(document.querySelectorAll('.subject-card'))
    // для каждой карточки — объект с выбором
    .map((card) => ({
      // id предмета
      subject: card.dataset.subject,
      // «знаю» или «подтянуть»
      kind: getCheckedValue(card, `kind-${card.dataset.subject}`) ?? '',
      // уровень числом
      level: Number(getCheckedValue(card, `level-${card.dataset.subject}`)),
    // конец объекта
    }))
    // filter оставляет только выбранные предметы
    .filter((skill) => skill.kind !== '');
// конец функции collectSkills
}

// ----------------------------------------------------------------------------
// collectAvailability — собирает отмеченное время.
// Принимает: ничего. Возвращает: массив { day, part }.
// ----------------------------------------------------------------------------
// function
function collectAvailability() {
  // все отмеченные чекбоксы времени
  return Array.from(form.querySelectorAll('input[name="time"]:checked')).map((input) => {
    // split(':') делит «1:morning» на ['1', 'morning']; деструктуризация массива кладёт части в переменные
    const [day, part] = input.value.split(':');
    // день числом, часть дня строкой
    return { day: Number(day), part };
  // конец map
  });
// конец функции collectAvailability
}

// ----------------------------------------------------------------------------
// updateCompletion — пересчитывает «Профиль заполнен на X%».
// Принимает: ничего. Возвращает: ничего.
// ----------------------------------------------------------------------------
// function
function updateCompletion() {
  // выбранные предметы
  const skills = collectSkills();
  // пункты проверки: подпись и выполнен ли
  const items = [
    // имя и аватар есть всегда (обязательны при регистрации)
    { label: 'Имя и аватар', done: form.first_name.value.trim() !== '' },
    // some — true, если ХОТЯ БЫ ОДИН элемент подходит
    { label: 'Предмет, который знаешь', done: skills.some((skill) => skill.kind === 'know') },
    // предмет «подтянуть»
    { label: 'Предмет, который хочешь подтянуть', done: skills.some((skill) => skill.kind === 'learn') },
    // хотя бы одна отметка времени
    { label: 'Удобное время', done: collectAvailability().length > 0 },
  // конец массива
  ];
  // сколько пунктов выполнено: filter оставляет выполненные, length — их количество
  const doneCount = items.filter((item) => item.done).length;
  // Math.round округляет до целого; процент выполненных
  const percent = Math.round((doneCount / items.length) * 100);
  // число в заголовке
  document.getElementById('completion-percent').textContent = String(percent);
  // ширина заливки полоски
  document.getElementById('completion-bar').style.width = `${percent}%`;
  // значение для программ чтения с экрана
  document.getElementById('completion-progress').setAttribute('aria-valuenow', String(percent));
  // список пунктов: ✅ — выполнено, ⬜ — нет
  document.getElementById('completion-list').innerHTML = items.map((item) => `<li class="${item.done ? 'done' : ''}">${item.done ? '✅' : '⬜'} ${item.label}</li>`).join('');
// конец функции updateCompletion
}

// ----------------------------------------------------------------------------
// renderHero — заполняет верхнюю карточку (аватар, имя, класс, школа, очки)
// и имя с аватаром в шапке сайта.
// Принимает: profile — профиль. Возвращает: ничего.
// ----------------------------------------------------------------------------
// function
function renderHero(profile) {
  // аватар (textContent — безопасно, HTML не выполнится)
  document.getElementById('hero-avatar').textContent = profile.avatar;
  // имя «Амир Т.»
  document.getElementById('hero-name').textContent = formatName(profile);
  // части строки «8 класс · Школа №1 · Ученик»
  const meta = [
    // класс, если есть
    profile.grade ? `${profile.grade} класс` : '',
    // название школы из связанной таблицы (?. — если школы нет)
    profile.schools?.name ?? '',
    // роль по-русски
    ROLE_NAMES[profile.role] ?? '',
  // filter(Boolean) убирает пустые строки; join(' · ') соединяет через точку
  ].filter(Boolean).join(' · ');
  // вставляем строку
  document.getElementById('hero-meta').textContent = meta;
  // очки
  document.getElementById('hero-points').textContent = String(profile.points);
  // аватар в шапке сайта
  const headerAvatar = document.querySelector('.header-user .avatar');
  // обновляем, если нашли
  if (headerAvatar) headerAvatar.textContent = profile.avatar;
  // имя в шапке
  const headerName = document.querySelector('.header-user-name');
  // обновляем, если нашли
  if (headerName) headerName.textContent = formatName(profile);
// конец функции renderHero
}

// ----------------------------------------------------------------------------
// setDirty — отмечает, есть ли несохранённые изменения, и пишет статус.
// Принимает: isDirty — true/false. Возвращает: ничего.
// ----------------------------------------------------------------------------
// function
function setDirty(isDirty) {
  // запоминаем
  state.isDirty = isDirty;
  // текст статуса рядом с кнопкой
  document.getElementById('save-status').textContent = isDirty ? 'Есть несохранённые изменения' : 'Все изменения сохранены';
// конец функции setDirty
}

// ----------------------------------------------------------------------------
// saveProfile — сохраняет всё в базу по шагам.
// Принимает: values — { firstName, lastName, grade, avatar }; skills; availability.
// Возвращает: Promise (при ошибке бросает её).
// ----------------------------------------------------------------------------
// async function
async function saveProfile(values, skills, availability) {
  // id пользователя
  const userId = state.user.id;
  // ученик ли это
  const isStudent = state.profile.role === 'student';
  // какие поля профиля меняем; класс — только у ученика
  const profileUpdate = isStudent ? { first_name: values.firstName, grade: values.grade, avatar: values.avatar } : { first_name: values.firstName, avatar: values.avatar };
  // 1) профиль: update меняет строку, eq('id', userId) — только свою
  const profileResult = await supabase.from('profiles').update(profileUpdate).eq('id', userId);
  // ошибка — бросаем
  if (profileResult.error) throw profileResult.error;
  // 2) фамилия в закрытой таблице (первую букву в profiles обновит триггер)
  const privateResult = await supabase.from('profile_private').update({ last_name: values.lastName }).eq('id', userId);
  // ошибка — бросаем
  if (privateResult.error) throw privateResult.error;
  // предметы и время есть только у ученика
  if (!isStudent) return;
  // 3а) удаляем предметы, которые ученик снял; сначала «удалить все мои»...
  let deleteQuery = supabase.from('skills').delete().eq('user_id', userId);
  // ...но если что-то выбрано, то «кроме выбранных»: not('subject', 'in', '(a,b)') — предмет НЕ из списка
  if (skills.length > 0) deleteQuery = deleteQuery.not('subject', 'in', `(${skills.map((skill) => skill.subject).join(',')})`);
  // выполняем удаление
  const deleteResult = await deleteQuery;
  // ошибка — бросаем
  if (deleteResult.error) throw deleteResult.error;
  // 3б) upsert = insert или update: новые предметы добавятся, существующие обновятся; onConflict — по какому уникальному ключу искать существующие
  if (skills.length > 0) {
    // строки для таблицы skills
    const rows = skills.map((skill) => ({ user_id: userId, subject: skill.subject, kind: skill.kind, level: skill.level }));
    // выполняем upsert
    const upsertResult = await supabase.from('skills').upsert(rows, { onConflict: 'user_id,subject' });
    // ошибка — бросаем
    if (upsertResult.error) throw upsertResult.error;
  // конец if
  }
  // 4а) время проще перезаписать целиком: удаляем все свои отметки...
  const clearResult = await supabase.from('availability').delete().eq('user_id', userId);
  // ошибка — бросаем
  if (clearResult.error) throw clearResult.error;
  // 4б) ...и вставляем выбранные заново
  if (availability.length > 0) {
    // добавляем user_id к каждой отметке; ...slot — «распаковка» полей объекта slot
    const insertResult = await supabase.from('availability').insert(availability.map((slot) => ({ user_id: userId, ...slot })));
    // ошибка — бросаем
    if (insertResult.error) throw insertResult.error;
  // конец if
  }
// конец функции saveProfile
}

// ----------------------------------------------------------------------------
// handleSubmit — нажатие «Сохранить профиль»: проверка и сохранение.
// Принимает: event. Возвращает: Promise.
// ----------------------------------------------------------------------------
// async function
async function handleSubmit(event) {
  // не перезагружаем страницу
  event.preventDefault();
  // кнопка сохранения
  const button = document.getElementById('save-button');
  // защита от двойного нажатия
  if (button.disabled) return;
  // убираем старые ошибки
  clearFormErrors(form);
  // ученик ли это
  const isStudent = state.profile.role === 'student';
  // значения полей
  const values = {
    // имя
    firstName: form.first_name.value.trim(),
    // фамилия
    lastName: form.last_name.value.trim(),
    // класс числом (у учителя поле скрыто — будет null)
    grade: isStudent ? Number(form.grade.value) || null : null,
    // аватар
    avatar: getCheckedValue(form, 'avatar') ?? state.profile.avatar,
  // конец объекта
  };
  // проверка имени
  const firstNameError = validateName(values.firstName, 'Имя');
  // проверка фамилии
  const lastNameError = validateName(values.lastName, 'Фамилия');
  // класс обязателен для ученика
  const gradeError = isStudent && !values.grade ? 'Выбери класс' : '';
  // показываем ошибки под полями
  showFieldError(form.first_name, firstNameError);
  // фамилия
  showFieldError(form.last_name, lastNameError);
  // класс
  showFieldError(form.grade, gradeError);
  // если есть ошибки — стоп
  if (firstNameError || lastNameError || gradeError) {
    // курсор в первое поле с ошибкой
    focusFirstError(form);
    // стоп
    return;
  // конец if
  }
  // выбранные предметы
  const skills = collectSkills();
  // у каждого выбранного предмета должен быть уровень 1–5 (Number.isInteger — целое ли число)
  const withoutLevel = skills.find((skill) => !Number.isInteger(skill.level) || skill.level < 1 || skill.level > 5);
  // место для ошибки раздела предметов
  const subjectsError = document.getElementById('subjects-error');
  // если нашли предмет без уровня
  if (withoutLevel) {
    // текст ошибки
    subjectsError.textContent = 'Выбери уровень для каждого отмеченного предмета.';
    // показываем
    subjectsError.hidden = false;
    // стоп
    return;
  // конец if
  }
  // иначе прячем ошибку раздела
  subjectsError.hidden = true;
  // «загрузка»
  setButtonLoading(button, true);
  // try — сохранение
  try {
    // сохраняем всё
    await saveProfile(values, skills, collectAvailability());
    // перечитываем профиль: могли начислиться очки и поменяться первая буква фамилии
    const { data, error } = await supabase.from('profiles').select('*, schools(name)').eq('id', state.user.id).single();
    // ошибка — бросаем
    if (error) throw error;
    // запоминаем новый профиль
    state.profile = data;
    // обновляем верхнюю карточку и шапку
    renderHero(data);
    // у ученика перечитываем предметы: список для теста и галочки; catch — ошибку только в консоль (профиль уже сохранён)
    if (state.profile.role === 'student') await refreshSavedSkills().catch(logError);
    // изменений больше нет
    setDirty(false);
    // всплывающее сообщение об успехе
    showToast('Профиль сохранён', 'success');
  // catch — ошибка
  } catch (error) {
    // в консоль
    logError(error);
    // понятный текст над кнопкой
    showFormError(form, getErrorMessage(error));
  // finally — всегда выключаем «загрузку»
  } finally {
    // кнопка снова активна
    setButtonLoading(button, false);
  // конец try/catch/finally
  }
// конец функции handleSubmit
}

// ----------------------------------------------------------------------------
// loadData — загружает фамилию, предметы и время одновременно.
// Promise.all запускает три запроса параллельно и ждёт, пока выполнятся все.
// Принимает: userId. Возвращает: Promise с { lastName, skills, availability }.
// ----------------------------------------------------------------------------
// async function
async function loadData(userId) {
  // деструктуризация массива результатов: первый результат — фамилия, второй — предметы, третий — время
  const [privateResult, skillsResult, availabilityResult] = await Promise.all([
    // фамилия; maybeSingle — одна строка или null
    supabase.from('profile_private').select('last_name').eq('id', userId).maybeSingle(),
    // свои предметы
    supabase.from('skills').select('subject, kind, level, verified_at').eq('user_id', userId),
    // своё время
    supabase.from('availability').select('day, part').eq('user_id', userId),
  // конец массива запросов
  ]);
  // проверяем ошибки всех трёх запросов; find вернёт первый результат с ошибкой
  const failed = [privateResult, skillsResult, availabilityResult].find((result) => result.error);
  // если ошибка есть — бросаем её
  if (failed) throw failed.error;
  // возвращаем данные; ?? — значения по умолчанию, если строк нет
  return { lastName: privateResult.data?.last_name ?? '', skills: skillsResult.data ?? [], availability: availabilityResult.data ?? [] };
// конец функции loadData
}

// ----------------------------------------------------------------------------
// loadHistory — отзывы партнёров обо мне, средняя оценка и история
// проведённых занятий. Если загрузить не удалось, профиль всё равно работает,
// а в этих разделах появится сообщение об ошибке.
// Принимает: ничего. Возвращает: Promise.
// ----------------------------------------------------------------------------
// async function
async function loadHistory() {
  // блок отзывов
  const reviewsBox = document.getElementById('my-reviews');
  // try — запросы
  try {
    // правила очков берутся из config.js, запрос к базе не нужен
    document.getElementById('my-points-rules').innerHTML = pointsRulesHtml();
    // отзывы, проведённые занятия, партнёрства и бейджи параллельно
    const [reviews, lessonsRes, partnerships, badges] = await Promise.all([
      // отзывы обо мне
      loadReviewsAbout(state.user.id),
      // проведённые занятия моих партнёрств (RLS), новые сверху
      supabase.from('lessons').select('id, partnership_id, scheduled_at, topic').eq('status', 'done').order('scheduled_at', { ascending: false }),
      // партнёрства — чтобы показать, с кем было занятие
      loadPartnerships(),
      // мои бейджи
      loadBadges(state.user.id),
    // конец списка
    ]);
    // все бейджи: полученные цветные, остальные серые с подсказкой
    document.getElementById('my-badges').innerHTML = badgesHtml(badges, { showLocked: true });
    // если адрес заканчивается на #badges (пришли из уведомления) — прокручиваем к бейджам; scrollIntoView — прокрутить к элементу
    if (location.hash === '#badges') document.getElementById('badges').scrollIntoView({ behavior: 'smooth' });
    // ошибка занятий
    if (lessonsRes.error) throw lessonsRes.error;
    // средняя оценка
    const summary = ratingSummary(reviews);
    // число в верхней карточке
    document.getElementById('hero-rating').textContent = summary.average === null ? '—' : `★ ${summary.average}`;
    // подпись
    document.getElementById('hero-rating-label').textContent = summary.count === 0 ? 'нет оценок' : `оценок: ${summary.count}`;
    // число проведённых занятий
    document.getElementById('hero-lessons').textContent = String(lessonsRes.data.length);
    // список отзывов
    reviewsBox.innerHTML = reviewsListHtml(reviews);
    // словарь «id партнёрства → партнёрство»
    const byId = new Map(partnerships.map((p) => [p.id, p]));
    // количество в заголовке истории
    document.getElementById('history-count').textContent = String(lessonsRes.data.length);
    // список занятий: дата, тема, с кем
    document.getElementById('my-history').innerHTML = lessonsRes.data.length === 0
      // пусто
      ? '<li class="muted">Проведённых занятий пока нет.</li>'
      // пункты списка; тему экранируем — её ввёл ученик
      : lessonsRes.data.map((lesson) => `<li><strong>${new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' }).format(new Date(lesson.scheduled_at))}</strong> — ${escapeHtml(lesson.topic)}${byId.has(lesson.partnership_id) ? ` <span class="muted">(${escapeHtml(partnershipTitle(byId.get(lesson.partnership_id), state.user.id))})</span>` : ''}</li>`).join('');
  // catch — ошибка
  } catch (error) {
    // в консоль
    logError(error);
    // сообщение в разделе отзывов
    renderState(reviewsBox, 'error', 'Не удалось загрузить отзывы и историю', getErrorMessage(error));
    // и в разделе бейджей, чтобы там не висело «Загружаем…»
    document.getElementById('my-badges').innerHTML = '<p class="muted">Не удалось загрузить бейджи. Обнови страницу.</p>';
  // конец try/catch
  }
// конец функции loadHistory
}

// ----------------------------------------------------------------------------
// start — запуск страницы.
// Принимает: ничего. Возвращает: Promise.
// ----------------------------------------------------------------------------
// async function
async function start() {
  // проверка входа, шапка; active: 'profile' подсвечивает пункт меню
  const context = await initPage({ active: 'profile' });
  // null — страницу показывать нельзя (не вошёл, ошибка) — выходим
  if (!context) return;
  // запоминаем пользователя
  state.user = context.user;
  // и профиль
  state.profile = context.profile;
  // ученик ли это
  const isStudent = state.profile.role === 'student';
  // try — загрузка данных
  try {
    // фамилия, предметы, время
    const data = await loadData(state.user.id);
    // верхняя карточка
    renderHero(state.profile);
    // имя в поле
    form.first_name.value = state.profile.first_name;
    // фамилия в поле
    form.last_name.value = data.lastName;
    // список классов: пустой пункт и 1–11; selected — текущий класс
    form.grade.innerHTML = '<option value="">Выбери класс</option>' + GRADES.map((grade) => `<option value="${grade}"${grade === state.profile.grade ? ' selected' : ''}>${grade} класс</option>`).join('');
    // выбор аватара с текущим аватаром
    document.getElementById('avatar-picker').innerHTML = avatarPickerHtml('avatar', state.profile.avatar);
    // карточки предметов
    renderSubjects(data.skills);
    // запоминаем сохранённые предметы
    state.skills = data.skills;
    // раздел «Подтверди свои знания»
    renderVerifyList();
    // сетка времени
    renderTimeGrid(data.availability);
    // у учителя и админа прячем разделы ученика
    if (!isStudent) document.querySelectorAll('[data-student-only]').forEach((element) => { element.hidden = true; });
    // очки есть только у учеников
    document.getElementById('hero-points-box').hidden = !isStudent;
    // приветствие после регистрации: в адресе есть ?welcome=1
    document.getElementById('welcome-alert').hidden = new URLSearchParams(location.search).get('welcome') !== '1';
    // сообщение о блокировке
    document.getElementById('blocked-alert').hidden = !state.profile.is_blocked;
    // блок предупреждений
    const warningsAlert = document.getElementById('warnings-alert');
    // если предупреждения есть
    if (state.profile.warnings_count > 0) {
      // текст с количеством
      warningsAlert.textContent = `Учитель вынес тебе предупреждений: ${state.profile.warnings_count}. Соблюдай правила общения.`;
      // показываем
      warningsAlert.hidden = false;
    // конец if
    }
    // считаем заполненность
    updateCompletion();
    // прячем «загрузку»
    document.getElementById('profile-loading').hidden = true;
    // показываем профиль
    document.getElementById('profile-content').hidden = false;
    // вернулись со страницы теста (адрес #verify) — прокручиваем к разделу теста
    if (location.hash === '#verify' && isStudent) document.getElementById('verify').scrollIntoView({ behavior: 'smooth' });
    // у ученика догружаем отзывы и историю (без await — профиль уже можно редактировать)
    if (isStudent) loadHistory();
    // и серию (тоже без await)
    if (isStudent) loadStreakSection();
  // catch — ошибка загрузки
  } catch (error) {
    // в консоль
    logError(error);
    // понятное сообщение вместо «загрузки»
    renderState(document.getElementById('profile-loading'), 'error', 'Не удалось загрузить профиль', getErrorMessage(error));
    // стоп
    return;
  // конец try/catch
  }
  // событие change срабатывает при любом изменении в форме (выбор радиокнопки, галочки, списка)
  form.addEventListener('change', (event) => {
    // closest ищет ближайшего «родителя» с классом subject-card; если изменение внутри карточки предмета — обновляем её
    const card = event.target.closest('.subject-card');
    // обновляем карточку, если нашли
    if (card) updateSubjectCard(card);
    // пересчитываем заполненность
    updateCompletion();
    // появились несохранённые изменения
    setDirty(true);
  // конец обработчика change
  });
  // input — срабатывает при каждом вводе символа в текстовое поле
  form.addEventListener('input', () => setDirty(true));
  // отправка формы — сохранение
  form.addEventListener('submit', handleSubmit);
  // beforeunload — пользователь уходит со страницы; если есть несохранённые изменения, браузер спросит «Покинуть страницу?»
  window.addEventListener('beforeunload', (event) => {
    // если всё сохранено — не мешаем
    if (!state.isDirty) return;
    // preventDefault включает стандартный вопрос браузера
    event.preventDefault();
  // конец обработчика
  });
// конец функции start
}

// запускаем страницу
start();
