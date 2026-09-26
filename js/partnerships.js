// ============================================================================
// Файл: js/partnerships.js
// Зачем нужен: общие функции для партнёрств (пар и троек):
//   • loadPartnerships — загрузить мои партнёрства вместе с участниками;
//   • exchangeSteps — кто кому с чем помогает;
//   • названия статусов и видов партнёрства по-русски.
// Как связан с остальными: используется страницами js/pages/partners.js
// и js/pages/chat.js (дальше — занятия и материалы). Данные читаются из
// таблиц partnerships, partnership_members и profiles; RLS в базе отдаёт
// только партнёрства, где текущий ученик — участник.
// ============================================================================

// подключение к Supabase
import { supabase } from './supabase.js';
// имя «Амир Т.»
import { formatName } from './auth.js';
// плашка предмета
import { subjectChipHtml } from './ui.js';
// экранирование
import { escapeHtml } from './utils.js';

// STATUS_LABELS — статусы партнёрства по-русски и цвет плашки
export const STATUS_LABELS = {
  // ждёт согласия
  pending: { text: 'Ждёт ответа', variant: 'warning' },
  // активно
  active: { text: 'Активно', variant: 'success' },
  // отклонено
  declined: { text: 'Отклонено', variant: 'danger' },
  // завершено
  finished: { text: 'Завершено', variant: 'primary' },
// конец объекта
};

// KIND_LABELS — вид партнёрства по-русски
export const KIND_LABELS = { pair: 'Пара', triple: 'Тройка' };

// ----------------------------------------------------------------------------
// loadPartnerships — загружает мои партнёрства с участниками и их профилями.
// Принимает: объект { id } — если передан id, загружаем одно партнёрство.
// Возвращает: Promise с массивом партнёрств; у каждого поле members:
//   [{ user_id, teaches_to, teaches_subject, accepted, profile: {...} }].
// ----------------------------------------------------------------------------
// { id = null } = {} — необязательный параметр
export async function loadPartnerships({ id = null } = {}) {
  // запрос: партнёрства и вложенные строки участников (связь по partnership_id)
  let query = supabase
    // таблица партнёрств
    .from('partnerships')
    // нужные столбцы; partnership_members(...) — вложенная выборка связанной таблицы
    .select('id, kind, status, created_by, created_at, accepted_at, finished_at, partnership_members(user_id, teaches_to, teaches_subject, accepted)')
    // order(..., { ascending: false }) — сначала новые
    .order('created_at', { ascending: false });
  // если нужен один — добавляем условие
  if (id !== null) query = query.eq('id', id);
  // выполняем запрос
  const { data, error } = await query;
  // ошибка — бросаем
  if (error) throw error;
  // Set — уникальные id всех участников всех партнёрств
  const userIds = new Set(data.flatMap((p) => p.partnership_members.map((m) => m.user_id)));
  // если участников нет (нет партнёрств) — возвращаем пустой список
  if (userIds.size === 0) return [];
  // загружаем профили участников одним запросом; in('id', [...]) — id из списка
  const profilesRes = await supabase.from('profiles').select('id, first_name, last_initial, avatar, grade, is_blocked').in('id', [...userIds]);
  // ошибка — бросаем
  if (profilesRes.error) throw profilesRes.error;
  // словарь «id → профиль»
  const profiles = new Map(profilesRes.data.map((profile) => [profile.id, profile]));
  // к каждому участнику добавляем его профиль; ?? — заглушка, если профиль не виден
  return data.map((p) => ({ ...p, members: p.partnership_members.map((m) => ({ ...m, profile: profiles.get(m.user_id) ?? { id: m.user_id, first_name: 'Ученик', last_initial: '', avatar: '👤', grade: null } })) }));
// конец функции loadPartnerships
}

// ----------------------------------------------------------------------------
// otherMembers — участники партнёрства, кроме меня.
// Принимает: partnership; meId. Возвращает: массив участников.
// ----------------------------------------------------------------------------
// export function
export function otherMembers(partnership, meId) {
  // filter убирает меня
  return partnership.members.filter((member) => member.user_id !== meId);
// конец функции otherMembers
}

// ----------------------------------------------------------------------------
// partnershipTitle — название для заголовка: «Лена К.» или «Тимур Л. и Сабина Р.».
// Принимает: partnership; meId. Возвращает: строку.
// ----------------------------------------------------------------------------
// export function
export function partnershipTitle(partnership, meId) {
  // имена остальных участников через « и »
  return otherMembers(partnership, meId).map((member) => formatName(member.profile)).join(' и ');
// конец функции partnershipTitle
}

// ----------------------------------------------------------------------------
// exchangeSteps — шаги обмена «кто → кому: предмет», начиная с меня.
// Принимает: partnership; meId.
// Возвращает: массив { from, to, subject }, где from и to — профили,
//   а у моего профиля поле isMe = true.
// ----------------------------------------------------------------------------
// export function
export function exchangeSteps(partnership, meId) {
  // словарь «id → участник»
  const byId = new Map(partnership.members.map((member) => [member.user_id, member]));
  // профиль с отметкой «это я»
  const person = (userId) => ({ ...byId.get(userId).profile, isMe: userId === meId });
  // шаги: начинаем с меня и идём по цепочке teaches_to
  const steps = [];
  // текущий участник цепочки
  let current = byId.get(meId);
  // for с счётчиком: шагов столько же, сколько участников
  for (let i = 0; i < partnership.members.length && current; i++) {
    // добавляем шаг «current → кому он помогает»
    steps.push({ from: person(current.user_id), to: person(current.teaches_to), subject: current.teaches_subject });
    // переходим к следующему в цепочке
    current = byId.get(current.teaches_to);
  // конец цикла
  }
  // возвращаем шаги
  return steps;
// конец функции exchangeSteps
}

// ----------------------------------------------------------------------------
// hasAccepted — согласился ли я на это партнёрство.
// Принимает: partnership; meId. Возвращает: boolean.
// ----------------------------------------------------------------------------
// export function
export function hasAccepted(partnership, meId) {
  // находим свою строку участника; ?. — если вдруг нет
  return Boolean(partnership.members.find((member) => member.user_id === meId)?.accepted);
// конец функции hasAccepted
}

// ----------------------------------------------------------------------------
// exchangeStepsHtml — список шагов обмена в HTML: «🦊 Ты → 🐼 Лена К. [Английский]».
// Принимает: steps — массив из exchangeSteps. Возвращает: строку HTML.
// ----------------------------------------------------------------------------
// export function
export function exchangeStepsHtml(steps) {
  // имя для показа: «Ты» или «Имя Б.»
  const nameOf = (person) => (person.isMe ? 'Ты' : formatName(person));
  // каждый шаг — пункт списка
  const items = steps.map((step) => [
    // начало пункта
    '<li class="triple-step">',
    // кто помогает
    `<span class="avatar avatar-sm" aria-hidden="true">${escapeHtml(step.from.avatar)}</span><strong>${escapeHtml(nameOf(step.from))}</strong>`,
    // стрелка
    '<span aria-hidden="true">→</span>',
    // кому помогает
    `<span class="avatar avatar-sm" aria-hidden="true">${escapeHtml(step.to.avatar)}</span><strong>${escapeHtml(nameOf(step.to))}</strong>`,
    // предмет
    subjectChipHtml(step.subject, null, step.to.isMe ? 'success' : 'primary'),
    // конец пункта
    '</li>',
  // склеиваем части пункта
  ].join(''));
  // нумерованный список шагов
  return `<ol class="triple-steps">${items.join('')}</ol>`;
// конец функции exchangeStepsHtml
}
