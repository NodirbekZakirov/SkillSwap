// ============================================================================
// Файл: js/pages/materials.js
// Зачем нужен: страница «Материалы» партнёрства (pages/materials.html?id=12):
//   • выбрать файл (кнопкой или перетаскиванием) и проверить его:
//     только картинки и PDF до 5 МБ;
//   • загрузить файл в Supabase Storage (корзина materials) и записать
//     сведения о нём в таблицу materials;
//   • показать список файлов с превью картинок, открыть или скачать по
//     временной ссылке (действует 1 час), удалить свой файл.
// Защита: корзина закрытая, правила Storage пускают только участников
// партнёрства (sql/schema.sql, часть 10), сервер сам отклоняет большие и
// неразрешённые файлы.
// Как связан с остальными: js/layout.js, js/partnerships.js, js/files.js,
// js/dialog.js, js/auth.js, js/supabase.js, js/utils.js.
// ============================================================================

// запуск страницы
import { initPage } from '../layout.js';
// подключение к Supabase
import { supabase } from '../supabase.js';
// имя «Амир Т.»
import { formatName } from '../auth.js';
// партнёрства
import { loadPartnerships, partnershipTitle } from '../partnerships.js';
// проверка файлов
import { validateFile, formatFileSize, buildStoragePath, isImage } from '../files.js';
// окно подтверждения
import { confirmAction } from '../dialog.js';
// экранирование, тосты, кнопки, состояния, даты, ошибки
import { escapeHtml, showToast, setButtonLoading, renderState, formatDateTime, getErrorMessage, logError } from '../utils.js';

// BUCKET — имя корзины Storage (создана в sql/schema.sql)
const BUCKET = 'materials';
// LINK_LIFETIME — сколько секунд действует временная ссылка на файл (1 час)
const LINK_LIFETIME = 60 * 60;

// state — данные страницы
const state = {
  // мой id
  meId: null,
  // номер партнёрства
  partnershipId: null,
  // партнёрство с участниками
  partnership: null,
  // выбранный, но ещё не загруженный файл
  selectedFile: null,
  // файлы: Map «id → строка materials» (нужно для удаления)
  files: new Map(),
// конец объекта
};

// форма загрузки
const form = document.getElementById('upload-form');
// поле выбора файла
const fileInput = document.getElementById('file-input');

// ----------------------------------------------------------------------------
// selectFile — запоминает выбранный файл, проверяет его и показывает.
// Принимает: file — объект File или null (сбросить выбор). Возвращает: ничего.
// ----------------------------------------------------------------------------
// function
function selectFile(file) {
  // место для ошибки
  const errorBox = document.getElementById('file-error');
  // блок с выбранным файлом
  const selectedBox = document.getElementById('selected-file');
  // кнопка «Загрузить»
  const button = document.getElementById('upload-button');
  // сбрасываем выбор
  if (!file) {
    // забываем файл
    state.selectedFile = null;
    // очищаем поле выбора (value = '' — стандартный способ сбросить <input type="file">)
    fileInput.value = '';
    // прячем блок и ошибку
    selectedBox.hidden = true;
    // ошибку тоже
    errorBox.hidden = true;
    // кнопка неактивна
    button.disabled = true;
    // выход
    return;
  // конец if
  }
  // проверяем файл
  const error = validateFile(file);
  // текст ошибки
  errorBox.textContent = error;
  // показываем ошибку, если есть
  errorBox.hidden = !error;
  // запоминаем файл, только если он подходит
  state.selectedFile = error ? null : file;
  // кнопка активна только для подходящего файла
  button.disabled = Boolean(error);
  // иконка: картинка или документ
  document.getElementById('selected-icon').textContent = isImage(file.type) ? '🖼️' : '📄';
  // имя файла (textContent — безопасно)
  document.getElementById('selected-name').textContent = file.name;
  // размер
  document.getElementById('selected-size').textContent = formatFileSize(file.size);
  // показываем блок выбранного файла
  selectedBox.hidden = false;
// конец функции selectFile
}

