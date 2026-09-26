// ============================================================================
// Файл: js/pages/chat.js
// Зачем нужен: страница чата pages/chat.html?id=<номер партнёрства>:
//   • загружает партнёрство, участников, блокировки и последние сообщения;
//   • показывает ленту с разделителями по дням;
//   • отправляет сообщения (только в активном партнёрстве);
//   • получает новые сообщения мгновенно через Supabase Realtime;
//   • предупреждает, если в тексте есть телефон, ссылка или @ник;
//   • «Пожаловаться» на сообщение, заблокировать участника, завершить обмен;
//   • голосовые сообщения (запись с микрофона — js/voice.js);
//   • общая доска для рисования (js/board.js) и общий таймер (js/timer.js).
// Защита: даже если обойти проверки на странице, база не даст писать
// чужим и заблокированным (RLS-правило messages_insert в sql/schema.sql).
// Как связан с остальными: js/layout.js, js/partnerships.js, js/safety.js,
// js/dialog.js, js/supabase.js, js/utils.js, js/voice.js, js/board.js, js/timer.js.
// ============================================================================

// запуск страницы
import { initPage } from '../layout.js';
// подключение к Supabase
import { supabase } from '../supabase.js';
// имя «Амир Т.»
import { formatName } from '../auth.js';
// функции партнёрств
import { loadPartnerships, otherMembers, partnershipTitle, STATUS_LABELS, KIND_LABELS } from '../partnerships.js';
// поиск контактов в тексте
import { findContacts, describeContacts, CONTACT_WARNING } from '../safety.js';
// окна подтверждения и ввода
import { openDialog, confirmAction } from '../dialog.js';
// экранирование, тосты, кнопки, состояния, даты, ошибки
import { escapeHtml, showToast, setButtonLoading, renderState, formatTime, formatDay, getErrorMessage, logError } from '../utils.js';
// голосовые сообщения: запись, загрузка, плеер
import { isVoiceSupported, createRecorder, uploadVoice, removeVoice, voicePlayerHtml, initVoicePlayers, formatSeconds, micErrorText } from '../voice.js';
// общая доска
import { initBoard } from '../board.js';
// общий таймер занятия
import { initPairTimer } from '../timer.js';

// MAX_MESSAGE_LENGTH — максимальная длина сообщения (так же ограничено в базе)
const MAX_MESSAGE_LENGTH = 1000;
// MESSAGES_LIMIT — сколько последних сообщений загружать при открытии
const MESSAGES_LIMIT = 200;
// MESSAGE_COLUMNS — какие столбцы сообщения нужны странице (и при загрузке, и после отправки)
const MESSAGE_COLUMNS = 'id, sender_id, body, voice_path, voice_seconds, created_at';
// METER_BARS — сколько полосок громкости во время записи голоса
const METER_BARS = 24;

// state — данные страницы
const state = {
  // номер партнёрства из адреса
  partnershipId: null,
  // партнёрство с участниками
  partnership: null,
  // мой профиль
  me: null,
  // блокировки, где я участвую
  blocks: [],
  // Set id уже показанных сообщений (чтобы Realtime не показал своё сообщение второй раз)
  shownIds: new Set(),
  // день последнего показанного сообщения (для разделителей «Сегодня», «Вчера»)
  lastDay: '',
  // канал Realtime
  channel: null,
  // запись голоса: объект из createRecorder или null
  recorder: null,
  // последние значения громкости для полосок
  levels: [],
// конец объекта state
};

// лента сообщений
const messagesBox = document.getElementById('chat-messages');
// форма отправки
const form = document.getElementById('chat-form');
// поле ввода
const input = document.getElementById('chat-input');

// ----------------------------------------------------------------------------
// memberProfile — профиль участника по id.
// Принимает: userId. Возвращает: объект профиля или undefined.
// ----------------------------------------------------------------------------
// function
function memberProfile(userId) {
  // находим участника и берём профиль; ?. — если не нашли
  return state.partnership.members.find((member) => member.user_id === userId)?.profile;
// конец функции memberProfile
}

// ----------------------------------------------------------------------------
// isBlockedByMe — заблокировал ли я этого ученика.
// Принимает: userId. Возвращает: boolean.
// ----------------------------------------------------------------------------
// function
function isBlockedByMe(userId) {
  // some — есть ли блокировка «я → он»
  return state.blocks.some((block) => block.blocker_id === state.me.id && block.blocked_id === userId);
// конец функции isBlockedByMe
}

