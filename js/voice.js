// ============================================================================
// Файл: js/voice.js
// Зачем нужен: ГОЛОСОВЫЕ СООБЩЕНИЯ в чате.
//   • запись с микрофона: MediaRecorder (встроен в браузер) пишет звук,
//     а AudioContext + AnalyserNode показывают громкость «живыми» полосками;
//   • загрузка файла в закрытую корзину Supabase Storage «voice»
//     (путь «номер_чата/время-случайные_буквы.webm» — по первой папке
//     правила базы проверяют, что писать сюда можно только участнику);
//   • плеер: кнопка ▶/⏸, «волна» из полосок, перемотка кликом, время.
// Слушать файл можно только по временной ссылке (signed URL, 1 час).
// Как связан с остальными: вызывается из js/pages/chat.js (запись и
// отправка) и js/pages/teacher.js (прослушать голосовое из жалобы).
// Правила доступа — voice_* в sql/schema.sql (часть 10).
// ============================================================================

// подключение к Supabase
import { supabase } from './supabase.js';
// самая длинная запись
import { MAX_VOICE_SECONDS } from './config.js';
// экранирование и вывод ошибок в консоль
import { escapeHtml, logError } from './utils.js';

// VOICE_BUCKET — корзина Storage для голосовых
const VOICE_BUCKET = 'voice';
// LINK_LIFETIME — сколько секунд живёт временная ссылка на файл (1 час)
const LINK_LIFETIME = 60 * 60;
// BARS — сколько полосок в «волне» плеера
const BARS = 28;
// MIME_CANDIDATES — форматы записи по порядку предпочтения (Chrome/Android — webm, iPhone — mp4)
const MIME_CANDIDATES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
// EXTENSIONS — расширение файла для каждого формата
const EXTENSIONS = { 'audio/webm': 'webm', 'audio/mp4': 'm4a', 'audio/ogg': 'ogg' };

// urlCache — уже полученные временные ссылки: «путь → ссылка» (чтобы не просить второй раз)
const urlCache = new Map();
// currentAudio — что играет сейчас (одновременно играет только одно сообщение)
let currentAudio = null;
// currentPlayer — плеер (HTML-блок), который сейчас играет
let currentPlayer = null;

// ----------------------------------------------------------------------------
// isVoiceSupported — умеет ли браузер записывать звук.
// Принимает: ничего. Возвращает: boolean.
// ----------------------------------------------------------------------------
// export function
export function isVoiceSupported() {
  // ?. — если mediaDevices нет, получим undefined; typeof — проверка, что MediaRecorder существует
  return Boolean(navigator.mediaDevices?.getUserMedia) && typeof window.MediaRecorder !== 'undefined';
// конец функции isVoiceSupported
}

// ----------------------------------------------------------------------------
// pickMime — первый формат записи, который поддерживает этот браузер.
// Принимает: ничего. Возвращает: строку формата или '' (пусть браузер выберет сам).
// ----------------------------------------------------------------------------
// function
function pickMime() {
  // isTypeSupported — поддерживает ли MediaRecorder такой формат; ?? '' — если ни один не подошёл
  return MIME_CANDIDATES.find((mime) => MediaRecorder.isTypeSupported(mime)) ?? '';
// конец функции pickMime
}

// ----------------------------------------------------------------------------
// micErrorText — понятный текст ошибки микрофона.
// Принимает: error — ошибка getUserMedia. Возвращает: строку.
// ----------------------------------------------------------------------------
// export function
export function micErrorText(error) {
  // пользователь или настройки запретили микрофон
  if (error?.name === 'NotAllowedError') return 'Нет доступа к микрофону. Разреши его в настройках браузера (значок 🔒 рядом с адресом).';
  // микрофона нет
  if (error?.name === 'NotFoundError') return 'Микрофон не найден. Подключи его и попробуй ещё раз.';
  // всё остальное
  return 'Не удалось включить микрофон. Попробуй ещё раз.';
// конец функции micErrorText
}

