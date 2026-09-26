// ============================================================================
// Файл: tests/matching.test.mjs
// Зачем нужен: автоматическая проверка алгоритма подбора (js/matching.js).
// Каждый тест создаёт маленькую «школу» из выдуманных учеников и проверяет,
// что алгоритм находит правильные пары и тройки и правильно считает процент.
// Как запустить: в папке проекта выполнить команду  node tests/matching.test.mjs
// (нужен Node.js 22 или новее). Расширение .mjs говорит Node.js, что это ES-модуль.
// Как связан с остальными: импортирует функции из js/matching.js — тот же код,
// что работает на сайте. Базу данных тест не трогает.
// ============================================================================

// assert — встроенный в Node.js модуль проверок: если условие неверно, он «бросает» ошибку
import assert from 'node:assert/strict';
// функции алгоритма, которые проверяем
import { buildStudents, getTeachableSubjects, findMatchesForStudent, calculateCompatibility, filterMatches, explainMatch, gradeScore, WEIGHTS } from '../js/matching.js';

// счётчик пройденных тестов
let passed = 0;
// счётчик упавших тестов
let failed = 0;

// ----------------------------------------------------------------------------
// test — запускает один тест и печатает результат.
// Принимает: name — название теста; fn — функция с проверками.
// Возвращает: ничего.
// ----------------------------------------------------------------------------
// function
function test(name, fn) {
  // try — если внутри fn какая-то проверка не пройдёт, попадём в catch
  try {
    // запускаем проверки
    fn();
    // увеличиваем счётчик (++ — прибавить 1)
    passed++;
    // печатаем зелёную галочку; console.log — вывод в терминал
    console.log(`  ✔ ${name}`);
  // catch — тест не прошёл
  } catch (error) {
    // счётчик упавших
    failed++;
    // печатаем крестик и причину
    console.log(`  ✘ ${name}\n    ${error.message}`);
  // конец try/catch
  }
// конец функции test
}

// ----------------------------------------------------------------------------
// makeSchool — создаёт учеников в формате алгоритма из короткого описания.
// Принимает: list — массив { id, grade, know: {предмет: уровень},
//   learn: {предмет: уровень}, slots: ['1:afternoon', ...], blocked }.
// Возвращает: массив учеников (как buildStudents для строк из базы).
// ----------------------------------------------------------------------------
// function
function makeSchool(list) {
  // профили — как строки таблицы profiles
  const profiles = list.map((s) => ({ id: s.id, first_name: s.id, last_initial: 'Т', avatar: '🦊', grade: s.grade ?? 8, is_blocked: s.blocked ?? false }));
  // flatMap — у каждого ученика несколько предметов; собираем все строки в один массив
  const skills = list.flatMap((s) => [
    // предметы «знаю»; verified — список предметов, подтверждённых тестом (у них есть дата verified_at)
    ...Object.entries(s.know ?? {}).map(([subject, level]) => ({ user_id: s.id, subject, kind: 'know', level, verified_at: (s.verified ?? []).includes(subject) ? '2026-09-01T10:00:00Z' : null })),
    // предметы «хочу подтянуть»
    ...Object.entries(s.learn ?? {}).map(([subject, level]) => ({ user_id: s.id, subject, kind: 'learn', level })),
  // конец массива
  ]);
  // удобное время — как строки таблицы availability
  const availability = list.flatMap((s) => (s.slots ?? []).map((slot) => ({ user_id: s.id, day: Number(slot.split(':')[0]), part: slot.split(':')[1] })));
  // превращаем всё в учеников алгоритма
  return buildStudents(profiles, skills, availability);
// конец функции makeSchool
}

// заголовок в терминале
console.log('\nПроверка алгоритма подбора (js/matching.js)\n');

// --- тест 1: правило стрелки ---
test('Стрелка есть, только если помощник знает на 4–5 и лучше минимум на 2', () => {
  // ученики: A знает английский на 5, B — на 4, C — на 3; D хочет подтянуть английский с уровнем 2
  const [a, b, c, d] = makeSchool([
    // A: 5 − 2 = 3 → подходит
    { id: 'A', know: { english: 5 } },
    // B: 4 − 2 = 2 → подходит (ровно минимум)
    { id: 'B', know: { english: 4 } },
    // C: уровень 3 — меньше 4 → не подходит
    { id: 'C', know: { english: 3 } },
    // D — ученик
    { id: 'D', learn: { english: 2 } },
  // конец списка
  ]);
  // A может помочь D
  assert.equal(getTeachableSubjects(a, d).length, 1);
  // B может помочь D
  assert.equal(getTeachableSubjects(b, d).length, 1);
  // C не может
  assert.equal(getTeachableSubjects(c, d).length, 0);
  // проверим разницу меньше 2: E знает на 4, F хочет с уровнем 3 → разница 1 → нельзя
  const [e, f] = makeSchool([{ id: 'E', know: { physics: 4 } }, { id: 'F', learn: { physics: 3 } }]);
  // стрелки нет
  assert.equal(getTeachableSubjects(e, f).length, 0);
// конец теста
});

