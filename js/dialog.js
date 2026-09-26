// ============================================================================
// Файл: js/dialog.js
// Зачем нужен: красивые окна подтверждения («Завершить партнёрство?») и окно
// с полем ввода (причина жалобы) вместо стандартных confirm() и prompt()
// браузера. Используется встроенный HTML-тег <dialog>: браузер сам затемняет
// фон, держит фокус внутри окна и закрывает его клавишей Esc.
// Как связан с остальными: вызывается из js/pages/partners.js и chat.js
// (и дальше — занятия, панели). Стили окна — в css/components.css (.dialog).
// ============================================================================

// экранирование текста
import { escapeHtml } from './utils.js';

// ----------------------------------------------------------------------------
// openDialog — показывает окно и ждёт ответа пользователя.
// Принимает объект настроек:
//   title — заголовок; text — пояснение;
//   confirmLabel — текст главной кнопки; cancelLabel — текст кнопки отмены;
//   danger — true, если действие опасное (красная кнопка);
//   input — { label, placeholder, maxLength, value, minLength, requiredMessage } —
//     если нужно поле ввода (value — текст, который уже будет в поле;
//     minLength — сколько символов минимум нужно для подтверждения;
//     requiredMessage — что написать под полем, если текста мало).
// Возвращает: Promise с { confirmed: true/false, value: 'текст поля' }.
// Если другое окно уже открыто (двойной клик) — сразу { confirmed: false }.
// ----------------------------------------------------------------------------
// export function — значения по умолчанию прямо в параметрах
export function openDialog({ title, text = '', confirmLabel = 'Да', cancelLabel = 'Отмена', danger = false, input = null }) {
  // защита от двойного клика: если окно уже открыто — второе не открываем, отвечаем «нет»
  if (document.querySelector('dialog.dialog[open]')) return Promise.resolve({ confirmed: false, value: '' });
  // new Promise((resolve) => ...) — создаём «обещание», которое выполнится, когда пользователь нажмёт кнопку
  return new Promise((resolve) => {
    // создаём элемент <dialog>
    const dialog = document.createElement('dialog');
    // класс для стилей
    dialog.className = 'dialog';
    // поле ввода (если нужно): textarea с ограничением длины и скрытое место для текста ошибки (role="alert" — экранный диктор прочитает её сразу)
    const inputHtml = input ? `<label class="field"><span class="field-label">${escapeHtml(input.label)}</span><textarea class="input" name="value" maxlength="${input.maxLength ?? 500}" placeholder="${escapeHtml(input.placeholder ?? '')}">${escapeHtml(input.value ?? '')}</textarea><span class="field-error" role="alert" hidden></span></label>` : '';
    // собираем содержимое окна; method="dialog" — форма никуда не отправляется, ответ обработаем в событии submit
    dialog.innerHTML = [
      // форма внутри окна
      '<form method="dialog" class="form">',
      // заголовок
      `<h2 class="dialog-title">${escapeHtml(title)}</h2>`,
      // пояснение
      text ? `<p class="muted">${escapeHtml(text)}</p>` : '',
      // поле ввода
      inputHtml,
      // ряд кнопок
      '<div class="dialog-actions">',
      // кнопка отмены; value="cancel" — это значение станет dialog.returnValue
      `<button class="btn btn-ghost" value="cancel" type="submit">${escapeHtml(cancelLabel)}</button>`,
      // главная кнопка: красная для опасных действий
      `<button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" value="confirm" type="submit">${escapeHtml(confirmLabel)}</button>`,
      // конец ряда кнопок
      '</div>',
      // конец формы
      '</form>',
    // склеиваем
    ].join('');
    // добавляем окно на страницу
    document.body.append(dialog);
    // флаг «ответ уже получен» — защита от двойного срабатывания
    let answered = false;
    // finish — закрывает окно и отдаёт ответ; вызывается один раз
    const finish = (confirmed) => {
      // если ответ уже был — ничего не делаем
      if (answered) return;
      // запоминаем, что ответ получен
      answered = true;
      // текст из поля ввода; ?. — если поля нет
      const value = dialog.querySelector('textarea')?.value.trim() ?? '';
      // close — закрыть окно
      dialog.close();
      // удаляем окно со страницы
      dialog.remove();
      // выполняем обещание — возвращаем ответ тому, кто ждёт через await
      resolve({ confirmed, value });
    // конец функции finish
    };
    // submit — нажали одну из кнопок; event.submitter — какая именно кнопка
    dialog.querySelector('form').addEventListener('submit', (event) => {
      // отменяем стандартное закрытие — закроем сами в finish
      event.preventDefault();
      // true, если у нажатой кнопки value="confirm"
      const confirmed = event.submitter?.value === 'confirm';
      // поле ввода (null, если его нет)
      const textarea = dialog.querySelector('textarea');
      // минимальная длина текста; ?. и ?? — 0, если поля нет или минимум не задан
      const minLength = input?.minLength ?? 0;
      // подтверждают, но текста мало — окно НЕ закрываем, показываем ошибку под полем
      if (confirmed && textarea && textarea.value.trim().length < minLength) {
        // место для текста ошибки
        const errorBox = dialog.querySelector('.field-error');
        // текст ошибки: свой (requiredMessage) или стандартный
        errorBox.textContent = input.requiredMessage ?? `Напиши хотя бы ${minLength} символа`;
        // hidden = false — показываем ошибку
        errorBox.hidden = false;
        // красная рамка у поля
        textarea.classList.add('is-invalid');
        // курсор обратно в поле
        textarea.focus();
        // стоп — ждём, пока пользователь допишет
        return;
      // конец if
      }
      // отдаём ответ и закрываем окно
      finish(confirmed);
    // конец обработчика
    });
    // input — пользователь печатает в поле: убираем подсветку ошибки; ?. — если поля нет
    dialog.querySelector('textarea')?.addEventListener('input', (event) => {
      // убираем красную рамку
      event.target.classList.remove('is-invalid');
      // прячем текст ошибки
      dialog.querySelector('.field-error').hidden = true;
    // конец обработчика
    });
    // cancel — нажали клавишу Esc: это ответ «нет»
    dialog.addEventListener('cancel', (event) => {
      // отменяем стандартное закрытие
      event.preventDefault();
      // ответ «нет»
      finish(false);
    // конец обработчика
    });
    // showModal — показать окно поверх страницы с затемнением фона
    dialog.showModal();
    // курсор в поле ввода (если есть), иначе на кнопку отмены — безопаснее для опасных действий
    (dialog.querySelector('textarea') ?? dialog.querySelector('[value="cancel"]')).focus();
  // конец Promise
  });
// конец функции openDialog
}

// ----------------------------------------------------------------------------
// confirmAction — короткий вариант: «Да / Отмена», возвращает только true/false.
// Принимает: те же настройки, что openDialog (без input).
// Возвращает: Promise<boolean>.
// ----------------------------------------------------------------------------
// export async function
export async function confirmAction(options) {
  // ждём ответа окна и берём только confirmed
  const { confirmed } = await openDialog(options);
  // возвращаем true или false
  return confirmed;
// конец функции confirmAction
}