// ----------------------------------------------------------------------------
// writeBlockReason — почему писать нельзя (или '' — писать можно).
// Принимает: ничего. Возвращает: строку.
// ----------------------------------------------------------------------------
// function
function writeBlockReason() {
  // статус партнёрства
  const { status } = state.partnership;
  // ещё ждём согласия
  if (status === 'pending') return 'Чат откроется, когда все участники примут запрос на обмен.';
  // обмен закончен
  if (status === 'finished') return 'Обмен завершён. Переписка доступна только для чтения.';
  // отклонён
  if (status === 'declined') return 'Запрос на обмен был отклонён.';
  // меня заблокировал учитель
  if (state.me.is_blocked) return 'Учитель ограничил твой аккаунт: писать сообщения нельзя.';
  // есть блокировка между мной и кем-то из участников (в любую сторону)
  if (state.blocks.length > 0) return 'Переписка недоступна: один из участников заблокирован.';
  // можно писать
  return '';
// конец функции writeBlockReason
}

// ----------------------------------------------------------------------------
// messageHtml — HTML одного сообщения.
// Принимает: message — { id, sender_id, body, voice_path, voice_seconds, created_at }.
// Возвращает: строку HTML.
// ----------------------------------------------------------------------------
// function
function messageHtml(message) {
  // моё ли сообщение
  const own = message.sender_id === state.me.id;
  // профиль автора; ?? — заглушка, если автора уже нет в партнёрстве
  const author = memberProfile(message.sender_id) ?? { first_name: 'Ученик', last_initial: '', avatar: '👤' };
  // есть ли в тексте контакты
  const hasContacts = findContacts(message.body).length > 0;
  // в тройке подписываем автора, в паре и так понятно
  const showAuthor = !own && state.partnership.kind === 'triple';
  // собираем сообщение
  return [
    // строка сообщения; own — моё (справа)
    `<div class="message${own ? ' own' : ''}" data-id="${message.id}">`,
    // аватар собеседника
    own ? '' : `<span class="avatar avatar-sm" aria-hidden="true">${escapeHtml(author.avatar)}</span>`,
    // «пузырь» сообщения
    '<div class="message-bubble">',
    // имя автора
    showAuthor ? `<span class="message-author">${escapeHtml(formatName(author))}</span>` : '',
    // голосовое сообщение — плеер (путь файла экранирует voicePlayerHtml)
    message.voice_path ? voicePlayerHtml(message.voice_path, message.voice_seconds) : '',
    // ТЕКСТ СООБЩЕНИЯ — обязательно через escapeHtml: так вставленный HTML-код покажется как текст и не выполнится; у голосового текста может не быть
    message.body ? `<p class="message-text">${escapeHtml(message.body)}</p>` : '',
    // предупреждение о контактах
    hasContacts ? `<p class="message-warning">⚠️ ${CONTACT_WARNING}</p>` : '',
    // время и кнопка жалобы
    '<div class="message-meta">',
    // <time> — тег для даты; datetime — машинный формат
    `<time datetime="${escapeHtml(message.created_at)}">${formatTime(message.created_at)}</time>`,
    // «Пожаловаться» — только на чужие сообщения
    own ? '' : `<button class="message-report" type="button" data-report="${message.id}">Пожаловаться</button>`,
    // конец строки времени
    '</div>',
    // конец пузыря
    '</div>',
    // конец сообщения
    '</div>',
  // склеиваем
  ].join('');
// конец функции messageHtml
}

// ----------------------------------------------------------------------------
// appendMessages — добавляет сообщения в конец ленты с разделителями по дням.
// Принимает: messages — массив сообщений (по времени). Возвращает: ничего.
// ----------------------------------------------------------------------------
// function
function appendMessages(messages) {
  // HTML для добавления
  let html = '';
  // перебираем сообщения
  for (const message of messages) {
    // уже показано (например, своё сообщение пришло ещё и через Realtime) — пропускаем
    if (state.shownIds.has(message.id)) continue;
    // запоминаем id
    state.shownIds.add(message.id);
    // день сообщения
    const day = formatDay(message.created_at);
    // новый день — добавляем разделитель
    if (day !== state.lastDay) {
      // разделитель по центру
      html += `<div class="chat-day"><span>${day}</span></div>`;
      // запоминаем день
      state.lastDay = day;
    // конец if
    }
    // само сообщение
    html += messageHtml(message);
  // конец цикла
  }
  // убираем надпись «Сообщений пока нет», если она была
  messagesBox.querySelector('.chat-empty')?.remove();
  // insertAdjacentHTML('beforeend') — добавить в конец, не перерисовывая старые сообщения
  messagesBox.insertAdjacentHTML('beforeend', html);
  // прокручиваем ленту вниз: scrollTop — прокрутка, scrollHeight — полная высота содержимого
  messagesBox.scrollTop = messagesBox.scrollHeight;
// конец функции appendMessages
}

