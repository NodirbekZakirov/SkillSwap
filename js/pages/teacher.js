// ============================================================================
// Файл: js/pages/teacher.js
// Зачем нужен: панель учителя (pages/teacher.html):
//   • статистика школы и диаграмма «какие предметы нужнее всего»
//     (SQL-функция get_school_stats);
//   • жалобы на сообщения: кто пожаловался, на кого, текст, дата;
//     действия — скрыть сообщение, предупреждение, блокировка, закрыть жалобу
//     (SQL-функции teacher_hide_message, teacher_warn_user,
//     teacher_set_blocked, teacher_close_complaint);
//   • список заблокированных учеников с кнопкой «Разблокировать».
// Защита: страница открывается только учителю (initPage с roles), но главное —
// каждая SQL-функция сама проверяет, что пользователь учитель ЭТОЙ школы.
// Как связан с остальными: js/layout.js, js/dialog.js, js/config.js,
// js/auth.js, js/supabase.js, js/utils.js.
// ============================================================================

// запуск страницы
import { initPage } from '../layout.js';
// подключение к Supabase
import { supabase } from '../supabase.js';
// поиск предмета
import { getSubject } from '../config.js';
// имя «Амир Т.»
import { formatName } from '../auth.js';
// окна подтверждения
import { confirmAction } from '../dialog.js';
// экранирование, тосты, кнопки, состояния, даты, ошибки
import { escapeHtml, showToast, setButtonLoading, renderState, formatDateTime, getErrorMessage, logError } from '../utils.js';
// плеер голосовых сообщений (если пожаловались на голосовое)
import { voicePlayerHtml, initVoicePlayers } from '../voice.js';

// state — данные страницы
const state = {
  // мой профиль
  me: null,
  // все жалобы школы
  complaints: [],
  // Map «id ученика → профиль (с фамилией)»
  people: new Map(),
  // Map «id сообщения → скрыто ли»
  hiddenMessages: new Map(),
  // голосовые сообщения из жалоб: «id сообщения → { voice_path, voice_seconds }»
  voiceMessages: new Map(),
// конец объекта
};

// ----------------------------------------------------------------------------
// fullName — имя и полная фамилия (учителю фамилия видна по правилам RLS).
// Принимает: userId. Возвращает: строку.
// ----------------------------------------------------------------------------
// function
function fullName(userId) {
  // профиль из словаря
  const person = state.people.get(userId);
  // нет данных — заглушка
  if (!person) return 'Ученик';
  // «Амир Тошев, 8 класс» или «Амир Т.», если фамилия не загрузилась
  return `${person.last_name ? `${person.first_name} ${person.last_name}` : formatName(person)}${person.grade ? `, ${person.grade} класс` : ''}`;
// конец функции fullName
}

// ----------------------------------------------------------------------------
// renderStats — плашки статистики и диаграмма спроса.
// Принимает: stats — ответ get_school_stats. Возвращает: ничего.
// ----------------------------------------------------------------------------
// function
function renderStats(stats) {
  // четыре показателя: иконка, число, подпись (подпись-название подходит к любому числу: «1 / открытые жалобы»)
  const cards = [
    // ученики
    ['🎒', stats.students, 'ученики'],
    // проведённые занятия
    ['🎓', stats.lessons_done, 'проведённые занятия'],
    // активные обмены
    ['🤝', stats.active_partnerships, 'активные обмены'],
    // открытые жалобы
    ['🚩', stats.open_complaints, 'открытые жалобы'],
  // конец массива
  ];
  // плашки; деструктуризация [icon, value, label] — берём три элемента массива
  document.getElementById('stats-grid').innerHTML = cards.map(([icon, value, label]) => `<div class="stat-box"><span class="stat-value"><span aria-hidden="true">${icon}</span> ${value}</span><span class="stat-label">${label}</span></div>`).join('');
  // контейнер диаграммы
  const chart = document.getElementById('demand-chart');
  // спрос на предметы (массив { subject, count }, уже отсортирован базой)
  const demand = stats.demand ?? [];
  // пусто
  if (demand.length === 0) {
    // сообщение
    renderState(chart, 'empty', 'Данных пока нет', 'Ученики ещё не отметили предметы, которые хотят подтянуть.');
    // выход
    return;
  // конец if
  }
  // самое большое значение — 100% ширины столбика
  const max = Math.max(...demand.map((d) => d.count));
  // столбики: ширина = количество / максимум × 100%
  chart.innerHTML = `<ul class="bar-chart">${demand.map((d) => {
    // предмет
    const subject = getSubject(d.subject);
    // строка диаграммы; style="width: 60%" — ширина полоски; aria-label — для программ чтения с экрана
    return `<li class="bar-row" aria-label="${escapeHtml(subject.name)}: ${d.count}"><span class="bar-label"><span aria-hidden="true">${subject.icon}</span> ${escapeHtml(subject.name)}</span><span class="bar-track"><span class="bar-fill" style="width: ${Math.round((d.count / max) * 100)}%"></span></span><strong class="bar-value">${d.count}</strong></li>`;
  // конец map
  }).join('')}</ul>`;
// конец функции renderStats
}

