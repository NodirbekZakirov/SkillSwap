// ============================================================================
// Файл: js/timer.js
// Зачем нужен: ОБЩИЙ ТАЙМЕР ЗАНЯТИЯ в чате. Любой участник по желанию
// ставит таймер (длина занятия и перерыва) и запускает его «для всех»:
// у партнёра он появляется сразу (Supabase Realtime), идёт синхронно,
// его можно поставить на паузу, продолжить и выключить.
// Как это устроено: база хранит, КОГДА закончится цикл (ends_at), а каждый
// экран сам считает, сколько осталось. Часы на телефонах могут спешить,
// поэтому поправка offset = «время сервера − время телефона».
// Цикл: сначала занятие (📚), потом перерыв (☕). Когда фаза меняется —
// короткий звуковой сигнал, вибрация и сообщение.
// Как связан с остальными: вызывается из js/pages/chat.js; SQL-функции
// get_timer и timer_control — в sql/schema.sql; стили — css/pages.css.
// ============================================================================

// подключение к Supabase
import { supabase } from './supabase.js';
// тосты, защита кнопок, ошибки
import { showToast, setButtonLoading, getErrorMessage, logError, escapeHtml } from './utils.js';

// PRESETS — готовые варианты длины занятия (минуты)
const PRESETS = [15, 25, 45, 60];
// BREAKS — варианты перерыва (минуты; 0 — без перерыва)
const BREAKS = [0, 5, 10];
// RING_LENGTH — длина окружности кольца прогресса (радиус 26: 2 · π · 26 ≈ 163)
const RING_LENGTH = 163;

// ----------------------------------------------------------------------------
// playChime — короткая мелодия из трёх нот (без файлов: звук создаёт
// сам браузер через AudioContext). Плюс вибрация на телефоне.
// Принимает: ничего. Возвращает: ничего.
// ----------------------------------------------------------------------------
// function
function playChime() {
  // try — браузер может запретить звук, пока пользователь ничего не нажимал
  try {
    // звуковой движок браузера
    const context = new (window.AudioContext || window.webkitAudioContext)();
    // три ноты: до, ми, соль (частоты в герцах)
    [523, 659, 784].forEach((frequency, i) => {
      // генератор тона
      const oscillator = context.createOscillator();
      // регулятор громкости
      const gain = context.createGain();
      // частота ноты
      oscillator.frequency.value = frequency;
      // когда начать ноту: каждая следующая на 0,18 секунды позже
      const at = context.currentTime + i * 0.18;
      // громкость: быстро вверх и плавно вниз (без щелчков)
      gain.gain.setValueAtTime(0.0001, at);
      // вверх
      gain.gain.exponentialRampToValueAtTime(0.25, at + 0.02);
      // вниз
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.35);
      // соединяем: генератор → громкость → динамики
      oscillator.connect(gain).connect(context.destination);
      // играем
      oscillator.start(at);
      // и останавливаем
      oscillator.stop(at + 0.4);
    // конец перебора нот
    });
    // закрываем движок через секунду
    setTimeout(() => context.close().catch(() => {}), 1200);
  // catch — без звука
  } catch (error) {
    // в консоль
    logError(error);
  // конец try/catch
  }
  // вибрация: 200 мс, пауза 100, 200 мс (?. — на компьютере вибрации нет)
  navigator.vibrate?.([200, 100, 200]);
// конец функции playChime
}

// ----------------------------------------------------------------------------
// formatClock — «24:59» из миллисекунд.
// Принимает: ms. Возвращает: строку.
// ----------------------------------------------------------------------------
// export function
export function formatClock(ms) {
  // целые секунды, округление вверх (чтобы 0:00 было ровно в конце)
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  // минуты:секунды
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
// конец функции formatClock
}