// --- тест 2: прямая пара ---
test('Находит прямую пару: А → Б и Б → А', () => {
  // Амир знает английский, хочет алгебру; Лена — наоборот
  const school = makeSchool([
    // Амир
    { id: 'Amir', know: { english: 5 }, learn: { algebra: 2 } },
    // Лена
    { id: 'Lena', know: { algebra: 5 }, learn: { english: 2 } },
  // конец списка
  ]);
  // ищем совпадения для Амира
  const result = findMatchesForStudent('Amir', school);
  // одна пара
  assert.equal(result.pairs.length, 1);
  // партнёр — Лена (members[1])
  assert.equal(result.pairs[0].members[1].id, 'Lena');
  // когда пара есть, тройки не ищем
  assert.equal(result.triples.length, 0);
// конец теста
});

// --- тест 3: тройка ---
test('Если пары нет, находит тройку А → Б → В → А', () => {
  // по кругу: A учит B английскому, B учит C химии, C учит A геометрии
  const school = makeSchool([
    // A
    { id: 'A', know: { english: 5 }, learn: { geometry: 1 } },
    // B
    { id: 'B', know: { chemistry: 5 }, learn: { english: 2 } },
    // C
    { id: 'C', know: { geometry: 5 }, learn: { chemistry: 2 } },
  // конец списка
  ]);
  // ищем для A
  const result = findMatchesForStudent('A', school);
  // пар нет
  assert.equal(result.pairs.length, 0);
  // одна тройка
  assert.equal(result.triples.length, 1);
  // порядок по кругу: A, B, C
  assert.deepEqual(result.triples[0].members.map((m) => m.id), ['A', 'B', 'C']);
// конец теста
});

// --- тест 4: процент совместимости ---
test('Процент: идеальная пара даёт 100, веса 40 + 35 + 25', () => {
  // веса в сумме 100
  assert.equal(WEIGHTS.level + WEIGHTS.time + WEIGHTS.grade, 100);
  // разница уровней 4 (5 − 1), три общих окошка, одинаковый класс
  const slots = ['1:afternoon', '2:afternoon', '3:afternoon'];
  // школа из двух идеальных партнёров
  const school = makeSchool([
    // A
    { id: 'A', grade: 8, know: { english: 5 }, learn: { algebra: 1 }, slots },
    // B
    { id: 'B', grade: 8, know: { algebra: 5 }, learn: { english: 1 }, slots },
  // конец списка
  ]);
  // пара
  const pair = findMatchesForStudent('A', school).pairs[0];
  // 100%
  assert.equal(pair.percent, 100);
  // части
  assert.deepEqual(pair.parts, { level: 40, time: 35, grade: 25 });
// конец теста
});

// --- тест 5: части процента ---
test('Процент: разница уровней 2, нет общего времени, классы далеко', () => {
  // A (5 класс) и B (11 класс): разница 6 классов
  const [a, b] = makeSchool([{ id: 'A', grade: 5, slots: ['1:morning'] }, { id: 'B', grade: 11, slots: ['2:evening'] }]);
  // одна связь с разницей уровней 2
  const result = calculateCompatibility([{ teacher: a, learner: b, gap: 2 }]);
  // знания: 2/4 = 0.5 → 20 баллов; время: 0; классы: 1 − (6−2)/5 = 0.2 → 5 баллов
  assert.deepEqual(result.parts, { level: 20, time: 0, grade: 5 });
  // итог 25
  assert.equal(result.percent, 25);
  // классы: разница 2 — идеально
  assert.equal(gradeScore({ grade: 7 }, { grade: 9 }), 1);
// конец теста
});

// --- тест 6: сортировка ---
test('Результаты отсортированы по проценту (сначала лучшие)', () => {
  // у A два возможных партнёра: B (с общим временем) и C (без)
  const school = makeSchool([
    // A
    { id: 'A', know: { english: 5 }, learn: { algebra: 2 }, slots: ['1:afternoon', '2:afternoon'] },
    // C — без общего времени
    { id: 'C', know: { algebra: 5 }, learn: { english: 2 }, slots: ['7:evening'] },
    // B — с общим временем
    { id: 'B', know: { algebra: 5 }, learn: { english: 2 }, slots: ['1:afternoon', '2:afternoon'] },
  // конец списка
  ]);
  // пары для A
  const { pairs } = findMatchesForStudent('A', school);
  // первым идёт B — у него процент выше
  assert.equal(pairs[0].members[1].id, 'B');
  // проценты по убыванию
  assert.ok(pairs[0].percent >= pairs[1].percent);
// конец теста
});