// ----------------------------------------------------------------------------
// renderHeader — шапка чата и меню участников.
// Принимает: ничего. Возвращает: ничего.
// ----------------------------------------------------------------------------
// function
function renderHeader() {
  // остальные участники
  const others = otherMembers(state.partnership, state.me.id);
  // статус по-русски
  const status = STATUS_LABELS[state.partnership.status];
  // аватары
  document.getElementById('chat-avatars').innerHTML = others.map((m) => `<span class="avatar">${escapeHtml(m.profile.avatar)}</span>`).join('');
  // имена (textContent — безопасно)
  document.getElementById('chat-title').textContent = partnershipTitle(state.partnership, state.me.id);
  // «Пара · Активно»
  document.getElementById('chat-subtitle').textContent = `${KIND_LABELS[state.partnership.kind]} · ${status.text}`;
  // название вкладки браузера
  document.title = `Чат: ${partnershipTitle(state.partnership, state.me.id)} — SkillSwap`;
  // участники с кнопкой «Заблокировать» / «Разблокировать»
  document.getElementById('chat-members').innerHTML = others.map((m) => [
    // пункт списка
    '<li class="chat-member">',
    // аватар и имя
    `<span class="avatar avatar-sm" aria-hidden="true">${escapeHtml(m.profile.avatar)}</span><a class="chat-member-name person-link" href="/pages/user.html?id=${encodeURIComponent(m.user_id)}">${escapeHtml(formatName(m.profile))}</a>`,
    // кнопка; data-block — id ученика
    `<button class="btn btn-sm ${isBlockedByMe(m.user_id) ? 'btn-secondary' : 'btn-danger'}" type="button" data-block="${m.user_id}">${isBlockedByMe(m.user_id) ? 'Разблокировать' : 'Заблокировать'}</button>`,
    // конец пункта
    '</li>',
  // склеиваем пункт; потом все пункты
  ].join('')).join('');
  // «Завершить обмен» — только для активного
  document.getElementById('finish-button').hidden = state.partnership.status !== 'active';
  // ссылка «Назначить занятие» ведёт на страницу занятий с уже выбранным партнёрством (?p=)
  const lessonLink = document.getElementById('lesson-link');
  // адрес ссылки
  lessonLink.href = `/pages/lessons.html?p=${state.partnershipId}`;
  // только для активного обмена
  lessonLink.hidden = state.partnership.status !== 'active';
  // ссылка на материалы (смотреть их можно и после завершения обмена)
  document.getElementById('materials-link').href = `/pages/materials.html?id=${state.partnershipId}`;
// конец функции renderHeader
}

// ----------------------------------------------------------------------------
// renderComposer — показывает форму отправки или причину, почему писать нельзя.
// Принимает: ничего. Возвращает: ничего.
// ----------------------------------------------------------------------------
// function
function renderComposer() {
  // причина запрета ('' — можно писать)
  const reason = writeBlockReason();
  // блок с причиной
  const closed = document.getElementById('chat-closed');
  // текст причины
  closed.textContent = reason;
  // показываем причину, если она есть
  closed.hidden = !reason;
  // форму — наоборот
  form.hidden = Boolean(reason);
// конец функции renderComposer
}

// ----------------------------------------------------------------------------
// updateContactWarning — при наборе текста показывает предупреждение о контактах.
// Принимает: ничего. Возвращает: ничего.
// ----------------------------------------------------------------------------
// function
function updateContactWarning() {
  // какие контакты найдены
  const kinds = findContacts(input.value);
  // блок предупреждения
  const warning = document.getElementById('contact-warning');
  // текст: общее правило и что именно найдено
  warning.textContent = kinds.length > 0 ? `⚠️ ${CONTACT_WARNING}. Похоже, в сообщении есть ${describeContacts(kinds)}.` : '';
  // показываем, только если что-то нашли
  warning.hidden = kinds.length === 0;
// конец функции updateContactWarning
}

