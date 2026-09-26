// ============================================================================
// Файл: js/pages/partners.js
// Зачем нужен: страница «Партнёры» (pages/partners.html):
//   • делит мои партнёрства на группы: входящие запросы, активные,
//     ждут ответа, история;
//   • кнопки: Принять, Отклонить, Отменить запрос, Открыть чат, Завершить.
// Все изменения делают SQL-функции respond_partnership и finish_partnership:
// они сами проверяют, что ученик — участник, и присылают уведомления.
// Как связан с остальными: js/layout.js, js/partnerships.js, js/dialog.js,
// js/supabase.js, js/utils.js.
// ============================================================================

// запуск страницы
import { initPage } from '../layout.js';
// подключение к Supabase
import { supabase } from '../supabase.js';
// функции партнёрств
import { loadPartnerships, otherMembers, partnershipTitle, exchangeSteps, exchangeStepsHtml, hasAccepted, STATUS_LABELS, KIND_LABELS } from '../partnerships.js';
// имя «Амир Т.»
import { formatName } from '../auth.js';
// окно подтверждения
import { confirmAction } from '../dialog.js';
// экранирование, тосты, защита кнопок, состояния, даты, ошибки
import { escapeHtml, showToast, setButtonLoading, renderState, formatDateTime, getErrorMessage, logError } from '../utils.js';

// мой id (заполним при запуске)
let meId = null;

// ----------------------------------------------------------------------------
// cardHtml — карточка партнёрства.
// Принимает: partnership; actions — HTML кнопок. Возвращает: строку HTML.
// ----------------------------------------------------------------------------
// function
function cardHtml(partnership, actions) {
  // остальные участники
  const others = otherMembers(partnership, meId);
  // статус по-русски и цвет
  const status = STATUS_LABELS[partnership.status];
  // кто ещё не ответил (для ожидающих)
  const waiting = partnership.status === 'pending' ? others.filter((m) => !m.accepted).map((m) => formatName(m.profile)) : [];
  // собираем карточку
  return [
    // карточка
    '<article class="card match-card fade-in">',
    // верхняя строка
    '<div class="match-head">',
    // аватары остальных участников
    `<div class="triple-avatars" aria-hidden="true">${others.map((m) => `<span class="avatar">${escapeHtml(m.profile.avatar)}</span>`).join('')}</div>`,
    // имена и вид (пара или тройка)
    `<div class="match-person"><h3>${escapeHtml(partnershipTitle(partnership, meId))}</h3><span class="muted">${KIND_LABELS[partnership.kind]}</span></div>`,
    // плашка статуса
    `<span class="chip chip-${status.variant}">${status.text}</span>`,
    // конец верхней строки
    '</div>',
    // кто кому с чем помогает
    exchangeStepsHtml(exchangeSteps(partnership, meId)),
    // дата: для активных — когда началось, иначе — когда предложено
    `<p class="muted partner-date">${partnership.accepted_at ? `Обмен начался ${formatDateTime(partnership.accepted_at)}` : `Предложено ${formatDateTime(partnership.created_at)}`}</p>`,
    // кого ждём
    waiting.length > 0 ? `<p class="muted">Ждём ответа: ${escapeHtml(waiting.join(', '))}</p>` : '',
    // кнопки
    actions ? `<div class="partner-actions">${actions}</div>` : '',
    // конец карточки
    '</article>',
  // склеиваем
  ].join('');
// конец функции cardHtml
}

// ----------------------------------------------------------------------------
// button — HTML одной кнопки действия.
// Принимает: action — действие (accept, decline, cancel, finish);
//   id — номер партнёрства; label — текст; style — класс кнопки.
// Возвращает: строку HTML.
// ----------------------------------------------------------------------------
// function
function button(action, id, label, style) {
  // data-action и data-id прочитает общий обработчик кликов
  return `<button class="btn ${style}" type="button" data-action="${action}" data-id="${id}">${label}</button>`;
// конец функции button
}

// ----------------------------------------------------------------------------
// fillList — заполняет список карточками или пустым состоянием.
// Принимает: listId — id контейнера; items — массив HTML-карточек;
//   emptyTitle, emptyText, emptyAction — для пустого состояния.
// Возвращает: ничего.
// ----------------------------------------------------------------------------
// function
function fillList(listId, items, emptyTitle, emptyText = '', emptyAction = null) {
  // контейнер
  const list = document.getElementById(listId);
  // есть карточки — вставляем
  if (items.length > 0) list.innerHTML = items.join('');
  // иначе — пустое состояние
  else renderState(list, 'empty', emptyTitle, emptyText, emptyAction);
// конец функции fillList
}