// ----------------------------------------------------------------------------
// createRecorder — готовит запись голоса.
// Принимает: { onTick(seconds, level) } — вызывается ~10 раз в секунду:
//   seconds — сколько записано, level — громкость от 0 до 1;
//   { onLimit() } — запись дошла до MAX_VOICE_SECONDS.
// Возвращает: объект { start(), stop(), cancel() }:
//   start() — Promise: включает микрофон и начинает запись;
//   stop() — Promise с { blob, seconds, mime } — готовый звук;
//   cancel() — выключает всё без результата.
// ----------------------------------------------------------------------------
// export function
export function createRecorder({ onTick = () => {}, onLimit = () => {} } = {}) {
  // поток с микрофона
  let stream = null;
  // сам записыватель
  let recorder = null;
  // кусочки записанного звука
  let chunks = [];
  // когда началась запись (мс)
  let startedAt = 0;
  // таймер обновления
  let tickId = null;
  // AudioContext — «звуковой движок» браузера (для измерения громкости)
  let audioContext = null;
  // анализатор громкости
  let analyser = null;
  // формат записи
  let mime = '';

  // cleanup — выключает микрофон и таймеры
  const cleanup = () => {
    // останавливаем обновление
    clearInterval(tickId);
    // stop() каждой дорожки — выключает микрофон (гаснет значок записи в браузере)
    stream?.getTracks().forEach((track) => track.stop());
    // закрываем звуковой движок; catch — если он уже закрыт
    audioContext?.close().catch(() => {});
  // конец cleanup
  };

  // level — текущая громкость от 0 до 1
  const level = () => {
    // анализатора нет — тишина
    if (!analyser) return 0;
    // Uint8Array — массив байтов для «формы звуковой волны»
    const data = new Uint8Array(analyser.fftSize);
    // заполняем его текущими значениями (128 — тишина)
    analyser.getByteTimeDomainData(data);
    // самое большое отклонение от тишины
    let peak = 0;
    // перебираем значения
    for (const value of data) peak = Math.max(peak, Math.abs(value - 128));
    // 0..128 → 0..1, чуть усиливаем, чтобы тихий голос тоже было видно
    return Math.min(1, (peak / 128) * 2);
  // конец level
  };

  // возвращаем объект управления записью
  return {
    // start — включить микрофон и начать запись
    async start() {
      // getUserMedia({ audio: true }) — спросить разрешение и включить микрофон
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // выбираем формат
      mime = pickMime();
      // new MediaRecorder(поток, настройки) — записыватель; без mimeType браузер выберет сам
      recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      // запоминаем формат, который реально выбрал браузер
      mime = recorder.mimeType || mime || 'audio/webm';
      // ondataavailable — пришёл кусочек звука; копим их
      recorder.ondataavailable = (event) => { if (event.data.size > 0) chunks.push(event.data); };
      // try — измерение громкости не обязательно: если не вышло, запись всё равно идёт
      try {
        // звуковой движок; webkitAudioContext — старое имя в Safari
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        // анализатор
        analyser = audioContext.createAnalyser();
        // размер «окна» анализа
        analyser.fftSize = 256;
        // подключаем микрофон к анализатору
        audioContext.createMediaStreamSource(stream).connect(analyser);
      // catch — без полосок громкости
      } catch (error) {
        // в консоль
        logError(error);
      // конец try/catch
      }
      // start(250) — начать запись, отдавая кусочки каждые 250 мс
      recorder.start(250);
      // время начала
      startedAt = Date.now();
      // каждые 100 мс сообщаем длину и громкость
      tickId = setInterval(() => {
        // сколько секунд записано
        const seconds = (Date.now() - startedAt) / 1000;
        // сообщаем странице
        onTick(seconds, level());
        // дошли до предела — сообщаем, страница сама остановит и отправит
        if (seconds >= MAX_VOICE_SECONDS) {
          // больше не тикаем
          clearInterval(tickId);
          // сигнал странице
          onLimit();
        // конец if
        }
      // конец интервала; 100 мс
      }, 100);
    // конец start
    },
    // stop — закончить запись и получить звук
    stop() {
      // new Promise — ждём, пока записыватель отдаст последний кусочек
      return new Promise((resolve) => {
        // длина записи в целых секундах: от 1 до MAX_VOICE_SECONDS
        const seconds = Math.min(MAX_VOICE_SECONDS, Math.max(1, Math.round((Date.now() - startedAt) / 1000)));
        // onstop — запись остановлена полностью
        recorder.onstop = () => {
          // основной формат без параметров: 'audio/webm;codecs=opus' → 'audio/webm'
          const baseMime = mime.split(';')[0];
          // Blob — «файл в памяти» из всех кусочков
          const blob = new Blob(chunks, { type: baseMime });
          // выключаем микрофон
          cleanup();
          // отдаём результат
          resolve({ blob, seconds, mime: baseMime });
        // конец onstop
        };
        // останавливаем запись
        recorder.stop();
      // конец Promise
      });
    // конец stop
    },
    // cancel — отменить запись
    cancel() {
      // результат не нужен: при остановке просто выключаем всё
      if (recorder && recorder.state !== 'inactive') {
        // onstop — после остановки
        recorder.onstop = cleanup;
        // останавливаем
        recorder.stop();
      // иначе (запись не началась) — просто выключаем микрофон
      } else {
        // выключаем
        cleanup();
      // конец if
      }
      // забываем кусочки
      chunks = [];
    // конец cancel
    },
  // конец объекта
  };
// конец функции createRecorder
}