// ----------------------------------------------------------------------------
// complaintCardHtml — карточка жалобы с кнопками действий.
// Принимает: c — строка complaints. Возвращает: строку HTML.
// ----------------------------------------------------------------------------
// function
function complaintCardHtml(c) {
  // на кого пожаловались
  const reported = state.people.get(c.reported_user_id);
  // скрыто ли сообщение (undefined — сообщение удалено)
  const hidden = state.hiddenMessages.get(c.message_id);
  // жалоба открыта
  const open = c.status === 'open';
  // заблокирован ли нарушитель
  const blocked = Boolean(reported?.is_blocked);
  // собираем карточку
  return [
    // карточка
    `<article class="card complaint-card${open ? '' : ' closed'} fade-in">`,
    // верх: статус и дата
    `<div class="lesson-top"><span class="chip ${open ? 'chip-danger' : 'chip-success'}">${open ? 'Открыта' : 'Закрыта'}</span><span class="muted">${formatDateTime(c.created_at)}</span></div>`,
    // кто пожаловался
    `<p class="complaint-line"><span class="muted">Пожаловался(-ась):</span> ${escapeHtml(fullName(c.reporter_id))}</p>`,
    // на кого, с числом предупреждений и блокировкой
    `<p class="complaint-line"><span class="muted">На кого:</span> <strong>${escapeHtml(fullName(c.reported_user_id))}</strong> · предупреждений: ${reported?.warnings_count ?? 0}${blocked ? ' · <span class="chip chip-danger">заблокирован(а)</span>' : ''}</p>`,
    // ТЕКСТ СООБЩЕНИЯ — копия из жалобы; экранируем обязательно
    `<blockquote class="complaint-message">${escapeHtml(c.message_text)}${hidden ? ' <span class="chip">скрыто</span>' : ''}</blockquote>`,
    // голосовое сообщение — плеер, чтобы учитель мог прослушать
    state.voiceMessages.has(c.message_id) ? voicePlayerHtml(state.voiceMessages.get(c.message_id).voice_path, state.voiceMessages.get(c.message_id).voice_seconds) : '',
    // причина (если указана)
    c.reason ? `<p class="complaint-line"><span class="muted">Причина:</span> ${escapeHtml(c.reason)}</p>` : '',
    // кнопки — только для открытых жалоб
    open ? [
      // начало ряда кнопок
      '<div class="partner-actions">',
      // скрыть сообщение (если оно ещё есть и не скрыто)
      c.message_id && hidden === false ? `<button class="btn btn-secondary btn-sm" type="button" data-action="hide" data-id="${c.id}">🙈 Скрыть сообщение</button>` : '',
      // предупреждение
      `<button class="btn btn-secondary btn-sm" type="button" data-action="warn" data-id="${c.id}">⚠️ Предупреждение</button>`,
      // блокировка
      blocked ? '' : `<button class="btn btn-danger btn-sm" type="button" data-action="block" data-id="${c.id}">🔒 Заблокировать</button>`,
      // закрыть жалобу
      `<button class="btn btn-primary btn-sm" type="button" data-action="close" data-id="${c.id}">✓ Закрыть жалобу</button>`,
      // конец ряда
      '</div>',
    // склеиваем кнопки
    ].join('') : '',
    // конец карточки
    '</article>',
  // склеиваем
  ].join('');
// конец функции complaintCardHtml
}

// ----------------------------------------------------------------------------
// renderComplaints — список жалоб с учётом фильтра.
// Принимает: ничего. Возвращает: ничего.
// ----------------------------------------------------------------------------
// function
function renderComplaints() {
  // выбранный фильтр: open, closed или all
  const filter = document.querySelector('input[name="complaint-filter"]:checked').value;
  // отбираем жалобы
  const list = state.complaints.filter((c) => filter === 'all' || c.status === filter);
  // контейнер
  const box = document.getElementById('complaints-list');
  // пусто — сообщение
  if (list.length === 0) renderState(box, 'empty', filter === 'open' ? 'Открытых жалоб нет 🎉' : 'Жалоб нет');
  // иначе — карточки
  else box.innerHTML = list.map(complaintCardHtml).join('');
// конец функции renderComplaints
}

