// ============================================================================
// Файл: js/pages/landing.js
// Зачем нужен: «оживляет» главную страницу index.html:
//   1) подключает кнопку смены темы;
//   2) рисует облако предметов из списка SUBJECTS;
//   3) ставит текущий год в подвал;
//   4) если пользователь уже вошёл, меняет кнопки «Регистрация / Вход»
//      на одну кнопку «Открыть SkillSwap»;
//   5) запускает анимации «пара» и «тройка».
// Как связан с остальными: подключается в index.html как модуль и берёт
// функции из js/theme.js, js/config.js, js/supabase.js, js/utils.js и
// js/landing-animation.js.
// ============================================================================

// import { ... } from '...' — берём нужные функции и данные из других модулей; ../ — подняться на папку выше
import { initThemeToggle } from '../theme.js';
// список предметов с иконками
import { SUBJECTS } from '../config.js';
// подключение к Supabase и флаг «ключи вставлены»
import { supabase, isSupabaseConfigured } from '../supabase.js';
// функция экранирования текста
import { escapeHtml } from '../utils.js';
// анимации подбора пары и тройки
import { initPairDemo, initTriadDemo } from '../landing-animation.js';

// ----------------------------------------------------------------------------
// renderSubjects — рисует плашки всех предметов на главной странице.
// Принимает: ничего. Возвращает: ничего.
// ----------------------------------------------------------------------------
// function — объявление функции
function renderSubjects() {
  // getElementById ищет элемент по его атрибуту id (без решётки)
  const container = document.getElementById('subjects-list');
  // если на странице нет такого блока, выходим
  if (!container) return;
  // map превращает каждый предмет в строку HTML; join('') склеивает все строки в одну
  container.innerHTML = SUBJECTS.map((subject) => `<span class="chip">${subject.icon} ${escapeHtml(subject.name)}</span>`).join('');
// конец функции renderSubjects
}

// ----------------------------------------------------------------------------
// showLoggedInButtons — заменяет кнопки «Регистрация / Вход» на
// «Открыть SkillSwap» (для тех, кто уже вошёл).
// Принимает: ничего. Возвращает: ничего.
// ----------------------------------------------------------------------------
// function — объявление функции
function showLoggedInButtons() {
  // querySelectorAll находит ВСЕ элементы по селектору; [data-guest-link] — элементы с таким атрибутом
  const guestLinks = document.querySelectorAll('[data-guest-link]');
  // forEach выполняет функцию для каждого найденного элемента; hidden = true прячет ссылку
  guestLinks.forEach((link) => { link.hidden = true; });
  // находим кнопку «Открыть SkillSwap» в шапке
  const appLink = document.getElementById('header-app-link');
  // если кнопка есть, показываем её (hidden = false)
  if (appLink) appLink.hidden = false;
  // одинаковый HTML-код кнопки для первого экрана и для блока призыва
  const appButton = '<a class="btn btn-primary btn-lg" href="/pages/matches.html">Открыть SkillSwap</a>';
  // находим блок кнопок на первом экране
  const heroActions = document.getElementById('hero-actions');
  // заменяем его содержимое кнопкой
  if (heroActions) heroActions.innerHTML = appButton;
  // находим блок кнопок внизу страницы
  const ctaActions = document.getElementById('cta-actions');
  // на цветном фоне нужна белая кнопка, поэтому свой класс cta-btn
  if (ctaActions) ctaActions.innerHTML = '<a class="btn btn-lg cta-btn" href="/pages/matches.html">Открыть SkillSwap</a>';
// конец функции showLoggedInButtons
}

// ----------------------------------------------------------------------------
// checkSession — проверяет, вошёл ли пользователь.
// async означает, что функция асинхронная: внутри можно ждать ответа сервера
// через await, не «замораживая» страницу.
// Принимает: ничего. Возвращает: Promise (обещание результата), без значения.
// ----------------------------------------------------------------------------
// async function — асинхронная функция
async function checkSession() {
  // если ключи Supabase ещё не вставлены, проверять нечего — остаются кнопки для гостей
  if (!isSupabaseConfigured) return;
  // try — запрос может завершиться ошибкой (нет интернета), ловим её
  try {
    // await ждёт ответа; getSession читает сохранённую в браузере сессию входа; { data, error } — берём из ответа два поля (деструктуризация)
    const { data, error } = await supabase.auth.getSession();
    // throw «бросает» ошибку — выполнение сразу перейдёт в блок catch
    if (error) throw error;
    // data.session есть только у вошедшего пользователя
    if (data.session) showLoggedInButtons();
  // catch — сюда попадаем при любой ошибке в try
  } catch (error) {
    // на главной странице ошибка не критична: просто пишем её в консоль как предупреждение, кнопки для гостей остаются
    console.warn('Не удалось проверить вход:', error);
  // конец try/catch
  }
// конец функции checkSession
}

// --- запуск: этот код выполняется сразу после загрузки модуля ---

// подключаем кнопку смены темы; getElementById находит кнопку по id
initThemeToggle(document.getElementById('theme-toggle'));
// рисуем облако предметов
renderSubjects();
// анимация пары на первом экране
initPairDemo(document.getElementById('pair-demo'));
// анимация тройки и синхронный с ней список шагов
initTriadDemo(document.getElementById('triad-demo'), document.getElementById('triad-steps'));
// находим место для года в подвале
const yearElement = document.getElementById('year');
// new Date() — текущие дата и время; getFullYear() — год четырьмя цифрами; String превращает число в строку
if (yearElement) yearElement.textContent = String(new Date().getFullYear());
// проверяем вход; await здесь не пишем — пусть проверка идёт в фоне, страница уже показана
checkSession();
