// ============================================================================
// Файл: js/matching.js
// Зачем нужен: АЛГОРИТМ ПОДБОРА партнёров — главная часть проекта.
// Здесь только «чистые» функции: они получают данные и возвращают результат,
// ничего не читают из базы и ничего не меняют снаружи. Поэтому алгоритм легко
// проверить тестом (tests/matching.test.mjs) и объяснить (ALGORITHM.md).
//
// Идея:
//   1) рассматриваем только учеников одной школы (это обеспечивает база);
//   2) строим ГРАФ: стрелка А → Б, если А знает предмет на 4–5, который Б
//      хочет подтянуть, и уровень А выше уровня Б минимум на 2;
//   3) ПАРА — стрелки в обе стороны: А → Б и Б → А;
//   4) если пары нет — ищем ТРОЙКУ: А → Б → В → А;
//   5) считаем процент совместимости (знания 40%, время 35%, классы 25%);
//   6) сортируем по проценту; при равном проценте выше те совпадения, где
//      уровень помощников подтверждён мини-тестом (skills.verified_at).
//
// Как связан с остальными: js/pages/matches.js загружает данные из Supabase
// и передаёт их сюда. Названия предметов берутся из js/config.js.
// Те же правила «кто может помогать» проверяет SQL-функция can_teach
// (sql/schema.sql), чтобы обмен нельзя было создать в обход алгоритма.
// ============================================================================

// функция поиска предмета (нужна для текста объяснения)
import { getSubject } from './config.js';

// ----------------------------- ПРАВИЛА ПОДБОРА -------------------------------

// MIN_HELPER_LEVEL — минимальный уровень помощника: помогать можно только с предметом на 4 или 5
export const MIN_HELPER_LEVEL = 4;
// MIN_LEVEL_GAP — помощник должен знать предмет минимум на 2 уровня лучше ученика
export const MIN_LEVEL_GAP = 2;
// MAX_LEVEL_GAP — самая большая возможная разница уровней: 5 − 1 = 4
export const MAX_LEVEL_GAP = 4;

// ----------------------------- ВЕСА СОВМЕСТИМОСТИ ----------------------------

// WEIGHTS — сколько процентов даёт каждая часть; в сумме ровно 100
export const WEIGHTS = {
  // разница уровней знаний (чем больше помощник знает, тем лучше) — 40%
  level: 40,
  // совпадение свободного времени — 35%
  time: 35,
  // близость классов — 25%
  grade: 25,
// конец объекта WEIGHTS
};

// SLOTS_FOR_FULL_TIME — сколько общих «окошек» (день + часть дня) нужно для полных 35%: 3 общих окошка и больше — отлично
export const SLOTS_FOR_FULL_TIME = 3;
// IDEAL_GRADE_DIFF — разница классов до 2 включительно считается идеальной (полные 25%)
export const IDEAL_GRADE_DIFF = 2;
// ZERO_GRADE_DIFF — при разнице в 7 классов и больше за классы 0%
export const ZERO_GRADE_DIFF = 7;
// MIN_OTHER_STUDENTS — если других учеников с заполненным профилем меньше 3, говорим «в школе мало учеников»
export const MIN_OTHER_STUDENTS = 3;

// ----------------------------------------------------------------------------
// displayName — имя для показа: «Амир Т.».
// Принимает: student — объект ученика. Возвращает: строку.
// ----------------------------------------------------------------------------
// export function — функция доступна другим файлам
export function displayName(student) {
  // если буквы фамилии нет — только имя; иначе «Имя Б.»
  return student.lastInitial ? `${student.firstName} ${student.lastInitial}.` : student.firstName;
// конец функции displayName
}