// ----------------------------------------------------------------------------
// autoGrow — поле ввода растёт вместе с текстом (до 160px).
// Принимает: ничего. Возвращает: ничего.
// ----------------------------------------------------------------------------
// function
function autoGrow() {
  // сбрасываем высоту, чтобы scrollHeight посчитался заново
  input.style.height = 'auto';
  // высота = высоте содержимого, но не больше 160px
  input.style.height = `${Math.min(input.scrollHeight, 160)}px`;
// конец функции autoGrow
}

// ----------------------------------------------------------------------------
// sendMessage — отправка сообщения.
// Принимает: event — событие отправки формы. Возвращает: Promise.
// ----------------------------------------------------------------------------
// async function
async function sendMessage(event) {
  // не перезагружаем страницу
  event.preventDefault();
  // кнопка отправки
  const button = document.getElementById('send-button');
  // защита от двойной отправки
  if (button.disabled) return;
  // текст без пробелов по краям
  const body = input.value.trim();
  // пустое сообщение не отправляем
  if (body === '') {
    // подсказка
    showToast('Напиши сообщение', 'error');
    // стоп
    return;
  // конец if
  }
  // слишком длинное
  if (body.length > MAX_MESSAGE_LENGTH) {
    // подсказка
    showToast(`Сообщение слишком длинное: максимум ${MAX_MESSAGE_LENGTH} символов`, 'error');
    // стоп
    return;
  // конец if
  }
  // «загрузка»
  setButtonLoading(button, true);
  // try — запрос
  try {
    // insert — добавить строку; select().single() — сразу получить её обратно (с id и временем)
    const { data, error } = await supabase.from('messages').insert({ partnership_id: state.partnershipId, sender_id: state.me.id, body }).select(MESSAGE_COLUMNS).single();
    // ошибка — в catch
    if (error) throw error;
    // показываем своё сообщение сразу, не дожидаясь Realtime
    appendMessages([data]);
    // очищаем поле
    input.value = '';
    // возвращаем обычную высоту поля
    autoGrow();
    // прячем предупреждение
    updateContactWarning();
  // catch — ошибка
  } catch (error) {
    // в консоль
    logError(error);
    // понятное сообщение (например, «Недостаточно прав» при блокировке)
    showToast(getErrorMessage(error), 'error');
  // finally — всегда
  } finally {
    // кнопка снова активна
    setButtonLoading(button, false);
    // курсор обратно в поле
    input.focus();
  // конец try/catch/finally
  }
// конец функции sendMessage
}

// ----------------------------------------------------------------------------
// showRecorder — переключает нижнюю панель: запись голоса или обычное поле.
// Принимает: recording — true (идёт запись) / false. Возвращает: ничего.
// ----------------------------------------------------------------------------
// function
function showRecorder(recording) {
  // панель записи
  document.getElementById('voice-recorder').hidden = !recording;
  // обычная строка ввода — наоборот
  form.querySelector('.chat-input-row').hidden = recording;
// конец функции showRecorder
}

// ----------------------------------------------------------------------------
// renderMeter — полоски громкости во время записи (последние METER_BARS
// значений бегут справа налево, как в мессенджерах).
// Принимает: level — громкость от 0 до 1. Возвращает: ничего.
// ----------------------------------------------------------------------------
// function
function renderMeter(level) {
  // добавляем новое значение в конец
  state.levels.push(level);
  // лишние старые убираем из начала (shift — удалить первый элемент)
  while (state.levels.length > METER_BARS) state.levels.shift();
  // полоски: высота от 10% до 100%
  document.getElementById('voice-meter').innerHTML = state.levels.map((value) => `<span style="height: ${Math.round(10 + value * 90)}%"></span>`).join('');
// конец функции renderMeter
}