// ----------------------------------------------------------------------------
// timerPhase — в какой фазе таймер и сколько в ней осталось.
// Чистая функция (без экрана и базы) — её легко проверить.
// Принимает: timer — строка таймера из базы; now — «сейчас по серверу» (мс).
// Возвращает: { phase: 'off' | 'work' | 'break' | 'done', left, total, paused }:
//   left — сколько осталось в этой фазе (мс), total — длина фазы (мс).
// ----------------------------------------------------------------------------
// export function
export function timerPhase(timer, now) {
  // выключен или данных нет
  if (!timer || timer.status === 'stopped') return { phase: 'off', left: 0, total: 0, paused: false };
  // длина перерыва в мс
  const breakMs = timer.break_minutes * 60 * 1000;
  // длина занятия в мс
  const workMs = timer.work_minutes * 60 * 1000;
  // на паузе ли
  const paused = timer.status === 'paused';
  // сколько осталось всего цикла: на паузе — из remaining_seconds, иначе — до ends_at
  const leftTotal = paused ? timer.remaining_seconds * 1000 : new Date(timer.ends_at).getTime() - now;
  // цикл закончился
  if (leftTotal <= 0) return { phase: 'done', left: 0, total: workMs, paused };
  // осталось больше перерыва — ещё идёт занятие
  if (leftTotal > breakMs) return { phase: 'work', left: leftTotal - breakMs, total: workMs, paused };
  // иначе — перерыв
  return { phase: 'break', left: leftTotal, total: breakMs, paused };
// конец функции timerPhase
}

