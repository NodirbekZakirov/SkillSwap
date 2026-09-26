// ============================================================================
// Файл: js/notifications.js
// Зачем нужен: уведомления (колокольчик 🔔 в шапке):
//   • счётчик непрочитанных и выпадающая панель с последними уведомлениями;
//   • мгновенная доставка новых уведомлений через Supabase Realtime
//     и всплывающее сообщение;
//   • «отметить прочитанными» — одно или все;
//   • напоминания о занятиях «сегодня» (SQL-функция ensure_my_reminders).
// Создаёт уведомления БАЗА: триггеры и функции в sql/schema.sql (новое
// совпадение, запрос, запрос принят, сообщение, занятие, бейдж и т.д.).
// Как связан с остальными: initNotificationBell вызывает js/layout.js на
// каждой странице; функции списка использует js/pages/notifications.js.
// ============================================================================

// подключение к Supabase
import { supabase } from './supabase.js';
// экранирование, тосты, время, ошибки
import { escapeHtml, showToast, formatRelative, logError } from './utils.js';

// NOTIFICATION_ICONS — иконка для каждого типа уведомления (типы — как в таблице notifications)
export const NOTIFICATION_ICONS = {
  // новое совпадение
  match: '✨',
  // запрос на обмен
  request: '📩',
  // все приняли обмен
  accepted: '🤝',
  // запрос отклонили
  declined: '🙅',
  // обмен завершён
  finished: '🏁',
  // новое сообщение
  message: '💬',
  // занятие назначено, отменено или проведено
  lesson: '📅',
  // напоминание о занятии сегодня
  reminder: '⏰',
  // новый бейдж
  badge: '🏅',
  // предупреждение от учителя или администратора
  warning: '⚠️',
  // новый ответ на мой вопрос
  answer: '💡',
  // решение администратора (одобрил или удалил ответ, удалил вопрос)
  moderation: '🛡️',
// конец объекта
};

// PANEL_LIMIT — сколько последних уведомлений показывать в выпадающей панели
const PANEL_LIMIT = 10;

// bell — состояние колокольчика на текущей странице
const bell = {
  // мой id
  userId: null,
  // кнопка колокольчика
  button: null,
  // красный кружок со счётчиком
  badge: null,
  // выпадающая панель
  panel: null,
// конец объекта
};

// ----------------------------------------------------------------------------
// safeLink — проверяет ссылку уведомления: разрешаем только страницы НАШЕГО
// сайта (начинаются с одного «/»). Так даже поддельное уведомление не уведёт
// ученика на чужой сайт.
// Принимает: link — строка. Возвращает: безопасный адрес.
// ----------------------------------------------------------------------------
// export function
export function safeLink(link) {
  // только «/...», но не «//...» (так начинаются ссылки на другие сайты)
  return typeof link === 'string' && link.startsWith('/') && !link.startsWith('//') ? link : '/pages/notifications.html';
// конец функции safeLink
}

// ----------------------------------------------------------------------------
// notificationItemHtml — одно уведомление в виде пункта списка.
// Принимает: n — строка таблицы notifications. Возвращает: строку HTML.
// ----------------------------------------------------------------------------
// export function
export function notificationItemHtml(n) {
  // иконка по типу; ?? — запасная
  const icon = NOTIFICATION_ICONS[n.type] ?? '🔔';
  // собираем пункт; unread — непрочитанное (подсвечено)
  return [
    // пункт списка
    `<li class="notif-item${n.is_read ? '' : ' unread'}">`,
    // ссылка; data-id — чтобы отметить прочитанным при клике
    `<a class="notif-link" href="${escapeHtml(safeLink(n.link))}" data-notification="${n.id}">`,
    // иконка
    `<span class="notif-icon" aria-hidden="true">${icon}</span>`,
    // текст
    '<span class="notif-text">',
    // заголовок; текст пришёл из базы — экранируем
    `<strong>${escapeHtml(n.title)}</strong>`,
    // подробности (могут содержать текст сообщения ученика — обязательно экранируем)
    n.body ? `<span class="notif-body">${escapeHtml(n.body)}</span>` : '',
    // время
    `<span class="muted notif-time">${formatRelative(n.created_at)}</span>`,
    // конец текста
    '</span>',
    // пометка «непрочитано» для программ чтения с экрана
    n.is_read ? '' : '<span class="visually-hidden">(не прочитано)</span>',
    // конец ссылки
    '</a>',
    // конец пункта
    '</li>',
  // склеиваем
  ].join('');
// конец функции notificationItemHtml
}