// ----------------------------------------------------------------------------
// renderBlocked — список заблокированных учеников школы.
// Принимает: ничего. Возвращает: Promise.
// ----------------------------------------------------------------------------
// async function
async function renderBlocked() {
  // контейнер
  const box = document.getElementById('blocked-list');
  // ученики моей школы с is_blocked = true
  const { data, error } = await supabase.from('profiles').select('id, first_name, last_initial, avatar, grade').eq('school_id', state.me.school_id).eq('role', 'student').eq('is_blocked', true);
  // ошибка — бросаем
  if (error) throw error;
  // никого — короткий текст
  if (data.length === 0) {
    // текст
    box.innerHTML = '<p class="muted">Заблокированных учеников нет.</p>';
    // выход
    return;
  // конец if
  }
  // строки с кнопкой «Разблокировать»; data-user — id ученика
  box.innerHTML = `<ul class="chat-members">${data.map((p) => `<li class="chat-member"><span class="avatar avatar-sm" aria-hidden="true">${escapeHtml(p.avatar)}</span><span class="chat-member-name">${escapeHtml(formatName(p))}${p.grade ? ` · ${p.grade} класс` : ''}</span><button class="btn btn-secondary btn-sm" type="button" data-unblock="${p.id}">Разблокировать</button></li>`).join('')}</ul>`;
// конец функции renderBlocked
}

// ----------------------------------------------------------------------------
// loadAll — загружает статистику, жалобы, людей и скрытые сообщения.
// Принимает: ничего. Возвращает: Promise.
// ----------------------------------------------------------------------------
// async function
async function loadAll() {
  // статистика и жалобы параллельно
  const [statsRes, complaintsRes] = await Promise.all([
    // SQL-функция статистики (сама проверит, что я учитель)
    supabase.rpc('get_school_stats'),
    // жалобы моей школы (RLS), новые сверху
    supabase.from('complaints').select('id, reporter_id, reported_user_id, message_id, message_text, reason, status, created_at').order('created_at', { ascending: false }),
  // конец списка
  ]);
  // ошибки
  if (statsRes.error) throw statsRes.error;
  // ошибка жалоб
  if (complaintsRes.error) throw complaintsRes.error;
  // запоминаем жалобы
  state.complaints = complaintsRes.data;
  // статистика и диаграмма
  renderStats(statsRes.data);
  // все ученики из жалоб (без повторов)
  const userIds = [...new Set(state.complaints.flatMap((c) => [c.reporter_id, c.reported_user_id]))];
  // все сообщения из жалоб (без null и повторов)
  const messageIds = [...new Set(state.complaints.map((c) => c.message_id).filter(Boolean))];
  // если жалоб нет — людей и сообщений грузить не нужно
  if (userIds.length > 0) {
    // профили, фамилии и сообщения параллельно
    const [profilesRes, privateRes, messagesRes] = await Promise.all([
      // профили учеников школы
      supabase.from('profiles').select('id, first_name, last_initial, grade, is_blocked, warnings_count').in('id', userIds),
      // полные фамилии (учителю своей школы их видно)
      supabase.from('profile_private').select('id, last_name').in('id', userIds),
      // сообщения из жалоб: учитель видит только их (правило messages_select)
      messageIds.length > 0 ? supabase.from('messages').select('id, is_hidden, voice_path, voice_seconds').in('id', messageIds) : Promise.resolve({ data: [], error: null }),
    // конец списка
    ]);
    // первая ошибка, если есть
    const failed = [profilesRes, privateRes, messagesRes].find((res) => res.error);
    // бросаем
    if (failed) throw failed.error;
    // фамилии по id
    const lastNames = new Map(privateRes.data.map((row) => [row.id, row.last_name]));
    // профиль + фамилия
    state.people = new Map(profilesRes.data.map((p) => [p.id, { ...p, last_name: lastNames.get(p.id) ?? '' }]));
    // скрыто ли каждое сообщение
    state.hiddenMessages = new Map(messagesRes.data.map((m) => [m.id, m.is_hidden]));
    // голосовые сообщения из жалоб (только с voice_path)
    state.voiceMessages = new Map(messagesRes.data.filter((m) => m.voice_path).map((m) => [m.id, m]));
  // конец if
  }
  // жалобы
  renderComplaints();
  // заблокированные
  await renderBlocked();
// конец функции loadAll
}