// ----------------------------------------------------------------------------
// uploadVoice — загружает запись в Storage.
// Принимает: partnershipId — номер чата (первая папка пути); recording —
//   { blob, mime }. Возвращает: Promise со строкой пути файла.
// ----------------------------------------------------------------------------
// export async function
export async function uploadVoice(partnershipId, recording) {
  // расширение по формату; ?? 'webm' — на всякий случай
  const extension = EXTENSIONS[recording.mime] ?? 'webm';
  // случайные буквы: Math.random().toString(36) — число в «36-ричной» записи из цифр и букв
  const random = Math.random().toString(36).slice(2, 8);
  // путь: «12/1712345678901-ab12cd.webm»
  const path = `${partnershipId}/${Date.now()}-${random}.${extension}`;
  // upload — загрузить; contentType — тип файла (корзина пропускает только звук); upsert: false — не перезаписывать
  const { error } = await supabase.storage.from(VOICE_BUCKET).upload(path, recording.blob, { contentType: recording.mime, upsert: false });
  // ошибка — бросаем
  if (error) throw error;
  // возвращаем путь
  return path;
// конец функции uploadVoice
}

// ----------------------------------------------------------------------------
// removeVoice — удаляет файл (если сообщение не удалось сохранить).
// Принимает: path. Возвращает: Promise.
// ----------------------------------------------------------------------------
// export async function
export async function removeVoice(path) {
  // remove принимает массив путей
  const { error } = await supabase.storage.from(VOICE_BUCKET).remove([path]);
  // ошибку только в консоль: пользователю она ничего не даст
  if (error) logError(error);
// конец функции removeVoice
}

// ----------------------------------------------------------------------------
// formatSeconds — «1:05» из числа секунд.
// Принимает: seconds. Возвращает: строку.
// ----------------------------------------------------------------------------
// export function
export function formatSeconds(seconds) {
  // целые секунды, не меньше нуля
  const total = Math.max(0, Math.floor(seconds));
  // минуты:секунды; padStart — «5» → «05»
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
// конец функции formatSeconds
}