// ----------------------------------------------------------------------------
// startRecording — нажали 🎤: включаем микрофон и начинаем запись.
// Принимает: ничего. Возвращает: Promise.
// ----------------------------------------------------------------------------
// async function
async function startRecording() {
  // запись уже идёт — ничего не делаем (защита от двойного нажатия)
  if (state.recorder) return;
  // новые полоски громкости
  state.levels = [];
  // готовим запись: onTick — обновлять время и полоски; onLimit — дошли до 2 минут: отправляем
  state.recorder = createRecorder({
    // каждые ~100 мс
    onTick: (seconds, level) => {
      // время записи
      document.getElementById('voice-time').textContent = formatSeconds(seconds);
      // полоски
      renderMeter(level);
    // конец onTick
    },
    // дошли до предела
    onLimit: () => {
      // сообщение
      showToast('Максимум 2 минуты — отправляем запись', 'info');
      // отправляем
      sendVoice();
    // конец onLimit
    },
  // конец настроек
  });
  // try — браузер спросит разрешение на микрофон
  try {
    // включаем микрофон и начинаем
    await state.recorder.start();
    // показываем панель записи
    showRecorder(true);
    // время с нуля
    document.getElementById('voice-time').textContent = '0:00';
  // catch — нет разрешения или микрофона
  } catch (error) {
    // в консоль
    logError(error);
    // понятный текст
    showToast(micErrorText(error), 'error');
    // выключаем то, что успело включиться
    state.recorder.cancel();
    // записи нет
    state.recorder = null;
  // конец try/catch
  }
// конец функции startRecording
}

// ----------------------------------------------------------------------------
// cancelRecording — ✕: выключаем микрофон, ничего не отправляем.
// Принимает: ничего. Возвращает: ничего.
// ----------------------------------------------------------------------------
// function
function cancelRecording() {
  // записи нет — нечего отменять
  if (!state.recorder) return;
  // выключаем
  state.recorder.cancel();
  // записи больше нет
  state.recorder = null;
  // возвращаем поле ввода
  showRecorder(false);
// конец функции cancelRecording
}

// ----------------------------------------------------------------------------
// sendVoice — ➤: останавливаем запись, загружаем файл и отправляем сообщение.
// Если сообщение не сохранилось — удаляем загруженный файл.
// Принимает: ничего. Возвращает: Promise.
// ----------------------------------------------------------------------------
// async function
async function sendVoice() {
  // записи нет — выходим
  if (!state.recorder) return;
  // кнопка отправки записи
  const button = document.getElementById('voice-send');
  // защита от двойного нажатия
  if (button.disabled) return;
  // «загрузка»
  setButtonLoading(button, true);
  // путь загруженного файла (нужен, чтобы удалить при ошибке)
  let path = '';
  // try — остановка, загрузка, сообщение
  try {
    // останавливаем и получаем { blob, seconds, mime }
    const recording = await state.recorder.stop();
    // запись больше не идёт
    state.recorder = null;
    // загружаем файл в Storage (папка — номер чата)
    path = await uploadVoice(state.partnershipId, recording);
    // сообщение без текста, но с голосом; select — сразу получить строку обратно
    const { data, error } = await supabase.from('messages').insert({ partnership_id: state.partnershipId, sender_id: state.me.id, body: '', voice_path: path, voice_seconds: recording.seconds }).select(MESSAGE_COLUMNS).single();
    // ошибка — в catch
    if (error) throw error;
    // показываем своё сообщение сразу
    appendMessages([data]);
  // catch — ошибка
  } catch (error) {
    // в консоль
    logError(error);
    // понятное сообщение
    showToast(`Голосовое не отправлено: ${getErrorMessage(error)}`, 'error');
    // файл загрузился, а сообщение нет — удаляем файл
    if (path) removeVoice(path);
    // если запись ещё не остановлена — выключаем микрофон
    if (state.recorder) state.recorder.cancel();
    // записи нет
    state.recorder = null;
  // finally — всегда
  } finally {
    // кнопка снова активна
    setButtonLoading(button, false);
    // возвращаем поле ввода
    showRecorder(false);
  // конец try/catch/finally
  }
// конец функции sendVoice
}