// ----------------------------------------------------------------------------
// buildStudents — превращает строки из базы в удобные объекты учеников.
// Принимает: profiles — строки таблицы profiles; skills — строки skills;
//   availability — строки availability.
// Возвращает: массив объектов:
//   { id, firstName, lastInitial, avatar, grade, isBlocked,
//     knows: { предмет: уровень }, learns: { предмет: уровень },
//     verified: { предмет: true } — уровни «знаю», подтверждённые тестом,
//     slots: Set строк «день:часть» }
// ----------------------------------------------------------------------------
// export function
export function buildStudents(profiles, skills, availability) {
  // Map — словарь «ключ → значение»; здесь «id ученика → объект ученика»
  const byId = new Map();
  // for (const profile of profiles) — цикл: по очереди берём каждый профиль
  for (const profile of profiles) {
    // set(ключ, значение) — кладём ученика в словарь
    byId.set(profile.id, {
      // id ученика
      id: profile.id,
      // имя
      firstName: profile.first_name,
      // первая буква фамилии
      lastInitial: profile.last_initial,
      // аватар
      avatar: profile.avatar,
      // класс
      grade: profile.grade,
      // заблокирован ли учителем; Boolean превращает значение в true/false
      isBlocked: Boolean(profile.is_blocked),
      // предметы «знаю»: пустой объект, заполним ниже
      knows: {},
      // предметы «хочу подтянуть»
      learns: {},
      // предметы, уровень которых подтверждён тестом
      verified: {},
      // new Set() — пустое множество удобного времени
      slots: new Set(),
    // конец объекта ученика
    });
  // конец цикла по профилям
  }
  // раскладываем предметы по ученикам
  for (const skill of skills) {
    // get(ключ) — достаём ученика по id
    const student = byId.get(skill.user_id);
    // continue — пропустить эту строку и перейти к следующей (ученика нет в списке)
    if (!student) continue;
    // квадратные скобки [skill.subject] — ключ объекта из переменной; знает — в knows, иначе — в learns
    if (skill.kind === 'know') student.knows[skill.subject] = skill.level;
    // else — иначе
    else student.learns[skill.subject] = skill.level;
    // verified_at заполнен — уровень подтверждён тестом (у строк без этого столбца будет undefined — значит «нет»)
    if (skill.kind === 'know' && skill.verified_at) student.verified[skill.subject] = true;
  // конец цикла по предметам
  }
  // раскладываем удобное время
  for (const slot of availability) {
    // ученик этой отметки
    const student = byId.get(slot.user_id);
    // add добавляет строку «1:morning» во множество
    if (student) student.slots.add(`${slot.day}:${slot.part}`);
  // конец цикла по времени
  }
  // values() — все значения словаря; [...] превращает их в обычный массив
  return [...byId.values()];
// конец функции buildStudents
}

// ----------------------------------------------------------------------------
// getTeachableSubjects — с какими предметами helper может помочь learner.
// Правило: helper знает предмет на MIN_HELPER_LEVEL и выше, learner хочет его
// подтянуть, и разница уровней не меньше MIN_LEVEL_GAP.
// Принимает: helper — кто помогает; learner — кому помогают.
// Возвращает: массив { subject, helperLevel, learnerLevel, gap, verified },
//   отсортированный от самой большой разницы уровней к самой маленькой
//   (при равной разнице первым идёт предмет с подтверждённым уровнем).
// ----------------------------------------------------------------------------
// export function
export function getTeachableSubjects(helper, learner) {
  // Object.entries(learner.learns) — массив пар [предмет, уровень ученика]
  return Object.entries(learner.learns)
    // filter оставляет только подходящие предметы
    .filter(([subject, learnerLevel]) => {
      // уровень помощника по этому предмету; ?? 0 — если предмета нет среди «знаю», считаем 0
      const helperLevel = helper.knows[subject] ?? 0;
      // оба условия правила: знает на 4–5 И разница уровней не меньше 2
      return helperLevel >= MIN_HELPER_LEVEL && helperLevel - learnerLevel >= MIN_LEVEL_GAP;
    // конец filter
    })
    // map превращает пару в объект с подробностями
    .map(([subject, learnerLevel]) => ({
      // предмет
      subject,
      // уровень помощника
      helperLevel: helper.knows[subject],
      // уровень ученика
      learnerLevel,
      // разница уровней
      gap: helper.knows[subject] - learnerLevel,
      // подтверждён ли уровень помощника тестом; ?. — у старых объектов без verified не будет ошибки
      verified: Boolean(helper.verified?.[subject]),
    // конец объекта
    }))
    // по убыванию разницы; || — если разница равна (0), сравниваем подтверждение: Number(true) = 1
    .sort((a, b) => b.gap - a.gap || Number(b.verified) - Number(a.verified));
// конец функции getTeachableSubjects
}

