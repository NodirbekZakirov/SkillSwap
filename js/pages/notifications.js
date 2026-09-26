// ============================================================================
// Файл: js/pages/notifications.js
// Зачем нужен: страница «Уведомления» (pages/notifications.html): полный
// список моих уведомлений (последние 100), фильтр «Все / Непрочитанные»,
// кнопка «Прочитать все»; клик по уведомлению отмечает его прочитанным и
// открывает нужную страницу.
// Как связан с остальными: общие функции — js/notifications.js;
// запуск — js/layout.js; состояния и ошибки — js/utils.js.
// ============================================================================

// запуск страницы
import { initPage } from '../layout.js';
// функции уведомлений
import { loadNotifications, notificationItemHtml, markRead, markAllRead, refreshNotificationBell } from '../notifications.js';
// тосты, кнопки, состояния, ошибки
import { showToast, setButtonLoading, renderState, getErrorMessage, logError } from '../utils.js';

// PAGE_LIMIT — сколько уведомлений показывать на странице
const PAGE_LIMIT = 100;

// контейнер списка
const box = document.getElementById('notif-page');
// мой id (заполним при запуске)
let userId = null;

// ----------------------------------------------------------------------------
// render — загружает и рисует список с учётом фильтра.
// Принимает: ничего. Возвращает: Promise.
// ----------------------------------------------------------------------------
// async function
async function render() {
  // выбранный фильтр: 'all' или 'unread'
  const filter = document.querySelector('input[name="filter"]:checked').value;
  // try — загрузка
  try {
    // уведомления
    const items = await loadNotifications({ limit: PAGE_LIMIT, unreadOnly: filter === 'unread' });
    // пусто
    if (items.length === 0) {
      // разные тексты для «всех» и «непрочитанных»
      renderState(box, 'empty', filter === 'unread' ? 'Всё прочитано 🎉' : 'Уведомлений пока нет', filter === 'unread' ? '' : 'Здесь появятся запросы на обмен, сообщения и новости о занятиях.');
      // выход
      return;
    // конец if
    }
    // список
    box.innerHTML = `<ul class="notif-list">${items.map(notificationItemHtml).join('')}</ul>`;
  // catch — ошибка
  } catch (error) {
    // в консоль
    logError(error);
    // сообщение
    renderState(box, 'error', 'Не удалось загрузить уведомления', getErrorMessage(error), { href: location.pathname, label: 'Попробовать ещё раз' });
  // конец try/catch
  }
// конец функции render
}

// ----------------------------------------------------------------------------
// start — запуск страницы.
// Принимает: ничего. Возвращает: Promise.
// ----------------------------------------------------------------------------
// async function
async function start() {
  // страница для всех ролей; в меню пункта нет (active пустой)
  const context = await initPage({ active: '' });
  // нельзя показывать — выходим
  if (!context) return;
  // мой id
  userId = context.user.id;
  // первая отрисовка
  await render();
  // смена фильтра — перерисовка
  document.querySelectorAll('input[name="filter"]').forEach((input) => input.addEventListener('change', render));
  // «Прочитать все»
  document.getElementById('read-all').addEventListener('click', async (event) => {
    // кнопка
    const button = event.currentTarget;
    // защита от двойного нажатия
    if (button.disabled) return;
    // «загрузка»
    setButtonLoading(button, true);
    // try — запрос
    try {
      // отмечаем все
      await markAllRead(userId);
      // сообщение
      showToast('Все уведомления прочитаны', 'success');
      // перерисовываем список
      await render();
      // обновляем колокольчик в шапке
      await refreshNotificationBell();
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
  // конец обработчика
  });
  // клик по уведомлению — отмечаем прочитанным (переход по ссылке сделает браузер)
  box.addEventListener('click', (event) => {
    // ссылка уведомления
    const link = event.target.closest('[data-notification]');
    // если нашли — отмечаем
    if (link) markRead(Number(link.dataset.notification)).catch(logError);
  // конец обработчика
  });
// конец функции start
}

// запускаем страницу
start();
