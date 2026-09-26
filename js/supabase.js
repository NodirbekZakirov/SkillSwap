// ============================================================================
// Файл: js/supabase.js
// Зачем нужен: создаёт ОДНО подключение (клиент) к Supabase для всего сайта.
// Как связан с остальными: берёт адрес и ключ из js/config.js, а все остальные
// модули импортируют отсюда готовый объект supabase и делают через него
// запросы: supabase.from('profiles').select() и т.д.
// Библиотека supabase-js подключается прямо из интернета (CDN jsDelivr),
// поэтому сайту не нужны npm и сборщики.
// ============================================================================

// import { createClient } from '...' — берём функцию createClient из библиотеки; адрес CDN с пометкой +esm отдаёт библиотеку как ES-модуль; @2 — вторая версия
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
// импортируем адрес проекта и публичный ключ из нашего файла настроек
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

// ----------------------------------------------------------------------------
// findConfigProblem — проверяет адрес и ключ из config.js.
// Принимает: ничего.
// Возвращает: текст проблемы на русском или '' (пустая строка — всё в порядке).
// ----------------------------------------------------------------------------
// function
function findConfigProblem() {
  // includes проверяет, есть ли в строке кусочек текста; || — «ИЛИ»: адрес или ключ ещё не заменены
  if (SUPABASE_URL.includes('YOUR-PROJECT-ID') || SUPABASE_ANON_KEY.includes('YOUR-ANON-KEY')) {
    // ключи ещё не вставлены
    return 'Вставь адрес и публичный ключ Supabase в файл js/config.js — инструкция в README.md.';
  // конец if
  }
  // startsWith — начинается ли строка с текста; sb_secret_ — секретный ключ, Supabase запрещает его в браузере
  if (SUPABASE_ANON_KEY.startsWith('sb_secret_')) {
    // объясняем, какой ключ нужен
    return 'В js/config.js вставлен СЕКРЕТНЫЙ ключ (sb_secret_...). Его нельзя использовать на сайте. Вставь Publishable key (sb_publishable_...) из Project Settings → API Keys.';
  // конец if
  }
  // всё в порядке
  return '';
// конец функции findConfigProblem
}

// configProblem — текст проблемы с настройками (или ''); его показывает js/layout.js
export const configProblem = findConfigProblem();

// isSupabaseConfigured — true, если проблем с настройками нет
export const isSupabaseConfigured = configProblem === '';

// if — условие: если с настройками что-то не так
if (!isSupabaseConfigured) {
  // console.warn — предупреждение в консоли (жёлтое, не ошибка) с подсказкой, что делать
  console.warn(`SkillSwap: ${configProblem}`);
// конец if
}

// создаём клиент только если ключи есть; иначе null («пусто»), и страницы покажут понятное сообщение вместо ошибки
export const supabase = isSupabaseConfigured
  // createClient(адрес, ключ) создаёт объект для работы с Auth, базой, Storage и Realtime
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  // : — вторая часть тернарного оператора: значение, если условие ложно
  : null;