// ----------------------------------------------------------------------------
// loadNotifications — загружает мои уведомления (новые сверху).
// Принимает: { limit, unreadOnly }. Возвращает: Promise с массивом.
// ----------------------------------------------------------------------------
// export async function
export async function loadNotifications({ limit = 50, unreadOnly = false } = {}) {
  // запрос; RLS отдаёт только мои уведомления
  let query = supabase.from('notifications').select('id, type, title, body, link, is_read, created_at').order('created_at', { ascending: false }).limit(limit);
  // только непрочитанные
  if (unreadOnly) query = query.eq('is_read', false);
  // выполняем
  const { data, error } = await query;
  // ошибка — бросаем
  if (error) throw error;
  // возвращаем список
  return data;
// конец функции loadNotifications
}

// ----------------------------------------------------------------------------
// countUnread — сколько непрочитанных уведомлений.
// Принимает: ничего. Возвращает: Promise с числом.
// ----------------------------------------------------------------------------
// export async function
export async function countUnread() {
  // count: 'exact' — посчитать строки; head: true — сами строки не присылать, только количество
  const { count, error } = await supabase.from('notifications').select('id', { count: 'exact', head: true }).eq('is_read', false);
  // ошибка — бросаем
  if (error) throw error;
  // ?? 0 — если количество не пришло
  return count ?? 0;
// конец функции countUnread
}

// ----------------------------------------------------------------------------
// markRead — отметить одно уведомление прочитанным.
// Принимает: id. Возвращает: Promise.
// ----------------------------------------------------------------------------
// export async function
export async function markRead(id) {
  // update меняет только is_read — больше ученику менять и нельзя (права в базе)
  const { error } = await supabase.from('notifications').update({ is_read: true }).eq('id', id);
  // ошибка — бросаем
  if (error) throw error;
// конец функции markRead
}

// ----------------------------------------------------------------------------
// markAllRead — отметить все мои уведомления прочитанными.
// Принимает: userId. Возвращает: Promise.
// ----------------------------------------------------------------------------
// export async function
export async function markAllRead(userId) {
  // все мои непрочитанные
  const { error } = await supabase.from('notifications').update({ is_read: true }).eq('user_id', userId).eq('is_read', false);
  // ошибка — бросаем
  if (error) throw error;
// конец функции markAllRead
}

// ----------------------------------------------------------------------------
// setCount — показывает число на колокольчике и в названии вкладки.
// Принимает: count — количество непрочитанных. Возвращает: ничего.
// ----------------------------------------------------------------------------
// function
function setCount(count) {
  // больше 99 показываем как «99+»
  bell.badge.textContent = count > 99 ? '99+' : String(count);
  // кружок виден, только если есть непрочитанные
  bell.badge.hidden = count === 0;
  // подпись кнопки для программ чтения с экрана
  bell.button.setAttribute('aria-label', count > 0 ? `Уведомления: непрочитанных ${count}` : 'Уведомления');
  // replace(/^\(\d+\+?\) /, '') — убираем старое «(3) » в начале названия вкладки
  const baseTitle = document.title.replace(/^\(\d+\+?\) /, '');
  // если есть непрочитанные — «(3) Совпадения — SkillSwap»
  document.title = count > 0 ? `(${count > 99 ? '99+' : count}) ${baseTitle}` : baseTitle;
// конец функции setCount
}