// ----------------------------------------------------------------------------
// barHeights — высоты полосок «волны»: псевдослучайные, но одинаковые для
// одного и того же файла (вычисляются из пути), чтобы плеер не «прыгал».
// Принимает: path. Возвращает: массив чисел от 25 до 100 (проценты).
// ----------------------------------------------------------------------------
// function
function barHeights(path) {
  // начальное число из букв пути: charCodeAt — код символа
  let seed = [...path].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) % 2147483647, 7);
  // для каждой полоски — следующее «случайное» число (простой генератор)
  return Array.from({ length: BARS }, () => {
    // шаг генератора
    seed = (seed * 16807) % 2147483647;
    // высота от 25 до 100 процентов
    return 25 + (seed % 76);
  // конец Array.from
  });
// конец функции barHeights
}

// ----------------------------------------------------------------------------
// voicePlayerHtml — HTML плеера голосового сообщения.
// Принимает: path — путь файла; seconds — длина. Возвращает: строку HTML.
// ----------------------------------------------------------------------------
// export function
export function voicePlayerHtml(path, seconds) {
  // полоски «волны»; --h — высота полоски (переменная CSS)
  const bars = barHeights(path).map((height) => `<span class="voice-bar" style="--h: ${height}%"></span>`).join('');
  // собираем плеер; data-voice — путь файла, data-seconds — длина
  return [
    // блок плеера
    `<div class="voice-player" data-voice="${escapeHtml(path)}" data-seconds="${Number(seconds) || 0}">`,
    // кнопка ▶
    '<button class="voice-play" type="button" aria-label="Прослушать голосовое сообщение">▶</button>',
    // «волна»; role="slider" — перемотка; программа чтения с экрана назовёт её «Перемотка»
    `<div class="voice-wave" role="slider" tabindex="0" aria-label="Перемотка" aria-valuemin="0" aria-valuemax="${Number(seconds) || 0}" aria-valuenow="0">${bars}</div>`,
    // время: сначала полная длина
    `<span class="voice-time">${formatSeconds(seconds)}</span>`,
    // конец плеера
    '</div>',
  // склеиваем
  ].join('');
// конец функции voicePlayerHtml
}

// ----------------------------------------------------------------------------
// signedUrl — временная ссылка на файл (с запоминанием).
// Принимает: path. Возвращает: Promise со ссылкой.
// ----------------------------------------------------------------------------
// async function
async function signedUrl(path) {
  // уже есть — отдаём сразу
  if (urlCache.has(path)) return urlCache.get(path);
  // createSignedUrl(путь, секунды) — ссылка, которая работает ограниченное время
  const { data, error } = await supabase.storage.from(VOICE_BUCKET).createSignedUrl(path, LINK_LIFETIME);
  // ошибка — бросаем
  if (error) throw error;
  // запоминаем
  urlCache.set(path, data.signedUrl);
  // отдаём
  return data.signedUrl;
// конец функции signedUrl
}

// ----------------------------------------------------------------------------
// updatePlayer — перерисовывает плеер: кнопку, закрашенные полоски, время.
// Принимает: player — блок плеера; audio — элемент звука. Возвращает: ничего.
// ----------------------------------------------------------------------------
// function
function updatePlayer(player, audio) {
  // длина: у записей webm браузер часто не знает длину (Infinity) — тогда берём из базы
  const duration = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : Number(player.dataset.seconds) || 1;
  // доля прослушанного от 0 до 1
  const fraction = Math.min(1, audio.currentTime / duration);
  // кнопка: ⏸ во время игры, ▶ на паузе
  player.querySelector('.voice-play').textContent = audio.paused ? '▶' : '⏸';
  // подпись кнопки для программ чтения с экрана
  player.querySelector('.voice-play').setAttribute('aria-label', audio.paused ? 'Прослушать голосовое сообщение' : 'Пауза');
  // закрашиваем полоски до текущего места; toggle(класс, условие) — добавить или убрать класс
  player.querySelectorAll('.voice-bar').forEach((bar, i) => bar.classList.toggle('played', i / BARS < fraction));
  // время: во время игры — сколько прошло, иначе полная длина
  player.querySelector('.voice-time').textContent = formatSeconds(audio.paused && audio.currentTime === 0 ? duration : audio.currentTime);
  // для программ чтения с экрана
  player.querySelector('.voice-wave').setAttribute('aria-valuenow', String(Math.round(audio.currentTime)));
// конец функции updatePlayer
}

