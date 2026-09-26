// ============================================================================
// Файл: js/badges.js
// Зачем нужен: показ бейджей и правил очков.
//   • loadBadges — какие бейджи получил ученик (таблица user_badges);
//   • badgesHtml — сетка бейджей: полученные цветные с датой, остальные
//     серые с подсказкой «как получить»;
//   • pointsRulesHtml — список «как заработать очки».
// Выдаёт бейджи и начисляет очки БАЗА (SQL-функции check_badges и points_for
// в sql/schema.sql) — здесь только красивый показ.
// Как связан с остальными: списки берутся из js/config.js (BADGES,
// POINTS_RULES); используется js/pages/profile.js, user.js, leaderboard.js.
// ============================================================================

// подключение к Supabase
import { supabase } from './supabase.js';
// описания бейджей и правил очков
import { BADGES, POINTS_RULES } from './config.js';
// экранирование
import { escapeHtml } from './utils.js';

// ----------------------------------------------------------------------------
// loadBadges — полученные бейджи ученика.
// Принимает: userId. Возвращает: Promise с Map «id бейджа → дата получения».
// ----------------------------------------------------------------------------
// export async function
export async function loadBadges(userId) {
  // строки user_badges этого ученика (RLS: видны ученики своей школы)
  const { data, error } = await supabase.from('user_badges').select('badge, earned_at').eq('user_id', userId);
  // ошибка — бросаем
  if (error) throw error;
  // Map из пар [id, дата]
  return new Map(data.map((row) => [row.badge, row.earned_at]));
// конец функции loadBadges
}

// ----------------------------------------------------------------------------
// badgesHtml — сетка бейджей.
// Принимает: earned — Map из loadBadges; showLocked — показывать ли
//   ещё не полученные (в своём профиле — да, в чужом — нет).
// Возвращает: строку HTML.
// ----------------------------------------------------------------------------
// { showLocked = false } = {} — необязательный параметр-объект
export function badgesHtml(earned, { showLocked = false } = {}) {
  // какие бейджи показывать: все или только полученные
  const list = showLocked ? BADGES : BADGES.filter((badge) => earned.has(badge.id));
  // нечего показывать
  if (list.length === 0) return '<p class="muted">Бейджей пока нет.</p>';
  // формат даты «25 сент.»
  const dateFormat = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' });
  // карточка каждого бейджа
  const items = list.map((badge) => {
    // дата получения или undefined
    const date = earned.get(badge.id);
    // получен ли
    const got = Boolean(date);
    // собираем карточку; класс locked делает бейдж серым
    return [
      // пункт списка
      `<li class="badge-card${got ? '' : ' locked'}">`,
      // большая иконка
      `<span class="badge-icon" aria-hidden="true">${badge.icon}</span>`,
      // название
      `<strong>${escapeHtml(badge.name)}</strong>`,
      // получен — дата, нет — условие
      got ? `<span class="muted">получен ${dateFormat.format(new Date(date))}</span>` : `<span class="muted">🔒 ${escapeHtml(badge.description)}</span>`,
      // конец пункта
      '</li>',
    // склеиваем
    ].join('');
  // конец map
  });
  // список бейджей; aria-label — подпись для программ чтения с экрана
  return `<ul class="badges-grid" aria-label="Бейджи">${items.join('')}</ul>`;
// конец функции badgesHtml
}

// ----------------------------------------------------------------------------
// pointsRulesHtml — список правил начисления очков.
// Принимает: ничего. Возвращает: строку HTML.
// ----------------------------------------------------------------------------
// export function
export function pointsRulesHtml() {
  // пункт на каждое правило: иконка, «+10», текст
  const items = POINTS_RULES.map((rule) => `<li><span aria-hidden="true">${rule.icon}</span> <strong>+${rule.points}</strong> ${escapeHtml(rule.text)}</li>`).join('');
  // список
  return `<ul class="points-rules">${items}</ul>`;
// конец функции pointsRulesHtml
}