// ----------------------------------------------------------------------------
// uploadFile — загрузка выбранного файла.
// Шаг 1: файл → Storage. Шаг 2: строка → таблица materials.
// Если шаг 2 не удался, удаляем файл из Storage, чтобы не оставлять мусор.
// Принимает: event — отправка формы. Возвращает: Promise.
// ----------------------------------------------------------------------------
// async function
async function uploadFile(event) {
  // не перезагружаем страницу
  event.preventDefault();
  // кнопка
  const button = document.getElementById('upload-button');
  // защита от двойного нажатия
  if (button.disabled) return;
  // выбранный файл
  const file = state.selectedFile;
  // ещё раз проверяем (на всякий случай)
  const error = validateFile(file);
  // есть ошибка
  if (error) {
    // показываем её
    selectFile(file);
    // стоп
    return;
  // конец if
  }
  // общий блок ошибки
  const formError = form.querySelector('[data-form-error]');
  // прячем старую ошибку
  formError.hidden = true;
  // «загрузка»
  setButtonLoading(button, true);
  // путь в хранилище: «12/1727000000000-a1b2c3.pdf»
  const path = buildStoragePath(state.partnershipId, file.type);
  // try — запросы
  try {
    // upload(путь, файл, настройки) — отправляем файл; contentType — тип; upsert: false — не перезаписывать существующий
    const uploadRes = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type, upsert: false });
    // ошибка загрузки — в catch
    if (uploadRes.error) throw uploadRes.error;
    // сведения о файле в таблицу; slice(0, 200) — имя не длиннее 200 символов (как в базе)
    const insertRes = await supabase.from('materials').insert({ partnership_id: state.partnershipId, uploader_id: state.meId, file_path: path, file_name: file.name.slice(0, 200), mime_type: file.type, size_bytes: file.size });
    // если запись не удалась
    if (insertRes.error) {
      // удаляем уже загруженный файл, чтобы он не остался «сиротой»
      await supabase.storage.from(BUCKET).remove([path]);
      // и сообщаем об ошибке
      throw insertRes.error;
    // конец if
    }
    // успех
    showToast('Файл загружен', 'success');
    // сбрасываем выбор
    selectFile(null);
    // обновляем список
    await loadFiles();
  // catch — ошибка
  } catch (err) {
    // в консоль
    logError(err);
    // понятный текст
    formError.textContent = getErrorMessage(err);
    // показываем
    formError.hidden = false;
  // finally — всегда
  } finally {
    // снимаем «загрузку»; кнопка станет активной, только если файл снова выбран
    setButtonLoading(button, false);
    // без выбранного файла кнопка неактивна
    button.disabled = !state.selectedFile;
  // конец try/catch/finally
  }
// конец функции uploadFile
}

// ----------------------------------------------------------------------------
// fileCardHtml — карточка файла.
// Принимает: file — строка materials; viewUrl — ссылка для просмотра;
//   downloadUrl — ссылка для скачивания; uploader — профиль автора.
// Возвращает: строку HTML.
// ----------------------------------------------------------------------------
// function
function fileCardHtml(file, viewUrl, downloadUrl, uploader) {
  // мой ли файл
  const mine = file.uploader_id === state.meId;
  // превью: картинка или значок PDF; loading="lazy" — картинка грузится, только когда видна на экране
  const thumb = isImage(file.mime_type) && viewUrl ? `<img src="${escapeHtml(viewUrl)}" alt="${escapeHtml(file.file_name)}" loading="lazy">` : '<span class="file-thumb-icon" aria-hidden="true">📄</span>';
  // собираем карточку
  return [
    // карточка
    '<article class="card file-card fade-in">',
    // превью — ссылка на просмотр; target="_blank" — в новой вкладке; rel="noopener" — новая вкладка не получит доступ к нашей
    viewUrl ? `<a class="file-thumb" href="${escapeHtml(viewUrl)}" target="_blank" rel="noopener">${thumb}</a>` : `<div class="file-thumb">${thumb}</div>`,
    // имя, размер, дата, автор
    `<div class="file-info"><strong class="file-name">${escapeHtml(file.file_name)}</strong><span class="muted">${formatFileSize(file.size_bytes)} · ${formatDateTime(file.created_at)} · ${escapeHtml(mine ? 'ты' : formatName(uploader))}</span></div>`,
    // кнопки
    '<div class="partner-actions">',
    // скачать
    downloadUrl ? `<a class="btn btn-secondary btn-sm" href="${escapeHtml(downloadUrl)}">Скачать</a>` : '',
    // удалить — только свои файлы
    mine ? `<button class="btn btn-ghost btn-sm" type="button" data-delete="${file.id}">Удалить</button>` : '',
    // конец кнопок
    '</div>',
    // конец карточки
    '</article>',
  // склеиваем
  ].join('');
// конец функции fileCardHtml
}

