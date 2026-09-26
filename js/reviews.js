// ============================================================================
// Файл: js/reviews.js
// Зачем нужен: всё про оценки и отзывы:
//   • loadReviewsAbout — отзывы об ученике вместе с именами авторов;
//   • ratingSummary — средняя оценка и количество;
//   • starsHtml — оценка звёздами ★★★★☆;
//   • reviewsListHtml — список отзывов;
//   • starPickerHtml / updateStarPicker — выбор оценки звёздами в форме.
// Как связан с остальными: используется страницами js/pages/lessons.js
// (оценка после занятия), js/pages/profile.js (мои отзывы) и
// js/pages/user.js (профиль другого ученика). Отзывы хранятся в таблице
// reviews; RLS показывает отзывы только об учениках своей школы.
// ============================================================================

// подключение к Supabase
import { supabase } from './supabase.js';
// имя «Амир Т.»
import { formatName } from './auth.js';
// экранирование и дата
import { escapeHtml, formatDateTime } from './utils.js';

// ----------------------------------------------------------------------------
// loadReviewsAbout — загружает отзывы об ученике (новые сверху) и профили авторов.
// Принимает: userId — о ком отзывы.
// Возвращает: Promise с массивом { id, rating, comment, created_at, author }.
// ----------------------------------------------------------------------------
// export async function
export async function loadReviewsAbout(userId) {
  // отзывы, где target_id — нужный ученик
  const { data, error } = await supabase.from('reviews').select('id, rating, comment, created_at, author_id').eq('target_id', userId).order('created_at', { ascending: false });
  // ошибка — бросаем
  if (error) throw error;
  // нет отзывов — пустой список
  if (data.length === 0) return [];
  // уникальные id авторов
  const authorIds = [...new Set(data.map((review) => review.author_id))];
  // профили авторов одним запросом
  const authors = await supabase.from('profiles').select('id, first_name, last_initial, avatar').in('id', authorIds);
  // ошибка — бросаем
  if (authors.error) throw authors.error;
  // словарь «id → профиль»
  const byId = new Map(authors.data.map((profile) => [profile.id, profile]));
  // к каждому отзыву — его автор (или заглушка)
  return data.map((review) => ({ ...review, author: byId.get(review.author_id) ?? { first_name: 'Ученик', last_initial: '', avatar: '👤' } }));
// конец функции loadReviewsAbout
}

// ----------------------------------------------------------------------------
// ratingSummary — средняя оценка.
// Принимает: reviews — массив отзывов.
// Возвращает: { average: число с одним знаком после запятой или null, count }.
// ----------------------------------------------------------------------------
// export function
export function ratingSummary(reviews) {
  // нет отзывов — средней нет
  if (reviews.length === 0) return { average: null, count: 0 };
  // reduce — сумма всех оценок
  const sum = reviews.reduce((total, review) => total + review.rating, 0);
  // Math.round(x * 10) / 10 — округление до одного знака после запятой (4.666 → 4.7)
  return { average: Math.round((sum / reviews.length) * 10) / 10, count: reviews.length };
// конец функции ratingSummary
}

// ----------------------------------------------------------------------------
// starsHtml — оценка звёздами: 4 → ★★★★☆.
// Принимает: rating — число от 1 до 5 (может быть дробным: округляем).
// Возвращает: строку HTML.
// ----------------------------------------------------------------------------
// export function
export function starsHtml(rating) {
  // целое число закрашенных звёзд
  const filled = Math.round(rating);
  // repeat(n) — повторить строку n раз
  const stars = '★'.repeat(filled) + '☆'.repeat(5 - filled);
  // role="img" и aria-label — программа чтения с экрана скажет «Оценка 4 из 5»
  return `<span class="stars" role="img" aria-label="Оценка ${rating} из 5">${stars}</span>`;
// конец функции starsHtml
}

// ----------------------------------------------------------------------------
// reviewsListHtml — список отзывов.
// Принимает: reviews — из loadReviewsAbout. Возвращает: строку HTML.
// ----------------------------------------------------------------------------
// export function
export function reviewsListHtml(reviews) {
  // пустой список — короткий текст
  if (reviews.length === 0) return '<p class="muted">Отзывов пока нет.</p>';
  // каждый отзыв — пункт списка
  const items = reviews.map((review) => [
    // пункт
    '<li class="review">',
    // автор, звёзды и дата
    `<div class="review-head"><span class="avatar avatar-sm" aria-hidden="true">${escapeHtml(review.author.avatar)}</span><strong>${escapeHtml(formatName(review.author))}</strong>${starsHtml(review.rating)}<span class="muted review-date">${formatDateTime(review.created_at)}</span></div>`,
    // текст отзыва — ОБЯЗАТЕЛЬНО экранируем: его написал ученик
    review.comment ? `<p class="review-text">${escapeHtml(review.comment)}</p>` : '',
    // конец пункта
    '</li>',
  // склеиваем части пункта
  ].join(''));
  // список
  return `<ul class="reviews">${items.join('')}</ul>`;
// конец функции reviewsListHtml
}

// ----------------------------------------------------------------------------
// starPickerHtml — выбор оценки: 5 радиокнопок в виде звёзд.
// Принимает: name — имя группы радиокнопок. Возвращает: строку HTML.
// ----------------------------------------------------------------------------
// export function
export function starPickerHtml(name) {
  // подписи для каждой оценки
  const titles = ['Плохо', 'Так себе', 'Нормально', 'Хорошо', 'Отлично'];
  // пять радиокнопок; title — подсказка при наведении
  const options = titles.map((title, index) => `<label title="${title}"><input type="radio" name="${name}" value="${index + 1}" aria-label="${index + 1} — ${title}"><span aria-hidden="true">★</span></label>`).join('');
  // группа радиокнопок
  return `<div class="star-picker" role="radiogroup" aria-label="Оценка от 1 до 5">${options}</div>`;
// конец функции starPickerHtml
}

// ----------------------------------------------------------------------------
// updateStarPicker — закрашивает звёзды до выбранной включительно.
// Принимает: picker — элемент .star-picker. Возвращает: ничего.
// ----------------------------------------------------------------------------
// export function
export function updateStarPicker(picker) {
  // выбранное значение (0, если ничего не выбрано)
  const value = Number(picker.querySelector('input:checked')?.value ?? 0);
  // перебираем радиокнопки; classList.toggle('filled', условие) — звезда закрашена, если её номер ≤ выбранного
  picker.querySelectorAll('input').forEach((input) => input.parentElement.classList.toggle('filled', Number(input.value) <= value));
// конец функции updateStarPicker
}