// ----------------------------------------------------------------------------
// handleComplaintAction — кнопки в карточке жалобы.
// Принимает: button — нажатая кнопка (data-action, data-id). Возвращает: Promise.
// ----------------------------------------------------------------------------
// async function
async function handleComplaintAction(button) {
  // жалоба
  const complaint = state.complaints.find((c) => c.id === Number(button.dataset.id));
  // не нашли — выходим
  if (!complaint) return;
  // действие
  const { action } = button.dataset;
  // имя нарушителя для окна подтверждения
  const name = fullName(complaint.reported_user_id);
  // тексты окон и вызовы SQL-функций для каждого действия
  const actions = {
    // скрыть сообщение
    hide: { dialog: { title: 'Скрыть сообщение?', text: 'Участники чата больше не увидят это сообщение.', confirmLabel: 'Скрыть' }, rpc: ['teacher_hide_message', { p_message_id: complaint.message_id }], done: 'Сообщение скрыто' },
    // предупреждение
    warn: { dialog: { title: 'Вынести предупреждение?', text: `Ученик: ${name}. Он(а) получит уведомление.`, confirmLabel: 'Вынести' }, rpc: ['teacher_warn_user', { p_user_id: complaint.reported_user_id }], done: 'Предупреждение вынесено' },
    // блокировка
    block: { dialog: { title: 'Заблокировать ученика?', text: `Ученик: ${name}. Не сможет писать в чат и не появится в подборе, пока вы его не разблокируете.`, confirmLabel: 'Заблокировать', danger: true }, rpc: ['teacher_set_blocked', { p_user_id: complaint.reported_user_id, p_blocked: true }], done: 'Ученик заблокирован' },
    // закрыть жалобу
    close: { dialog: { title: 'Закрыть жалобу?', text: 'Жалоба перейдёт в «Закрытые».', confirmLabel: 'Закрыть' }, rpc: ['teacher_close_complaint', { p_complaint_id: complaint.id }], done: 'Жалоба закрыта' },
  // конец объекта
  };
  // настройки нужного действия
  const config = actions[action];
  // неизвестное действие — выходим
  if (!config) return;
  // окно подтверждения
  const ok = await confirmAction({ ...config.dialog, cancelLabel: 'Отмена' });
  // передумал
  if (!ok) return;
  // «загрузка»
  setButtonLoading(button, true);
  // try — запрос
  try {
    // ...config.rpc — «распаковываем» [имя функции, параметры] в аргументы rpc
    const { error } = await supabase.rpc(...config.rpc);
    // ошибка — в catch
    if (error) throw error;
    // сообщение
    showToast(config.done, 'success');
    // перезагружаем данные (статистика, жалобы, блокировки)
    await loadAll();
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
// конец функции handleComplaintAction
}

// ----------------------------------------------------------------------------
// unblock — снять блокировку с ученика.
// Принимает: button — кнопка с data-unblock. Возвращает: Promise.
// ----------------------------------------------------------------------------
// async function
async function unblock(button) {
  // подтверждение
  const ok = await confirmAction({ title: 'Разблокировать ученика?', text: 'Он(а) снова сможет писать в чат и появится в подборе.', confirmLabel: 'Разблокировать' });
  // передумал
  if (!ok) return;
  // «загрузка»
  setButtonLoading(button, true);
  // try — запрос
  try {
    // SQL-функция с p_blocked: false
    const { error } = await supabase.rpc('teacher_set_blocked', { p_user_id: button.dataset.unblock, p_blocked: false });
    // ошибка — в catch
    if (error) throw error;
    // сообщение
    showToast('Ученик разблокирован', 'success');
    // обновляем всё
    await loadAll();
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
// конец функции unblock
}

// ----------------------------------------------------------------------------
// start — запуск страницы.
// Принимает: ничего. Возвращает: Promise.
// ----------------------------------------------------------------------------
// async function
async function start() {
  // только для учителя
  const context = await initPage({ active: 'teacher', roles: ['teacher'] });
  // нельзя показывать — выходим
  if (!context) return;
  // мой профиль
  state.me = context.profile;
  // название школы
  document.getElementById('teacher-school').textContent = `Школа: ${context.profile.schools?.name ?? 'не указана'}. Ты видишь только учеников этой школы.`;
  // блок состояний
  const stateBox = document.getElementById('teacher-state');
  // try — загрузка
  try {
    // всё сразу
    await loadAll();
    // прячем «загрузку»
    stateBox.innerHTML = '';
    // показываем содержимое
    document.getElementById('teacher-content').hidden = false;
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
  // фильтр жалоб
  document.querySelectorAll('input[name="complaint-filter"]').forEach((input) => input.addEventListener('change', renderComplaints));
  // плееры голосовых сообщений в жалобах
  initVoicePlayers(document.getElementById('complaints-list'));
  // клики по кнопкам жалоб (делегирование)
  document.getElementById('complaints-list').addEventListener('click', (event) => {
    // кнопка с действием
    const button = event.target.closest('button[data-action]');
    // если нашли и не занята
    if (button && !button.disabled) handleComplaintAction(button);
  // конец обработчика
  });
  // кнопки «Разблокировать»
  document.getElementById('blocked-list').addEventListener('click', (event) => {
    // кнопка
    const button = event.target.closest('button[data-unblock]');
    // если нашли и не занята
    if (button && !button.disabled) unblock(button);
  // конец обработчика
  });
// конец функции start
}

// запускаем страницу
start();