// ----------------------------------------------------------------------------
// loadFiles — загружает список файлов и временные ссылки на них.
// Принимает: ничего. Возвращает: Promise.
// ----------------------------------------------------------------------------
// async function
async function loadFiles() {
  // список на странице
  const list = document.getElementById('files-list');
  // строки таблицы materials (RLS отдаст, только если я участник)
  const { data, error } = await supabase.from('materials').select('id, file_path, file_name, mime_type, size_bytes, uploader_id, created_at').eq('partnership_id', state.partnershipId).order('created_at', { ascending: false });
  // ошибка — бросаем
  if (error) throw error;
  // запоминаем файлы по id
  state.files = new Map(data.map((file) => [file.id, file]));
  // счётчик
  document.getElementById('files-count').textContent = String(data.length);
  // файлов нет
  if (data.length === 0) {
    // пустое состояние: в активном обмене — подсказка загрузить, иначе просто «файлов нет»
    renderState(list, 'empty', 'Файлов пока нет', state.partnership.status === 'active' ? 'Загрузи фото задачи или конспект — партнёр сразу его увидит.' : '');
    // выход
    return;
  // конец if
  }
  // пути всех файлов
  const paths = data.map((file) => file.file_path);
  // createSignedUrls — временные ссылки для просмотра сразу на все файлы
  const viewRes = await supabase.storage.from(BUCKET).createSignedUrls(paths, LINK_LIFETIME);
  // при ошибке ссылок список всё равно покажем, просто без просмотра
  if (viewRes.error) logError(viewRes.error);
  // словарь «путь → ссылка»; ?? [] — если ссылок нет
  const viewUrls = new Map((viewRes.data ?? []).map((item) => [item.path, item.signedUrl]));
  // ссылки для скачивания: download — браузер сохранит файл под настоящим именем
  const downloadUrls = await Promise.all(data.map(async (file) => {
    // одна ссылка на один файл
    const res = await supabase.storage.from(BUCKET).createSignedUrl(file.file_path, LINK_LIFETIME, { download: file.file_name });
    // если не получилось — null (кнопки «Скачать» не будет)
    return res.error ? null : res.data.signedUrl;
  // конец map
  }));
  // словарь «id ученика → профиль» из участников партнёрства
  const people = new Map(state.partnership.members.map((m) => [m.user_id, m.profile]));
  // карточки; index — номер файла в массиве, по нему берём ссылку для скачивания
  list.innerHTML = data.map((file, index) => fileCardHtml(file, viewUrls.get(file.file_path), downloadUrls[index], people.get(file.uploader_id) ?? { first_name: 'Ученик', last_initial: '' })).join('');
// конец функции loadFiles
}

// ----------------------------------------------------------------------------
// deleteFile — удаляет свой файл: строку из таблицы и сам файл из Storage.
// Принимает: button — кнопка с data-delete. Возвращает: Promise.
// ----------------------------------------------------------------------------
// async function
async function deleteFile(button) {
  // строка файла
  const file = state.files.get(Number(button.dataset.delete));
  // не нашли — выходим
  if (!file) return;
  // подтверждение
  const ok = await confirmAction({ title: 'Удалить файл?', text: `«${file.file_name}» пропадёт и у партнёра.`, confirmLabel: 'Удалить', danger: true });
  // передумал
  if (!ok) return;
  // «загрузка»
  setButtonLoading(button, true);
  // try — запросы
  try {
    // удаляем строку; select('id') — вернуть удалённые строки, чтобы понять, удалилось ли что-то (RLS разрешает только автору)
    const { data, error } = await supabase.from('materials').delete().eq('id', file.id).select('id');
    // ошибка — в catch
    if (error) throw error;
    // ничего не удалилось — это не мой файл
    if (data.length === 0) throw new Error('permission denied');
    // удаляем сам файл из хранилища
    const removeRes = await supabase.storage.from(BUCKET).remove([file.file_path]);
    // если файл не удалился — не страшно для ученика, просто пишем в консоль
    if (removeRes.error) logError(removeRes.error);
    // сообщение
    showToast('Файл удалён', 'success');
    // обновляем список
    await loadFiles();
  // catch — ошибка
  } catch (error) {
    // в консоль
    logError(error);
    // сообщение
    showToast(getErrorMessage(error), 'error');
    // кнопка снова активна
    setButtonLoading(button, false);
  // конец try/catch
  }
// конец функции deleteFile
}

