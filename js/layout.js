// ============================================================================
// Файл: js/layout.js
// Зачем нужен: общий «каркас» всех страниц сайта:
//   • initPage — для страниц ВНУТРИ сайта: проверяет вход и роль, загружает
//     профиль, рисует шапку с меню и нижнее меню на телефоне;
//   • initGuestPage — для страниц входа и регистрации: простая шапка.
// Как связан с остальными: каждый скрипт в js/pages/ первым делом вызывает
// initPage или initGuestPage. В HTML страницы должны быть элементы
// <header id="app-header"> и <main> с <div id="page">.
// Функции входа берутся из js/auth.js, кнопка темы — из js/theme.js.
// Проверка роли здесь — только для удобства; настоящая защита данных — RLS в базе.
// ============================================================================

// проверка, вставлены ли ключи Supabase
import { isSupabaseConfigured, configProblem } from './supabase.js';
// функции входа
import { getSession, getMyProfile, getHomePage, formatName, signOut, clearLocalSession } from './auth.js';
// кнопка смены темы
import { initThemeToggle } from './theme.js';
// экранирование, состояния экрана, понятные ошибки
import { escapeHtml, renderState, getErrorMessage, logError } from './utils.js';
// колокольчик уведомлений
import { initNotificationBell } from './notifications.js';
// значок серии «🔥 5» в шапке
import { initStreakChip } from './streaks.js';

// NAV_ITEMS — пункты меню для каждой роли: id (для подсветки), адрес, иконка, подпись
const NAV_ITEMS = {
  // меню ученика
  student: [
    // экран совпадений; short — короткая подпись для нижнего меню телефона (длинная не влезает)
    { id: 'matches', href: '/pages/matches.html', icon: '🔍', label: 'Совпадения', short: 'Подбор' },
    // партнёры и запросы
    { id: 'partners', href: '/pages/partners.html', icon: '🤝', label: 'Партнёры' },
    // занятия
    { id: 'lessons', href: '/pages/lessons.html', icon: '📅', label: 'Занятия' },
    // вопросы и ответы
    { id: 'questions', href: '/pages/questions.html', icon: '❓', label: 'Вопросы' },
    // рейтинг школы
    { id: 'leaderboard', href: '/pages/leaderboard.html', icon: '🏆', label: 'Рейтинг' },
    // свой профиль
    { id: 'profile', href: '/pages/profile.html', icon: '👤', label: 'Профиль' },
  // конец меню ученика
  ],
  // меню учителя
  teacher: [
    // панель учителя
    { id: 'teacher', href: '/pages/teacher.html', icon: '🛡️', label: 'Панель учителя' },
    // вопросы учеников всех школ (только просмотр)
    { id: 'questions', href: '/pages/questions.html', icon: '❓', label: 'Вопросы' },
    // профиль
    { id: 'profile', href: '/pages/profile.html', icon: '👤', label: 'Профиль' },
  // конец меню учителя
  ],
  // меню администратора
  admin: [
    // панель администратора
    { id: 'admin', href: '/pages/admin.html', icon: '⚙️', label: 'Администратор' },
    // вопросы всех школ
    { id: 'questions', href: '/pages/questions.html', icon: '❓', label: 'Вопросы' },
    // профиль
    { id: 'profile', href: '/pages/profile.html', icon: '👤', label: 'Профиль' },
  // конец меню администратора
  ],
// конец объекта NAV_ITEMS
};

// ----------------------------------------------------------------------------
// logoHtml — HTML-код логотипа.
// Принимает: href — куда ведёт логотип. Возвращает: строку HTML.
// ----------------------------------------------------------------------------
// function без export — нужна только в этом файле
function logoHtml(href) {
  // возвращаем ссылку с цветным значком и названием
  return `<a class="logo" href="${href}" aria-label="SkillSwap — на главную"><span class="logo-mark" aria-hidden="true">⇄</span><span>SkillSwap</span></a>`;
// конец функции logoHtml
}