// ----------------------------------------------------------------------------
// buildGraph — строит граф «кто кому может помочь».
// Граф хранится как словарь словарей:
//   graph.get(idА).get(idБ) = список предметов, с которыми А поможет Б.
// Если стрелки А → Б нет, то graph.get(idА).get(idБ) === undefined.
// Принимает: students — массив учеников. Возвращает: Map.
// ----------------------------------------------------------------------------
// export function
export function buildGraph(students) {
  // пустой граф
  const graph = new Map();
  // перебираем каждого возможного помощника
  for (const helper of students) {
    // стрелки, выходящие из helper
    const edges = new Map();
    // перебираем каждого возможного ученика
    for (const learner of students) {
      // сам себе не помогает
      if (helper.id === learner.id) continue;
      // с какими предметами helper поможет learner
      const subjects = getTeachableSubjects(helper, learner);
      // если хоть один предмет есть — рисуем стрелку helper → learner
      if (subjects.length > 0) edges.set(learner.id, subjects);
    // конец внутреннего цикла
    }
    // запоминаем все стрелки помощника
    graph.set(helper.id, edges);
  // конец внешнего цикла
  }
  // возвращаем граф
  return graph;
// конец функции buildGraph
}

// ----------------------------------------------------------------------------
// countSharedSlots — сколько общих «окошек» времени у двух учеников.
// Принимает: a, b — ученики. Возвращает: число.
// ----------------------------------------------------------------------------
// export function
export function countSharedSlots(a, b) {
  // [...a.slots] — массив окошек ученика a; filter оставляет те, что есть и у b (has — «есть ли во множестве»)
  return [...a.slots].filter((slot) => b.slots.has(slot)).length;
// конец функции countSharedSlots
}

// ----------------------------------------------------------------------------
// levelScore — оценка знаний от 0 до 1 для одной связи «помощник → ученик».
// Разница 2 → 0.5, разница 3 → 0.75, разница 4 → 1.
// Принимает: gap — разница уровней. Возвращает: число от 0 до 1.
// ----------------------------------------------------------------------------
// export function
export function levelScore(gap) {
  // Math.min(x, 1) — не больше 1; делим разницу на самую большую возможную
  return Math.min(gap / MAX_LEVEL_GAP, 1);
// конец функции levelScore
}

// ----------------------------------------------------------------------------
// timeScore — оценка совпадения времени от 0 до 1.
// 0 общих окошек → 0, 1 → 0.33, 2 → 0.67, 3 и больше → 1.
// Принимает: a, b — ученики. Возвращает: число от 0 до 1.
// ----------------------------------------------------------------------------
// export function
export function timeScore(a, b) {
  // общие окошки, но не больше SLOTS_FOR_FULL_TIME
  return Math.min(countSharedSlots(a, b), SLOTS_FOR_FULL_TIME) / SLOTS_FOR_FULL_TIME;
// конец функции timeScore
}

// ----------------------------------------------------------------------------
// gradeScore — оценка близости классов от 0 до 1.
// Разница 0–2 класса → 1; дальше плавно уменьшается; 7 и больше → 0.
// Принимает: a, b — ученики. Возвращает: число от 0 до 1.
// ----------------------------------------------------------------------------
// export function
export function gradeScore(a, b) {
  // если у кого-то не указан класс — оценить нельзя, ставим 0
  if (!a.grade || !b.grade) return 0;
  // Math.abs — модуль числа (разница без знака минус)
  const diff = Math.abs(a.grade - b.grade);
  // близкие классы — идеально
  if (diff <= IDEAL_GRADE_DIFF) return 1;
  // Math.max(0, ...) — не меньше нуля; линейно уменьшаем от 1 до 0
  return Math.max(0, 1 - (diff - IDEAL_GRADE_DIFF) / (ZERO_GRADE_DIFF - IDEAL_GRADE_DIFF));
// конец функции gradeScore
}

// ----------------------------------------------------------------------------
// average — среднее арифметическое массива чисел.
// Принимает: numbers — массив. Возвращает: число (0 для пустого массива).
// ----------------------------------------------------------------------------
// function без export — нужна только здесь
function average(numbers) {
  // пустой массив — среднее 0
  if (numbers.length === 0) return 0;
  // reduce складывает все числа: sum — накопленная сумма, n — очередное число, 0 — начальное значение
  return numbers.reduce((sum, n) => sum + n, 0) / numbers.length;
// конец функции average
}

