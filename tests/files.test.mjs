// ============================================================================
// Файл: tests/files.test.mjs
// Зачем нужен: проверка функций js/files.js — какие файлы можно загрузить,
// как показывается размер и как строится путь в хранилище.
// Как запустить: node tests/files.test.mjs
// Как связан с остальными: импортирует js/files.js (тот же код, что на сайте).
// ============================================================================

// модуль проверок Node.js
import assert from 'node:assert/strict';
// проверяемые функции
import { validateFile, formatFileSize, buildStoragePath, isImage } from '../js/files.js';

// счётчики
let passed = 0;
// упавшие
let failed = 0;

// ----------------------------------------------------------------------------
// test — запускает один тест и печатает результат.
// Принимает: name; fn — функция с проверками. Возвращает: ничего.
// ----------------------------------------------------------------------------
// function
function test(name, fn) {
  // try — проверка может не пройти
  try {
    // запускаем
    fn();
    // прошёл
    passed++;
    // печатаем
    console.log(`  ✔ ${name}`);
  // не прошёл
  } catch (error) {
    // счётчик
    failed++;
    // печатаем причину
    console.log(`  ✘ ${name}\n    ${error.message}`);
  // конец try/catch
  }
// конец функции test
}

// МБ — 1 мегабайт в байтах
const MB = 1024 * 1024;

// заголовок
console.log('\nПроверка файлов (js/files.js)\n');

// картинки и PDF до 5 МБ — можно
test('Картинка 1 МБ и PDF 5 МБ проходят проверку', () => {
  // JPEG 1 МБ — ошибок нет
  assert.equal(validateFile({ type: 'image/jpeg', size: MB }), '');
  // PDF ровно 5 МБ — ещё можно
  assert.equal(validateFile({ type: 'application/pdf', size: 5 * MB }), '');
// конец теста
});

// слишком большой
test('Файл больше 5 МБ не проходит', () => {
  // 5 МБ + 1 байт
  assert.match(validateFile({ type: 'image/png', size: 5 * MB + 1 }), /слишком большой/);
// конец теста
});

// неразрешённые типы
test('Word, программы и видео не проходят', () => {
  // документ Word
  assert.match(validateFile({ type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', size: 1000 }), /нельзя/);
  // программа .exe
  assert.match(validateFile({ type: 'application/x-msdownload', size: 1000 }), /нельзя/);
  // видео
  assert.match(validateFile({ type: 'video/mp4', size: 1000 }), /нельзя/);
  // SVG тоже нельзя: внутри SVG может быть скрипт
  assert.match(validateFile({ type: 'image/svg+xml', size: 1000 }), /нельзя/);
// конец теста
});

// пустые случаи
test('Нет файла или пустой файл — понятная ошибка', () => {
  // ничего не выбрано
  assert.equal(validateFile(null), 'Выбери файл');
  // 0 байт
  assert.equal(validateFile({ type: 'image/png', size: 0 }), 'Файл пустой');
// конец теста
});

// размер по-человечески
test('Размер показывается в Б, КБ и МБ', () => {
  // байты
  assert.equal(formatFileSize(500), '500 Б');
  // килобайты
  assert.equal(formatFileSize(2048), '2 КБ');
  // мегабайты с запятой
  assert.equal(formatFileSize(1.5 * MB), '1,5 МБ');
// конец теста
});

// путь в хранилище
test('Путь в хранилище: папка партнёрства, латиница, правильное расширение', () => {
  // передаём время и случайную часть явно, чтобы результат был предсказуем
  assert.equal(buildStoragePath(12, 'application/pdf', 1700000000000, 'abc123'), '12/1700000000000-abc123.pdf');
  // для картинки — jpg
  assert.match(buildStoragePath(3, 'image/jpeg'), /^3\/\d+-[a-z0-9]+\.jpg$/);
  // isImage
  assert.equal(isImage('image/png') && !isImage('application/pdf'), true);
// конец теста
});

// режим «только картинки» (фото к вопросам и ответам)
test('Режим «только фото»: PDF нельзя, картинку можно', () => {
  // PDF отклоняется
  assert.match(validateFile({ type: 'application/pdf', size: 1000 }, { imagesOnly: true }), /только фото/);
  // PNG проходит
  assert.equal(validateFile({ type: 'image/png', size: 1000 }, { imagesOnly: true }), '');
// конец теста
});

// итог
console.log(`\nИтого: пройдено ${passed}, не пройдено ${failed}\n`);
// код ошибки для системы, если что-то упало
if (failed > 0) process.exitCode = 1;
