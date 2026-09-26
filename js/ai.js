// ============================================================================
// Файл: js/ai.js
// Зачем нужен: блок «💡 Подсказка от ИИ» на странице вопроса.
// ИИ не решает задачу за ученика, а подсказывает, с чего начать.
// Как работает:
//   • подсказку к вопросу ИИ пишет ОДИН раз, она хранится в таблице ai_hints,
//     и дальше её видят все — бесплатно и мгновенно;
//   • новую подсказку создаёт серверная функция supabase/functions/ai-hint
//     (ключ ИИ хранится только там, на сервере — в браузер он не попадает);
//   • у ученика дневной лимит новых подсказок (AI_DAILY_LIMIT в js/config.js).
// Состояния блока: «предложение» (кнопка), «подсказка уже готова» (показать),
// «ИИ думает…», сама подсказка, ошибка, лимит исчерпан.
// Как связан с остальными: вызывается из js/pages/question.js; разметка —
// pages/question.html (id="ai-card"); стили — css/pages.css (.ai-…).
// ============================================================================

// подключение к Supabase
import { supabase } from './supabase.js';
// дневной лимит
import { AI_DAILY_LIMIT } from './config.js';
// экранирование, кнопка «загрузка», запись ошибок, склонение слов
import { escapeHtml, setButtonLoading, logError, pluralRu } from './utils.js';

// ----------------------------------------------------------------------------
// fetchHint — готовая подсказка к вопросу (если её уже кто-то запросил).
// Принимает: questionId — номер вопроса. Возвращает: Promise<string|null>.
// ----------------------------------------------------------------------------
// export async function — функцию можно импортировать; async — внутри есть await
export async function fetchHint(questionId) {
  // select('hint') — берём только текст; maybeSingle — одна строка или null
  const { data, error } = await supabase.from('ai_hints').select('hint').eq('question_id', questionId).maybeSingle();
  // ошибка — бросаем
  if (error) throw error;
  // ?. — если data равен null, получим undefined; ?? null — тогда вернём null
  return data?.hint ?? null;
// конец функции fetchHint
}

// ----------------------------------------------------------------------------
// fetchHintsLeft — сколько новых подсказок осталось сегодня.
// Принимает: ничего. Возвращает: Promise<number|null> (null — не удалось узнать).
// ----------------------------------------------------------------------------
// export async function
export async function fetchHintsLeft() {
  // rpc — вызов функции базы ai_hints_left
  const { data, error } = await supabase.rpc('ai_hints_left');
  // не удалось — не страшно, просто не покажем число
  if (error) {
    // в консоль как предупреждение
    logError(error);
    // «неизвестно»
    return null;
  // конец if
  }
  // число
  return data;
// конец функции fetchHintsLeft
}

// ----------------------------------------------------------------------------
// requestHint — просит серверную функцию ai-hint написать подсказку.
// Принимает: questionId. Возвращает: Promise<{ hint, left }>.
// При ошибке бросает Error с понятным текстом и полем status (HTTP-код).
// ----------------------------------------------------------------------------
// export async function
export async function requestHint(questionId) {
  // functions.invoke — вызов Edge Function; supabase-js сам добавит токен вошедшего ученика
  const { data, error } = await supabase.functions.invoke('ai-hint', { body: { questionId } });
  // всё хорошо — возвращаем подсказку и остаток лимита
  if (!error) return { hint: data.hint, left: data.left ?? null };
  // error.context — ответ сервера (Response), если сервер ответил ошибкой
  const response = error.context;
  // status — HTTP-код ответа (0 — ответа не было совсем, например нет интернета)
  const status = response?.status ?? 0;
  // текст по умолчанию
  let message = 'Не удалось связаться с ИИ. Проверь интернет и попробуй ещё раз.';
  // 404 — функция ещё не загружена в Supabase
  if (status === 404) message = 'Подсказки ИИ пока не настроены.';
  // пробуем прочитать наш текст ошибки из ответа ({ error: '...' })
  try {
    // typeof ... === 'function' — проверяем, что у ответа есть метод json
    if (response && typeof response.json === 'function') {
      // разбираем JSON
      const body = await response.json();
      // если сервер прислал понятный текст — берём его
      if (body?.error) message = body.error;
    // конец if
    }
  // ответ не JSON — оставляем текст по умолчанию
  } catch {
    // ничего не делаем
  // конец try/catch
  }
  // создаём ошибку с текстом
  const failure = new Error(message);
  // запоминаем код, чтобы отличить «лимит исчерпан» (429) от остальных ошибок
  failure.status = status;
  // бросаем
  throw failure;
// конец функции requestHint
}

