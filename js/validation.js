// ============================================================================
// Файл: js/validation.js
// Зачем нужен: проверка полей форм (пустые поля, неверный email, короткий
// пароль, неправильное имя) и показ понятных ошибок на русском под полями.
// Как связан с остальными: его импортируют страницы с формами:
// js/pages/register.js, login.js, forgot-password.js, reset-password.js,
// profile.js. Красная рамка и текст ошибки оформлены в css/components.css
// (классы .is-invalid и .field-error).
// ============================================================================

// MIN_PASSWORD_LENGTH — минимальная длина пароля (константа в одном месте, чтобы легко поменять)
export const MIN_PASSWORD_LENGTH = 8;

// EMAIL_PATTERN — регулярное выражение (шаблон) для email: что-то@что-то.что-то; ^ — начало строки, $ — конец, [^\s@]+ — один или больше символов, кроме пробела и @
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// NAME_PATTERN — имя или фамилия: только буквы любого алфавита (\p{L}), пробел, дефис и апострофы (для узбекских o‘ и g‘); флаг u включает поддержку Unicode
const NAME_PATTERN = /^[\p{L}][\p{L}\s'’‘ʻ-]*$/u;

// ----------------------------------------------------------------------------
// validateEmail — проверяет email.
// Принимает: value — текст из поля. Возвращает: текст ошибки или '' (пустая строка — ошибок нет).
// ----------------------------------------------------------------------------
// export function — функцию используют другие файлы
export function validateEmail(value) {
  // trim() убирает пробелы в начале и в конце
  const email = value.trim();
  // пустое поле; === — строгое сравнение (значение и тип совпадают)
  if (email === '') return 'Введи email';
  // test проверяет, подходит ли строка под шаблон
  if (!EMAIL_PATTERN.test(email)) return 'Email выглядит неправильно. Пример: amir@mail.uz';
  // ошибок нет
  return '';
// конец функции validateEmail
}

// ----------------------------------------------------------------------------
// validatePassword — проверяет пароль.
// Принимает: value — пароль. Возвращает: текст ошибки или ''.
// ----------------------------------------------------------------------------
// export function
export function validatePassword(value) {
  // пароль не обрезаем по пробелам: пробел тоже может быть частью пароля
  if (value === '') return 'Введи пароль';
  // .length — количество символов в строке
  if (value.length < MIN_PASSWORD_LENGTH) return `Пароль слишком короткий: нужно минимум ${MIN_PASSWORD_LENGTH} символов`;
  // ошибок нет
  return '';
// конец функции validatePassword
}

// ----------------------------------------------------------------------------
// validateName — проверяет имя или фамилию.
// Принимает: value — текст; label — «Имя» или «Фамилия» для сообщения.
// Возвращает: текст ошибки или ''.
// ----------------------------------------------------------------------------
// export function
export function validateName(value, label) {
  // убираем пробелы по краям
  const name = value.trim();
  // пустое поле
  if (name === '') return `Заполни поле «${label}»`;
  // слишком длинное; 40 — такое же ограничение стоит в базе (schema.sql)
  if (name.length > 40) return `${label}: не больше 40 символов`;
  // цифры и знаки вроде < > не допускаем
  if (!NAME_PATTERN.test(name)) return `${label}: используй только буквы`;
  // ошибок нет
  return '';
// конец функции validateName
}

// ----------------------------------------------------------------------------
// showFieldError — показывает ошибку под полем (или убирает её).
// Принимает: input — поле; message — текст ошибки ('' — убрать ошибку).
// Возвращает: ничего.
// ----------------------------------------------------------------------------
// export function
export function showFieldError(input, message) {
  // если поля нет, выходим
  if (!input) return;
  // рядом с полем лежит элемент для ошибки с id вида «email-error»
  const errorElement = document.getElementById(`${input.id}-error`);
  // Boolean(message) — true, если строка не пустая; включаем или выключаем красную рамку
  input.classList.toggle('is-invalid', Boolean(message));
  // aria-invalid сообщает программам чтения с экрана, что в поле ошибка
  input.setAttribute('aria-invalid', String(Boolean(message)));
  // если элемента для текста ошибки нет — дальше делать нечего
  if (!errorElement) return;
  // текст ошибки (textContent безопасен: HTML не выполнится)
  errorElement.textContent = message;
  // прячем пустой элемент, чтобы он не занимал место
  errorElement.hidden = !message;
// конец функции showFieldError
}

// ----------------------------------------------------------------------------
// clearFormErrors — убирает все ошибки в форме.
// Принимает: form — элемент формы. Возвращает: ничего.
// ----------------------------------------------------------------------------
// export function
export function clearFormErrors(form) {
  // находим все поля с красной рамкой и снимаем её
  form.querySelectorAll('.is-invalid').forEach((input) => showFieldError(input, ''));
  // общий блок ошибки формы (если есть) прячем
  const formError = form.querySelector('[data-form-error]');
  // hidden = true — скрыть
  if (formError) formError.hidden = true;
// конец функции clearFormErrors
}

// ----------------------------------------------------------------------------
// showFormError — показывает общую ошибку над кнопкой формы
// (например, «Неверный email или пароль»).
// Принимает: form — форма; message — текст. Возвращает: ничего.
// ----------------------------------------------------------------------------
// export function
export function showFormError(form, message) {
  // блок с атрибутом data-form-error внутри формы
  const formError = form.querySelector('[data-form-error]');
  // если блока нет — выходим
  if (!formError) return;
  // вставляем текст
  formError.textContent = message;
  // показываем блок
  formError.hidden = false;
// конец функции showFormError
}

// ----------------------------------------------------------------------------
// focusFirstError — ставит курсор в первое поле с ошибкой, чтобы ученику
// не пришлось его искать.
// Принимает: form. Возвращает: ничего.
// ----------------------------------------------------------------------------
// export function
export function focusFirstError(form) {
  // первое поле с классом is-invalid
  const firstInvalid = form.querySelector('.is-invalid');
  // ?. — если такого поля нет, focus() просто не вызовется
  firstInvalid?.focus();
// конец функции focusFirstError
}