// ----------------------------------------------------------------------------
// render — загружает партнёрства и раскладывает их по группам.
// Принимает: ничего. Возвращает: Promise.
// ----------------------------------------------------------------------------
// async function
async function render() {
  // блок состояний
  const stateBox = document.getElementById('partners-state');
  // блок содержимого
  const content = document.getElementById('partners-content');
  // try — загрузка
  try {
    // все мои партнёрства
    const partnerships = await loadPartnerships();
    // входящие: ждут ответа, а я ещё не согласился
    const incoming = partnerships.filter((p) => p.status === 'pending' && !hasAccepted(p, meId));
    // мои запросы: ждут ответа, я уже согласился
    const outgoing = partnerships.filter((p) => p.status === 'pending' && hasAccepted(p, meId));
    // активные
    const active = partnerships.filter((p) => p.status === 'active');
    // история
    const history = partnerships.filter((p) => p.status === 'declined' || p.status === 'finished');
    // входящие: кнопки «Принять» и «Отклонить»
    fillList('incoming-list', incoming.map((p) => cardHtml(p, button('accept', p.id, 'Принять', 'btn-primary') + button('decline', p.id, 'Отклонить', 'btn-ghost'))), 'Новых запросов нет');
    // активные: «Открыть чат» и «Завершить»
    fillList('active-list', active.map((p) => cardHtml(p, `<a class="btn btn-primary" href="/pages/chat.html?id=${p.id}">💬 Открыть чат</a><a class="btn btn-secondary" href="/pages/materials.html?id=${p.id}">📎 Материалы</a>` + button('finish', p.id, 'Завершить', 'btn-ghost'))),'Активных обменов пока нет', 'Найди партнёра на экране совпадений и предложи обмен.', { href: '/pages/matches.html', label: 'К совпадениям' });
    // мои запросы: «Отменить запрос»
    fillList('outgoing-list', outgoing.map((p) => cardHtml(p, button('cancel', p.id, 'Отменить запрос', 'btn-ghost'))), 'Нет запросов, ждущих ответа');
    // история: без кнопок; у завершённых можно открыть переписку
    fillList('history-list', history.map((p) => cardHtml(p, p.accepted_at ? `<a class="btn btn-ghost" href="/pages/chat.html?id=${p.id}">Переписка</a>` : '')), 'История пуста');
    // входящие скрываем, если их нет (не отвлекаем)
    document.getElementById('incoming-section').hidden = incoming.length === 0;
    // историю скрываем, если она пуста
    document.getElementById('history-section').hidden = history.length === 0;
    // прячем «загрузку»
    stateBox.innerHTML = '';
    // показываем содержимое
    content.hidden = false;
  // catch — ошибка
  } catch (error) {
    // в консоль
    logError(error);
    // прячем содержимое
    content.hidden = true;
    // сообщение с кнопкой «Попробовать ещё раз»
    renderState(stateBox, 'error', 'Не удалось загрузить партнёров', getErrorMessage(error), { href: location.pathname, label: 'Попробовать ещё раз' });
  // конец try/catch
  }
// конец функции render
}

// ----------------------------------------------------------------------------
// handleAction — обработчик кнопок: принять, отклонить, отменить, завершить.
// Принимает: btn — нажатая кнопка. Возвращает: Promise.
// ----------------------------------------------------------------------------
// async function
async function handleAction(btn) {
  // защита от двойного нажатия
  if (btn.disabled) return;
  // действие и номер партнёрства из атрибутов data-*; Number — строку в число
  const { action } = btn.dataset;
  // номер партнёрства
  const id = Number(btn.dataset.id);
  // для необратимых действий спрашиваем подтверждение
  if (action !== 'accept') {
    // тексты окна для каждого действия
    const texts = {
      // отклонить
      decline: { title: 'Отклонить запрос?', confirmLabel: 'Отклонить' },
      // отменить свой запрос
      cancel: { title: 'Отменить запрос?', confirmLabel: 'Отменить запрос' },
      // завершить обмен
      finish: { title: 'Завершить обмен?', text: 'Чат закроется, запланированные занятия отменятся. Историю занятий и отзывы ты сохранишь.', confirmLabel: 'Завершить' },
    // конец объекта
    };
    // ...texts[action] — берём заголовок и тексты; danger: true — красная кнопка
    const ok = await confirmAction({ ...texts[action], cancelLabel: 'Не надо', danger: true });
    // пользователь передумал
    if (!ok) return;
  // конец if
  }
  // «загрузка» на кнопке
  setButtonLoading(btn, true);
  // try — запрос
  try {
    // принять или отклонить — функция respond_partnership, иначе finish_partnership
    if (action === 'accept' || action === 'decline') {
      // p_accept: true — принять, false — отклонить
      const { data, error } = await supabase.rpc('respond_partnership', { p_partnership_id: id, p_accept: action === 'accept' });
      // ошибка — в catch
      if (error) throw error;
      // сообщение зависит от результата: 'active' — все согласны, 'pending' — ждём остальных
      const messages = { active: 'Обмен начался! Можно писать в чат', pending: 'Согласие отправлено. Ждём остальных участников', declined: 'Запрос отклонён' };
      // всплывающее сообщение
      showToast(messages[data] ?? 'Готово', 'success');
    // иначе — завершить или отменить
    } else {
      // вызываем finish_partnership
      const { error } = await supabase.rpc('finish_partnership', { p_partnership_id: id });
      // ошибка — в catch
      if (error) throw error;
      // сообщение
      showToast(action === 'cancel' ? 'Запрос отменён' : 'Обмен завершён', 'success');
    // конец if/else
    }
    // перерисовываем список с новыми статусами
    await render();
  // catch — ошибка
  } catch (error) {
    // в консоль
    logError(error);
    // понятное сообщение
    showToast(getErrorMessage(error), 'error');
    // кнопка снова активна
    setButtonLoading(btn, false);
  // конец try/catch
  }
// конец функции handleAction
}

// ----------------------------------------------------------------------------
// start — запуск страницы.
// Принимает: ничего. Возвращает: Promise.
// ----------------------------------------------------------------------------
// async function
async function start() {
  // только для учеников
  const context = await initPage({ active: 'partners', roles: ['student'] });
  // нельзя показывать — выходим
  if (!context) return;
  // запоминаем свой id
  meId = context.user.id;
  // загружаем и рисуем
  await render();
  // один обработчик кликов на всё содержимое (делегирование событий)
  document.getElementById('partners-content').addEventListener('click', (event) => {
    // кнопка с data-action, по которой кликнули
    const btn = event.target.closest('button[data-action]');
    // если нашли — выполняем действие
    if (btn) handleAction(btn);
  // конец обработчика
  });
// конец функции start
}

// запускаем страницу
start();