// ----------------------------------------------------------------------------
// hintHtml — превращает текст подсказки в аккуратный HTML: строки «1. …»
// становятся нумерованным списком, «Проверь себя: …» — отдельной плашкой.
// Весь текст экранируется: HTML из ответа ИИ никогда не выполнится.
// Принимает: text — подсказка. Возвращает: строку HTML.
// ----------------------------------------------------------------------------
// export function
export function hintHtml(text) {
  // split('\n') — делим на строки; map(trim) — убираем пробелы; filter(Boolean) — выбрасываем пустые
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
  // части итогового HTML
  const parts = [];
  // пункты текущего списка
  let items = [];
  // flushList — если накопились пункты списка, добавляем их как <ol>
  const flushList = () => {
    // пунктов нет — выходим
    if (items.length === 0) return;
    // <ol> — нумерованный список; style="--i: N" — номер пункта для задержки анимации в CSS
    parts.push(`<ol class="ai-steps">${items.map((item, i) => `<li style="--i: ${i}">${item}</li>`).join('')}</ol>`);
    // начинаем новый список
    items = [];
  // конец функции flushList
  };
  // for...of — перебираем строки
  for (const line of lines) {
    // /^\d+[.)]\s*/ — регулярное выражение: в начале строки цифры, потом точка или скобка и пробелы
    const step = line.match(/^\d+[.)]\s*(.*)$/);
    // пункт списка — копим (группа (.*) — текст после номера)
    if (step) {
      // экранируем и кладём
      items.push(escapeHtml(step[1]));
      // к следующей строке
      continue;
    // конец if
    }
    // строка «- …» или «• …» — тоже пункт
    if (/^[-•]\s+/.test(line)) {
      // убираем маркер, экранируем
      items.push(escapeHtml(line.replace(/^[-•]\s+/, '')));
      // к следующей строке
      continue;
    // конец if
    }
    // обычная строка — сначала закрываем список
    flushList();
    // «Проверь себя» — особая плашка
    if (/^проверь себя/i.test(line)) parts.push(`<p class="ai-check">🎯 ${escapeHtml(line)}</p>`);
    // остальное — обычный абзац
    else parts.push(`<p>${escapeHtml(line)}</p>`);
  // конец цикла
  }
  // список в самом конце текста
  flushList();
  // склеиваем
  return parts.join('');
// конец функции hintHtml
}

// ----------------------------------------------------------------------------
// leftText — строка «Осталось сегодня: 7 из 10 подсказок».
// Принимает: left — число или null. Возвращает: строку ('' — если неизвестно).
// ----------------------------------------------------------------------------
// function
function leftText(left) {
  // неизвестно — ничего не пишем
  if (left === null || left === undefined) return '';
  // pluralRu — правильное окончание слова
  return `Осталось сегодня: ${left} из ${AI_DAILY_LIMIT} ${pluralRu(AI_DAILY_LIMIT, ['подсказки', 'подсказок', 'подсказок'])}`;
// конец функции leftText
}

