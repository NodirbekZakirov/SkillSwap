// ============================================================================
// Файл: js/ui.js
// Зачем нужен: маленькие «строители» HTML, которые повторяются на разных
// страницах: выбор аватара, плашка предмета с иконкой, отметка «подтверждено».
// Как связан с остальными: берёт списки из js/config.js; используется
// страницами регистрации, профиля, совпадений и другими. Стили — в
// css/pages.css (.avatar-picker, .verified-mark) и css/components.css (.chip).
// ============================================================================

// список аватаров и функция поиска предмета
import { AVATARS, getSubject } from './config.js';
// экранирование текста
import { escapeHtml } from './utils.js';

// ----------------------------------------------------------------------------
// avatarPickerHtml — HTML-код выбора аватара (сетка круглых кнопок-эмодзи).
// Под капотом это обычные радиокнопки <input type="radio">: из группы с
// одинаковым name можно выбрать только одну.
// Принимает: name — имя группы радиокнопок; selected — выбранный аватар.
// Возвращает: строку HTML.
// ----------------------------------------------------------------------------
// export function
export function avatarPickerHtml(name, selected) {
  // для каждого аватара — label с радиокнопкой внутри; клик по label выбирает кнопку
  const options = AVATARS.map((avatar) => [
    // label — подпись, связанная с полем; класс для круглой кнопки
    '<label class="avatar-option">',
    // type="radio" — радиокнопка; value — значение; checked — выбрана, если это текущий аватар; aria-label — подпись для программ чтения с экрана
    `<input type="radio" name="${name}" value="${avatar}"${avatar === selected ? ' checked' : ''} aria-label="Аватар ${avatar}">`,
    // сам эмодзи; aria-hidden — чтобы не читался дважды
    `<span aria-hidden="true">${avatar}</span>`,
    // закрываем label
    '</label>',
  // join('') склеивает части одного аватара
  ].join(''));
  // role="radiogroup" — группа радиокнопок; join('') склеивает все аватары
  return `<div class="avatar-picker" role="radiogroup" aria-label="Выбери аватар">${options.join('')}</div>`;
// конец функции avatarPickerHtml
}

// ----------------------------------------------------------------------------
// getCheckedValue — значение выбранной радиокнопки в группе.
// Принимает: root — где искать (форма); name — имя группы.
// Возвращает: строку-значение или null, если ничего не выбрано.
// ----------------------------------------------------------------------------
// export function
export function getCheckedValue(root, name) {
  // селектор атрибута: input с нужным name и псевдоклассом :checked (выбран)
  const checked = root.querySelector(`input[name="${name}"]:checked`);
  // ?. — если ничего не выбрано, вернётся undefined, а ?? превратит его в null
  return checked?.value ?? null;
// конец функции getCheckedValue
}

// ----------------------------------------------------------------------------
// subjectChipHtml — плашка предмета: иконка + название (+ уровень).
// Принимает: subjectId — id предмета; level — уровень (необязательно);
//   variant — цвет плашки: 'primary', 'success', 'warning' и т.д.
// Возвращает: строку HTML.
// ----------------------------------------------------------------------------
// level = null, variant = 'primary' — значения по умолчанию
export function subjectChipHtml(subjectId, level = null, variant = 'primary') {
  // находим предмет в списке
  const subject = getSubject(subjectId);
  // если уровень передан — добавляем « · 5»
  const levelText = level ? ` · ${level}` : '';
  // собираем плашку; название экранируем на всякий случай (оно могло прийти из базы)
  return `<span class="chip chip-${variant}"><span aria-hidden="true">${subject.icon}</span>${escapeHtml(subject.name)}${levelText}</span>`;
// конец функции subjectChipHtml
}

// ----------------------------------------------------------------------------
// verifiedMarkHtml — отметка «✔ подтверждено тестом» рядом с предметом.
// Принимает: short — true, если нужна короткая версия (только галочка).
// Возвращает: строку HTML.
// ----------------------------------------------------------------------------
// export function; short = false — значение по умолчанию
export function verifiedMarkHtml(short = false) {
  // title — подсказка при наведении мыши; aria-label — текст для программ чтения с экрана
  return `<span class="verified-mark" title="Уровень подтверждён мини-тестом" aria-label="Уровень подтверждён тестом">✔${short ? '' : ' подтверждено'}</span>`;
// конец функции verifiedMarkHtml
}