// ----------------------------------------------------------------------------
// calculateCompatibility — процент совместимости для пары или тройки.
// Для каждой связи «помощник → ученик» считаем три оценки, берём среднее
// по всем связям и умножаем на веса.
// Принимает: links — массив связей { teacher, learner, gap }.
// Возвращает: { percent, parts: { level, time, grade } } — части в баллах
//   (например, level: 30 из 40), percent — их сумма от 0 до 100.
// ----------------------------------------------------------------------------
// export function
export function calculateCompatibility(links) {
  // средняя оценка знаний по всем связям
  const level = average(links.map((link) => levelScore(link.gap)));
  // средняя оценка времени между помощником и учеником каждой связи
  const time = average(links.map((link) => timeScore(link.teacher, link.learner)));
  // средняя оценка классов
  const grade = average(links.map((link) => gradeScore(link.teacher, link.learner)));
  // Math.round округляет до целого; переводим оценки 0–1 в баллы по весам
  const parts = {
    // баллы за знания (из 40)
    level: Math.round(level * WEIGHTS.level),
    // баллы за время (из 35)
    time: Math.round(time * WEIGHTS.time),
    // баллы за классы (из 25)
    grade: Math.round(grade * WEIGHTS.grade),
  // конец объекта parts
  };
  // итоговый процент — сумма баллов (так на экране части точно складываются в итог)
  return { percent: parts.level + parts.time + parts.grade, parts };
// конец функции calculateCompatibility
}

// ----------------------------------------------------------------------------
// pickSubject — выбирает предмет для связи: если задан фильтр и такой предмет
// подходит — берём его, иначе лучший (с самой большой разницей уровней).
// Принимает: subjects — список из getTeachableSubjects; preferred — id предмета или ''.
// Возвращает: один объект { subject, helperLevel, learnerLevel, gap }.
// ----------------------------------------------------------------------------
// function
function pickSubject(subjects, preferred) {
  // ищем предпочтительный предмет; если не нашли — берём первый (лучший)
  return subjects.find((item) => item.subject === preferred) ?? subjects[0];
// конец функции pickSubject
}

// ----------------------------------------------------------------------------
// makeLink — создаёт одну связь «teacher учит learner предмету».
// Принимает: teacher, learner — ученики; choice — выбранный предмет.
// Возвращает: объект связи.
// ----------------------------------------------------------------------------
// function
function makeLink(teacher, learner, choice) {
  // ...choice — «распаковываем» поля subject, helperLevel, learnerLevel, gap
  return { teacher, learner, ...choice };
// конец функции makeLink
}

// ----------------------------------------------------------------------------
// makeMatch — собирает объект совпадения и считает совместимость.
// Принимает: type — 'pair' или 'triple'; members — ученики (первый — «я»);
//   links — связи. Возвращает: объект совпадения.
// ----------------------------------------------------------------------------
// function
function makeMatch(type, members, links) {
  // процент и части
  const { percent, parts } = calculateCompatibility(links);
  // сколько связей с подтверждённым тестом уровнем помощника (нужно для сортировки)
  const verifiedCount = links.filter((link) => link.verified).length;
  // id — склеенные id участников, уникальный ключ совпадения
  return { id: members.map((member) => member.id).join('|'), type, members, links, percent, parts, verifiedCount };
// конец функции makeMatch
}

// ----------------------------------------------------------------------------
// findPairs — ищет прямые пары для ученика me: стрелки me → X и X → me.
// Принимает: me — ученик; graph — граф; byId — Map «id → ученик»;
//   preferred — предмет из фильтра ('' — без фильтра).
// Возвращает: массив совпадений типа 'pair'.
// ----------------------------------------------------------------------------
// export function
export function findPairs(me, graph, byId, preferred = '') {
  // сюда соберём пары
  const pairs = [];
  // стрелки из me: кому я могу помочь; ?? new Map() — если стрелок нет, пустой словарь
  const outgoing = graph.get(me.id) ?? new Map();
  // for (const [otherId, iTeach] of outgoing) — перебираем пары «id ученика → чему я могу его научить»
  for (const [otherId, iTeach] of outgoing) {
    // ?. — если у другого ученика нет стрелок, получим undefined; есть ли стрелка other → me
    const theyTeach = graph.get(otherId)?.get(me.id);
    // нет обратной стрелки — не пара
    if (!theyTeach) continue;
    // объект второго ученика
    const other = byId.get(otherId);
    // две связи: я → он и он → я
    const links = [makeLink(me, other, pickSubject(iTeach, preferred)), makeLink(other, me, pickSubject(theyTeach, preferred))];
    // push добавляет элемент в конец массива
    pairs.push(makeMatch('pair', [me, other], links));
  // конец цикла
  }
  // возвращаем найденные пары
  return pairs;
// конец функции findPairs
}

