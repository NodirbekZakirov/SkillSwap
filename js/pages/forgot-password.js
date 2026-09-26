// ============================================================================
// Файл: js/pages/forgot-password.js
// Зачем нужен: отправляет письмо для восстановления пароля
// (supabase.auth.resetPasswordForEmail). Ссылка в письме ведёт на
// pages/reset-password.html.
// Как связан с остальными: использует js/layout.js, js/supabase.js,
// js/utils.js, js/validation.js.
// ============================================================================

// запуск страницы гостя
import { initGuestPage } from '../layout.js';
// подключение к Supabase
import { supabase } from '../supabase.js';
// защита кнопки и понятные ошибки
import { setButtonLoading, getErrorMessage, logError } from '../utils.js';
// проверки
import { validateEmail, showFieldError, clearFormErrors, showFormError } from '../validation.js';

// форма
const form = document.getElementById('forgot-form');

// ----------------------------------------------------------------------------
// handleSubmit — отправка формы: проверяем email и просим Supabase прислать письмо.
// Принимает: event. Возвращает: Promise.
// ----------------------------------------------------------------------------
// async function
async function handleSubmit(event) {
  // не перезагружаем страницу
  event.preventDefault();
  // кнопка
  const button = document.getElementById('forgot-button');
  // защита от двойного нажатия
  if (button.disabled) return;
  // убираем старые ошибки
  clearFormErrors(form);
  // email
  const email = form.email.value.trim().toLowerCase();
  // проверка
  const emailError = validateEmail(email);
  // показываем ошибку (или убираем)
  showFieldError(form.email, emailError);
  // если ошибка — курсор в поле и стоп
  if (emailError) {
    // курсор в поле
    form.email.focus();
    // стоп
    return;
  // конец if
  }
  // включаем «загрузку»
  setButtonLoading(button, true);
  // try — запрос
  try {
    // resetPasswordForEmail отправляет письмо; redirectTo — адрес страницы, куда приведёт ссылка
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}/pages/reset-password.html` });
    // ошибка — в catch
    if (error) throw error;
    // прячем форму
    form.hidden = true;
    // показываем сообщение (одинаковое, есть такой email или нет — так нельзя узнать, кто зарегистрирован)
    document.getElementById('forgot-success').hidden = false;
  // catch — ошибка
  } catch (error) {
    // в консоль
    logError(error);
    // понятный текст
    showFormError(form, getErrorMessage(error));
  // finally — всегда выключаем «загрузку»
  } finally {
    // кнопка снова активна
    setButtonLoading(button, false);
  // конец try/catch/finally
  }
// конец функции handleSubmit
}

// --- запуск страницы ---

// эту страницу можно открывать и вошедшим, поэтому redirectIfLoggedIn не указываем
const canShow = await initGuestPage();
// если можно показывать
if (canShow) {
  // подписываемся на отправку
  form.addEventListener('submit', handleSubmit);
// конец if
}