// ----------------------------------------------------------------------------
// initPairTimer — подключает таймер к странице чата.
// Принимает объект:
//   partnershipId — номер партнёрства;
//   canControl — можно ли управлять (активный обмен без блокировок);
//   button — кнопка «⏱ Таймер» в шапке чата;
//   panel — панель настройки; bar — полоска идущего таймера;
//   nameOf(userId) — имя участника («Лена К.») для подписи «Запустил(а)».
// Возвращает: Promise.
// ----------------------------------------------------------------------------
// export async function
export async function initPairTimer({ partnershipId, canControl, button, panel, bar, nameOf }) {
  // текущая строка таймера из базы
  let timer = null;
  // поправка часов: время сервера − время телефона (мс)
  let offset = 0;
  // фаза при прошлой перерисовке (чтобы заметить смену фазы и подать сигнал)
  let lastPhase = null;
  // исходное название вкладки (к нему добавляем «⏱ 12:34 · »)
  const baseTitle = document.title;
  // кнопку и панель показываем, только если можно управлять
  button.hidden = !canControl;

  // serverNow — «сейчас» по часам сервера
  const serverNow = () => Date.now() + offset;

  // render — перерисовка полоски таймера (вызывается каждую секунду)
  const render = () => {
    // фаза и оставшееся время
    const state = timerPhase(timer, serverNow());
    // сменилась фаза, пока страница открыта, — сигнал (при первой отрисовке не звеним)
    if (lastPhase && lastPhase !== state.phase && !state.paused) {
      // занятие закончилось, начался перерыв
      if (state.phase === 'break') { playChime(); showToast(`☕ Перерыв ${timer.break_minutes} мин! Отдохните и разомнитесь.`, 'success'); }
      // весь цикл закончился
      if (state.phase === 'done') { playChime(); showToast('✅ Время занятия вышло! Не забудьте отметить занятие на странице «Занятия».', 'success'); }
    // конец if
    }
    // запоминаем фазу
    lastPhase = state.phase;
    // выключен — прячем полоску и возвращаем название вкладки
    if (state.phase === 'off') {
      // прячем
      bar.hidden = true;
      // название
      document.title = baseTitle;
      // стоп
      return;
    // конец if
    }
    // подписи фаз
    const labels = { work: '📚 Занятие', break: '☕ Перерыв', done: '✅ Время вышло' };
    // доля оставшегося времени (для кольца): 0..1
    const fraction = state.total > 0 ? state.left / state.total : 0;
    // кто последний нажал кнопку
    const who = timer.updated_by ? nameOf(timer.updated_by) : '';
    // HTML полоски
    bar.innerHTML = [
      // кольцо прогресса (SVG — рисунок из фигур); stroke-dashoffset — «незакрашенная» часть окружности
      `<div class="timer-ring timer-${state.phase}${state.paused ? ' is-paused' : ''}">`,
      // svg 60×60
      '<svg viewBox="0 0 60 60" aria-hidden="true">',
      // серая подложка
      '<circle class="timer-ring-bg" cx="30" cy="30" r="26"></circle>',
      // цветная дуга; transform — начинать сверху
      `<circle class="timer-ring-fg" cx="30" cy="30" r="26" stroke-dasharray="${RING_LENGTH}" stroke-dashoffset="${(RING_LENGTH * (1 - fraction)).toFixed(1)}" transform="rotate(-90 30 30)"></circle>`,
      // конец svg
      '</svg>',
      // время внутри кольца
      `<span class="timer-clock">${formatClock(state.left)}</span>`,
      // конец кольца
      '</div>',
      // подписи
      '<div class="timer-info">',
      // фаза и пауза
      `<strong>${labels[state.phase]}${state.paused ? ' · пауза' : ''}</strong>`,
      // настройки и кто запустил
      `<span class="muted">${timer.work_minutes} мин${timer.break_minutes ? ` + перерыв ${timer.break_minutes}` : ''}${who ? ` · ${escapeHtml(who)}` : ''}</span>`,
      // конец подписей
      '</div>',
      // кнопки управления (если можно)
      canControl ? [
        // ряд кнопок
        '<div class="timer-actions">',
        // пауза или продолжить (у законченного таймера не нужны)
        state.phase === 'done' ? '' : `<button class="icon-btn" type="button" data-timer="${state.paused ? 'resume' : 'pause'}" aria-label="${state.paused ? 'Продолжить' : 'Пауза'}" title="${state.paused ? 'Продолжить' : 'Пауза'}">${state.paused ? '▶' : '⏸'}</button>`,
        // выключить
        '<button class="icon-btn" type="button" data-timer="stop" aria-label="Выключить таймер" title="Выключить">⏹</button>',
        // конец ряда
        '</div>',
      // склеиваем кнопки
      ].join('') : '',
    // склеиваем полоску
    ].join('');
    // показываем полоску
    bar.hidden = false;
    // название вкладки: время видно, даже если вкладка не открыта
    document.title = state.phase === 'done' ? `✅ ${baseTitle}` : `⏱ ${formatClock(state.left)} · ${baseTitle}`;
  // конец render
  };

  // apply — новая строка таймера (из запроса или Realtime)
  const apply = (row) => {
    // запоминаем
    timer = row;
    // перерисовываем
    render();
  // конец apply
  };

  // control — нажатие кнопки таймера: start / pause / resume / stop
  const control = async (action, clicked, minutes = {}) => {
    // защита от двойного нажатия
    if (clicked?.disabled) return;
    // «загрузка»
    if (clicked) setButtonLoading(clicked, true);
    // try — запрос
    try {
      // SQL-функция сама проверит права; p_work_minutes и p_break_minutes нужны только для start
      const { data, error } = await supabase.rpc('timer_control', { p_partnership_id: partnershipId, p_action: action, p_work_minutes: minutes.work ?? 25, p_break_minutes: minutes.break ?? 5 });
      // ошибка — в catch
      if (error) throw error;
      // поправка часов по ответу сервера
      offset = new Date(data.server_now).getTime() - Date.now();
      // новое состояние (Realtime тоже пришлёт его — это не страшно)
      apply(data);
      // запуск — закрываем панель и сообщаем
      if (action === 'start') {
        // закрываем панель
        panel.hidden = true;
        // кнопка «не нажата»
        button.setAttribute('aria-expanded', 'false');
        // сообщение
        showToast('Таймер запущен для всех участников ⏱', 'success');
      // конец if
      }
    // catch — ошибка
    } catch (error) {
      // в консоль
      logError(error);
      // сообщение
      showToast(getErrorMessage(error), 'error');
    // finally — всегда
    } finally {
      // кнопка снова активна (если она ещё на странице)
      if (clicked?.isConnected) setButtonLoading(clicked, false);
    // конец try/catch/finally
    }
  // конец control
  };

  // панель настройки: готовые длины, своё число, перерыв, кнопка запуска
  panel.innerHTML = [
    // заголовок
    '<h2 class="timer-panel-title">⏱ Таймер занятия</h2>',
    // пояснение
    '<p class="muted">Таймер увидят все участники чата. Когда время выйдет — прозвучит сигнал.</p>',
    // выбор длины занятия
    '<p class="timer-label">Длина занятия</p>',
    // готовые варианты как переключатель; 25 — выбран сразу
    `<div class="segmented timer-presets" role="radiogroup" aria-label="Длина занятия">${PRESETS.map((m) => `<label><input type="radio" name="timer-work" value="${m}"${m === 25 ? ' checked' : ''}><span>${m} мин</span></label>`).join('')}</div>`,
    // своё число минут
    '<label class="timer-custom"><span>или своё:</span><input class="input" id="timer-custom" type="number" min="1" max="120" inputmode="numeric" placeholder="мин"></label>',
    // выбор перерыва
    '<p class="timer-label">Перерыв после занятия</p>',
    // варианты перерыва; 5 — выбран сразу
    `<div class="segmented" role="radiogroup" aria-label="Перерыв">${BREAKS.map((m) => `<label><input type="radio" name="timer-break" value="${m}"${m === 5 ? ' checked' : ''}><span>${m === 0 ? 'без перерыва' : `${m} мин`}</span></label>`).join('')}</div>`,
    // кнопки
    '<div class="timer-panel-actions">',
    // отмена
    '<button class="btn btn-ghost" type="button" data-timer-close>Отмена</button>',
    // запуск
    '<button class="btn btn-primary" type="button" data-timer-start>▶ Запустить для всех</button>',
    // конец кнопок
    '</div>',
  // склеиваем
  ].join('');

  // кнопка «⏱ Таймер» — открыть/закрыть панель
  button.addEventListener('click', () => {
    // переключаем видимость
    panel.hidden = !panel.hidden;
    // aria-expanded — «раскрыто ли» для программ чтения с экрана
    button.setAttribute('aria-expanded', String(!panel.hidden));
    // открыли — курсор на первый вариант
    if (!panel.hidden) panel.querySelector('input').focus();
  // конец обработчика
  });

  // своё число — снимаем выбор с готовых вариантов (и наоборот)
  panel.querySelector('#timer-custom').addEventListener('input', () => panel.querySelectorAll('input[name="timer-work"]').forEach((input) => { input.checked = false; }));
  // выбрали готовый вариант — очищаем своё число
  panel.querySelectorAll('input[name="timer-work"]').forEach((input) => input.addEventListener('change', () => { panel.querySelector('#timer-custom').value = ''; }));

  // клики в панели
  panel.addEventListener('click', (event) => {
    // «Отмена» — закрыть
    if (event.target.closest('[data-timer-close]')) {
      // прячем
      panel.hidden = true;
      // кнопка «не нажата»
      button.setAttribute('aria-expanded', 'false');
    // конец if
    }
    // «Запустить»
    const startButton = event.target.closest('[data-timer-start]');
    // не она — выходим
    if (!startButton) return;
    // своё число (если введено), иначе выбранный вариант
    const custom = Number(panel.querySelector('#timer-custom').value);
    // выбранный готовый вариант; ?. — если ничего не выбрано
    const preset = Number(panel.querySelector('input[name="timer-work"]:checked')?.value);
    // итоговая длина занятия
    const work = custom || preset;
    // проверка: целое число от 1 до 120
    if (!Number.isInteger(work) || work < 1 || work > 120) {
      // подсказка
      showToast('Длина занятия — от 1 до 120 минут', 'error');
      // стоп
      return;
    // конец if
    }
    // перерыв
    const breakMinutes = Number(panel.querySelector('input[name="timer-break"]:checked')?.value ?? 0);
    // запускаем
    control('start', startButton, { work, break: breakMinutes });
  // конец обработчика
  });

  // кнопки на полоске (пауза, продолжить, стоп) — делегирование
  bar.addEventListener('click', (event) => {
    // кнопка с data-timer
    const actionButton = event.target.closest('[data-timer]');
    // нашли — выполняем действие
    if (actionButton) control(actionButton.dataset.timer, actionButton);
  // конец обработчика
  });

  // try — начальное состояние
  try {
    // SQL-функция get_timer: строка таймера + время сервера
    const { data, error } = await supabase.rpc('get_timer', { p_partnership_id: partnershipId });
    // ошибка — в catch
    if (error) throw error;
    // поправка часов
    offset = new Date(data.server_now).getTime() - Date.now();
    // показываем
    apply(data);
  // catch — таймер не главное: чат работает и без него
  } catch (error) {
    // в консоль
    logError(error);
  // конец try/catch
  }

  // Realtime: любые изменения строки таймера этого партнёрства (event: '*' — вставка и изменение)
  const channel = supabase
    // отдельный канал для таймера
    .channel(`timer-${partnershipId}`)
    // слушаем таблицу partnership_timers с нашим partnership_id
    .on('postgres_changes', { event: '*', schema: 'public', table: 'partnership_timers', filter: `partnership_id=eq.${partnershipId}` }, (payload) => {
      // payload.new — новая строка (у удаления её нет)
      if (payload.new && payload.new.status) apply(payload.new);
    // конец обработчика
    })
    // включаем подписку
    .subscribe();
  // уходим со страницы — закрываем канал
  window.addEventListener('pagehide', () => supabase.removeChannel(channel));
  // каждую секунду перерисовываем (обратный отсчёт)
  setInterval(render, 1000);
// конец функции initPairTimer
}