// ----------------------------------------------------------------------------
// refreshBell — перечитывает счётчик и (если панель открыта) список.
// Принимает: ничего. Возвращает: Promise.
// ----------------------------------------------------------------------------
// async function
async function refreshBell() {
  // try — запросы могут не пройти
  try {
    // счётчик
    setCount(await countUnread());
    // если панель открыта — обновляем и её
    if (!bell.panel.hidden) await renderPanel();
  // catch — ошибка не критична: колокольчик просто не обновится
  } catch (error) {
    // в консоль
    logError(error);
  // конец try/catch
  }
// конец функции refreshBell
}

// ----------------------------------------------------------------------------
// refreshNotificationBell — обновить колокольчик «снаружи» (например, со
// страницы уведомлений после «Прочитать все»), не дожидаясь события Realtime.
// Принимает: ничего. Возвращает: Promise.
// ----------------------------------------------------------------------------
// export async function
export async function refreshNotificationBell() {
  // если колокольчик ещё не создан на странице — нечего обновлять
  if (!bell.button) return;
  // обновляем счётчик и список
  await refreshBell();
// конец функции refreshNotificationBell
}

// ----------------------------------------------------------------------------
// renderPanel — рисует выпадающую панель с последними уведомлениями.
// Принимает: ничего. Возвращает: Promise.
// ----------------------------------------------------------------------------
// async function
async function renderPanel() {
  // список внутри панели
  const list = bell.panel.querySelector('.notif-list');
  // try — загрузка
  try {
    // последние уведомления
    const items = await loadNotifications({ limit: PANEL_LIMIT });
    // пусто — подсказка, иначе пункты
    list.innerHTML = items.length === 0 ? '<li class="notif-empty muted">Уведомлений пока нет</li>' : items.map(notificationItemHtml).join('');
  // catch — ошибка
  } catch (error) {
    // в консоль
    logError(error);
    // сообщение в панели
    list.innerHTML = '<li class="notif-empty muted">Не удалось загрузить уведомления</li>';
  // конец try/catch
  }
// конец функции renderPanel
}

// ----------------------------------------------------------------------------
// togglePanel — открыть или закрыть выпадающую панель.
// Принимает: open — true (открыть) или false (закрыть). Возвращает: ничего.
// ----------------------------------------------------------------------------
// function
function togglePanel(open) {
  // показываем или прячем
  bell.panel.hidden = !open;
  // aria-expanded — программа чтения с экрана знает, открыто ли меню
  bell.button.setAttribute('aria-expanded', String(open));
  // при открытии загружаем свежий список
  if (open) renderPanel();
// конец функции togglePanel
}

// ----------------------------------------------------------------------------
// handleRealtime — пришло изменение в моих уведомлениях (Realtime).
// Принимает: payload — { eventType, new }. Возвращает: ничего.
// ----------------------------------------------------------------------------
// function
function handleRealtime(payload) {
  // новая или обновлённая строка
  const n = payload.new;
  // «свежее» ли уведомление: новое или «всплывшее» снова (сообщения чата так обновляются)
  const isFresh = n && !n.is_read && (payload.eventType === 'INSERT' || Date.now() - new Date(n.created_at).getTime() < 10000);
  // если это уведомление про страницу, которая сейчас открыта (например, этот же чат) — сразу отмечаем прочитанным и не мешаем
  if (isFresh && safeLink(n.link) === location.pathname + location.search) {
    // отмечаем прочитанным; then — когда готово, обновляем счётчик
    markRead(n.id).then(refreshBell).catch(logError);
    // выход
    return;
  // конец if
  }
  // показываем всплывающее сообщение с иконкой и заголовком
  if (isFresh) showToast(`${NOTIFICATION_ICONS[n.type] ?? '🔔'} ${n.title}`, 'info');
  // обновляем счётчик и список
  refreshBell();
// конец функции handleRealtime
}

