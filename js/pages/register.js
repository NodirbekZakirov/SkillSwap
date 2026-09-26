// ============================================================================
// Файл: js/pages/register.js
// Зачем нужен: логика страницы регистрации pages/register.html:
//   1) заполняет списки школ (из базы), классов и аватаров;
//   2) проверяет поля формы и показывает ошибки на русском;
//   3) регистрирует ученика через Supabase Auth (signUp).
// Имя, фамилия, школа, класс и аватар передаются в options.data — база
// сохраняет их в raw_user_meta_data, и триггер handle_new_user (sql/schema.sql)
// создаёт из них профиль.
// Как связан с остальными: использует js/layout.js, js/supabase.js,
// js/config.js, js/ui.js, js/utils.js, js/validation.js.
// ============================================================================

// запуск страницы гостя
import { initGuestPage } from '../layout.js';
// подключение к Supabase
import { supabase } from '../supabase.js';
// список классов и аватар по умолчанию
import { GRADES, DEFAULT_AVATAR } from '../config.js';
// выбор аватара и чтение выбранной радиокнопки
import { avatarPickerHtml, getCheckedValue } from '../ui.js';
// экранирование, защита кнопки, понятные ошибки
import { escapeHtml, setButtonLoading, getErrorMessage, logError } from '../utils.js';
// проверки полей
import { validateEmail, validatePassword, validateName, showFieldError, clearFormErrors, showFormError, focusFirstError } from '../validation.js';

// querySelector по id формы — находим форму один раз и запоминаем
const form = document.getElementById('register-form');

// ----------------------------------------------------------------------------
// fillGrades — заполняет список классов 1–11.
// Принимает: ничего. Возвращает: ничего.
// ----------------------------------------------------------------------------
// function
function fillGrades() {
  // список классов
  const select = document.getElementById('grade');
  // для каждого класса создаём <option>; insertAdjacentHTML('beforeend', ...) добавляет HTML в конец элемента
  GRADES.forEach((grade) => select.insertAdjacentHTML('beforeend', `<option value="${grade}">${grade} класс</option>`));
// конец функции fillGrades
}

// ----------------------------------------------------------------------------
// loadSchools — загружает список школ из базы и заполняет выпадающий список.
// Список школ виден даже гостю (правило schools_select_all в schema.sql).
// Принимает: ничего. Возвращает: Promise.
// ----------------------------------------------------------------------------
// async function
async function loadSchools() {
  // список школ на странице
  const select = document.getElementById('school');
  // try — запрос может не пройти
  try {
    // select('id, name, city') — нужные столбцы; order('name') — по алфавиту
    const { data, error } = await supabase.from('schools').select('id, name, city').order('name');
    // ошибка — в catch
    if (error) throw error;
    // школ ещё нет — администратор их не добавил
    if (data.length === 0) {
      // понятный текст вместо пустого списка
      select.innerHTML = '<option value="">Школ пока нет — попроси администратора добавить</option>';
      // выходим
      return;
    // конец if
    }
    // первый пункт-подсказка
    const placeholder = '<option value="">Выбери школу</option>';
    // пункты школ; название и город экранируем — их ввёл администратор
    const options = data.map((school) => `<option value="${school.id}">${escapeHtml(school.name)}${school.city ? `, ${escapeHtml(school.city)}` : ''}</option>`).join('');
    // вставляем всё в список
    select.innerHTML = placeholder + options;
  // catch — ошибка загрузки
  } catch (error) {
    // подробности для разработчика
    logError(error);
    // пункт с сообщением
    select.innerHTML = '<option value="">Не удалось загрузить школы</option>';
    // понятная ошибка над кнопкой
    showFormError(form, getErrorMessage(error));
  // конец try/catch
  }
// конец функции loadSchools
}

// ----------------------------------------------------------------------------
// validateForm — проверяет все поля и показывает ошибки.
// Принимает: values — объект со значениями полей.
// Возвращает: true, если ошибок нет.
// ----------------------------------------------------------------------------
// function
function validateForm(values) {
  // объект «поле → текст ошибки»; пустая строка — ошибки нет
  const errors = {
    // имя
    'first-name': validateName(values.firstName, 'Имя'),
    // фамилия
    'last-name': validateName(values.lastName, 'Фамилия'),
    // email
    email: validateEmail(values.email),
    // пароль
    password: validatePassword(values.password),
    // повтор пароля должен совпадать
    'password-confirm': values.passwordConfirm !== values.password ? 'Пароли не совпадают' : '',
    // школа обязательна
    school: values.schoolId ? '' : 'Выбери школу из списка',
    // класс обязателен
    grade: values.grade ? '' : 'Выбери класс',
  // конец объекта
  };
  // Object.entries превращает объект в массив пар [ключ, значение]; для каждой пары показываем ошибку под полем
  Object.entries(errors).forEach(([fieldId, message]) => showFieldError(document.getElementById(fieldId), message));
  // Object.values — массив значений; every — true, если для КАЖДОГО значения условие верно (все ошибки пустые)
  return Object.values(errors).every((message) => message === '');
// конец функции validateForm
}