// ----------------------------------------------------------------------------
// reportMessage — жалоба на сообщение (копия текста уйдёт учителю).
// Принимает: button — кнопка «Пожаловаться». Возвращает: Promise.
// ----------------------------------------------------------------------------
// async function
async function reportMessage(button) {
  // окно с полем для причины
  const { confirmed, value } = await openDialog({
    // заголовок
    title: 'Пожаловаться на сообщение?',
    // пояснение
    text: 'Учитель твоей школы увидит это сообщение и разберётся. Автор не узнает, кто пожаловался.',
    // поле ввода причины
    input: { label: 'Что случилось? (необязательно)', placeholder: 'Например: грубость, просит номер телефона', maxLength: 500 },
    // текст главной кнопки
    confirmLabel: 'Отправить жалобу',
  // конец настроек
  });
  // передумал
  if (!confirmed) return;
  // «загрузка»
  setButtonLoading(button, true);
  // try — запрос
  try {
    // SQL-функция report_message сама сохранит копию текста и проверит права
    const { error } = await supabase.rpc('report_message', { p_message_id: Number(button.dataset.report), p_reason: value });
    // ошибка — в catch
    if (error) throw error;
    // успех
    showToast('Жалоба отправлена учителю. Спасибо!', 'success');
    // кнопку меняем на отметку
    button.outerHTML = '<span class="message-reported">Жалоба отправлена</span>';
  // catch — ошибка (например, «Ты уже пожаловался»)
  } catch (error) {
    // в консоль
    logError(error);
    // сообщение
    showToast(getErrorMessage(error), 'error');
    // кнопка снова активна
    setButtonLoading(button, false);
  // конец try/catch
  }
// конец функции reportMessage
}

// ----------------------------------------------------------------------------
// toggleBlock — заблокировать или разблокировать участника.
// Принимает: button — кнопка с data-block. Возвращает: Promise.
// ----------------------------------------------------------------------------
// async function
async function toggleBlock(button) {
  // id ученика
  const userId = button.dataset.block;
  // сейчас заблокирован?
  const blocked = isBlockedByMe(userId);
  // имя для окна
  const name = formatName(memberProfile(userId));
  // подтверждение
  const ok = await confirmAction(blocked
    // разблокировать; имя в именительном падеже, чтобы не склонять его
    ? { title: 'Снять блокировку?', text: `Участник: ${name}. Вы снова сможете переписываться.`, confirmLabel: 'Разблокировать' }
    // заблокировать
    : { title: 'Заблокировать участника?', text: `Участник: ${name}. Вы не сможете писать друг другу, и этот ученик больше не появится в твоих совпадениях.`, confirmLabel: 'Заблокировать', danger: true });
  // передумал
  if (!ok) return;
  // «загрузка»
  setButtonLoading(button, true);
  // try — запрос
  try {
    // разблокировать — удалить строку, заблокировать — добавить
    const { error } = blocked
      // delete с двумя условиями eq
      ? await supabase.from('blocks').delete().eq('blocker_id', state.me.id).eq('blocked_id', userId)
      // insert новой блокировки
      : await supabase.from('blocks').insert({ blocker_id: state.me.id, blocked_id: userId });
    // ошибка — в catch
    if (error) throw error;
    // обновляем список блокировок
    state.blocks = blocked
      // убираем
      ? state.blocks.filter((b) => !(b.blocker_id === state.me.id && b.blocked_id === userId))
      // добавляем
      : [...state.blocks, { blocker_id: state.me.id, blocked_id: userId }];
    // сообщение
    showToast(blocked ? 'Блокировка снята' : 'Участник заблокирован', 'success');
    // перерисовываем шапку и форму
    renderHeader();
    // форма
    renderComposer();
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
// конец функции toggleBlock
}

// ----------------------------------------------------------------------------
// finishPartnership — завершить обмен из чата.
// Принимает: button. Возвращает: Promise.
// ----------------------------------------------------------------------------
// async function
async function finishPartnership(button) {
  // подтверждение
  const ok = await confirmAction({ title: 'Завершить обмен?', text: 'Чат станет только для чтения, запланированные занятия отменятся.', confirmLabel: 'Завершить', danger: true });
  // передумал
  if (!ok) return;
  // «загрузка»
  setButtonLoading(button, true);
  // try — запрос
  try {
    // SQL-функция finish_partnership
    const { error } = await supabase.rpc('finish_partnership', { p_partnership_id: state.partnershipId });
    // ошибка — в catch
    if (error) throw error;
    // меняем статус у себя
    state.partnership.status = 'finished';
    // сообщение
    showToast('Обмен завершён', 'success');
    // перерисовываем
    renderHeader();
    // форма станет недоступна
    renderComposer();
  // catch — ошибка
  } catch (error) {
    // в консоль
    logError(error);
    // сообщение
    showToast(getErrorMessage(error), 'error');
  // finally — всегда
  } finally {
    // кнопка снова активна
    setButtonLoading(button, false);
  // конец try/catch/finally
  }
// конец функции finishPartnership
}

// ----------------------------------------------------------------------------
// subscribeToMessages — подписка на новые сообщения через Supabase Realtime.
// База сама присылает каждую новую строку таблицы messages этого чата;
// чужие сообщения не придут — Realtime тоже соблюдает RLS.
// Принимает: ничего. Возвращает: ничего.
// ----------------------------------------------------------------------------
// function
function subscribeToMessages() {
  // channel(имя) — создаём канал; имя уникальное для чата
  state.channel = supabase
    // канал
    .channel(`chat-${state.partnershipId}`)
    // on('postgres_changes', ...) — слушаем изменения таблицы: только вставки (INSERT) в messages с нашим partnership_id
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `partnership_id=eq.${state.partnershipId}` }, (payload) => {
      // payload.new — новая строка
      appendMessages([payload.new]);
    // конец обработчика
    })
    // subscribe — включаем подписку
    .subscribe();
  // pagehide — пользователь уходит со страницы: закрываем канал, чтобы не держать соединение
  window.addEventListener('pagehide', () => supabase.removeChannel(state.channel));
