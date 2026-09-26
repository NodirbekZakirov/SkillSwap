// ============================================================================
// Файл: js/pages/leaderboard.js
// Зачем нужен: страница «Рейтинг» (pages/leaderboard.html): топ-10
// помощников школы за текущий месяц. Первые три — на пьедестале, остальные —
// списком; моя строка подсвечена; сверху — моё место и очки за месяц.
// Данные считает SQL-функция get_school_leaderboard: она складывает очки из
// журнала points_log за этот месяц и берёт только учеников моей школы.
// Как связан с остальными: js/layout.js, js/badges.js, js/auth.js,
// js/supabase.js, js/utils.js.
// ============================================================================

// запуск страницы
import { initPage } from '../layout.js';
// подключение к Supabase
import { supabase } from '../supabase.js';
// имя «Амир Т.»
import { formatName } from '../auth.js';
// правила очков
import { pointsRulesHtml } from '../badges.js';
// экранирование, состояния, ошибки
import { escapeHtml, renderState, getErrorMessage, logError, pluralRu } from '../utils.js';

// MEDALS — медали для первых трёх мест
const MEDALS = ['🥇', '🥈', '🥉'];

// ----------------------------------------------------------------------------
// personLink — аватар и имя со ссылкой на профиль ученика.
// Принимает: row — строка рейтинга; meId — мой id. Возвращает: строку HTML.
// ----------------------------------------------------------------------------
// function
function personLink(row, meId) {
  // имя; к себе добавляем «(ты)»
  const name = `${formatName(row)}${row.user_id === meId ? ' (ты)' : ''}`;
  // ссылка на профиль (свой откроется как «Мой профиль»)
  return `<a class="person-link" href="/pages/user.html?id=${encodeURIComponent(row.user_id)}">${escapeHtml(name)}</a>`;
// конец функции personLink
}

// ----------------------------------------------------------------------------
// render — рисует пьедестал, список и моё место.
// Принимает: rows — строки рейтинга (по убыванию очков); meId.
// Возвращает: ничего.
// ----------------------------------------------------------------------------
// function
function render(rows, meId) {
  // первые три
  const top = rows.slice(0, 3);
  // остальные
  const rest = rows.slice(3);
  // пьедестал: у каждого места медаль, аватар, имя, очки и класс
  document.getElementById('podium').innerHTML = top.map((row, index) => [
    // место; place-1, place-2, place-3 — классы для высоты «ступеньки»; me — моя строка
    `<li class="podium-place place-${index + 1}${row.user_id === meId ? ' me' : ''}">`,
    // медаль
    `<span class="podium-medal" aria-hidden="true">${MEDALS[index]}</span>`,
    // аватар
    `<span class="avatar avatar-lg" aria-hidden="true">${escapeHtml(row.avatar)}</span>`,
    // имя
    `<strong class="podium-name">${personLink(row, meId)}</strong>`,
    // очки
    `<span class="podium-points">${row.month_points} ${pluralRu(row.month_points, ['очко', 'очка', 'очков'])}</span>`,
    // класс
    `<span class="muted">${row.grade ?? '?'} класс</span>`,
    // конец места
    '</li>',
  // склеиваем
  ].join('')).join('');
  // список мест 4–10
  const list = document.getElementById('leaderboard-list');
  // строки списка
  list.innerHTML = rest.map((row) => `<li class="leaderboard-row${row.user_id === meId ? ' me' : ''}"><span class="avatar avatar-sm" aria-hidden="true">${escapeHtml(row.avatar)}</span><span class="leaderboard-name">${personLink(row, meId)} <span class="muted">· ${row.grade ?? '?'} класс</span></span><strong>${row.month_points}</strong></li>`).join('');
  // список прячем, если в рейтинге меньше 4 человек
  list.hidden = rest.length === 0;
  // findIndex — номер моей строки (-1, если меня нет в десятке)
  const myIndex = rows.findIndex((row) => row.user_id === meId);
  // блок «моё место»
  const myPlace = document.getElementById('my-place');
  // я в десятке
  if (myIndex >= 0) {
    // зелёный блок
    myPlace.className = 'alert alert-success section-card';
    // текст; index + 1 — место (нумерация с 1)
    myPlace.textContent = `🎉 Ты на ${myIndex + 1}-м месте: ${rows[myIndex].month_points} ${pluralRu(rows[myIndex].month_points, ['очко', 'очка', 'очков'])} за месяц. Так держать!`;
  // меня нет в десятке
  } else {
    // обычный блок
    myPlace.className = 'alert section-card';
    // подсказка
    myPlace.textContent = 'Тебя пока нет в десятке лучших. Проведи занятие и получи хорошую оценку — и ты здесь появишься!';
  // конец if/else
  }
// конец функции render
}

// ----------------------------------------------------------------------------
// start — запуск страницы.
// Принимает: ничего. Возвращает: Promise.
// ----------------------------------------------------------------------------
// async function
async function start() {
  // только для учеников
  const context = await initPage({ active: 'leaderboard', roles: ['student'] });
  // нельзя показывать — выходим
  if (!context) return;
  // название текущего месяца; если просить только месяц, Intl даёт форму «сентябрь»
  const month = new Intl.DateTimeFormat('ru-RU', { month: 'long' }).format(new Date());
  // вставляем в заголовок: «Рейтинг · сентябрь»
  document.getElementById('month-name').textContent = `· ${month}`;
  // правила очков
  document.getElementById('points-rules').innerHTML = pointsRulesHtml();
  // блок состояний
  const stateBox = document.getElementById('leaderboard-state');
  // try — запрос
  try {
    // вызываем SQL-функцию рейтинга
    const { data, error } = await supabase.rpc('get_school_leaderboard');
    // ошибка — в catch
    if (error) throw error;
    // очищаем «загрузку»
    stateBox.innerHTML = '';
    // рейтинг пуст — никто не набрал очков в этом месяце
    if (data.length === 0) {
      // сообщение
      renderState(stateBox, 'empty', 'В этом месяце очков ещё нет ни у кого', 'Стань первым: проведи занятие с партнёром!', { href: '/pages/matches.html', label: 'Найти партнёра' });
    // конец if
    }
    // рисуем
    render(data, context.user.id);
    // при пустом рейтинге блок «моё место» не нужен — сообщение выше уже всё объясняет
    document.getElementById('my-place').hidden = data.length === 0;
    // пьедестал прячем, если пусто
    document.getElementById('podium').hidden = data.length === 0;
    // показываем содержимое
    document.getElementById('leaderboard-content').hidden = false;
  // catch — ошибка
  } catch (error) {
    // в консоль
    logError(error);
    // сообщение
    renderState(stateBox, 'error', 'Не удалось загрузить рейтинг', getErrorMessage(error), { href: location.pathname, label: 'Попробовать ещё раз' });
  // конец try/catch
  }
// конец функции start
}

// запускаем страницу
start();
