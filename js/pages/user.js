// ============================================================================
// Файл: js/pages/user.js
// Зачем нужен: страница профиля другого ученика pages/user.html?id=...:
// имя (фамилия — только первая буква), класс, очки, предметы, средняя
// оценка и отзывы партнёров. Видны только ученики своей школы: если id из
// другой школы, база просто не вернёт профиль (RLS), и мы покажем
// «Ученик не найден».
// Как связан с остальными: js/layout.js, js/auth.js, js/reviews.js,
// js/ui.js, js/supabase.js, js/utils.js.
// ============================================================================

// запуск страницы
import { initPage } from '../layout.js';
// подключение к Supabase
import { supabase } from '../supabase.js';
// имя «Амир Т.»
import { formatName } from '../auth.js';
// отзывы
import { loadReviewsAbout, ratingSummary, reviewsListHtml } from '../reviews.js';
// плашка предмета
import { subjectChipHtml, verifiedMarkHtml } from '../ui.js';
// бейджи
import { loadBadges, badgesHtml } from '../badges.js';
// состояния и ошибки
import { renderState, getErrorMessage, logError, pluralRu } from '../utils.js';
// серия «недель подряд помогает»
import { loadStreak } from '../streaks.js';

// ----------------------------------------------------------------------------
// chipsHtml — плашки предметов с уровнем.
// Принимает: skills — строки skills; variant — цвет. Возвращает: строку HTML.
// ----------------------------------------------------------------------------
// function
function chipsHtml(skills, variant) {
  // нет предметов — прочерк
  if (skills.length === 0) return '<span class="muted">—</span>';
  // сортируем по уровню (сначала сильные) и превращаем в плашки; подтверждённые тестом — с галочкой ✔
  return [...skills].sort((a, b) => b.level - a.level).map((s) => subjectChipHtml(s.subject, s.level, variant) + (s.verified_at ? verifiedMarkHtml(true) : '')).join('');
// конец функции chipsHtml
}

// ----------------------------------------------------------------------------
// showStreak — плашка «🔥 5 недель подряд» в верхней карточке.
// Принимает: userId. Возвращает: Promise.
// ----------------------------------------------------------------------------
// async function
async function showStreak(userId) {
  // серия этого ученика
  const streak = await loadStreak(userId);
  // число с огоньком
  document.getElementById('user-streak').textContent = `🔥 ${streak.current}`;
  // подпись: «неделя / недели / недель подряд»
  document.getElementById('user-streak-label').textContent = `${pluralRu(streak.current, ['неделя', 'недели', 'недель'])} подряд`;
  // показываем плашку
  document.getElementById('user-streak-box').hidden = false;
// конец функции showStreak
}

// ----------------------------------------------------------------------------
// start — запуск страницы.
// Принимает: ничего. Возвращает: Promise.
// ----------------------------------------------------------------------------
// async function
async function start() {
  // страница для всех ролей (учитель тоже может посмотреть ученика своей школы)
  const context = await initPage({ active: '' });
  // нельзя показывать — выходим
  if (!context) return;
  // блок состояний
  const stateBox = document.getElementById('user-state');
  // id ученика из адреса
  const userId = new URLSearchParams(location.search).get('id');
  // свой профиль смотрим на странице «Мой профиль»
  if (userId === context.user.id) {
    // переход без записи в историю
    location.replace('/pages/profile.html');
    // стоп
    return;
  // конец if
  }
  // нет id в адресе
  if (!userId) {
    // сообщение
    renderState(stateBox, 'error', 'Ученик не найден', 'Проверь ссылку.');
    // стоп
    return;
  // конец if
  }
  // try — загрузка
  try {
    // профиль, предметы, отзывы и бейджи параллельно
    const [profileRes, skillsRes, reviews, badges] = await Promise.all([
      // профиль; maybeSingle — null, если не найден (или из другой школы)
      supabase.from('profiles').select('id, first_name, last_initial, avatar, grade, points, role, schools(name)').eq('id', userId).maybeSingle(),
      // предметы ученика
      supabase.from('skills').select('subject, kind, level, verified_at').eq('user_id', userId),
      // отзывы о нём
      loadReviewsAbout(userId),
      // его бейджи
      loadBadges(userId),
    // конец списка
    ]);
    // ошибки
    if (profileRes.error) throw profileRes.error;
    // ошибка предметов
    if (skillsRes.error) throw skillsRes.error;
    // профиль
    const profile = profileRes.data;
    // не нашли
    if (!profile) {
      // сообщение
      renderState(stateBox, 'error', 'Ученик не найден', 'Можно смотреть профили только учеников своей школы.');
      // стоп
      return;
    // конец if
    }
    // аватар
    document.getElementById('user-avatar').textContent = profile.avatar;
    // имя
    document.getElementById('user-name').textContent = formatName(profile);
    // класс и школа; filter(Boolean) убирает пустые части
    document.getElementById('user-meta').textContent = [profile.grade ? `${profile.grade} класс` : '', profile.schools?.name ?? ''].filter(Boolean).join(' · ');
    // очки
    document.getElementById('user-points').textContent = String(profile.points);
    // средняя оценка
    const summary = ratingSummary(reviews);
    // число или прочерк
    document.getElementById('user-rating').textContent = summary.average === null ? '—' : `★ ${summary.average}`;
    // подпись: сколько отзывов
    document.getElementById('user-rating-label').textContent = summary.count === 0 ? 'нет оценок' : `оценок: ${summary.count}`;
    // «может помочь»
    document.getElementById('user-knows').innerHTML = chipsHtml(skillsRes.data.filter((s) => s.kind === 'know'), 'success');
    // «хочет подтянуть»
    document.getElementById('user-learns').innerHTML = chipsHtml(skillsRes.data.filter((s) => s.kind === 'learn'), 'warning');
    // отзывы
    document.getElementById('user-reviews').innerHTML = reviewsListHtml(reviews);
    // бейджи: у чужого профиля показываем только полученные
    document.getElementById('user-badges').innerHTML = badgesHtml(badges);
    // раздел бейджей виден, только если они есть (size — количество элементов в Map)
    document.getElementById('user-badges-section').hidden = badges.size === 0;
    // название вкладки
    document.title = `${formatName(profile)} — SkillSwap`;
    // прячем «загрузку»
    stateBox.innerHTML = '';
    // показываем профиль
    document.getElementById('user-content').hidden = false;
    // серия — только у учеников; без await, ошибка — только в консоль
    if (profile.role === 'student') showStreak(userId).catch(logError);
  // catch — ошибка
  } catch (error) {
    // в консоль
    logError(error);
    // сообщение
    renderState(stateBox, 'error', 'Не удалось загрузить профиль', getErrorMessage(error), { href: location.pathname + location.search, label: 'Попробовать ещё раз' });
    // стоп
    return;
  // конец try/catch
  }
  // ссылка «Назад»: если есть куда вернуться — возвращаемся
  document.getElementById('back-link').addEventListener('click', (event) => {
    // history.length > 1 — в истории вкладки есть предыдущая страница
    if (history.length > 1) {
      // не переходим по href
      event.preventDefault();
      // history.back() — шаг назад, как кнопка браузера
      history.back();
    // конец if
    }
  // конец обработчика
  });
// конец функции start
}

// запускаем страницу
start();