// ----------------------------------------------------------------------------
// togglePlay — включает или ставит на паузу голосовое сообщение.
// Принимает: player — блок плеера. Возвращает: Promise.
// ----------------------------------------------------------------------------
// async function
async function togglePlay(player) {
  // этот плеер уже играет или стоит на паузе — просто переключаем
  if (currentPlayer === player && currentAudio) {
    // на паузе — продолжаем, иначе — пауза; catch — браузер может отказать без клика
    if (currentAudio.paused) currentAudio.play().catch(logError); else currentAudio.pause();
    // стоп
    return;
  // конец if
  }
  // другой плеер играл — останавливаем его
  if (currentAudio) currentAudio.pause();
  // кнопка «загружается»
  player.querySelector('.voice-play').textContent = '…';
  // try — получение ссылки
  try {
    // временная ссылка
    const url = await signedUrl(player.dataset.voice);
    // new Audio(ссылка) — элемент звука без показа на странице
    const audio = new Audio(url);
    // запоминаем текущие
    currentAudio = audio;
    // и плеер
    currentPlayer = player;
    // timeupdate — позиция изменилась; play/pause — нажали кнопку
    ['timeupdate', 'play', 'pause'].forEach((name) => audio.addEventListener(name, () => updatePlayer(player, audio)));
    // ended — дослушали до конца: возвращаем в начало
    audio.addEventListener('ended', () => {
      // в начало
      audio.currentTime = 0;
      // перерисовываем
      updatePlayer(player, audio);
    // конец обработчика
    });
    // play() — начать; возвращает Promise
    await audio.play();
  // catch — не удалось загрузить или включить
  } catch (error) {
    // в консоль
    logError(error);
    // возвращаем кнопку
    player.querySelector('.voice-play').textContent = '▶';
    // подсказка прямо в плеере
    player.querySelector('.voice-time').textContent = 'ошибка';
  // конец try/catch
  }
// конец функции togglePlay
}

// ----------------------------------------------------------------------------
// seek — перемотка кликом по «волне».
// Принимает: player; event — событие клика. Возвращает: ничего.
// ----------------------------------------------------------------------------
// function
function seek(player, event) {
  // перематывать можно только то, что сейчас загружено
  if (currentPlayer !== player || !currentAudio) return;
  // прямоугольник «волны» на экране
  const rect = player.querySelector('.voice-wave').getBoundingClientRect();
  // доля: где кликнули по ширине, от 0 до 1
  const fraction = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
  // длина записи (как в updatePlayer)
  const duration = Number.isFinite(currentAudio.duration) && currentAudio.duration > 0 ? currentAudio.duration : Number(player.dataset.seconds) || 1;
  // перематываем
  currentAudio.currentTime = fraction * duration;
// конец функции seek
}

// ----------------------------------------------------------------------------
// initVoicePlayers — включает все плееры внутри контейнера (делегирование
// событий: один обработчик на весь контейнер, работает и для новых сообщений).
// Принимает: container — например, лента сообщений. Возвращает: ничего.
// ----------------------------------------------------------------------------
// export function
export function initVoicePlayers(container) {
  // клик внутри контейнера
  container.addEventListener('click', (event) => {
    // плеер, внутри которого кликнули
    const player = event.target.closest('.voice-player');
    // клик не по плееру — не наше дело
    if (!player) return;
    // кнопка ▶/⏸
    if (event.target.closest('.voice-play')) togglePlay(player);
    // «волна» — перемотка
    else if (event.target.closest('.voice-wave')) seek(player, event);
  // конец обработчика
  });
// конец функции initVoicePlayers
}