// ----------------------------------------------------------------------------
// handleSubmit — обработчик отправки формы.
// Принимает: event — событие отправки. Возвращает: Promise.
// ----------------------------------------------------------------------------
// async function
async function handleSubmit(event) {
  // preventDefault отменяет стандартное поведение — перезагрузку страницы при отправке формы
  event.preventDefault();
  // кнопка отправки
  const button = document.getElementById('register-button');
  // если кнопка уже отключена (идёт отправка) — второй раз не отправляем
  if (button.disabled) return;
  // убираем старые ошибки
  clearFormErrors(form);
  // собираем значения полей в один объект; .value — текст в поле
  const values = {
    // имя без пробелов по краям
    firstName: form.first_name.value.trim(),
    // фамилия
    lastName: form.last_name.value.trim(),
    // email маленькими буквами
    email: form.email.value.trim().toLowerCase(),
    // пароль как есть
    password: form.password.value,
    // повтор пароля
    passwordConfirm: form.password_confirm.value,
    // id школы
    schoolId: form.school_id.value,
    // класс
    grade: form.grade.value,
    // выбранный аватар (или аватар по умолчанию)
    avatar: getCheckedValue(form, 'avatar') ?? DEFAULT_AVATAR,
  // конец объекта
  };
  // есть ошибки — показываем первую и выходим
  if (!validateForm(values)) {
    // курсор в первое поле с ошибкой
    focusFirstError(form);
    // стоп
    return;
  // конец if
  }
  // включаем «загрузку»: кнопка отключается (защита от двойного нажатия)
  setButtonLoading(button, true);
  // try — запрос к Supabase
  try {
    // signUp — регистрация по email и паролю
    const { data, error } = await supabase.auth.signUp({
      // email
      email: values.email,
      // пароль
      password: values.password,
      // дополнительные настройки
      options: {
        // data — эти поля попадут в raw_user_meta_data, их прочитает триггер handle_new_user
        data: {
          // имя
          first_name: values.firstName,
          // фамилия
          last_name: values.lastName,
          // id школы (строкой — триггер проверит, что это число)
          school_id: values.schoolId,
          // класс
          grade: values.grade,
          // аватар
          avatar: values.avatar,
        // конец data
        },
        // куда вернётся ученик после клика по ссылке подтверждения в письме; location.origin — адрес нашего сайта
        emailRedirectTo: `${location.origin}/pages/login.html`,
      // конец options
      },
    // конец signUp
    });
    // ошибка — в catch
    if (error) throw error;
    // Supabase не говорит прямо, что email занят (защита от подбора адресов), но у такого пользователя пустой список identities
    if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
      // показываем ошибку под email
      showFieldError(form.email, 'Этот email уже зарегистрирован. Попробуй войти.');
      // курсор в поле
      form.email.focus();
      // стоп
      return;
    // конец if
    }
    // если подтверждение email отключено, сессия появляется сразу — ведём заполнять профиль
    if (data.session) {
      // ?welcome=1 — профиль покажет приветствие
      location.href = '/pages/profile.html?welcome=1';
      // стоп
      return;
    // конец if
    }
    // иначе нужно подтвердить email: прячем форму
    form.hidden = true;
    // показываем блок «Проверь почту»
    document.getElementById('register-success').hidden = false;
  // catch — ошибка регистрации
  } catch (error) {
    // подробности в консоль
    logError(error);
    // понятное сообщение над кнопкой
    showFormError(form, getErrorMessage(error));
  // finally — выполняется ВСЕГДА, и после успеха, и после ошибки
  } finally {
    // выключаем «загрузку»
    setButtonLoading(button, false);
  // конец try/catch/finally
  }
// конец функции handleSubmit
}

// --- запуск страницы ---

// await на верхнем уровне модуля разрешён; проверяем ключи и уводим уже вошедших
const canShow = await initGuestPage({ redirectIfLoggedIn: true });
// если страницу можно показывать (иначе функция уже показала сообщение или переход)
if (canShow) {
  // вставляем сетку аватаров, первый выбран по умолчанию
  document.getElementById('avatar-picker').innerHTML = avatarPickerHtml('avatar', DEFAULT_AVATAR);
  // заполняем классы
  fillGrades();
  // загружаем школы (await — ждём, чтобы список был готов)
  await loadSchools();
  // подписываемся на отправку формы
  form.addEventListener('submit', handleSubmit);
// конец if
}