// ----------------------------------------------------------------------------
// findTriples — ищет тройки для ученика me: me → B → C → me.
// Принимает: me, graph, byId, preferred — как у findPairs.
// Возвращает: массив совпадений типа 'triple'.
// ----------------------------------------------------------------------------
// export function
export function findTriples(me, graph, byId, preferred = '') {
  // сюда соберём тройки
  const triples = [];
  // шаг 1: B — кому могу помочь я
  for (const [bId, iTeachB] of graph.get(me.id) ?? new Map()) {
    // шаг 2: C — кому может помочь B
    for (const [cId, bTeachC] of graph.get(bId) ?? new Map()) {
      // C не должен быть мной (тогда это пара, а не тройка)
      if (cId === me.id) continue;
      // шаг 3: может ли C помочь мне — замыкаем круг
      const cTeachMe = graph.get(cId)?.get(me.id);
      // круг не замкнулся
      if (!cTeachMe) continue;
      // объекты учеников B и C
      const b = byId.get(bId);
      // ученик C
      const c = byId.get(cId);
      // три связи по кругу
      const links = [
        // я → B
        makeLink(me, b, pickSubject(iTeachB, preferred)),
        // B → C
        makeLink(b, c, pickSubject(bTeachC, preferred)),
        // C → я
        makeLink(c, me, pickSubject(cTeachMe, preferred)),
      // конец массива связей
      ];
      // добавляем тройку
      triples.push(makeMatch('triple', [me, b, c], links));
    // конец цикла по C
    }
  // конец цикла по B
  }
  // возвращаем тройки
  return triples;
// конец функции findTriples
}

// ----------------------------------------------------------------------------
// canHelpSomeone — есть ли у ученика хоть один предмет на 4–5 (может помогать).
// Принимает: student. Возвращает: boolean.
// ----------------------------------------------------------------------------
// export function
export function canHelpSomeone(student) {
  // Object.values — массив уровней «знаю»; some — есть ли хоть один >= 4
  return Object.values(student.knows).some((level) => level >= MIN_HELPER_LEVEL);
// конец функции canHelpSomeone
}

// ----------------------------------------------------------------------------
// isReadyForMatching — заполнен ли профиль настолько, чтобы участвовать в подборе:
// есть предмет «хочу подтянуть» и предмет «знаю» на 4–5.
// Принимает: student. Возвращает: boolean.
// ----------------------------------------------------------------------------
// export function
export function isReadyForMatching(student) {
  // Object.keys(...).length — сколько предметов «хочу подтянуть»
  return Object.keys(student.learns).length > 0 && canHelpSomeone(student);
// конец функции isReadyForMatching
}

// ----------------------------------------------------------------------------
// findMatchesForStudent — ГЛАВНАЯ функция: все совпадения для одного ученика.
// Принимает:
//   meId — id ученика, для которого ищем;
//   students — все ученики школы (из buildStudents);
//   options — { excludedIds: id, которых не предлагать (уже партнёры,
//     заблокированные), preferredSubject: предмет из фильтра }.
// Возвращает: {
//   status: 'ok' | 'no-profile' | 'blocked' | 'incomplete' | 'few-students' | 'no-matches',
//   missing: что не заполнено (для 'incomplete'): 'learn', 'know',
//   noTime: true, если ученик не отметил удобное время,
//   pairs: [...], triples: [...] }
// ----------------------------------------------------------------------------
// options = {} — по умолчанию пустой объект
export function findMatchesForStudent(meId, students, options = {}) {
  // деструктуризация с значениями по умолчанию
  const { excludedIds = [], preferredSubject = '' } = options;
  // заготовка ответа: пустые списки
  const empty = { pairs: [], triples: [], missing: [], noTime: false };
  // находим себя среди учеников
  const me = students.find((student) => student.id === meId);
  // нет профиля ученика — случай 'no-profile'
  if (!me) return { ...empty, status: 'no-profile' };
  // заблокированного учителем ученика в подбор не пускаем
  if (me.isBlocked) return { ...empty, status: 'blocked' };
  // что не заполнено в профиле
  const missing = [];
  // нет предметов «хочу подтянуть»
  if (Object.keys(me.learns).length === 0) missing.push('learn');
  // нет предмета «знаю» на 4–5
  if (!canHelpSomeone(me)) missing.push('know');
  // профиль не готов — случай 'incomplete'
  if (missing.length > 0) return { ...empty, status: 'incomplete', missing };
  // Set из исключённых id — быстрая проверка has()
  const excluded = new Set(excludedIds);
  // кандидаты: не я, не заблокированы, не исключены, профиль заполнен
  const candidates = students.filter((student) => student.id !== me.id && !student.isBlocked && !excluded.has(student.id) && isReadyForMatching(student));
  // все участники подбора: я и кандидаты
  const pool = [me, ...candidates];
  // словарь «id → ученик» для быстрого поиска
  const byId = new Map(pool.map((student) => [student.id, student]));
  // строим граф
  const graph = buildGraph(pool);
  // ищем пары и сортируем (по проценту, при равенстве — по подтверждённым уровням)
  const pairs = findPairs(me, graph, byId, preferredSubject).sort(compareMatches);
  // тройки ищем ТОЛЬКО если пар нет (по заданию)
  const triples = pairs.length === 0 ? findTriples(me, graph, byId, preferredSubject).sort(compareMatches) : [];
  // итоговый статус
  let status = 'ok';
  // ничего не нашли — почему?
  if (pairs.length === 0 && triples.length === 0) status = candidates.length < MIN_OTHER_STUDENTS ? 'few-students' : 'no-matches';
  // возвращаем результат; noTime — подсказка отметить время
  return { status, missing: [], noTime: me.slots.size === 0, pairs, triples };
// конец функции findMatchesForStudent
}