// конец функции subscribeToMessages
}

// ----------------------------------------------------------------------------
// loadChat — загружает партнёрство, блокировки и сообщения.
// Принимает: ничего. Возвращает: Promise<boolean> — удалось ли.
// ----------------------------------------------------------------------------
// async function
async function loadChat() {
  // блок состояний
  const stateBox = document.getElementById('chat-state');
  // Number.isInteger — проверка, что в адресе правильный номер
  if (!Number.isInteger(state.partnershipId) || state.partnershipId <= 0) {
    // сообщение
    renderState(stateBox, 'error', 'Чат не найден', 'Проверь ссылку.', { href: '/pages/partners.html', label: 'К партнёрам' });
    // неудача
    return false;
  // конец if
  }
  // try — запросы
  try {
    // партнёрство (RLS вернёт его, только если я участник)
    const [partnership] = await loadPartnerships({ id: state.partnershipId });
    // не нашли — нет такого чата или нет доступа
    if (!partnership) {
      // сообщение
      renderState(stateBox, 'error', 'Чат не найден', 'Возможно, у тебя нет доступа к этому чату.', { href: '/pages/partners.html', label: 'К партнёрам' });
      // неудача
      return false;
    // конец if
    }
    // запоминаем
    state.partnership = partnership;
    // id остальных участников
    const otherIds = otherMembers(partnership, state.me.id).map((m) => m.user_id);
    // блокировки и последние сообщения параллельно
    const [blocksRes, messagesRes] = await Promise.all([
      // блокировки, где я участвую
      supabase.from('blocks').select('blocker_id, blocked_id'),
      // последние сообщения: сортировка по убыванию и limit — берём самые новые
      supabase.from('messages').select(MESSAGE_COLUMNS).eq('partnership_id', state.partnershipId).order('created_at', { ascending: false }).limit(MESSAGES_LIMIT),
    // конец списка запросов
    ]);
    // ошибка любого запроса
    if (blocksRes.error) throw blocksRes.error;
    // ошибка сообщений
    if (messagesRes.error) throw messagesRes.error;
    // оставляем только блокировки с участниками этого чата
    state.blocks = blocksRes.data.filter((b) => otherIds.includes(b.blocker_id) || otherIds.includes(b.blocked_id));
    // шапка
    renderHeader();
    // reverse — переворачиваем, чтобы старые были сверху
    const messages = messagesRes.data.reverse();
    // текст для пустой ленты: в активном чате — подсказка поздороваться, иначе просто «нет сообщений»
    const emptyText = partnership.status === 'active' ? 'Сообщений пока нет. Поздоровайся и договорись о первом занятии! 👋' : 'Сообщений нет.';
    // если сообщений нет — показываем этот текст
    if (messages.length === 0) messagesBox.innerHTML = `<p class="chat-empty muted">${emptyText}</p>`;
    // иначе показываем
    else appendMessages(messages);
    // форма или причина запрета
    renderComposer();
    // прячем «загрузку»
    stateBox.innerHTML = '';
    // показываем чат
    document.getElementById('chat-content').hidden = false;
    // лента видна — прокручиваем вниз
    messagesBox.scrollTop = messagesBox.scrollHeight;
    // успех
    return true;
  // catch — ошибка
  } catch (error) {
    // в консоль
    logError(error);
    // сообщение
    renderState(stateBox, 'error', 'Не удалось открыть чат', getErrorMessage(error), { href: location.pathname + location.search, label: 'Попробовать ещё раз' });
    // неудача
    return false;
  // конец try/catch
  }
// конец функции loadChat
}

