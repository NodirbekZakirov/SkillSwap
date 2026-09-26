// ============================================================================
// Файл: js/qa.js
// Зачем нужен: общие функции раздела «Вопросы и ответы»:
//   • статусы ответа («Одобрено администратором» и т.д.);
//   • проверка текста вопроса или ответа (длина и грубые слова);
//   • загрузка и удаление фото в Storage (корзина qa-images) и временные
//     ссылки на них;
//   • загрузка профилей авторов одним запросом.
// Раздел общий для всех школ: вопросы и ответы видят ученики любой школы.
// Как связан с остальными: используется страницами js/pages/questions.js,
// question.js и admin.js. Защиту данных делает база (RLS для questions и
// answers, правила корзины qa-images, функция get_qa_authors в sql/schema.sql).
// ============================================================================

// подключение к Supabase
import { supabase } from './supabase.js';
// проверка файлов и путь в хранилище
import { validateFile, buildStoragePath } from './files.js';
// поиск грубых слов
import { findBadWords } from './moderation.js';
// экранирование
import { escapeHtml } from './utils.js';

// QA_BUCKET — корзина Storage для фото вопросов и ответов
export const QA_BUCKET = 'qa-images';
// IMAGE_LINK_LIFETIME — сколько секунд действует временная ссылка на фото (1 час)
const IMAGE_LINK_LIFETIME = 60 * 60;

// ANSWER_STATUSES — статусы ответа: текст плашки и её цвет
export const ANSWER_STATUSES = {
  // ещё не проверен
  pending: { text: '⏳ Не проверено администратором', variant: 'warning' },
  // одобрен
  approved: { text: '✅ Одобрено администратором', variant: 'success' },
  // удалён (видит только автор и админ)
  removed: { text: '🗑 Удалено администратором', variant: 'danger' },
// конец объекта
};

// ----------------------------------------------------------------------------
// answerStatusHtml — плашка статуса ответа.
// Принимает: status — 'pending', 'approved' или 'removed'. Возвращает: HTML.
// ----------------------------------------------------------------------------
// export function
export function answerStatusHtml(status) {
  // описание статуса; ?? — на случай неизвестного значения
  const s = ANSWER_STATUSES[status] ?? ANSWER_STATUSES.pending;
  // плашка нужного цвета
  return `<span class="chip chip-${s.variant}">${s.text}</span>`;
// конец функции answerStatusHtml
}

// ----------------------------------------------------------------------------
// checkText — проверяет текст вопроса или ответа.
// Принимает: text — текст; { label, min, max } — название поля и длина.
// Возвращает: текст ошибки на русском или '' (всё хорошо).
// ----------------------------------------------------------------------------
// export function
export function checkText(text, { label, min = 0, max }) {
  // слишком короткий
  if (text.length < min) return min > 1 ? `${label}: минимум ${min} символов` : `Заполни поле «${label}»`;
  // слишком длинный
  if (text.length > max) return `${label}: максимум ${max} символов (сейчас ${text.length})`;
  // грубые слова
  const bad = findBadWords(text);
  // если нашли — просим исправить
  if (bad.length > 0) return `Пожалуйста, без грубых слов: «${bad.join('», «')}». Исправь текст — так общение остаётся дружелюбным.`;
  // всё хорошо
  return '';
// конец функции checkText
}

// ----------------------------------------------------------------------------
// checkImage — проверяет фото (только картинки до 5 МБ).
// Принимает: file — File или null (фото необязательно). Возвращает: ошибку или ''.
// ----------------------------------------------------------------------------
// export function
export function checkImage(file) {
  // фото не выбрано — это нормально
  if (!file) return '';
  // та же проверка, что для материалов, но без PDF
  return validateFile(file, { imagesOnly: true });
// конец функции checkImage
}

// ----------------------------------------------------------------------------
// uploadQaImage — загружает фото в папку школы: «3/1712345678-ab12cd.jpg».
// Принимает: file — картинка; schoolId — номер школы. Возвращает: Promise с путём.
// ----------------------------------------------------------------------------
// export async function
export async function uploadQaImage(file, schoolId) {
  // путь: первая папка — номер школы (по ней правила Storage проверяют доступ)
  const path = buildStoragePath(schoolId, file.type);
  // загрузка; upsert: false — не перезаписывать
  const { error } = await supabase.storage.from(QA_BUCKET).upload(path, file, { contentType: file.type, upsert: false });
  // ошибка — бросаем
  if (error) throw error;
  // возвращаем путь
  return path;
// конец функции uploadQaImage
}