// ----------------------------------------------------------------------------
// renderAppHeader — рисует шапку и нижнее меню для вошедшего пользователя.
// Принимает: profile — профиль; active — id текущего пункта меню.
// Возвращает: ничего.
// ----------------------------------------------------------------------------
// function
function renderAppHeader(profile, active) {
  // пункты меню для роли пользователя; ?? [] — если роли нет в словаре, пустой список
  const items = NAV_ITEMS[profile.role] ?? [];
  // map превращает каждый пункт в HTML-ссылку; aria-current="page" отмечает текущую страницу для программ чтения с экрана;
  // title — подсказка при наведении (на средних экранах у неактивных пунктов видна только иконка, см. .nav-label в css/pages.css)
  const links = items.map((item) => `<a class="nav-link${item.id === active ? ' active' : ''}" href="${item.href}" title="${item.label}"${item.id === active ? ' aria-current="page"' : ''}><span aria-hidden="true">${item.icon}</span><span class="nav-label">${item.label}</span></a>`).join('');
  // такие же пункты для нижнего меню телефона: иконка сверху, подпись снизу (короткая short, если есть; ?? — иначе обычная)
  const bottomLinks = items.map((item) => `<a class="bottom-nav-link${item.id === active ? ' active' : ''}" href="${item.href}"><span class="bottom-nav-icon" aria-hidden="true">${item.icon}</span><span class="bottom-nav-label">${item.short ?? item.label}</span></a>`).join('');
  // находим место для шапки
  const header = document.getElementById('app-header');
  // собираем HTML шапки из частей
  header.innerHTML = [
    // контейнер шапки
    '<div class="container header-inner">',
    // логотип ведёт на главную страницу роли
    logoHtml(getHomePage(profile.role)),
    // меню ссылок (на телефоне скрыто через CSS)
    `<nav class="main-nav" aria-label="Главное меню">${links}</nav>`,
    // блок кнопок справа
    '<div class="header-actions" id="header-actions">',
    // имя и аватар пользователя; escapeHtml — имя ввёл пользователь, поэтому экранируем
    `<a class="header-user" href="/pages/profile.html" title="Мой профиль"><span class="avatar avatar-sm">${escapeHtml(profile.avatar)}</span><span class="header-user-name">${escapeHtml(formatName(profile))}</span></a>`,
    // кнопка смены темы
    '<button class="icon-btn" id="theme-toggle" type="button" aria-label="Сменить тему">🌙</button>',
    // кнопка выхода
    '<button class="icon-btn" id="logout-button" type="button" aria-label="Выйти" title="Выйти">🚪</button>',
    // закрываем блок кнопок
    '</div>',
    // закрываем контейнер
    '</div>',
  // склеиваем части
  ].join('');
  // создаём нижнее меню (для телефона)
  const bottomNav = document.createElement('nav');
  // классы для стилей
  bottomNav.className = 'bottom-nav';
  // подпись для программ чтения с экрана
  bottomNav.setAttribute('aria-label', 'Нижнее меню');
  // вставляем ссылки
  bottomNav.innerHTML = bottomLinks;
  // добавляем меню в конец страницы
  document.body.append(bottomNav);
  // класс для body: снизу появится отступ под меню
  document.body.classList.add('has-bottom-nav');
  // подключаем кнопку темы
  initThemeToggle(document.getElementById('theme-toggle'));
  // по клику на «Выйти» вызываем signOut
  document.getElementById('logout-button').addEventListener('click', signOut);
  // колокольчик уведомлений в блок кнопок шапки; без await — страница не ждёт уведомлений; catch — ошибку только в консоль
  initNotificationBell(document.getElementById('header-actions'), profile).catch(logError);
  // значок серии «🔥 5» — только у учеников; ошибки обрабатывает сама функция
  if (profile.role === 'student') initStreakChip(document.getElementById('header-actions'));
// конец функции renderAppHeader
}

// ----------------------------------------------------------------------------
// renderGuestHeader — простая шапка для гостя: логотип и кнопка темы.
// Принимает: ничего. Возвращает: ничего.
// ----------------------------------------------------------------------------
// function
function renderGuestHeader() {
  // место для шапки
  const header = document.getElementById('app-header');
  // если его нет на странице — выходим
  if (!header) return;
  // HTML шапки гостя
  header.innerHTML = [
    // контейнер
    '<div class="container header-inner">',
    // логотип ведёт на главную страницу сайта
    logoHtml('/'),
    // блок кнопок
    '<div class="header-actions">',
    // кнопка темы
    '<button class="icon-btn" id="theme-toggle" type="button" aria-label="Сменить тему">🌙</button>',
    // закрываем блок кнопок
    '</div>',
    // закрываем контейнер
    '</div>',
  // склеиваем
  ].join('');
  // подключаем кнопку темы
  initThemeToggle(document.getElementById('theme-toggle'));
// конец функции renderGuestHeader
}

// ----------------------------------------------------------------------------
// showNotConfigured — сообщение «ключи Supabase не вставлены».
// Принимает: container — куда показать. Возвращает: ничего.
// ----------------------------------------------------------------------------
// function
function showNotConfigured(container) {
  // используем общий блок состояния «ошибка»
  renderState(container, 'error', 'Сайт не подключён к базе', configProblem);
// конец функции showNotConfigured
}

