// ============================================================================
// Файл: js/streaks.js
// Зачем нужен: СЕРИИ «недель подряд помогаешь другим» (как ударный режим в
// Duolingo). Неделя засчитана, если в ней было проведённое занятие или
// одобренный администратором ответ на вопрос. Пропустил неделю — серия
// сгорает. Считает всё база (SQL-функции streak_info и get_streak), здесь —
// только загрузка и красивый показ:
//   • карточка с огоньком и полоской последних 8 недель (профиль);
//   • маленький значок «🔥 5» в шапке сайта.
// Как связан с остальными: вызывается из js/layout.js (значок в шапке),
// js/pages/profile.js и js/pages/user.js (карточка). Стили — css/pages.css.
// ============================================================================

// подключение к Supabase
import { supabase } from './supabase.js';
// склонение слов и вывод ошибок в консоль
import { pluralRu, logError } from './utils.js';

// WEEK_FORMS — формы слова «неделя» для pluralRu: 1 неделя, 2 недели, 5 недель
const WEEK_FORMS = ['неделя', 'недели', 'недель'];

// ----------------------------------------------------------------------------
// loadStreak — загружает серию ученика из базы.
// Принимает: userId — чья серия (null — моя). Возвращает: Promise с объектом
//   { current, best, this_week, at_risk, weeks: [8 × true/false] }.
// ----------------------------------------------------------------------------
// export async function; userId = null — по умолчанию «моя»
export async function loadStreak(userId = null) {
  // SQL-функция get_streak сама проверит, что ученик из моей школы
  const { data, error } = await supabase.rpc('get_streak', { p_user_id: userId });
  // ошибка — бросаем, пусть решает вызывающий код
  if (error) throw error;
  // возвращаем объект серии
  return data;
// конец функции loadStreak
}

// ----------------------------------------------------------------------------
// weekLabels — подписи к 8 последним неделям: дата понедельника «8 сент.».
// Принимает: ничего. Возвращает: массив из 8 строк (от старой к текущей).
// ----------------------------------------------------------------------------
// function
function weekLabels() {
  // сегодня
  const today = new Date();
  // getDay() — день недели: 0 — воскресенье, 1 — понедельник...; сдвиг до понедельника: (день + 6) % 7
  const shift = (today.getDay() + 6) % 7;
  // понедельник этой недели: new Date(год, месяц, число) — полночь нужного дня
  const monday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - shift);
  // формат «8 сент.»
  const format = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' });
  // 8 понедельников: i = 0 — 7 недель назад, i = 7 — эта неделя
  return Array.from({ length: 8 }, (_, i) => format.format(new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() - (7 - i) * 7)));
// конец функции weekLabels
}

// ----------------------------------------------------------------------------
// streakHint — подсказка под серией: что сделать, чтобы серия росла.
// Принимает: streak — объект серии. Возвращает: строку.
// ----------------------------------------------------------------------------
// function
function streakHint(streak) {
  // эта неделя уже засчитана
  if (streak.this_week) return '✅ Эта неделя засчитана! Помоги кому-нибудь и на следующей — серия вырастет.';
  // серия есть, но на этой неделе ещё ничего
  if (streak.at_risk) return '⏳ До воскресенья проведи занятие или ответь на вопрос — иначе серия сгорит!';
  // серии нет, но рекорд был
  if (streak.best > 0) return `Серия прервалась. Твой рекорд — ${streak.best} ${pluralRu(streak.best, WEEK_FORMS)}. Начни новую на этой неделе!`;
  // серии никогда не было
  return 'Проведи занятие или получи одобрение ответа на вопрос — и загорится первый огонёк!';
// конец функции streakHint
}

// ----------------------------------------------------------------------------
// streakCardHtml — карточка серии: огонёк, число недель, рекорд, 8 недель.
// Принимает: streak — объект серии; { own } — true, если это моя серия
//   (тогда показываем подсказку, что делать).
// Возвращает: строку HTML (без внешней обёртки-секции).
// ----------------------------------------------------------------------------
// export function
export function streakCardHtml(streak, { own = true } = {}) {
  // подписи недель
  const labels = weekLabels();
  // 8 кружков: огонёк — неделя засчитана; последняя — текущая неделя
  const weeks = streak.weeks.map((done, i) => [
    // li — один кружок; current — текущая неделя (выделяем рамкой)
    `<li class="streak-week${done ? ' done' : ''}${i === 7 ? ' current' : ''}" title="Неделя с ${labels[i]}: ${done ? 'засчитана' : 'нет помощи'}">`,
    // кружок: огонёк или точка
    `<span class="streak-dot" aria-hidden="true">${done ? '🔥' : '·'}</span>`,
    // подпись: «эта» для текущей недели, иначе дата понедельника
    `<span class="streak-week-label">${i === 7 ? 'эта' : labels[i]}</span>`,
    // конец кружка
    '</li>',
  // склеиваем части кружка, потом все кружки
  ].join('')).join('');
  // собираем карточку
  return [
    // верхняя строка: огонёк и число
    `<div class="streak-main${streak.current > 0 ? ' is-active' : ''}">`,
    // большой огонёк; серый, если серии нет
    '<span class="streak-flame" aria-hidden="true">🔥</span>',
    // число и подпись
    `<div class="streak-numbers"><strong class="streak-number">${streak.current}</strong><span>${pluralRu(streak.current, WEEK_FORMS)} подряд ${own ? 'помогаешь' : 'помогает'} другим</span></div>`,
    // рекорд
    `<div class="streak-best"><span class="muted">Рекорд</span><strong>${streak.best}</strong></div>`,
    // конец верхней строки
    '</div>',
    // полоска 8 недель; aria-label — пояснение для программ чтения с экрана
    `<ol class="streak-weeks" aria-label="Последние 8 недель">${weeks}</ol>`,
    // подсказка — только в своём профиле
    own ? `<p class="streak-hint${streak.at_risk ? ' is-risk' : ''}">${streakHint(streak)}</p>` : '',
  // склеиваем
  ].join('');
// конец функции streakCardHtml
}

// ----------------------------------------------------------------------------
// initStreakChip — значок «🔥 5» в шапке сайта (только если серия есть).
// Ошибку не показываем ученику: значок просто не появится.
// Принимает: container — блок кнопок шапки. Возвращает: Promise.
// ----------------------------------------------------------------------------
// export async function
export async function initStreakChip(container) {
  // try — запрос может не пройти
  try {
    // моя серия
    const streak = await loadStreak();
    // серии нет — значок не нужен
    if (!streak || streak.current === 0) return;
    // ссылка на карточку серии в профиле
    const chip = document.createElement('a');
    // класс для стилей; at-risk — мигает, если серия под угрозой
    chip.className = `streak-chip${streak.at_risk ? ' at-risk' : ''}`;
    // адрес: профиль, раздел #streak
    chip.href = '/pages/profile.html#streak';
    // подсказка при наведении
    chip.title = streak.at_risk ? 'Серия под угрозой: помоги кому-нибудь до воскресенья!' : `Серия: ${streak.current} ${pluralRu(streak.current, WEEK_FORMS)} подряд`;
    // textContent — безопасная вставка текста
    chip.textContent = `🔥 ${streak.current}`;
    // before — ставим значок перед именем пользователя (колокольчик остаётся первым)
    container.querySelector('.header-user').before(chip);
  // catch — ошибка только в консоль
  } catch (error) {
    // предупреждение для разработчика
    logError(error);
  // конец try/catch
  }
// конец функции initStreakChip
}