// ----------------------------------------------------------------------------
// initAiHint — запускает блок подсказки на странице вопроса.
// Принимает: card — блок id="ai-card"; { questionId, me } — номер вопроса и
//   мой профиль. Возвращает: Promise.
// ----------------------------------------------------------------------------
// export async function
export async function initAiHint(card, { questionId, me }) {
  // блока нет — выходим
  if (!card) return;
  // заблокированному ученику блок не показываем
  if (me.is_blocked) return;
  // место, куда рисуются состояния
  const body = card.querySelector('#ai-body');
  // hint — готовая подсказка (или null), left — остаток лимита
  let hint = null;
  // остаток лимита
  let left = null;
  // try — загрузка
  try {
    // Promise.all — готовая подсказка и остаток лимита одновременно
    [hint, left] = await Promise.all([fetchHint(questionId), fetchHintsLeft()]);
  // catch — ошибка
  } catch (error) {
    // в консоль
    logError(error);
    // без подсказки блок всё равно работает: покажем кнопку
    hint = null;
  // конец try/catch
  }

  // showOffer — «попробуй сам, а если застрял — попроси подсказку»
  const showOffer = () => {
    // лимит исчерпан — кнопку не даём
    const noneLeft = left === 0;
    // собираем HTML
    body.innerHTML = [
      // текст
      '<p class="ai-lead">Сначала попробуй сам 🙂 Застрял? ИИ подскажет правило или первый шаг — но решать всё равно будешь ты.</p>',
      // строка с кнопкой и остатком лимита
      '<div class="ai-actions">',
      // кнопка; disabled — если лимит исчерпан
      `<button class="btn btn-primary ai-button" type="button" data-ai="ask"${noneLeft ? ' disabled' : ''}><span aria-hidden="true">💡</span> Получить подсказку</button>`,
      // остаток лимита
      `<span class="muted ai-left">${noneLeft ? 'На сегодня подсказки закончились — завтра будут новые' : leftText(left)}</span>`,
      // конец строки
      '</div>',
    // склеиваем
    ].join('');
  // конец функции showOffer
  };

  // showReady — подсказка уже есть, но спрятана: пусть ученик сначала подумает сам
  const showReady = () => {
    // HTML
    body.innerHTML = [
      // текст
      '<p class="ai-lead">Подсказка к этому вопросу уже готова. Сначала попробуй сам — а если застрял, открой её.</p>',
      // кнопка «Показать» (лимит не тратится)
      '<div class="ai-actions"><button class="btn btn-secondary ai-button" type="button" data-ai="reveal"><span aria-hidden="true">👀</span> Показать подсказку</button></div>',
    // склеиваем
    ].join('');
  // конец функции showReady
  };

  // showThinking — «ИИ думает…» с анимацией
  const showThinking = () => {
    // aria-busy — программы чтения с экрана поймут, что идёт загрузка
    body.setAttribute('aria-busy', 'true');
    // HTML: три прыгающие точки и «скелет» будущего текста
    body.innerHTML = [
      // строка «ИИ думает»
      '<p class="ai-thinking"><span class="ai-dots" aria-hidden="true"><i></i><i></i><i></i></span> ИИ думает над подсказкой…</p>',
      // серые полоски-заглушки (skeleton) вместо текста
      '<div class="ai-skeleton" aria-hidden="true"><span></span><span></span><span></span></div>',
    // склеиваем
    ].join('');
  // конец функции showThinking
  };

  // showHint — сама подсказка; fresh — только что создана (тогда показываем остаток лимита)
  const showHint = (text, fresh) => {
    // загрузка закончилась
    body.removeAttribute('aria-busy');
    // HTML
    body.innerHTML = [
      // текст подсказки
      `<div class="ai-hint">${hintHtml(text)}</div>`,
      // предупреждение
      `<p class="ai-note">⚠️ ИИ может ошибаться. Проверь себя и дождись ответов учеников${fresh && left !== null ? ` · ${leftText(left)}` : ''}</p>`,
    // склеиваем
    ].join('');
  // конец функции showHint
  };

  // showError — ошибка; retry — показывать ли кнопку «Попробовать ещё раз»
  const showError = (message, retry) => {
    // загрузка закончилась
    body.removeAttribute('aria-busy');
    // HTML; экранируем текст ошибки
    body.innerHTML = [
      // сообщение
      `<div class="alert alert-error ai-error" role="alert">${escapeHtml(message)}</div>`,
      // кнопка повтора
      retry ? '<div class="ai-actions"><button class="btn btn-secondary ai-button" type="button" data-ai="ask"><span aria-hidden="true">🔄</span> Попробовать ещё раз</button></div>' : '',
    // склеиваем
    ].join('');
  // конец функции showError
  };

  // ask — запросить новую подсказку у сервера
  const ask = async (button) => {
    // защита от двойного нажатия
    if (button.disabled) return;
    // кнопка в состоянии «загрузка»
    setButtonLoading(button, true);
    // «ИИ думает…»
    showThinking();
    // try — запрос
    try {
      // ждём ответ сервера
      const result = await requestHint(questionId);
      // запоминаем подсказку
      hint = result.hint;
      // остаток лимита (если сервер его прислал — подсказка была новой)
      if (result.left !== null) left = result.left;
      // показываем
      showHint(hint, result.left !== null);
    // catch — ошибка
    } catch (error) {
      // в консоль
      logError(error);
      // 429 — лимит исчерпан
      if (error.status === 429) left = 0;
      // сообщение; повтор предлагаем, если это не лимит и не запрет
      showError(error.message, error.status !== 429 && error.status !== 403);
    // конец try/catch
    }
  // конец функции ask
  };

  // один обработчик кликов на весь блок (кнопки внутри перерисовываются)
  body.addEventListener('click', (event) => {
    // closest — ближайший элемент с атрибутом data-ai (сама кнопка или её родитель)
    const button = event.target.closest('[data-ai]');
    // клик не по кнопке — выходим
    if (!button) return;
    // «Показать подсказку» — просто показываем готовую
    if (button.dataset.ai === 'reveal') showHint(hint, false);
    // «Получить подсказку» / «Попробовать ещё раз»
    else ask(button);
  // конец обработчика
  });

  // первое состояние: подсказка уже есть — «показать», нет — «попробуй сам / получить»
  if (hint) showReady(); else showOffer();
  // показываем блок
  card.hidden = false;
// конец функции initAiHint
}