// ----------------------------------------------------------------------------
// initPage — запуск страницы внутри сайта.
// 1) проверяет, что ключи Supabase вставлены;
// 2) если пользователь не вошёл — отправляет на страницу входа;
// 3) загружает профиль и рисует шапку;
// 4) если роль не подходит — показывает «Нет доступа».
// Принимает: объект { active, roles }: active — id пункта меню,
//   roles — массив разрешённых ролей (например, ['teacher']) или null (все).
// Возвращает: Promise с { user, profile } или null, если страницу
//   показывать нельзя (тогда скрипт страницы должен просто остановиться).
// ----------------------------------------------------------------------------
// { active = '', roles = null } = {} — параметры по умолчанию, если объект не передали
export async function initPage({ active = '', roles = null } = {}) {
  // главный контейнер страницы, в нём показываем состояния
  const main = document.getElementById('page');
  // ключи не вставлены
  if (!isSupabaseConfigured) {
    // простая шапка
    renderGuestHeader();
    // сообщение
    showNotConfigured(main);
    // null — страницу дальше не строим
    return null;
  // конец if
  }
  // try — запросы к Supabase
  try {
    // текущая сессия
    const session = await getSession();
    // не вошёл — на страницу входа
    if (!session) {
      // encodeURIComponent кодирует адрес, чтобы его можно было передать внутри другого адреса
      const next = encodeURIComponent(location.pathname + location.search);
      // location.replace — переход без записи в историю (кнопка «Назад» не вернёт на закрытую страницу)
      location.replace(`/pages/login.html?next=${next}`);
      // дальше ничего не делаем
      return null;
    // конец if
    }
    // загружаем свой профиль
    const profile = await getMyProfile(session.user.id);
    // профиля нет: аккаунт удалён (например, демо-данные seed.sql создали заново), а браузер ещё «помнит» старый вход
    if (!profile) {
      // забываем старый вход в этом браузере — иначе страница входа будет снова и снова присылать сюда
      await clearLocalSession();
      // на страницу входа; expired=1 — там покажем, что случилось
      location.replace('/pages/login.html?expired=1');
      // стоп
      return null;
    // конец if
    }
    // рисуем шапку и меню
    renderAppHeader(profile, active);
    // Array.isArray — проверяет, что roles — массив; includes — есть ли роль в списке
    if (Array.isArray(roles) && !roles.includes(profile.role)) {
      // сообщение об отсутствии прав
      renderState(main, 'error', 'Нет доступа', 'Эта страница не предназначена для твоей роли.');
      // стоп
      return null;
    // конец if
    }
    // всё хорошо — возвращаем пользователя и профиль
    return { user: session.user, profile };
  // catch — любая ошибка сети или базы
  } catch (error) {
    // пишем подробности в консоль для разработчика
    logError(error);
    // шапка гостя, чтобы страница не была пустой
    renderGuestHeader();
    // понятное сообщение ученику
    renderState(main, 'error', 'Не удалось загрузить страницу', getErrorMessage(error));
    // стоп
    return null;
  // конец try/catch
  }
// конец функции initPage
}

// ----------------------------------------------------------------------------
// initGuestPage — запуск страниц входа, регистрации и восстановления пароля.
// Принимает: объект { redirectIfLoggedIn } — если true и пользователь уже
//   вошёл, сразу уводим его на его главную страницу.
// Возвращает: Promise<boolean> — true, если страницу можно показывать.
// ----------------------------------------------------------------------------
// export async function
export async function initGuestPage({ redirectIfLoggedIn = false } = {}) {
  // рисуем простую шапку
  renderGuestHeader();
  // ключи не вставлены — показываем сообщение вместо формы
  if (!isSupabaseConfigured) {
    // сообщение в главный контейнер
    showNotConfigured(document.getElementById('page'));
    // форму не показываем
    return false;
  // конец if
  }
  // если вошедших надо уводить
  if (redirectIfLoggedIn) {
    // try — запросы могут не пройти
    try {
      // текущая сессия
      const session = await getSession();
      // пользователь уже вошёл
      if (session) {
        // узнаём его роль
        const profile = await getMyProfile(session.user.id);
        // профиля нет — вход «устарел» (аккаунт удалён): забываем его и показываем форму входа
        if (!profile) {
          // забываем вход
          await clearLocalSession();
          // форму показываем
          return true;
        // конец if
        }
        // уходим на его главную страницу
        location.replace(getHomePage(profile.role));
        // форму не показываем
        return false;
      // конец if
      }
    // catch — если проверить не удалось, просто показываем форму
    } catch (error) {
      // предупреждение в консоль
      console.warn('Не удалось проверить вход:', error);
    // конец try/catch
    }
  // конец if
  }
  // форму показывать можно
  return true;
// конец функции initGuestPage
}