// ----------------------------------------------------------------------------
// start — запуск страницы.
// Принимает: ничего. Возвращает: Promise.
// ----------------------------------------------------------------------------
// async function
async function start() {
  // только для учеников; в меню подсвечиваем «Партнёры»
  const context = await initPage({ active: 'partners', roles: ['student'] });
  // нельзя показывать — выходим
  if (!context) return;
  // мой профиль
  state.me = context.profile;
  // номер партнёрства из адреса ?id=12
  state.partnershipId = Number(new URLSearchParams(location.search).get('id'));
  // загружаем чат
  const loaded = await loadChat();
  // не удалось — стоп
  if (!loaded) return;
  // отмечаем уведомления об этом чате прочитанными (RLS разрешит только свои)
  supabase.from('notifications').update({ is_read: true }).eq('dedupe_key', `chat:${state.partnershipId}`).then(({ error }) => { if (error) logError(error); });
  // подписка на новые сообщения
  subscribeToMessages();
  // отправка формы
  form.addEventListener('submit', sendMessage);
  // при вводе: предупреждение о контактах и рост поля
  input.addEventListener('input', () => {
    // проверяем контакты
    updateContactWarning();
    // подгоняем высоту
    autoGrow();
  // конец обработчика
  });
  // keydown — нажатие клавиши: Enter отправляет, Shift+Enter — новая строка
  input.addEventListener('keydown', (event) => {
    // Enter без Shift
    if (event.key === 'Enter' && !event.shiftKey) {
      // не добавляем перевод строки
      event.preventDefault();
      // requestSubmit — отправить форму так же, как по кнопке
      form.requestSubmit();
    // конец if
    }
  // конец обработчика
  });
  // клики по «Пожаловаться» в ленте (делегирование событий)
  messagesBox.addEventListener('click', (event) => {
    // кнопка жалобы
    const button = event.target.closest('[data-report]');
    // если нашли и она не занята
    if (button && !button.disabled) reportMessage(button);
  // конец обработчика
  });
  // клики по «Заблокировать» в меню участников
  document.getElementById('chat-members').addEventListener('click', (event) => {
    // кнопка блокировки
    const button = event.target.closest('[data-block]');
    // если нашли и она не занята
    if (button && !button.disabled) toggleBlock(button);
  // конец обработчика
  });
  // «Завершить обмен»
  document.getElementById('finish-button').addEventListener('click', (event) => finishPartnership(event.currentTarget));
  // плееры голосовых сообщений в ленте (один обработчик на всю ленту)
  initVoicePlayers(messagesBox);
  // кнопка 🎤 — только если браузер умеет записывать звук
  const micButton = document.getElementById('mic-button');
  // показываем кнопку
  micButton.hidden = !isVoiceSupported();
  // нажатие — начать запись
  micButton.addEventListener('click', startRecording);
  // ✕ — отменить запись
  document.getElementById('voice-cancel').addEventListener('click', cancelRecording);
  // ➤ — отправить запись
  document.getElementById('voice-send').addEventListener('click', sendVoice);
  // уходим со страницы во время записи — выключаем микрофон
  window.addEventListener('pagehide', cancelRecording);
  // можно ли рисовать и управлять таймером: те же условия, что для сообщений
  const canAct = writeBlockReason() === '';
  // имя участника по id — для подписей «Лена рисует…» и «запустил(а) таймер»
  const nameOf = (userId) => formatName(memberProfile(userId) ?? { first_name: 'Участник', last_initial: '' });
  // общая доска (смотреть можно всегда, рисовать — только в активном обмене)
  initBoard({ partnershipId: state.partnershipId, me: state.me, canDraw: canAct, openButton: document.getElementById('board-button'), nameOf });
  // общий таймер; без await — чат уже работает; ошибки обрабатывает сама функция
  initPairTimer({ partnershipId: state.partnershipId, canControl: canAct, button: document.getElementById('timer-button'), panel: document.getElementById('timer-panel'), bar: document.getElementById('timer-bar'), nameOf });
  // курсор в поле, если можно писать
  if (!form.hidden) input.focus();
// конец функции start
}

// запускаем страницу
start();