// ----------------------------------------------------------------------------
// initNotificationBell — вставляет колокольчик в шапку и запускает его.
// Принимает: container — куда вставить (блок кнопок шапки);
//   profile — мой профиль. Возвращает: Promise.
// ----------------------------------------------------------------------------
// export async function
export async function initNotificationBell(container, profile) {
  // мой id
  bell.userId = profile.id;
  // обёртка колокольчика (от неё позиционируется панель)
  const wrapper = document.createElement('div');
  // класс
  wrapper.className = 'bell';
  // кнопка, кружок-счётчик и панель
  wrapper.innerHTML = [
    // кнопка; aria-haspopup — у кнопки есть всплывающее меню
    '<button class="icon-btn" id="bell-button" type="button" aria-haspopup="true" aria-expanded="false" aria-label="Уведомления">🔔<span class="count-badge" hidden>0</span></button>',
    // панель; hidden — закрыта
    '<div class="card notif-panel" id="notif-panel" hidden>',
    // верх панели: заголовок и «прочитать все»
    '<div class="notif-panel-head"><strong>Уведомления</strong><button class="btn btn-ghost btn-sm" type="button" id="notif-read-all">Прочитать все</button></div>',
    // список
    '<ul class="notif-list"></ul>',
    // ссылка на страницу всех уведомлений
    '<a class="btn btn-secondary btn-sm btn-block" href="/pages/notifications.html">Все уведомления</a>',
    // конец панели
    '</div>',
  // склеиваем
  ].join('');
  // prepend — вставляем колокольчик ПЕРВЫМ в блок кнопок шапки
  container.prepend(wrapper);
  // запоминаем элементы
  bell.button = wrapper.querySelector('#bell-button');
  // кружок-счётчик
  bell.badge = wrapper.querySelector('.count-badge');
  // панель
  bell.panel = wrapper.querySelector('#notif-panel');
  // клик по колокольчику — открыть или закрыть панель
  bell.button.addEventListener('click', () => togglePanel(bell.panel.hidden));
  // клик в любом месте страницы вне колокольчика — закрыть панель; contains — внутри ли элемента место клика
  document.addEventListener('click', (event) => { if (!wrapper.contains(event.target)) togglePanel(false); });
  // Escape — закрыть панель
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !bell.panel.hidden) togglePanel(false); });
  // «Прочитать все»
  wrapper.querySelector('#notif-read-all').addEventListener('click', async (event) => {
    // кнопка
    const button = event.currentTarget;
    // защита от двойного нажатия
    button.disabled = true;
    // try — запрос
    try {
      // отмечаем все
      await markAllRead(bell.userId);
      // обновляем
      await refreshBell();
    // catch — ошибка
    } catch (error) {
      // в консоль
      logError(error);
      // сообщение
      showToast('Не удалось отметить уведомления', 'error');
    // finally — кнопка снова активна
    } finally {
      // включаем кнопку
      button.disabled = false;
    // конец try/catch/finally
    }
  // конец обработчика
  });
  // клик по уведомлению в панели — отмечаем прочитанным (переход по ссылке браузер сделает сам)
  bell.panel.addEventListener('click', (event) => {
    // ссылка уведомления
    const link = event.target.closest('[data-notification]');
    // если нашли — отмечаем (без await: переход не ждёт ответа)
    if (link) markRead(Number(link.dataset.notification)).catch(logError);
  // конец обработчика
  });
  // ученикам создаём напоминания о сегодняшних занятиях (база не создаст повторных)
  if (profile.role === 'student') {
    // вызываем SQL-функцию; ошибку только пишем в консоль
    const { error } = await supabase.rpc('ensure_my_reminders');
    // если ошибка
    if (error) logError(error);
  // конец if
  }
  // первый подсчёт непрочитанных
  await refreshBell();
  // подписка Realtime на мои уведомления: event: '*' — и новые (INSERT), и изменённые (UPDATE)
  const channel = supabase
    // канал с уникальным именем
    .channel(`notifications-${bell.userId}`)
    // filter — только строки, где user_id равен моему id
    .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${bell.userId}` }, handleRealtime)
    // включаем
    .subscribe();
  // уходим со страницы — закрываем канал
  window.addEventListener('pagehide', () => supabase.removeChannel(channel));
// конец функции initNotificationBell
}
