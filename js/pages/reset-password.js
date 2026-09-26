// ============================================================================
// Файл: js/pages/reset-password.js
// Зачем нужен: страница pages/reset-password.html — задаёт новый пароль.
// Ссылка из письма содержит временный ключ. Библиотека supabase-js при
// загрузке сама читает его из адреса и создаёт сессию восстановления.
// Если сессии нет — ссылка неверная или устарела.
// Как связан с остальными: использует js/layout.js, js/auth.js,
// js/supabase.js, js/utils.js, js/validation.js.
// ============================================================================

// запуск страницы гостя
import { initGuestPage } from '../layout.js';
// подключение к Supabase
import { supabase } from '../supabase.js';
// сессия, профиль, главная страница роли
import { getSession, getMyProfile, getHomePage } from '../auth.js';
// защита кнопки и понятные ошибки
import { setButtonLoading, getErrorMessage, logError } from '../utils.js';
// проверки
import { validatePassword, showFieldError, clearFormErrors, showFormError, focusFirstError } from '../validation.js';

// форма
const form = document.getElementById('reset-form');

// ----------------------------------------------------------------------------
// handleSubmit — сохраняет новый пароль.
// Принимает: event. Возвращает: Promise.
// ----------------------------------------------------------------------------
// async function
async function handleSubmit(event) {
  // не перезагружаем страницу
  event.preventDefault();
  // кнопка
  const button = document.getElementById('reset-button');
  // защита от двойного нажатия
  if (button.disabled) return;
  // убираем старые ошибки
  clearFormErrors(form);
  // новый пароль
  const password = form.password.value;
  // проверка длины
  const passwordError = validatePassword(password);
  // повтор должен совпадать
  const confirmError = form.password_confirm.value !== password ? 'Пароли не совпадают' : '';
  // показываем ошибки
  showFieldError(form.password, passwordError);
  // под повтором
  showFieldError(form.password_confirm, confirmError);
  // если есть ошибки — стоп
  if (passwordError || confirmError) {
    // курсор в первое поле с ошибкой
    focusFirstError(form);
    // выходим
    return;
  // конец if
  }
  // «загрузка»
  setButtonLoading(button, true);
  // try — запрос
  try {
    // updateUser меняет данные вошедшего пользователя; здесь — пароль
    const { data, error } = await supabase.auth.updateUser({ password });
    // ошибка — в catch
    if (error) throw error;
    // прячем форму
    form.hidden = true;
    // показываем успех
    document.getElementById('reset-success').hidden = false;
    // узнаём роль, чтобы открыть нужную страницу
    const profile = await getMyProfile(data.user.id);
    // через 1.5 секунды переходим на главную страницу роли
    setTimeout(() => { location.href = getHomePage(profile?.role); }, 1500);
  // catch — ошибка
  } catch (error) {
    // в консоль
    logError(error);
    // понятный текст
    showFormError(form, getErrorMessage(error));
    // кнопка снова активна
    setButtonLoading(button, false);
  // конец try/catch
  }
// конец функции handleSubmit
}

// ----------------------------------------------------------------------------
// start — проверяет ссылку и показывает форму или сообщение об ошибке.
// Принимает: ничего. Возвращает: Promise.
// ----------------------------------------------------------------------------
// async function
async function start() {
  // шапка и проверка ключей; вошедших НЕ уводим — им тоже нужна эта форма
  const canShow = await initGuestPage();
  // ключи не вставлены — сообщение уже показано
  if (!canShow) return;
  // try — чтение сессии
  try {
    // getSession дожидается, пока supabase-js обработает ключ из адреса ссылки
    const session = await getSession();
    // сессии нет — ссылка плохая
    if (!session) {
      // показываем предупреждение
      document.getElementById('reset-invalid').hidden = false;
      // стоп
      return;
    // конец if
    }
    // сессия есть — показываем форму
    form.hidden = false;
    // подписываемся на отправку
    form.addEventListener('submit', handleSubmit);
    // курсор в поле пароля
    form.password.focus();
  // catch — ошибка чтения сессии
  } catch (error) {
    // в консоль
    logError(error);
    // показываем предупреждение о ссылке
    document.getElementById('reset-invalid').hidden = false;
  // конец try/catch
  }
// конец функции start
}

// запускаем страницу
start();