// ----------------------------------------------------------------------------
// compareMatches — порядок совпадений: выше процент — выше в списке; при
// равном проценте выше то, где больше помощников с подтверждённым уровнем.
// Принимает: a, b — совпадения. Возвращает: число для sort (меньше 0 — a раньше).
// ----------------------------------------------------------------------------
// export function
export function compareMatches(a, b) {
  // разница процентов; если 0 — разница числа подтверждённых связей (?? 0 — у совпадения нет поля)
  return b.percent - a.percent || (b.verifiedCount ?? 0) - (a.verifiedCount ?? 0);
// конец функции compareMatches
}

// ----------------------------------------------------------------------------
// filterMatches — фильтры экрана совпадений: по предмету и по классу.
// Принимает: matches — массив совпадений; filters — { subject, grade }.
// Возвращает: отфильтрованный массив.
// ----------------------------------------------------------------------------
// export function
export function filterMatches(matches, { subject = '', grade = '' } = {}) {
  // оставляем совпадения, подходящие под оба фильтра
  return matches.filter((match) => {
    // фильтр по предмету: хотя бы одна связь с этим предметом (пустой фильтр — подходит всё)
    const subjectOk = !subject || match.links.some((link) => link.subject === subject);
    // фильтр по классу: кто-то из партнёров (кроме меня — members[0]) в этом классе; Number — строку из списка в число
    const gradeOk = !grade || match.members.slice(1).some((member) => member.grade === Number(grade));
    // оба условия
    return subjectOk && gradeOk;
  // конец filter
  });
// конец функции filterMatches
}

// ----------------------------------------------------------------------------
// explainMatch — объяснение совпадения простыми словами.
// Пара:   «Лена К. поможет тебе с алгеброй, а ты в ответ — с английским».
// Тройка: «Помощь по кругу: ты → Лена К. (английский), Лена К. → Тимур Л. (химия),
//          Тимур Л. → ты (геометрия)».
// Принимает: match — совпадение (members[0] — это «я»). Возвращает: строку.
// ----------------------------------------------------------------------------
// export function
export function explainMatch(match) {
  // первый участник — я
  const me = match.members[0];
  // имя участника или «ты», если это я
  const nameOf = (student) => (student.id === me.id ? 'ты' : displayName(student));
  // для пары
  if (match.type === 'pair') {
    // связь «я учу партнёра» — первая, «партнёр учит меня» — вторая
    const [iTeach, theyTeach] = match.links;
    // собираем фразу; withName — название в творительном падеже
    return `${displayName(theyTeach.teacher)} поможет тебе с ${getSubject(theyTeach.subject).withName}, а ты в ответ — с ${getSubject(iTeach.subject).withName}`;
  // конец if
  }
  // для тройки: каждую связь описываем как «кто → кому (предмет)»
  const steps = match.links.map((link) => `${nameOf(link.teacher)} → ${nameOf(link.learner)} (${getSubject(link.subject).name.toLowerCase()})`);
  // склеиваем через запятую
  return `Помощь по кругу: ${steps.join(', ')}`;
// конец функции explainMatch
}