// --- тест 7: исключения ---
test('Не предлагает текущих партнёров, заблокированных учителем и заблокированных пользователем', () => {
  // четыре возможных партнёра для A
  const school = makeSchool([
    // A
    { id: 'A', know: { english: 5 }, learn: { algebra: 2 } },
    // B — уже партнёр
    { id: 'B', know: { algebra: 5 }, learn: { english: 2 } },
    // C — заблокирован учителем
    { id: 'C', know: { algebra: 5 }, learn: { english: 2 }, blocked: true },
    // D — в личном чёрном списке
    { id: 'D', know: { algebra: 5 }, learn: { english: 2 } },
    // E — подходит
    { id: 'E', know: { algebra: 5 }, learn: { english: 2 } },
  // конец списка
  ]);
  // B и D передаём в исключения (так делает js/pages/matches.js)
  const { pairs } = findMatchesForStudent('A', school, { excludedIds: ['B', 'D'] });
  // остался только E
  assert.deepEqual(pairs.map((p) => p.members[1].id), ['E']);
// конец теста
});

// --- тест 8: крайние случаи ---
test('Крайние случаи: пустой профиль, мало учеников, нет совпадений, блокировка', () => {
  // A не заполнил «хочу подтянуть»
  let school = makeSchool([{ id: 'A', know: { english: 5 } }, { id: 'B', know: { algebra: 5 }, learn: { english: 2 } }]);
  // статус «профиль не заполнен», не хватает learn
  assert.deepEqual([findMatchesForStudent('A', school).status, findMatchesForStudent('A', school).missing], ['incomplete', ['learn']]);
  // A один в школе
  school = makeSchool([{ id: 'A', know: { english: 5 }, learn: { algebra: 2 } }]);
  // статус «мало учеников»
  assert.equal(findMatchesForStudent('A', school).status, 'few-students');
  // много учеников, но никто не знает алгебру
  school = makeSchool(['A', 'B', 'C', 'D'].map((id) => ({ id, know: { english: 5 }, learn: { algebra: 2 } })));
  // статус «нет совпадений»
  assert.equal(findMatchesForStudent('A', school).status, 'no-matches');
  // A заблокирован учителем
  school = makeSchool([{ id: 'A', know: { english: 5 }, learn: { algebra: 2 }, blocked: true }]);
  // статус «заблокирован»
  assert.equal(findMatchesForStudent('A', school).status, 'blocked');
// конец теста
});

// --- тест 9: фильтры и объяснение ---
test('Фильтры по предмету и классу, объяснение простыми словами', () => {
  // A может обменяться с B (7 класс, алгебра) и с C (9 класс, физика)
  const school = makeSchool([
    // A
    { id: 'Amir', grade: 8, know: { english: 5 }, learn: { algebra: 2, physics: 2 } },
    // B
    { id: 'Lena', grade: 7, know: { algebra: 5 }, learn: { english: 2 } },
    // C
    { id: 'Timur', grade: 9, know: { physics: 5 }, learn: { english: 1 } },
  // конец списка
  ]);
  // все пары
  const { pairs } = findMatchesForStudent('Amir', school);
  // фильтр по физике — только Тимур
  assert.deepEqual(filterMatches(pairs, { subject: 'physics' }).map((p) => p.members[1].id), ['Timur']);
  // фильтр по 7 классу — только Лена
  assert.deepEqual(filterMatches(pairs, { grade: '7' }).map((p) => p.members[1].id), ['Lena']);
  // объяснение для пары с Леной
  const lenaPair = pairs.find((p) => p.members[1].id === 'Lena');
  // проверяем текст
  assert.equal(explainMatch(lenaPair), 'Lena Т. поможет тебе с алгеброй, а ты в ответ — с английским');
// конец теста
});

// --- тест 10: подтверждённый тестом уровень ---
test('Подтверждённый тестом уровень: помечается и поднимает совпадение при равном проценте', () => {
  // B и C одинаковые (тот же класс, уровни и время), но у C уровень алгебры подтверждён тестом
  const school = makeSchool([
    // A хочет алгебру, знает английский
    { id: 'A', know: { english: 5 }, learn: { algebra: 2 }, slots: ['1:afternoon'] },
    // B — уровень не подтверждён
    { id: 'B', know: { algebra: 5 }, learn: { english: 2 }, slots: ['1:afternoon'] },
    // C — уровень подтверждён
    { id: 'C', know: { algebra: 5 }, learn: { english: 2 }, slots: ['1:afternoon'], verified: ['algebra'] },
    // D нужен, чтобы в школе было достаточно учеников
    { id: 'D', know: { history: 5 }, learn: { biology: 2 } },
  // конец списка
  ]);
  // ищем совпадения для A
  const result = findMatchesForStudent('A', school);
  // проценты у B и C одинаковые
  assert.equal(result.pairs[0].percent, result.pairs[1].percent);
  // первым стоит C — его уровень подтверждён
  assert.equal(result.pairs[0].members[1].id, 'C');
  // в связи «C учит A» стоит отметка verified
  assert.equal(result.pairs[0].links[1].verified, true);
  // у B отметки нет
  assert.equal(result.pairs[1].links[1].verified, false);
// конец теста
});

// итог в терминале
console.log(`\nИтого: пройдено ${passed}, не пройдено ${failed}\n`);
// process.exitCode = 1 — сообщаем системе, что были ошибки (важно для автоматических проверок)
if (failed > 0) process.exitCode = 1;