// ----------------------------------------------------------------------------
// setupDropzone — перетаскивание файла мышью в зону загрузки.
// Принимает: ничего. Возвращает: ничего.
// ----------------------------------------------------------------------------
// function
function setupDropzone() {
  // зона
  const zone = document.getElementById('dropzone');
  // dragover — файл «висит» над зоной; preventDefault разрешает бросить его сюда
  zone.addEventListener('dragover', (event) => {
    // разрешаем бросить
    event.preventDefault();
    // подсвечиваем зону
    zone.classList.add('is-dragging');
  // конец обработчика
  });
  // dragleave — файл увели из зоны
  zone.addEventListener('dragleave', () => zone.classList.remove('is-dragging'));
  // drop — файл бросили в зону
  zone.addEventListener('drop', (event) => {
    // не даём браузеру открыть файл
    event.preventDefault();
    // убираем подсветку
    zone.classList.remove('is-dragging');
    // dataTransfer.files — брошенные файлы; берём первый; ?? null — если ничего нет
    selectFile(event.dataTransfer.files[0] ?? null);
  // конец обработчика
  });
// конец функции setupDropzone
}

// ----------------------------------------------------------------------------
// start — запуск страницы.
// Принимает: ничего. Возвращает: Promise.
// ----------------------------------------------------------------------------
// async function
async function start() {
  // только для учеников; в меню подсвечиваем «Партнёры»
  const context = await initPage({ active: 'partners', roles: ['student'] });
  // нельзя показывать — выходим
  if (!context) return;
  // мой id
  state.meId = context.user.id;
  // номер партнёрства из адреса
  state.partnershipId = Number(new URLSearchParams(location.search).get('id'));
  // блок состояний
  const stateBox = document.getElementById('materials-state');
  // неправильный номер
  if (!Number.isInteger(state.partnershipId) || state.partnershipId <= 0) {
    // сообщение
    renderState(stateBox, 'error', 'Партнёрство не найдено', 'Проверь ссылку.', { href: '/pages/partners.html', label: 'К партнёрам' });
    // стоп
    return;
  // конец if
  }
  // try — загрузка
  try {
    // партнёрство (RLS вернёт, только если я участник)
    const [partnership] = await loadPartnerships({ id: state.partnershipId });
    // не нашли
    if (!partnership) {
      // сообщение
      renderState(stateBox, 'error', 'Партнёрство не найдено', 'Возможно, у тебя нет доступа к этим материалам.', { href: '/pages/partners.html', label: 'К партнёрам' });
      // стоп
      return;
    // конец if
    }
    // запоминаем
    state.partnership = partnership;
    // подзаголовок: с кем обмен
    document.getElementById('materials-subtitle').textContent = `Обмен: ${partnershipTitle(partnership, state.meId)} — файлы видят только участники обмена`;
    // ссылка «Назад» ведёт в чат этого партнёрства
    document.getElementById('back-to-chat').href = `/pages/chat.html?id=${state.partnershipId}`;
    // загружать можно только в активном партнёрстве
    const canUpload = partnership.status === 'active';
    // раздел загрузки
    document.getElementById('upload-section').hidden = !canUpload;
    // сообщение «загрузка закрыта»
    const closed = document.getElementById('upload-closed');
    // текст
    closed.textContent = partnership.status === 'pending' ? 'Загружать файлы можно, когда все участники примут обмен.' : 'Обмен завершён: новые файлы добавить нельзя, старые можно посмотреть.';
    // показываем, если загружать нельзя
    closed.hidden = canUpload;
    // список файлов
    await loadFiles();
    // прячем «загрузку»
    stateBox.innerHTML = '';
    // показываем содержимое
    document.getElementById('materials-content').hidden = false;
  // catch — ошибка
  } catch (error) {
    // в консоль
    logError(error);
    // сообщение
    renderState(stateBox, 'error', 'Не удалось загрузить материалы', getErrorMessage(error), { href: location.pathname + location.search, label: 'Попробовать ещё раз' });
    // стоп
    return;
  // конец try/catch
  }
  // выбор файла через окно
  fileInput.addEventListener('change', () => selectFile(fileInput.files[0] ?? null));
  // кнопка «Убрать»
  document.getElementById('clear-file').addEventListener('click', () => selectFile(null));
  // перетаскивание
  setupDropzone();
  // загрузка
  form.addEventListener('submit', uploadFile);
  // кнопки «Удалить» (делегирование)
  document.getElementById('files-list').addEventListener('click', (event) => {
    // кнопка удаления
    const button = event.target.closest('[data-delete]');
    // если нашли и не занята
    if (button && !button.disabled) deleteFile(button);
  // конец обработчика
  });
// конец функции start
}

// запускаем страницу
start();