// ----------------------------------------------------------------------------
// removeQaImages — удаляет фото из Storage (ошибку только пишем в консоль:
// для ученика это не важно).
// Принимает: paths — массив путей (null пропускаются). Возвращает: Promise.
// ----------------------------------------------------------------------------
// export async function
export async function removeQaImages(paths) {
  // filter(Boolean) — убираем null и пустые строки
  const list = paths.filter(Boolean);
  // нечего удалять
  if (list.length === 0) return;
  // remove — удалить файлы
  const { error } = await supabase.storage.from(QA_BUCKET).remove(list);
  // ошибку — в консоль как предупреждение
  if (error) console.warn('SkillSwap:', error.message);
// конец функции removeQaImages
}

// ----------------------------------------------------------------------------
// imageUrls — временные ссылки на фото (действуют 1 час).
// Принимает: paths — массив путей. Возвращает: Promise с Map «путь → ссылка».
// ----------------------------------------------------------------------------
// export async function
export async function imageUrls(paths) {
  // только непустые пути без повторов
  const list = [...new Set(paths.filter(Boolean))];
  // нечего — пустой словарь
  if (list.length === 0) return new Map();
  // ссылки сразу на все файлы
  const { data, error } = await supabase.storage.from(QA_BUCKET).createSignedUrls(list, IMAGE_LINK_LIFETIME);
  // при ошибке фото просто не покажутся
  if (error) {
    // предупреждение в консоль
    console.warn('SkillSwap:', error.message);
    // пустой словарь
    return new Map();
  // конец if
  }
  // словарь «путь → ссылка»; элементы без ссылки пропускаем
  return new Map(data.filter((item) => item.signedUrl).map((item) => [item.path, item.signedUrl]));
// конец функции imageUrls
}

// ----------------------------------------------------------------------------
// photoHtml — фото-превью, по клику открывается в новой вкладке.
// Принимает: url — ссылка; alt — описание. Возвращает: HTML или ''.
// ----------------------------------------------------------------------------
// export function
export function photoHtml(url, alt) {
  // нет ссылки — ничего не рисуем
  if (!url) return '';
  // rel="noopener" — новая вкладка не получит доступ к нашей; loading="lazy" — грузим, когда фото видно
  return `<a class="qa-photo" href="${escapeHtml(url)}" target="_blank" rel="noopener"><img src="${escapeHtml(url)}" alt="${escapeHtml(alt)}" loading="lazy"></a>`;
// конец функции photoHtml
}

// ----------------------------------------------------------------------------
// loadProfiles — профили авторов одним запросом.
// Принимает: ids — массив id. Возвращает: Promise с Map «id → профиль».
// ----------------------------------------------------------------------------
// export async function
export async function loadProfiles(ids) {
  // уникальные непустые id
  const list = [...new Set(ids.filter(Boolean))];
  // нечего загружать
  if (list.length === 0) return new Map();
  // профили; RLS отдаст только своих (своя школа) — админу все
  const { data, error } = await supabase.from('profiles').select('id, first_name, last_initial, avatar, grade, school_id, warnings_count').in('id', list);
  // ошибка — бросаем
  if (error) throw error;
  // словарь
  return new Map(data.map((p) => [p.id, p]));
// конец функции loadProfiles
}

// ----------------------------------------------------------------------------
// loadAuthors — карточки авторов вопросов и ответов из ЛЮБОЙ школы.
// Обычный запрос к profiles не подходит: RLS отдаёт только свою школу.
// Поэтому вызываем функцию базы get_qa_authors — она отдаёт только имя,
// первую букву фамилии, аватар, класс и название школы.
// Принимает: ids — массив id. Возвращает: Promise с Map «id → автор».
// ----------------------------------------------------------------------------
// export async function
export async function loadAuthors(ids) {
  // уникальные непустые id
  const list = [...new Set(ids.filter(Boolean))];
  // нечего загружать
  if (list.length === 0) return new Map();
  // rpc — вызов функции базы; { p_ids: list } — её параметр
  const { data, error } = await supabase.rpc('get_qa_authors', { p_ids: list });
  // ошибка — бросаем
  if (error) throw error;
  // словарь «id → автор»
  return new Map(data.map((p) => [p.id, p]));
// конец функции loadAuthors
}

