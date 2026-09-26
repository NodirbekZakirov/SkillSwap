// ============================================================================
// Файл: js/pages/login.js
// Зачем нужен: логика страницы входа pages/login.html: проверка полей,
// вход через Supabase Auth (signInWithPassword) и переход на нужную страницу.
// Как связан с остальными: использует js/layout.js, js/auth.js,
// js/supabase.js, js/utils.js, js/validation.js.
// ============================================================================

// запуск страницы гостя
import { initGuestPage } from '../layout.js';
// подключение к Supabase
import { supabase } from '../supabase.js';
// профиль, главная страница роли, безопасный адрес возврата
import { getMyProfile, getHomePage, getSafeNextUrl } from '../auth.js';
// защита кнопки и понятные ошибки
import { setButtonLoading, getErrorMessage, logError } from '../utils.js';
// проверки полей
import { validateEmail, showFieldError, clearFormErrors, showFormError, focusFirstError } from '../validation.js';

// форма входа
const form = document.getElementById('login-form');

// ----------------------------------------------------------------------------
// handleSubmit — обработчик отправки формы входа.
// Принимает: event — событие отправки. Возвращает: Promise.
// ----------------------------------------------------------------------------
// async function
async function handleSubmit(event) {
  // не перезагружаем страницу
  event.preventDefault();
  // кнопка входа
  const button = document.getElementById('login-button');
  // защита от двойного нажатия
  if (button.disabled) return;
  // убираем старые ошибки
  clearFormErrors(form);
  // email маленькими буквами без пробелов
  const email = form.email.value.trim().toLowerCase();
  // пароль как есть
  const password = form.password.value;
  // проверка email
  const emailError = validateEmail(email);
  // при входе проверяем только, что пароль не пустой (длину проверяли при регистрации)
  const passwordError = password === '' ? 'Введи пароль' : '';
  // показываем ошибку под email (или убираем)
  showFieldError(form.email, emailError);
  // под паролем
  showFieldError(form.password, passwordError);
  // если хоть одна ошибка — стоп
  if (emailError || passwordError) {
    // курсор в первое поле с ошибкой
    focusFirstError(form);
    // выходим
    return;
  // конец if
  }
  // отключаем кнопку на время запроса
  setButtonLoading(button, true);
  // try — запрос к Supabase
  try {
    // signInWithPassword — вход по email и паролю; при успехе supabase-js сохраняет сессию в браузере
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    // ошибка — в catch
    if (error) throw error;
    // загружаем профиль, чтобы узнать роль
    const profile = await getMyProfile(data.user.id);
    // если пришёл со страницы «?next=...» — возвращаем туда, иначе на главную страницу роли
    location.href = getSafeNextUrl() ?? getHomePage(profile?.role);
  // catch — ошибка входа
  } catch (error) {
    // подробности в консоль
    logError(error);
    // понятное сообщение («Неверный email или пароль» и т.п.)
    showFormError(form, getErrorMessage(error));
    // включаем кнопку обратно, чтобы можно было попробовать снова
    setButtonLoading(button, false);
  // конец try/catch
  }
// конец функции handleSubmit
}

// --- запуск страницы ---

// если пользователь уже вошёл (или пришёл по ссылке из письма) — сразу уводим
const canShow = await initGuestPage({ redirectIfLoggedIn: true });
// показываем форму
if (canShow) {
  // пришли после «устаревшего» входа (аккаунт удалён) — объясняем, что случилось
  if (new URLSearchParams(location.search).get('expired') === '1') showFormError(form, 'Аккаунт, в который был выполнен вход, больше не существует (например, демо-данные создали заново). Войди снова.');
  // подписываемся на отправку
  form.addEventListener('submit', handleSubmit);
  // курсор сразу в поле email — удобно
  form.email.focus();
// конец if
}