// ----------------------------------------------------------------------------
// schoolNoteHtml — подпись «· Школа №5» рядом с автором из другой школы.
// Принимает: author — автор (из loadAuthors); me — мой профиль.
// Возвращает: строку HTML или '' (если школа та же или неизвестна).
// ----------------------------------------------------------------------------
// export function
export function schoolNoteHtml(author, me) {
  // своя школа или школа неизвестна — подпись не нужна
  if (!author.school_name || author.school_id === me.school_id) return '';
  // название школы; экранируем — его вводил администратор
  return `<span class="muted">· 🏫 ${escapeHtml(author.school_name)}</span>`;
// конец функции schoolNoteHtml
}

// ----------------------------------------------------------------------------
// setupPhotoPicker — «Прикрепить фото» с превью и кнопкой «Убрать».
// В контейнере должны быть: input.photo-input (type="file"), .photo-preview
// (с <img> внутри), button.photo-remove и p.photo-error.
// Принимает: root — контейнер. Возвращает: объект { file, reset() }:
//   file — выбранный подходящий файл (или null), reset — сбросить выбор.
// ----------------------------------------------------------------------------
// export function
export function setupPhotoPicker(root) {
  // поле выбора файла
  const input = root.querySelector('.photo-input');
  // блок превью
  const preview = root.querySelector('.photo-preview');
  // картинка превью
  const img = preview.querySelector('img');
  // место для ошибки
  const errorBox = root.querySelector('.photo-error');
  // объект, который вернём; file — текущий файл
  const picker = {
    // выбранного файла пока нет
    file: null,
    // reset — сбросить выбор
    reset() {
      // забываем файл
      picker.file = null;
      // очищаем поле
      input.value = '';
      // прячем превью
      preview.hidden = true;
      // URL.revokeObjectURL — освобождаем память, занятую временной ссылкой на файл
      if (img.src.startsWith('blob:')) URL.revokeObjectURL(img.src);
      // убираем картинку
      img.removeAttribute('src');
      // прячем ошибку
      errorBox.hidden = true;
    // конец reset
    },
  // конец объекта
  };
  // выбор файла
  input.addEventListener('change', () => {
    // первый выбранный файл
    const file = input.files[0] ?? null;
    // сначала сбрасываем старое
    picker.reset();
    // ничего не выбрали — выходим
    if (!file) return;
    // проверка: только картинки до 5 МБ
    const error = checkImage(file);
    // есть ошибка
    if (error) {
      // текст
      errorBox.textContent = error;
      // показываем
      errorBox.hidden = false;
      // выход
      return;
    // конец if
    }
    // запоминаем файл
    picker.file = file;
    // URL.createObjectURL — временная ссылка на файл с компьютера, чтобы показать превью до загрузки
    img.src = URL.createObjectURL(file);
    // подпись для программ чтения с экрана
    img.alt = `Выбранное фото: ${file.name}`;
    // показываем превью
    preview.hidden = false;
  // конец обработчика
  });
  // кнопка «Убрать»
  root.querySelector('.photo-remove').addEventListener('click', () => picker.reset());
  // возвращаем объект
  return picker;
// конец функции setupPhotoPicker
}

// ----------------------------------------------------------------------------
// setupCounters — счётчики символов «12 / 150» у полей с maxlength.
// Принимает: root — где искать. Возвращает: ничего.
// ----------------------------------------------------------------------------
// export function — используется на страницах вопросов
export function setupCounters(root) {
  // все элементы-счётчики с атрибутом data-counter-for
  root.querySelectorAll('[data-counter-for]').forEach((counter) => {
    // поле, к которому относится счётчик
    const field = document.getElementById(counter.dataset.counterFor);
    // обновить текст счётчика
    const update = () => { counter.textContent = `${field.value.length} / ${field.maxLength}`; };
    // при каждом вводе
    field.addEventListener('input', update);
    // и сразу при запуске
    update();
  // конец forEach
  });
// конец функции setupCounters
}
