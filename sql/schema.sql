-- ============================================================================
-- Файл: sql/schema.sql
-- Зачем нужен: создаёт ВСЮ базу данных SkillSwap в Supabase (PostgreSQL):
--   1) таблицы и связи между ними;
--   2) индексы для быстрого поиска;
--   3) вспомогательные функции (проверка ролей и прав);
--   4) триггеры: регистрация, очки, бейджи, уведомления;
--   5) функции RPC — «кнопки» на сервере, которые сайт вызывает через
--      supabase.rpc('имя_функции', {...}) для сложных действий;
--   6) Row Level Security (RLS) — правила «кто какие строки видит и меняет»;
--   7) хранилище файлов Storage (корзины materials, qa-images, voice) и его правила;
--   8) Realtime — мгновенная доставка сообщений, уведомлений, рисунков
--      общей доски и состояния общего таймера;
--   9) вопросы мини-тестов для подтверждения уровня (часть 13);
--  10) подсказки ИИ к вопросам и дневной лимит (часть 14).
-- Как связан с остальными: сайт (папка js/) работает только с тем, что здесь
-- создано. Демо-данные — в sql/seed.sql, полный сброс базы — sql/reset.sql.
-- Как выполнить: Supabase → SQL Editor → New query → вставить весь файл → Run.
-- Выполнять ОДИН раз на новом проекте (повторный запуск — сначала reset.sql).
-- ============================================================================


-- ############################################################################
-- ЧАСТЬ 1. ТИПЫ И ТАБЛИЦЫ
-- ############################################################################

-- create domain — создаёт свой тип данных на основе существующего; subject_code — это text, но только из списка предметов
create domain public.subject_code as text
  -- check (value in (...)) — ограничение: значение должно быть одним из перечисленных (id предметов из js/config.js)
  check (value in ('math', 'algebra', 'geometry', 'physics', 'chemistry', 'biology', 'informatics', 'english', 'russian', 'uzbek', 'history', 'geography', 'literature'));

-- ---------------------------------------------------------------------------
-- Таблица schools — список школ. Им управляет администратор.
-- ---------------------------------------------------------------------------
-- create table — создать таблицу; public — стандартная схема (папка) для таблиц в Supabase
create table public.schools (
  -- bigint — большое целое число; generated always as identity — база сама выдаёт номера 1, 2, 3...; primary key — главный ключ: уникальный и не пустой
  id bigint generated always as identity primary key,
  -- text — строка любой длины; not null — поле обязательно; unique — двух школ с одинаковым названием быть не может; check — длина от 2 до 120 символов
  name text not null unique check (char_length(name) between 2 and 120),
  -- город школы; default '' — если не указан, будет пустая строка
  city text not null default '' check (char_length(city) <= 60),
  -- timestamptz — дата и время с часовым поясом; default now() — по умолчанию текущий момент
  created_at timestamptz not null default now()
-- ); — конец описания таблицы
);

-- ---------------------------------------------------------------------------
-- Таблица profiles — публичная часть профиля пользователя (без email и фамилии).
-- Одна строка на каждого пользователя из auth.users (там Supabase хранит логины).
-- ---------------------------------------------------------------------------
-- создаём таблицу профилей
create table public.profiles (
  -- uuid — длинный уникальный идентификатор; references auth.users (id) — внешний ключ: id должен существовать в auth.users; on delete cascade — удалили пользователя → удалится и профиль
  id uuid primary key references auth.users (id) on delete cascade,
  -- роль: student (ученик), teacher (учитель), admin (администратор); по умолчанию каждый новый пользователь — ученик
  role text not null default 'student' check (role in ('student', 'teacher', 'admin')),
  -- школа; on delete restrict — нельзя удалить школу, пока в ней есть пользователи; может быть null (у админа)
  school_id bigint references public.schools (id) on delete restrict,
  -- имя; от 1 до 40 символов
  first_name text not null check (char_length(first_name) between 1 and 40),
  -- первая буква фамилии — только её видят другие ученики; заполняется автоматически триггером из profile_private
  last_initial text not null default '' check (char_length(last_initial) <= 1),
  -- int — целое число; класс от 1 до 11; null разрешён (у учителя и админа класса нет)
  grade int check (grade between 1 and 11),
  -- аватар-эмодзи из набора (фото не храним ради безопасности детей)
  avatar text not null default '🦊' check (char_length(avatar) <= 8),
  -- сумма очков; меняется ТОЛЬКО триггерами (у учеников нет права менять это поле, см. часть 7)
  points int not null default 0,
  -- сколько предупреждений вынес учитель
  warnings_count int not null default 0,
  -- boolean — логический тип (true/false); заблокирован ли ученик учителем
  is_blocked boolean not null default false,
  -- дата регистрации
  created_at timestamptz not null default now()
-- конец таблицы profiles
);

-- ---------------------------------------------------------------------------
-- Таблица profile_private — закрытые данные: полная фамилия.
-- Вынесена в отдельную таблицу, чтобы RLS могла прятать её от других учеников:
-- RLS работает со строками целиком, а не с отдельными столбцами.
-- ---------------------------------------------------------------------------
-- создаём таблицу закрытых данных
create table public.profile_private (
  -- тот же id, что у профиля; удалили профиль → удалятся и закрытые данные
  id uuid primary key references public.profiles (id) on delete cascade,
  -- полная фамилия; видят только сам ученик, учитель его школы и админ
  last_name text not null check (char_length(last_name) between 1 and 40)
-- конец таблицы profile_private
);

-- ---------------------------------------------------------------------------
-- Таблица skills — предметы ученика: что знает (know) и что хочет подтянуть (learn).
-- ---------------------------------------------------------------------------
-- создаём таблицу навыков
create table public.skills (
  -- номер строки
  id bigint generated always as identity primary key,
  -- чей это навык
  user_id uuid not null references public.profiles (id) on delete cascade,
  -- предмет; тип subject_code разрешает только предметы из списка
  subject public.subject_code not null,
  -- know — знает хорошо (может помочь), learn — хочет подтянуть
  kind text not null check (kind in ('know', 'learn')),
  -- уровень от 1 до 5
  level int not null check (level between 1 and 5),
  -- когда уровень подтверждён тестом (null — не подтверждён); ставит только функция submit_quiz
  verified_at timestamptz,
  -- unique (user_id, subject) — один предмет у ученика только один раз: либо «знаю», либо «хочу подтянуть»
  unique (user_id, subject)
-- конец таблицы skills
);

-- ---------------------------------------------------------------------------
-- Таблица availability — удобное время: день недели и часть дня.
-- ---------------------------------------------------------------------------
-- создаём таблицу свободного времени
create table public.availability (
  -- чьё время
  user_id uuid not null references public.profiles (id) on delete cascade,
  -- день недели: 1 — понедельник ... 7 — воскресенье
  day int not null check (day between 1 and 7),
  -- часть дня: morning — до уроков, afternoon — после уроков, evening — вечер
  part text not null check (part in ('morning', 'afternoon', 'evening')),
  -- составной главный ключ: одна и та же пара «день + часть дня» у ученика только один раз
  primary key (user_id, day, part)
-- конец таблицы availability
);

-- ---------------------------------------------------------------------------
-- Таблица partnerships — партнёрство (пара или тройка) и его статус.
-- ---------------------------------------------------------------------------
-- создаём таблицу партнёрств
create table public.partnerships (
  -- номер партнёрства
  id bigint generated always as identity primary key,
  -- школа, в которой создано партнёрство; удалили школу → удалятся её партнёрства
  school_id bigint not null references public.schools (id) on delete cascade,
  -- pair — пара, triple — тройка
  kind text not null check (kind in ('pair', 'triple')),
  -- pending — ждёт согласия всех, active — активно, declined — отклонено, finished — завершено
  status text not null default 'pending' check (status in ('pending', 'active', 'declined', 'finished')),
  -- кто предложил обмен; on delete set null — удалили пользователя → здесь станет null
  created_by uuid references public.profiles (id) on delete set null,
  -- когда предложили
  created_at timestamptz not null default now(),
  -- когда все согласились (стало active)
  accepted_at timestamptz,
  -- когда завершили или отклонили
  finished_at timestamptz
-- конец таблицы partnerships
);

-- ---------------------------------------------------------------------------
-- Таблица partnership_members — участники партнёрства и кто кого чему учит.
-- В паре: А учит Б предмету X, Б учит А предмету Y.
-- В тройке: А учит Б, Б учит В, В учит А (каждый учит «следующего»).
-- ---------------------------------------------------------------------------
-- создаём таблицу участников
create table public.partnership_members (
  -- номер партнёрства; удалили партнёрство → удалятся участники
  partnership_id bigint not null references public.partnerships (id) on delete cascade,
  -- участник
  user_id uuid not null references public.profiles (id) on delete cascade,
  -- кому этот участник помогает
  teaches_to uuid not null references public.profiles (id) on delete cascade,
  -- с каким предметом помогает
  teaches_subject public.subject_code not null,
  -- согласился ли участник на обмен
  accepted boolean not null default false,
  -- ученик в одном партнёрстве только один раз
  primary key (partnership_id, user_id),
  -- нельзя учить самого себя; <> означает «не равно»
  check (user_id <> teaches_to)
-- конец таблицы partnership_members
);

-- ---------------------------------------------------------------------------
-- Таблица messages — сообщения чата внутри партнёрства.
-- ---------------------------------------------------------------------------
-- создаём таблицу сообщений
create table public.messages (
  -- номер сообщения
  id bigint generated always as identity primary key,
  -- в каком партнёрстве (чате)
  partnership_id bigint not null references public.partnerships (id) on delete cascade,
  -- кто отправил
  sender_id uuid not null references public.profiles (id) on delete cascade,
  -- текст сообщения: до 1000 символов (пустой только у голосового сообщения)
  body text not null default '' check (char_length(body) <= 1000),
  -- путь к голосовому сообщению в Storage (корзина voice) или null
  voice_path text,
  -- длина голосового сообщения в секундах (от 1 до 120)
  voice_seconds int check (voice_seconds between 1 and 120),
  -- скрыто ли учителем
  is_hidden boolean not null default false,
  -- время отправки
  created_at timestamptz not null default now(),
  -- constraint имя check (...) — именованная проверка: в сообщении есть текст ИЛИ голос
  constraint messages_content_check check (char_length(body) >= 1 or voice_path is not null),
  -- голос лежит в папке своего чата: split_part(путь, '/', 1) — первая папка пути, ::text — число в строку
  constraint messages_voice_folder_check check (voice_path is null or split_part(voice_path, '/', 1) = partnership_id::text)
-- конец таблицы messages
);

-- ---------------------------------------------------------------------------
-- Таблица blocks — кто кого заблокировал.
-- ---------------------------------------------------------------------------
-- создаём таблицу блокировок
create table public.blocks (
  -- кто заблокировал
  blocker_id uuid not null references public.profiles (id) on delete cascade,
  -- кого заблокировали
  blocked_id uuid not null references public.profiles (id) on delete cascade,
  -- когда
  created_at timestamptz not null default now(),
  -- одна и та же блокировка только один раз
  primary key (blocker_id, blocked_id),
  -- нельзя заблокировать себя
  check (blocker_id <> blocked_id)
-- конец таблицы blocks
);

-- ---------------------------------------------------------------------------
-- Таблица complaints — жалобы на сообщения. Разбирает учитель школы.
-- ---------------------------------------------------------------------------
-- создаём таблицу жалоб
create table public.complaints (
  -- номер жалобы
  id bigint generated always as identity primary key,
  -- школа, учитель которой увидит жалобу
  school_id bigint not null references public.schools (id) on delete cascade,
  -- кто пожаловался
  reporter_id uuid not null references public.profiles (id) on delete cascade,
  -- на кого пожаловались
  reported_user_id uuid not null references public.profiles (id) on delete cascade,
  -- на какое сообщение; удалили сообщение → здесь станет null, но копия текста останется
  message_id bigint references public.messages (id) on delete set null,
  -- копия текста сообщения на момент жалобы — учитель видит именно её
  message_text text not null,
  -- причина жалобы (необязательно)
  reason text check (char_length(reason) <= 500),
  -- open — открыта, closed — закрыта
  status text not null default 'open' check (status in ('open', 'closed')),
  -- когда подана
  created_at timestamptz not null default now(),
  -- когда закрыта
  closed_at timestamptz,
  -- кто закрыл
  closed_by uuid references public.profiles (id) on delete set null
-- конец таблицы complaints
);

-- ---------------------------------------------------------------------------
-- Таблица lessons — занятия партнёров.
-- ---------------------------------------------------------------------------
-- создаём таблицу занятий
create table public.lessons (
  -- номер занятия
  id bigint generated always as identity primary key,
  -- какое партнёрство
  partnership_id bigint not null references public.partnerships (id) on delete cascade,
  -- кто назначил
  created_by uuid references public.profiles (id) on delete set null,
  -- дата и время занятия
  scheduled_at timestamptz not null,
  -- тема: от 1 до 120 символов
  topic text not null check (char_length(topic) between 1 and 120),
  -- место: library — библиотека, classroom — свободный кабинет, online — онлайн
  place text not null check (place in ('library', 'classroom', 'online')),
  -- planned — запланировано, done — проведено, cancelled — отменено
  status text not null default 'planned' check (status in ('planned', 'done', 'cancelled')),
  -- когда создано
  created_at timestamptz not null default now()
-- конец таблицы lessons
);

-- ---------------------------------------------------------------------------
-- Таблица reviews — оценки и отзывы после занятия.
-- Каждый участник оценивает того, кто помогал ЕМУ.
-- ---------------------------------------------------------------------------
-- создаём таблицу отзывов
create table public.reviews (
  -- номер отзыва
  id bigint generated always as identity primary key,
  -- за какое занятие
  lesson_id bigint not null references public.lessons (id) on delete cascade,
  -- кто оценил
  author_id uuid not null references public.profiles (id) on delete cascade,
  -- кого оценили (своего помощника)
  target_id uuid not null references public.profiles (id) on delete cascade,
  -- оценка от 1 до 5
  rating int not null check (rating between 1 and 5),
  -- короткий отзыв, до 500 символов (необязательно)
  comment text check (char_length(comment) <= 500),
  -- когда
  created_at timestamptz not null default now(),
  -- один ученик оценивает одно занятие только один раз
  unique (lesson_id, author_id),
  -- себя оценить нельзя
  check (author_id <> target_id)
-- конец таблицы reviews
);

-- ---------------------------------------------------------------------------
-- Таблица materials — сведения о файлах партнёрства (сами файлы лежат в Storage).
-- ---------------------------------------------------------------------------
-- создаём таблицу материалов
create table public.materials (
  -- номер материала
  id bigint generated always as identity primary key,
  -- какое партнёрство
  partnership_id bigint not null references public.partnerships (id) on delete cascade,
  -- кто загрузил
  uploader_id uuid not null references public.profiles (id) on delete cascade,
  -- путь к файлу в Storage, например «12/1712345678-konspekt.pdf»; первая папка — номер партнёрства
  file_path text not null unique,
  -- исходное имя файла для показа
  file_name text not null check (char_length(file_name) between 1 and 200),
  -- тип файла: только картинки и PDF
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf')),
  -- размер в байтах: больше 0 и не больше 5 МБ (5 * 1024 * 1024 = 5242880)
  size_bytes int not null check (size_bytes > 0 and size_bytes <= 5242880),
  -- когда загружен
  created_at timestamptz not null default now()
-- конец таблицы materials
);

-- ---------------------------------------------------------------------------
-- Таблица points_log — история начисления очков (нужна для рейтинга за месяц).
-- ---------------------------------------------------------------------------
-- создаём журнал очков
create table public.points_log (
  -- номер записи
  id bigint generated always as identity primary key,
  -- кому начислено
  user_id uuid not null references public.profiles (id) on delete cascade,
  -- сколько очков
  points int not null,
  -- за что: lesson_done, good_review, profile_complete
  reason text not null,
  -- «ключ повтора»: одно и то же событие (например, «lesson:15») не начислится дважды
  dedupe_key text not null,
  -- когда начислено
  created_at timestamptz not null default now(),
  -- один и тот же ключ у ученика только один раз — защита от двойного начисления
  unique (user_id, dedupe_key)
-- конец таблицы points_log
);

-- ---------------------------------------------------------------------------
-- Таблица user_badges — полученные бейджи.
-- ---------------------------------------------------------------------------
-- создаём таблицу бейджей
create table public.user_badges (
  -- чей бейдж
  user_id uuid not null references public.profiles (id) on delete cascade,
  -- какой бейдж (id совпадают с BADGES в js/config.js)
  badge text not null check (badge in ('first_lesson', 'helper_5', 'helper_10', 'top_mentor', 'polyglot', 'expert', 'streak_4', 'verified_2')),
  -- когда получен
  earned_at timestamptz not null default now(),
  -- один бейдж у ученика только один раз
  primary key (user_id, badge)
-- конец таблицы user_badges
);

-- ---------------------------------------------------------------------------
-- Таблица notifications — уведомления (колокольчик в шапке).
-- ---------------------------------------------------------------------------
-- создаём таблицу уведомлений
create table public.notifications (
  -- номер уведомления
  id bigint generated always as identity primary key,
  -- кому
  user_id uuid not null references public.profiles (id) on delete cascade,
  -- тип уведомления (от него зависит иконка на сайте)
  type text not null check (type in ('match', 'request', 'accepted', 'declined', 'finished', 'message', 'lesson', 'reminder', 'badge', 'warning', 'answer', 'moderation')),
  -- заголовок
  title text not null,
  -- текст
  body text not null default '',
  -- ссылка, куда перейти по клику
  link text not null default '/pages/notifications.html',
  -- прочитано ли
  is_read boolean not null default false,
  -- ключ повтора (например, «reminder:15»), чтобы одинаковые уведомления не дублировались; может быть null
  dedupe_key text,
  -- когда создано
  created_at timestamptz not null default now(),
  -- один ключ повтора у пользователя один раз; строки с null в dedupe_key этим правилом не ограничены
  unique (user_id, dedupe_key)
-- конец таблицы notifications
);

-- ---------------------------------------------------------------------------
-- Таблица questions — вопросы учеников («Как решить задачу?»).
-- Раздел общий: вопрос видят ученики всех школ; school_id — школа автора.
-- ---------------------------------------------------------------------------
-- создаём таблицу вопросов
create table public.questions (
  -- номер вопроса
  id bigint generated always as identity primary key,
  -- школа автора; удалили школу → удалятся её вопросы
  school_id bigint not null references public.schools (id) on delete cascade,
  -- кто спросил
  author_id uuid not null references public.profiles (id) on delete cascade,
  -- предмет вопроса (тип subject_code — только предметы из списка)
  subject public.subject_code not null,
  -- короткий заголовок: от 5 до 150 символов
  title text not null check (char_length(title) between 5 and 150),
  -- подробности (необязательно): до 2000 символов
  body text not null default '' check (char_length(body) <= 2000),
  -- путь к фото задачи в Storage (корзина qa-images) или null
  image_path text,
  -- когда задан
  created_at timestamptz not null default now()
-- конец таблицы questions
);

-- ---------------------------------------------------------------------------
-- Таблица answers — ответы на вопросы. Ответ публикуется сразу со статусом
-- pending («не проверено администратором»); админ может одобрить (approved)
-- или удалить с комментарием (removed — видно только автору ответа).
-- ---------------------------------------------------------------------------
-- создаём таблицу ответов
create table public.answers (
  -- номер ответа
  id bigint generated always as identity primary key,
  -- на какой вопрос; удалили вопрос → удалятся его ответы
  question_id bigint not null references public.questions (id) on delete cascade,
  -- кто ответил
  author_id uuid not null references public.profiles (id) on delete cascade,
  -- текст ответа: до 3000 символов (может быть пустым, если есть фото)
  body text not null default '' check (char_length(body) <= 3000),
  -- путь к фото решения в Storage или null
  image_path text,
  -- pending — не проверено, approved — одобрено админом, removed — удалено админом
  status text not null default 'pending' check (status in ('pending', 'approved', 'removed')),
  -- комментарий администратора (обязателен при удалении)
  admin_comment text check (char_length(admin_comment) <= 500),
  -- кто проверил
  reviewed_by uuid references public.profiles (id) on delete set null,
  -- когда проверил
  reviewed_at timestamptz,
  -- когда написан
  created_at timestamptz not null default now(),
  -- в ответе должен быть текст ИЛИ фото (пустой ответ сохранить нельзя)
  check (char_length(body) > 0 or image_path is not null)
-- конец таблицы answers
);

-- ---------------------------------------------------------------------------
-- Таблица board_strokes — рисунки на общей доске партнёрства.
-- Одна строка — кусочек линии (сайт отправляет линию частями, пока её рисуют,
-- поэтому партнёр видит рисунок почти сразу). Особые строки:
--   clear — «очистить доску» (триггер удаляет всё, что было раньше);
--   undo  — «отменить мою линию stroke_key» (триггер удаляет её кусочки).
-- ---------------------------------------------------------------------------
-- создаём таблицу доски
create table if not exists public.board_strokes (
  -- номер строки (по нему восстанавливаем порядок рисования)
  id bigint generated always as identity primary key,
  -- доска какого партнёрства
  partnership_id bigint not null references public.partnerships (id) on delete cascade,
  -- кто нарисовал
  author_id uuid not null references public.profiles (id) on delete cascade,
  -- ключ линии: все кусочки одной линии имеют одинаковый ключ (его придумывает сайт)
  stroke_key text not null check (char_length(stroke_key) between 1 and 40),
  -- pen — карандаш, eraser — ластик, clear — очистка, undo — отмена линии
  kind text not null default 'pen' check (kind in ('pen', 'eraser', 'clear', 'undo')),
  -- цвет в формате #rrggbb; ~ — проверка по шаблону (регулярному выражению)
  color text not null default '#1f2937' check (color ~ '^#[0-9a-fA-F]{6}$'),
  -- толщина линии в точках доски
  size int not null default 4 check (size between 1 and 60),
  -- точки линии: [x1, y1, x2, y2, ...]; jsonb_typeof — тип значения JSON, jsonb_array_length — длина массива
  points jsonb not null default '[]'::jsonb check (jsonb_typeof(points) = 'array' and jsonb_array_length(points) <= 400),
  -- когда нарисовано
  created_at timestamptz not null default now()
-- конец таблицы board_strokes
);

-- ---------------------------------------------------------------------------
-- Таблица partnership_timers — общий таймер занятия (один на партнёрство).
-- Цикл = занятие (work_minutes) + перерыв (break_minutes). Пока таймер идёт,
-- хранится ends_at — когда закончится весь цикл; сколько осталось, каждый
-- экран считает сам. На паузе хранится remaining_seconds.
-- ---------------------------------------------------------------------------
-- создаём таблицу таймеров
create table if not exists public.partnership_timers (
  -- партнёрство — оно же главный ключ: у партнёрства только один таймер
  partnership_id bigint primary key references public.partnerships (id) on delete cascade,
  -- running — идёт, paused — на паузе, stopped — выключен
  status text not null default 'stopped' check (status in ('running', 'paused', 'stopped')),
  -- длина занятия в минутах
  work_minutes int not null default 25 check (work_minutes between 1 and 120),
  -- длина перерыва в минутах (0 — без перерыва)
  break_minutes int not null default 5 check (break_minutes between 0 and 30),
  -- когда закончится весь цикл (только у идущего таймера)
  ends_at timestamptz,
  -- сколько секунд цикла осталось (только на паузе)
  remaining_seconds int check (remaining_seconds >= 0),
  -- кто последний нажал кнопку
  updated_by uuid references public.profiles (id) on delete set null,
  -- когда нажали
  updated_at timestamptz not null default now()
-- конец таблицы partnership_timers
);

-- ---------------------------------------------------------------------------
-- Таблица quiz_questions — вопросы мини-тестов для подтверждения уровня.
-- Правильные ответы ученики НЕ видят: прямого доступа к таблице нет,
-- вопросы выдаёт и проверяет только база (start_quiz и submit_quiz).
-- ---------------------------------------------------------------------------
-- создаём таблицу вопросов теста
create table if not exists public.quiz_questions (
  -- номер вопроса
  id bigint generated always as identity primary key,
  -- предмет
  subject public.subject_code not null,
  -- текст вопроса
  question text not null check (char_length(question) between 5 and 300),
  -- text[] — массив строк; ровно 4 варианта ответа
  options text[] not null check (array_length(options, 1) = 4),
  -- номер правильного варианта: 0, 1, 2 или 3
  correct int not null check (correct between 0 and 3),
  -- пояснение, которое ученик увидит после теста
  explanation text not null default '',
  -- один и тот же вопрос в предмете только один раз
  unique (subject, question)
-- конец таблицы quiz_questions
);

-- ---------------------------------------------------------------------------
-- Таблица quiz_attempts — попытки пройти тест.
-- ---------------------------------------------------------------------------
-- создаём таблицу попыток
create table if not exists public.quiz_attempts (
  -- номер попытки
  id bigint generated always as identity primary key,
  -- кто проходит
  user_id uuid not null references public.profiles (id) on delete cascade,
  -- по какому предмету
  subject public.subject_code not null,
  -- bigint[] — массив номеров вопросов, которые выпали в этой попытке (по порядку)
  question_ids bigint[] not null,
  -- сколько правильных ответов (null — тест ещё не отправлен)
  score int,
  -- сдан ли тест
  passed boolean,
  -- когда начал
  started_at timestamptz not null default now(),
  -- когда отправил ответы
  finished_at timestamptz
-- конец таблицы quiz_attempts
);


-- ############################################################################
-- ЧАСТЬ 2. ИНДЕКСЫ
-- Индекс — как алфавитный указатель в книге: база находит нужные строки
-- быстро, без просмотра всей таблицы.
-- ############################################################################

-- create index имя on таблица (столбец) — индекс по школе: быстро находим всех учеников школы
create index profiles_school_idx on public.profiles (school_id);
-- индекс вопросов школы по дате (лента вопросов)
create index questions_school_time_idx on public.questions (school_id, created_at desc);
-- индекс ответов на вопрос
create index answers_question_idx on public.answers (question_id);
-- индекс ответов по статусу (модерация: «непроверенные»)
create index answers_status_idx on public.answers (status, created_at);
-- индекс доски: рисунки партнёрства по порядку
create index if not exists board_strokes_partnership_idx on public.board_strokes (partnership_id, id);
-- индекс попыток теста: мои попытки по предмету, новые сверху
create index if not exists quiz_attempts_user_idx on public.quiz_attempts (user_id, subject, started_at desc);
-- индекс по владельцу навыка
create index skills_user_idx on public.skills (user_id);
-- индекс по предмету и типу: быстро находим всех, кто хочет подтянуть, например, физику
create index skills_subject_kind_idx on public.skills (subject, kind);
-- индекс по партнёрствам школы и их статусу
create index partnerships_school_status_idx on public.partnerships (school_id, status);
-- индекс «в каких партнёрствах участвует ученик»
create index partnership_members_user_idx on public.partnership_members (user_id);
-- индекс для чата: сообщения партнёрства по времени
create index messages_partnership_time_idx on public.messages (partnership_id, created_at);
-- индекс «кого заблокировали» (по blocker_id уже есть главный ключ)
create index blocks_blocked_idx on public.blocks (blocked_id);
-- индекс жалоб школы по статусу
create index complaints_school_status_idx on public.complaints (school_id, status);
-- индекс занятий партнёрства по дате
create index lessons_partnership_time_idx on public.lessons (partnership_id, scheduled_at);
-- индекс отзывов о конкретном ученике
create index reviews_target_idx on public.reviews (target_id);
-- индекс материалов партнёрства
create index materials_partnership_idx on public.materials (partnership_id);
-- индекс журнала очков по ученику и дате (для рейтинга за месяц)
create index points_log_user_time_idx on public.points_log (user_id, created_at);
-- индекс уведомлений пользователя: непрочитанные, самые новые сначала
create index notifications_user_idx on public.notifications (user_id, is_read, created_at desc);


-- ############################################################################
-- ЧАСТЬ 3. ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
-- Их используют правила RLS и другие функции.
-- security definer — функция работает с правами СОЗДАТЕЛЯ (администратора
-- базы), а не того, кто её вызвал. Так она может заглянуть в profiles,
-- даже если RLS прячет строки, и правила RLS не зацикливаются.
-- set search_path = public — функция ищет таблицы только в схеме public
-- (защита от подмены таблиц злоумышленником).
-- stable — функция не меняет данные, поэтому база может кэшировать результат.
-- ############################################################################

-- ---------------------------------------------------------------------------
-- app_timezone — часовой пояс сайта (для «сегодня» и времени в уведомлениях).
-- Принимает: ничего. Возвращает: text — название часового пояса.
-- ---------------------------------------------------------------------------
-- create or replace function — создать функцию (или заменить, если есть); returns text — возвращает строку
create or replace function public.app_timezone()
-- тип результата
returns text
-- language sql — тело функции на простом SQL
language sql
-- immutable — результат всегда одинаковый
immutable
-- as — дальше идёт тело функции; оно записано между двумя парами знаков доллара
as $$
  -- Ташкент (UTC+5); поменяй, если школа в другом часовом поясе
  select 'Asia/Tashkent'
-- конец тела функции
$$;

-- ---------------------------------------------------------------------------
-- my_school_id — номер школы текущего пользователя.
-- Принимает: ничего. Возвращает: bigint — id школы (или null).
-- ---------------------------------------------------------------------------
-- создаём функцию
create or replace function public.my_school_id()
-- возвращает число
returns bigint
-- на SQL
language sql
-- не меняет данные
stable
-- работает с правами создателя
security definer
-- ищет таблицы только в public
set search_path = public
-- начало тела
as $$
  -- auth.uid() — встроенная функция Supabase: id пользователя, который сделал запрос
  select school_id from public.profiles where id = auth.uid()
-- конец тела
$$;

-- ---------------------------------------------------------------------------
-- is_admin — является ли текущий пользователь администратором.
-- Принимает: ничего. Возвращает: boolean.
-- ---------------------------------------------------------------------------
-- создаём функцию
create or replace function public.is_admin()
-- возвращает true/false
returns boolean
-- на SQL
language sql
-- не меняет данные
stable
-- права создателя
security definer
-- только схема public
set search_path = public
-- начало тела
as $$
  -- exists (подзапрос) — true, если подзапрос нашёл хотя бы одну строку; select 1 — нам важен сам факт, а не данные
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
-- конец тела
$$;

-- ---------------------------------------------------------------------------
-- is_teacher_of — является ли текущий пользователь учителем указанной школы.
-- Принимает: p_school_id — id школы. Возвращает: boolean.
-- ---------------------------------------------------------------------------
-- p_school_id bigint — параметр функции (приставка p_ — «parameter», чтобы не путать со столбцами)
create or replace function public.is_teacher_of(p_school_id bigint)
-- возвращает true/false
returns boolean
-- на SQL
language sql
-- не меняет данные
stable
-- права создателя
security definer
-- только схема public
set search_path = public
-- начало тела
as $$
  -- есть ли профиль текущего пользователя с ролью teacher и этой школой
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'teacher' and school_id = p_school_id)
-- конец тела
$$;

-- ---------------------------------------------------------------------------
-- school_of — школа указанного пользователя.
-- Принимает: p_user_id — id пользователя. Возвращает: bigint — id школы.
-- ---------------------------------------------------------------------------
-- создаём функцию
create or replace function public.school_of(p_user_id uuid)
-- возвращает число
returns bigint
-- на SQL
language sql
-- не меняет данные
stable
-- права создателя
security definer
-- только схема public
set search_path = public
-- начало тела
as $$
  -- берём school_id из профиля
  select school_id from public.profiles where id = p_user_id
-- конец тела
$$;

-- ---------------------------------------------------------------------------
-- display_name — короткое имя для уведомлений: «Амир Т.».
-- Принимает: p_user_id. Возвращает: text.
-- ---------------------------------------------------------------------------
-- создаём функцию
create or replace function public.display_name(p_user_id uuid)
-- возвращает строку
returns text
-- на SQL
language sql
-- не меняет данные
stable
-- права создателя
security definer
-- только схема public
set search_path = public
-- начало тела
as $$
  -- || склеивает строки: «Амир» + « » + «Т» + «.»
  select first_name || ' ' || last_initial || '.' from public.profiles where id = p_user_id
-- конец тела
$$;

-- ---------------------------------------------------------------------------
-- is_partnership_member — участвует ли текущий пользователь в партнёрстве.
-- Принимает: p_partnership_id. Возвращает: boolean.
-- ---------------------------------------------------------------------------
-- создаём функцию
create or replace function public.is_partnership_member(p_partnership_id bigint)
-- возвращает true/false
returns boolean
-- на SQL
language sql
-- не меняет данные
stable
-- права создателя
security definer
-- только схема public
set search_path = public
-- начало тела
as $$
  -- есть ли строка «этот пользователь в этом партнёрстве»
  select exists (select 1 from public.partnership_members where partnership_id = p_partnership_id and user_id = auth.uid())
-- конец тела
$$;

-- ---------------------------------------------------------------------------
-- is_active_member — участвует ли текущий пользователь в АКТИВНОМ партнёрстве.
-- Принимает: p_partnership_id. Возвращает: boolean.
-- ---------------------------------------------------------------------------
-- создаём функцию
create or replace function public.is_active_member(p_partnership_id bigint)
-- возвращает true/false
returns boolean
-- на SQL
language sql
-- не меняет данные
stable
-- права создателя
security definer
-- только схема public
set search_path = public
-- начало тела
as $$
  -- and — логическое «И»: участник И партнёрство в статусе active
  select public.is_partnership_member(p_partnership_id)
    -- проверяем статус партнёрства
    and exists (select 1 from public.partnerships where id = p_partnership_id and status = 'active')
-- конец тела
$$;

-- ---------------------------------------------------------------------------
-- can_teach — может ли один ученик помочь другому с предметом.
-- Правило то же, что в js/matching.js: помощник знает предмет на 4–5,
-- а его уровень выше уровня ученика минимум на 2.
-- Принимает: p_teacher (помощник), p_learner (кому помогают), p_subject.
-- Возвращает: boolean.
-- ---------------------------------------------------------------------------
-- создаём функцию
create or replace function public.can_teach(p_teacher uuid, p_learner uuid, p_subject text)
-- возвращает true/false
returns boolean
-- на SQL
language sql
-- не меняет данные
stable
-- права создателя
security definer
-- только схема public
set search_path = public
-- начало тела
as $$
  -- ищем пару строк: t — навык помощника, l — навык ученика; join ... on — соединяем строки двух таблиц по условию
  select exists (
    -- берём навыки помощника под коротким именем t
    select 1 from public.skills t
    -- и навыки ученика под именем l с тем же предметом
    join public.skills l on l.subject = t.subject
    -- помощник, ученик и нужный предмет
    where t.user_id = p_teacher and l.user_id = p_learner and t.subject = p_subject
      -- помощник «знает», ученик «хочет подтянуть»
      and t.kind = 'know' and l.kind = 'learn'
      -- 4 — минимальный уровень помощника (MIN_HELPER_LEVEL в js/matching.js)
      and t.level >= 4
      -- 2 — минимальная разница уровней (MIN_LEVEL_GAP в js/matching.js)
      and t.level - l.level >= 2
  -- закрываем exists
  )
-- конец тела
$$;

-- ---------------------------------------------------------------------------
-- can_send_message — может ли текущий пользователь писать в чат партнёрства.
-- Условия: партнёрство активно, пользователь — участник, он не заблокирован
-- учителем, и никто из участников не заблокировал другого.
-- Принимает: p_partnership_id. Возвращает: boolean.
-- ---------------------------------------------------------------------------
-- создаём функцию
create or replace function public.can_send_message(p_partnership_id bigint)
-- возвращает true/false
returns boolean
-- на SQL
language sql
-- не меняет данные
stable
-- права создателя
security definer
-- только схема public
set search_path = public
-- начало тела
as $$
  -- активный участник
  select public.is_active_member(p_partnership_id)
    -- not — «НЕ»; coalesce(x, true) — если x равно null, берём true (нет профиля — считаем заблокированным)
    and not coalesce((select is_blocked from public.profiles where id = auth.uid()), true)
    -- нет ни одной блокировки между участниками этого партнёрства
    and not exists (
      -- a и b — два участника одного партнёрства
      select 1 from public.partnership_members a
      -- соединяем со вторым участником того же партнёрства
      join public.partnership_members b on b.partnership_id = a.partnership_id
      -- и ищем блокировку «a заблокировал b»
      join public.blocks bl on bl.blocker_id = a.user_id and bl.blocked_id = b.user_id
      -- только в нашем партнёрстве
      where a.partnership_id = p_partnership_id
    -- закрываем not exists
    )
-- конец тела
$$;

-- ---------------------------------------------------------------------------
-- i_am_active_student — текущий пользователь — ученик и НЕ заблокирован.
-- Только такие могут задавать вопросы и отвечать.
-- Принимает: ничего. Возвращает: boolean.
-- ---------------------------------------------------------------------------
-- создаём функцию
create or replace function public.i_am_active_student()
-- возвращает true/false
returns boolean
-- на SQL
language sql
-- не меняет данные
stable
-- права создателя
security definer
-- только схема public
set search_path = public
-- начало тела
as $$
  -- есть мой профиль с ролью student и без блокировки
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'student' and not is_blocked)
-- конец тела
$$;

-- ---------------------------------------------------------------------------
-- get_qa_authors — карточки авторов для раздела «Вопросы» (он общий для всех
-- школ). Профили учеников из других школ закрыты правилом profiles_select,
-- поэтому функция отдаёт только безопасный минимум (имя, первая буква
-- фамилии, аватар, класс, школа) и только тех, кто сам написал вопрос или ответ.
-- Принимает: p_ids — массив id пользователей.
-- Возвращает: таблицу (id, first_name, last_initial, avatar, grade,
--   school_id, school_name) — по строке на каждого автора.
-- ---------------------------------------------------------------------------
-- create or replace function — создать функцию или заменить старую; uuid[] — массив id
create or replace function public.get_qa_authors(p_ids uuid[])
-- returns table (...) — функция возвращает таблицу с такими столбцами
returns table (id uuid, first_name text, last_initial text, avatar text, grade int, school_id bigint, school_name text)
-- на SQL
language sql
-- не меняет данные
stable
-- права создателя: так функция может прочитать профили из других школ
security definer
-- только схема public
set search_path = public
-- начало тела
as $$
  -- берём только безопасные поля профиля и название школы
  select p.id, p.first_name, p.last_initial, p.avatar, p.grade, p.school_id, s.name
  -- таблица профилей под коротким именем p
  from public.profiles p
  -- left join — присоединяем школу (если школы нет, school_name будет null)
  left join public.schools s on s.id = p.school_id
  -- = any(p_ids) — id входит в переданный массив
  where p.id = any(p_ids)
    -- только те, кто задал хотя бы один вопрос...
    and (exists (select 1 from public.questions q where q.author_id = p.id)
      -- ...или написал ответ, который не удалён администратором
      or exists (select 1 from public.answers a where a.author_id = p.id and a.status <> 'removed')
      -- ...или это я сам (свой удалённый ответ я тоже вижу)
      or p.id = auth.uid())
-- конец тела
$$;

-- ---------------------------------------------------------------------------
-- notify — создаёт уведомление.
-- Принимает: p_user_id — кому; p_type — тип; p_title — заголовок; p_body — текст;
--   p_link — ссылка; p_dedupe_key — ключ повтора (или null);
--   p_bump — если true и такое уведомление уже есть, оно «всплывает» снова
--   как непрочитанное (так делаем для сообщений чата, чтобы не засорять список).
-- Возвращает: void — ничего.
-- ---------------------------------------------------------------------------
-- default null / default false — значения параметров по умолчанию
create or replace function public.notify(p_user_id uuid, p_type text, p_title text, p_body text, p_link text, p_dedupe_key text default null, p_bump boolean default false)
-- void — функция ничего не возвращает
returns void
-- language plpgsql — процедурный язык PostgreSQL: в нём есть переменные, if, циклы
language plpgsql
-- права создателя: обычный ученик не может сам вставлять уведомления другим
security definer
-- только схема public
set search_path = public
-- начало тела
as $$
-- begin — начало блока команд
begin
  -- if ... then — условие: если нужно «поднять» старое уведомление
  if p_bump then
    -- insert into таблица (столбцы) values (значения) — добавить строку
    insert into public.notifications (user_id, type, title, body, link, dedupe_key)
    -- значения из параметров
    values (p_user_id, p_type, p_title, p_body, p_link, p_dedupe_key)
    -- on conflict ... do update — если строка с таким ключом уже есть, обновляем её вместо вставки; excluded — значения, которые пытались вставить
    on conflict (user_id, dedupe_key) do update set title = excluded.title, body = excluded.body, is_read = false, created_at = now();
  -- else — иначе
  else
    -- обычная вставка
    insert into public.notifications (user_id, type, title, body, link, dedupe_key)
    -- значения из параметров
    values (p_user_id, p_type, p_title, p_body, p_link, p_dedupe_key)
    -- do nothing — если такое уведомление уже есть, ничего не делаем
    on conflict (user_id, dedupe_key) do nothing;
  -- end if — конец условия
  end if;
-- end — конец блока
end;
-- конец тела
$$;


-- ############################################################################
-- ЧАСТЬ 4. РЕГИСТРАЦИЯ: автоматическое создание профиля
-- ############################################################################

-- ---------------------------------------------------------------------------
-- create_profile — создаёт профиль пользователя (строки в profiles и
-- profile_private) из данных регистрации: имя, фамилия, школа, класс, аватар.
-- Эти данные сайт передаёт при регистрации в options.data, а Supabase
-- хранит их в auth.users.raw_user_meta_data.
-- Вызывается триггером handle_new_user (ниже) и в конце этого файла —
-- для пользователей, у которых профиля ещё нет.
-- Принимает: p_user_id — id пользователя; p_meta — данные регистрации (JSON).
-- Возвращает: void.
-- ---------------------------------------------------------------------------
-- создаём функцию
create or replace function public.create_profile(p_user_id uuid, p_meta jsonb)
-- ничего не возвращает
returns void
-- язык plpgsql
language plpgsql
-- права создателя: обычный пользователь не может писать в profiles напрямую
security definer
-- только схема public
set search_path = public
-- начало тела
as $$
-- declare — раздел объявления переменных
declare
  -- jsonb — формат JSON в базе; meta — данные, переданные при регистрации
  meta jsonb := coalesce(p_meta, '{}'::jsonb);
  -- := — присваивание значения; ->> достаёт поле из JSON как текст; trim убирает пробелы по краям
  v_first_name text := trim(coalesce(meta ->> 'first_name', ''));
  -- фамилия
  v_last_name text := trim(coalesce(meta ->> 'last_name', ''));
  -- школа как текст (проверим, что это число)
  v_school_text text := coalesce(meta ->> 'school_id', '');
  -- класс как текст
  v_grade_text text := coalesce(meta ->> 'grade', '');
  -- аватар
  v_avatar text := coalesce(nullif(meta ->> 'avatar', ''), '🦊');
  -- сюда положим проверенный id школы
  v_school_id bigint;
  -- сюда положим проверенный класс
  v_grade int;
-- начало команд
begin
  -- ~ '^[0-9]+$' — проверка регулярным выражением: строка состоит только из цифр
  if v_school_text ~ '^[0-9]+$' then
    -- ::bigint — превращаем текст в число; := (select ...) — кладём результат запроса в переменную (если такой школы нет, будет null)
    v_school_id := (select id from public.schools where id = v_school_text::bigint);
  -- конец условия
  end if;
  -- класс тоже проверяем на цифры (одна или две); проверки вложены, чтобы ::int выполнялся только для цифр
  if v_grade_text ~ '^[0-9]{1,2}$' then
    -- теперь безопасно превращаем в число и проверяем диапазон 1–11
    if v_grade_text::int between 1 and 11 then
      -- запоминаем класс
      v_grade := v_grade_text::int;
    -- конец внутреннего условия
    end if;
  -- конец внешнего условия
  end if;
  -- если имя пустое (например, пользователя создали вручную в панели Supabase) — ставим заглушку; left(x, 40) — первые 40 символов
  v_first_name := left(coalesce(nullif(v_first_name, ''), 'Ученик'), 40);
  -- то же для фамилии
  v_last_name := left(coalesce(nullif(v_last_name, ''), 'Без фамилии'), 40);
  -- создаём публичный профиль
  insert into public.profiles (id, first_name, school_id, grade, avatar)
  -- p_user_id — id пользователя из auth.users; left(v_avatar, 8) — защита от слишком длинной строки
  values (p_user_id, v_first_name, v_school_id, v_grade, left(v_avatar, 8));
  -- создаём закрытую часть (полная фамилия); триггер sync_last_initial сам заполнит первую букву
  insert into public.profile_private (id, last_name) values (p_user_id, v_last_name);
-- конец команд
end;
-- конец тела
$$;

-- ---------------------------------------------------------------------------
-- handle_new_user — срабатывает, когда Supabase Auth создаёт нового
-- пользователя, и создаёт ему профиль функцией create_profile.
-- Принимает: new — новую строку auth.users (так устроены триггеры).
-- Возвращает: trigger (строку new).
-- ---------------------------------------------------------------------------
-- returns trigger — это функция-триггер
create or replace function public.handle_new_user()
-- тип результата — trigger
returns trigger
-- язык plpgsql
language plpgsql
-- права создателя: обычный пользователь не может писать в profiles напрямую
security definer
-- только схема public
set search_path = public
-- начало тела
as $$
-- начало команд
begin
  -- new.id — id нового пользователя, new.raw_user_meta_data — данные регистрации
  perform public.create_profile(new.id, new.raw_user_meta_data);
  -- триггер «after insert» должен вернуть строку; return new — вернуть новую строку
  return new;
-- конец команд
end;
-- конец тела
$$;

-- create trigger — создать триггер (автоматическое действие при событии в таблице)
create trigger on_auth_user_created
  -- after insert on auth.users — ПОСЛЕ добавления строки в таблицу пользователей Supabase
  after insert on auth.users
  -- for each row — для каждой добавленной строки; execute function — вызвать функцию
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- sync_last_initial — копирует первую букву фамилии в profiles.last_initial.
-- Срабатывает при создании и изменении profile_private.
-- Принимает: new — строку profile_private. Возвращает: trigger.
-- ---------------------------------------------------------------------------
-- создаём функцию-триггер
create or replace function public.sync_last_initial()
-- тип — trigger
returns trigger
-- язык plpgsql
language plpgsql
-- права создателя (last_initial ученик сам менять не может)
security definer
-- только схема public
set search_path = public
-- начало тела
as $$
-- начало команд
begin
  -- update таблица set столбец = значение where условие — изменить строки; upper — заглавная буква; left(x, 1) — первый символ
  update public.profiles set last_initial = upper(left(trim(new.last_name), 1)) where id = new.id;
  -- возвращаем строку
  return new;
-- конец команд
end;
-- конец тела
$$;

-- триггер на profile_private
create trigger on_profile_private_changed
  -- после вставки ИЛИ изменения фамилии; of last_name — только когда меняется этот столбец
  after insert or update of last_name on public.profile_private
  -- для каждой строки
  for each row execute function public.sync_last_initial();


-- ############################################################################
-- ЧАСТЬ 5. ОЧКИ И БЕЙДЖИ
-- Все правила начисления — в функции points_for (одно место).
-- Такие же числа показаны на сайте из js/config.js (POINTS_RULES).
-- ############################################################################

-- ---------------------------------------------------------------------------
-- points_for — сколько очков даётся за событие. ЗДЕСЬ меняются правила.
-- Принимает: p_reason — причина. Возвращает: int — число очков.
-- ---------------------------------------------------------------------------
-- создаём функцию
create or replace function public.points_for(p_reason text)
-- возвращает число
returns int
-- на SQL
language sql
-- результат зависит только от параметра
immutable
-- начало тела
as $$
  -- case when ... then ... end — выбор значения по условию (как switch в JavaScript)
  select case p_reason
    -- за проведённое занятие — 10 очков (каждому участнику: каждый кому-то помог)
    when 'lesson_done' then 10
    -- за оценку 4 или 5 от партнёра — 5 очков
    when 'good_review' then 5
    -- за полностью заполненный профиль — 20 очков (один раз)
    when 'profile_complete' then 20
    -- за ответ на вопрос, который одобрил администратор — 15 очков
    when 'answer_approved' then 15
    -- за уровень, подтверждённый тестом — 10 очков (за каждый предмет один раз)
    when 'skill_verified' then 10
    -- за всё остальное — 0
    else 0
  -- конец case
  end
-- конец тела
$$;

-- ---------------------------------------------------------------------------
-- award_points — начисляет очки один раз за событие.
-- Принимает: p_user_id — кому; p_reason — за что; p_dedupe_key — ключ события.
-- Возвращает: void.
-- ---------------------------------------------------------------------------
-- создаём функцию
create or replace function public.award_points(p_user_id uuid, p_reason text, p_dedupe_key text)
-- ничего не возвращает
returns void
-- язык plpgsql
language plpgsql
-- права создателя
security definer
-- только схема public
set search_path = public
-- начало тела
as $$
-- переменные
declare
  -- сколько очков за эту причину
  v_points int := public.points_for(p_reason);
  -- сколько строк реально вставилось (0 — если такое событие уже было)
  v_inserted int;
-- начало команд
begin
  -- записываем в журнал
  insert into public.points_log (user_id, points, reason, dedupe_key)
  -- значения
  values (p_user_id, v_points, p_reason, p_dedupe_key)
  -- если такой ключ уже был — не начисляем повторно
  on conflict (user_id, dedupe_key) do nothing;
  -- get diagnostics ... = row_count — узнаём, сколько строк затронула последняя команда
  get diagnostics v_inserted = row_count;
  -- если запись добавилась
  if v_inserted > 0 then
    -- увеличиваем общую сумму очков в профиле
    update public.profiles set points = points + v_points where id = p_user_id;
  -- конец условия
  end if;
-- конец команд
end;
-- конец тела
$$;

-- ---------------------------------------------------------------------------
-- badge_title — название бейджа для уведомления.
-- Принимает: p_badge — id бейджа. Возвращает: text.
-- ---------------------------------------------------------------------------
-- создаём функцию
create or replace function public.badge_title(p_badge text)
-- возвращает строку
returns text
-- на SQL
language sql
-- зависит только от параметра
immutable
-- начало тела
as $$
  -- выбираем название по id
  select case p_badge
    -- первое занятие
    when 'first_lesson' then '🎉 Первое занятие'
    -- помог 5 раз
    when 'helper_5' then '🤝 Помог 5 раз'
    -- помог 10 раз
    when 'helper_10' then '🏆 Помог 10 раз'
    -- средняя оценка 4.5+ за 5 занятий
    when 'top_mentor' then '⭐ Отличник-наставник'
    -- помог по 3 разным предметам
    when 'polyglot' then '🌈 Полиглот'
    -- 5 ответов, одобренных администратором
    when 'expert' then '🧠 Знаток'
    -- помогает 4 недели подряд
    when 'streak_4' then '🔥 Серия 4 недели'
    -- уровень подтверждён тестом по 2 предметам
    when 'verified_2' then '🎯 Проверенные знания'
    -- на всякий случай
    else p_badge
  -- конец case
  end
-- конец тела
$$;

-- ---------------------------------------------------------------------------
-- grant_badge — выдаёт бейдж (если его ещё нет) и присылает уведомление.
-- Принимает: p_user_id, p_badge. Возвращает: void.
-- ---------------------------------------------------------------------------
-- создаём функцию
create or replace function public.grant_badge(p_user_id uuid, p_badge text)
-- ничего не возвращает
returns void
-- язык plpgsql
language plpgsql
-- права создателя
security definer
-- только схема public
set search_path = public
-- начало тела
as $$
-- переменные
declare
  -- сколько строк вставилось
  v_inserted int;
-- начало команд
begin
  -- пробуем выдать бейдж
  insert into public.user_badges (user_id, badge) values (p_user_id, p_badge)
  -- если уже есть — ничего не делаем
  on conflict (user_id, badge) do nothing;
  -- узнаём, выдан ли он сейчас
  get diagnostics v_inserted = row_count;
  -- если бейдж новый — уведомление
  if v_inserted > 0 then
    -- perform — вызвать функцию и не использовать её результат
    perform public.notify(p_user_id, 'badge', 'Новый бейдж!', public.badge_title(p_badge), '/pages/profile.html#badges', 'badge:' || p_badge);
  -- конец условия
  end if;
-- конец команд
end;
-- конец тела
$$;

-- ---------------------------------------------------------------------------
-- check_badges — проверяет условия всех бейджей и выдаёт заслуженные.
-- Принимает: p_user_id. Возвращает: void.
-- ---------------------------------------------------------------------------
-- создаём функцию
create or replace function public.check_badges(p_user_id uuid)
-- ничего не возвращает
returns void
-- язык plpgsql
language plpgsql
-- права создателя
security definer
-- только схема public
set search_path = public
-- начало тела
as $$
-- переменные
declare
  -- сколько проведённых занятий у ученика
  v_done int;
  -- сколько оценок он получил
  v_reviews int;
  -- numeric — дробное число; средняя оценка
  v_avg numeric;
  -- по скольким разным предметам помогал
  v_subjects int;
  -- сколько ответов на вопросы одобрил администратор
  v_answers int;
-- начало команд
begin
  -- count(*) — количество строк; считаем проведённые занятия во всех партнёрствах ученика и кладём в v_done
  v_done := (select count(*)
    -- таблица занятий под именем l
    from public.lessons l
    -- соединяем с участниками того же партнёрства
    join public.partnership_members m on m.partnership_id = l.partnership_id
    -- наш ученик и статус «проведено»
    where m.user_id = p_user_id and l.status = 'done');
  -- count — сколько оценок получил ученик
  v_reviews := (select count(*) from public.reviews where target_id = p_user_id);
  -- avg — средняя оценка (null, если оценок нет)
  v_avg := (select avg(rating) from public.reviews where target_id = p_user_id);
  -- count(distinct ...) — сколько РАЗНЫХ предметов, где было хотя бы одно проведённое занятие
  v_subjects := (select count(distinct m.teaches_subject)
    -- участия ученика
    from public.partnership_members m
    -- только его
    where m.user_id = p_user_id
      -- и только партнёрства с проведёнными занятиями
      and exists (select 1 from public.lessons l where l.partnership_id = m.partnership_id and l.status = 'done'));
  -- «Первое занятие»
  if v_done >= 1 then perform public.grant_badge(p_user_id, 'first_lesson'); end if;
  -- «Помог 5 раз»
  if v_done >= 5 then perform public.grant_badge(p_user_id, 'helper_5'); end if;
  -- «Помог 10 раз»
  if v_done >= 10 then perform public.grant_badge(p_user_id, 'helper_10'); end if;
  -- «Отличник-наставник»: минимум 5 оценок и средняя не ниже 4.5
  if v_reviews >= 5 and v_avg >= 4.5 then perform public.grant_badge(p_user_id, 'top_mentor'); end if;
  -- «Полиглот»: помог по 3 разным предметам
  if v_subjects >= 3 then perform public.grant_badge(p_user_id, 'polyglot'); end if;
  -- одобренные ответы этого ученика
  v_answers := (select count(*) from public.answers where author_id = p_user_id and status = 'approved');
  -- «Знаток»: 5 одобренных ответов
  if v_answers >= 5 then perform public.grant_badge(p_user_id, 'expert'); end if;
  -- «Серия 4 недели»: лучшая серия недель с помощью — 4 и больше; ->> 'best' — поле JSON как текст, ::int — в число
  if (public.streak_info(p_user_id) ->> 'best')::int >= 4 then perform public.grant_badge(p_user_id, 'streak_4'); end if;
  -- «Проверенные знания»: уровень подтверждён тестом минимум по 2 предметам
  if (select count(*) from public.skills where user_id = p_user_id and verified_at is not null) >= 2 then perform public.grant_badge(p_user_id, 'verified_2'); end if;
-- конец команд
end;
-- конец тела
$$;

-- ---------------------------------------------------------------------------
-- streak_info — СЕРИЯ: сколько недель подряд ученик помогает другим.
-- Неделя засчитана, если в ней было проведённое занятие ученика (в обмене
-- каждый кому-то помогает) или одобренный администратором ответ на вопрос.
-- Серия жива, если засчитана эта неделя или прошлая (на этой ещё есть
-- время до воскресенья); если пропущена целая неделя — серия сгорает.
-- Недели считаются с понедельника по часовому поясу сайта (app_timezone).
-- Принимает: p_user_id. Возвращает: jsonb {
--   current — текущая серия (недель), best — лучшая серия,
--   this_week — засчитана ли эта неделя, at_risk — серия сгорит, если на
--   этой неделе ничего не сделать, weeks — 8 последних недель (true/false,
--   от старой к текущей) }.
-- ---------------------------------------------------------------------------
-- создаём функцию
create or replace function public.streak_info(p_user_id uuid)
-- возвращает JSON
returns jsonb
-- язык plpgsql
language plpgsql
-- не меняет данные
stable
-- права создателя (читает занятия и ответы ученика)
security definer
-- только схема public
set search_path = public
-- начало тела
as $$
-- переменные
declare
  -- date[] — массив дат: понедельники недель, в которые ученик помогал
  v_weeks date[];
  -- понедельник текущей недели
  v_this date;
  -- неделя, которую сейчас проверяем
  v_week date;
  -- текущая серия
  v_current int := 0;
  -- лучшая серия
  v_best int := 0;
  -- длина серии в цикле подсчёта лучшей
  v_run int := 0;
  -- предыдущая неделя в цикле
  v_prev date;
  -- 8 последних недель: true/false
  v_last8 jsonb := '[]'::jsonb;
-- начало команд
begin
  -- date_trunc('week', ...) — начало недели (понедельник); at time zone — перевод во время сайта; ::date — только дата
  v_this := date_trunc('week', now() at time zone public.app_timezone())::date;
  -- array(select ...) — собрать результат запроса в массив; distinct — без повторов; order by — по возрастанию
  v_weeks := array(select distinct w from (
    -- недели проведённых занятий ученика
    select date_trunc('week', l.scheduled_at at time zone public.app_timezone())::date as w
    -- занятия под именем l
    from public.lessons l
    -- соединяем с участниками того же партнёрства
    join public.partnership_members m on m.partnership_id = l.partnership_id
    -- наш ученик и только проведённые занятия
    where m.user_id = p_user_id and l.status = 'done'
    -- union all — добавить строки второго запроса
    union all
    -- недели одобренных ответов (coalesce — если даты проверки нет, берём дату ответа)
    select date_trunc('week', coalesce(a.reviewed_at, a.created_at) at time zone public.app_timezone())::date
    -- ответы ученика
    from public.answers a
    -- только одобренные
    where a.author_id = p_user_id and a.status = 'approved'
  -- s — имя подзапроса; сортируем недели по возрастанию
  ) s order by w);
  -- начинаем проверку с текущей недели
  v_week := v_this;
  -- эта неделя ещё не засчитана — серия может быть жива с прошлой недели; = any(массив) — «есть в массиве»
  if not (v_week = any(v_weeks)) then v_week := v_week - 7; end if;
  -- while — пока неделя есть в массиве, считаем серию и шагаем на неделю назад (дата − 7 дней)
  while v_week = any(v_weeks) loop
    -- ещё одна неделя серии
    v_current := v_current + 1;
    -- неделя назад
    v_week := v_week - 7;
  -- конец цикла
  end loop;
  -- foreach ... in array — перебираем недели по порядку, чтобы найти самую длинную серию
  foreach v_week in array v_weeks loop
    -- неделя идёт сразу за предыдущей — серия продолжается, иначе начинается заново
    if v_prev is not null and v_week = v_prev + 7 then v_run := v_run + 1; else v_run := 1; end if;
    -- greatest — наибольшее из значений
    v_best := greatest(v_best, v_run);
    -- запоминаем неделю
    v_prev := v_week;
  -- конец цикла
  end loop;
  -- generate_series(0, 7) — числа 0..7 (сколько недель назад); order by n desc — от старой недели к текущей; 8 отметок true/false
  v_last8 := (select jsonb_agg((v_this - n * 7) = any(v_weeks) order by n desc) from generate_series(0, 7) n);
  -- собираем ответ
  return jsonb_build_object(
    -- текущая серия
    'current', v_current,
    -- лучшая серия (не меньше текущей)
    'best', greatest(v_best, v_current),
    -- засчитана ли эта неделя
    'this_week', v_this = any(v_weeks),
    -- серия есть, но на этой неделе ещё ничего — сгорит, если не помочь до воскресенья
    'at_risk', v_current > 0 and not (v_this = any(v_weeks)),
    -- 8 последних недель
    'weeks', v_last8
  -- конец объекта
  );
-- конец команд
end;
-- конец тела
$$;

-- ---------------------------------------------------------------------------
-- check_profile_complete — даёт очки за заполненный профиль (один раз).
-- Профиль заполнен, если есть хотя бы один предмет «знаю», один «хочу
-- подтянуть» и одно удобное время.
-- Принимает: p_user_id. Возвращает: void.
-- ---------------------------------------------------------------------------
-- создаём функцию
create or replace function public.check_profile_complete(p_user_id uuid)
-- ничего не возвращает
returns void
-- язык plpgsql
language plpgsql
-- права создателя
security definer
-- только схема public
set search_path = public
-- начало тела
as $$
-- начало команд
begin
  -- три условия через and
  if exists (select 1 from public.skills where user_id = p_user_id and kind = 'know')
    -- есть предмет «хочу подтянуть»
    and exists (select 1 from public.skills where user_id = p_user_id and kind = 'learn')
    -- есть удобное время
    and exists (select 1 from public.availability where user_id = p_user_id) then
    -- ключ 'profile' — начислится только один раз за всю жизнь аккаунта
    perform public.award_points(p_user_id, 'profile_complete', 'profile');
  -- конец условия
  end if;
-- конец команд
end;
-- конец тела
$$;

-- ---------------------------------------------------------------------------
-- on_profile_data_added — триггер: после добавления предмета или времени
-- проверяем, не заполнен ли профиль полностью.
-- Принимает: new — новую строку skills или availability. Возвращает: trigger.
-- ---------------------------------------------------------------------------
-- создаём функцию-триггер
create or replace function public.on_profile_data_added()
-- тип — trigger
returns trigger
-- язык plpgsql
language plpgsql
-- права создателя
security definer
-- только схема public
set search_path = public
-- начало тела
as $$
-- начало команд
begin
  -- в обеих таблицах есть столбец user_id
  perform public.check_profile_complete(new.user_id);
  -- возвращаем строку
  return new;
-- конец команд
end;
-- конец тела
$$;

-- триггер на таблице навыков
create trigger on_skill_added
  -- после вставки строки
  after insert on public.skills
  -- для каждой строки
  for each row execute function public.on_profile_data_added();

-- триггер на таблице свободного времени
create trigger on_availability_added
  -- после вставки строки
  after insert on public.availability
  -- для каждой строки
  for each row execute function public.on_profile_data_added();

-- ---------------------------------------------------------------------------
-- skills_protect_verified — защищает отметку «уровень подтверждён тестом».
-- Ученик сам меняет свои предметы, но поставить себе verified_at не может:
-- её ставит только submit_quiz (включает флаг skillswap.verify на время
-- своей работы). Если предмет стал «хочу подтянуть» или уровень ниже 4 —
-- отметка снимается.
-- Принимает: new, old — строку до и после. Возвращает: trigger.
-- ---------------------------------------------------------------------------
-- создаём функцию-триггер
create or replace function public.skills_protect_verified()
-- тип — trigger
returns trigger
-- язык plpgsql
language plpgsql
-- начало тела
as $$
-- начало команд
begin
  -- current_setting(имя, true) — значение настройки или null; флаг ставит только submit_quiz
  if coalesce(current_setting('skillswap.verify', true), '') <> 'on' then
    -- tg_op — какая команда: новая строка получает «не подтверждено», изменённая сохраняет старую отметку
    if tg_op = 'INSERT' then new.verified_at := null; else new.verified_at := old.verified_at; end if;
  -- конец условия
  end if;
  -- подтверждение имеет смысл только для «знаю» с уровнем 4–5
  if new.kind <> 'know' or new.level < 4 then new.verified_at := null; end if;
  -- возвращаем (возможно, исправленную) строку
  return new;
-- конец команд
end;
-- конец тела
$$;

-- drop trigger if exists — убираем старую версию триггера (если скрипт запускают повторно)
drop trigger if exists before_skill_change on public.skills;
-- триггер ДО вставки или изменения навыка — может поправить строку
create trigger before_skill_change
  -- before insert or update — перед вставкой или изменением
  before insert or update on public.skills
  -- для каждой строки
  for each row execute function public.skills_protect_verified();


-- ############################################################################
-- ЧАСТЬ 6. ТРИГГЕРЫ ЗАНЯТИЙ, ОТЗЫВОВ И СООБЩЕНИЙ
-- ############################################################################

-- ---------------------------------------------------------------------------
-- lessons_validate_update — проверяет смену статуса занятия ДО сохранения.
-- Правила: менять можно только запланированное занятие; «проведено» можно
-- поставить только после времени начала.
-- Принимает: old — старая строка, new — новая. Возвращает: trigger (new).
-- ---------------------------------------------------------------------------
-- создаём функцию-триггер
create or replace function public.lessons_validate_update()
-- тип — trigger
returns trigger
-- язык plpgsql
language plpgsql
-- начало тела
as $$
-- начало команд
begin
  -- is distinct from — «отличается от» (правильно работает и с null)
  if new.status is distinct from old.status then
    -- уже проведённое или отменённое занятие менять нельзя
    if old.status <> 'planned' then
      -- raise exception — остановить команду с ошибкой; этот текст увидит ученик на сайте
      raise exception 'Статус этого занятия уже нельзя изменить';
    -- конец условия
    end if;
    -- нельзя отметить «проведено» заранее; now() — текущее время
    if new.status = 'done' and new.scheduled_at > now() then
      -- ошибка с понятным текстом
      raise exception 'Отметить «проведено» можно только после начала занятия';
    -- конец условия
    end if;
  -- конец условия
  end if;
  -- в триггере before возвращаем new — строку, которая будет сохранена
  return new;
-- конец команд
end;
-- конец тела
$$;

-- триггер на таблице занятий
create trigger before_lesson_update
  -- before update — ДО изменения строки (можно отменить изменение ошибкой)
  before update on public.lessons
  -- для каждой строки
  for each row execute function public.lessons_validate_update();

-- ---------------------------------------------------------------------------
-- on_lesson_created — после создания занятия уведомляет остальных участников.
-- Принимает: new — новое занятие. Возвращает: trigger.
-- ---------------------------------------------------------------------------
-- создаём функцию-триггер
create or replace function public.on_lesson_created()
-- тип — trigger
returns trigger
-- язык plpgsql
language plpgsql
-- права создателя (уведомления другим ученикам)
security definer
-- только схема public
set search_path = public
-- начало тела
as $$
-- переменные
declare
  -- record — переменная для одной строки результата запроса
  v_member record;
-- начало команд
begin
  -- for ... in select ... loop — цикл по каждой строке результата
  for v_member in select user_id from public.partnership_members where partnership_id = new.partnership_id and user_id <> new.created_by loop
    -- to_char(время, 'DD.MM в HH24:MI') — дата в виде «25.09 в 15:30»; at time zone — перевод в часовой пояс сайта
    perform public.notify(v_member.user_id, 'lesson', 'Назначено занятие', new.topic || ' — ' || to_char(new.scheduled_at at time zone public.app_timezone(), 'DD.MM в HH24:MI'), '/pages/lessons.html', null);
  -- конец цикла
  end loop;
  -- возвращаем строку
  return new;
-- конец команд
end;
-- конец тела
$$;

-- триггер создания занятия
create trigger after_lesson_insert
  -- после вставки
  after insert on public.lessons
  -- для каждой строки
  for each row execute function public.on_lesson_created();

-- ---------------------------------------------------------------------------
-- on_lesson_status_changed — когда занятие стало «проведено», начисляет очки
-- всем участникам и проверяет бейджи; при отмене — уведомляет участников.
-- Принимает: old, new. Возвращает: trigger.
-- ---------------------------------------------------------------------------
-- создаём функцию-триггер
create or replace function public.on_lesson_status_changed()
-- тип — trigger
returns trigger
-- язык plpgsql
language plpgsql
-- права создателя
security definer
-- только схема public
set search_path = public
-- начало тела
as $$
-- переменные
declare
  -- строка участника в цикле
  v_member record;
-- начало команд
begin
  -- стало «проведено» (раньше было другое)
  if new.status = 'done' and old.status <> 'done' then
    -- цикл по всем участникам партнёрства
    for v_member in select user_id from public.partnership_members where partnership_id = new.partnership_id loop
      -- очки за занятие; ключ 'lesson:15' не даст начислить дважды
      perform public.award_points(v_member.user_id, 'lesson_done', 'lesson:' || new.id);
      -- проверяем бейджи
      perform public.check_badges(v_member.user_id);
      -- напоминаем оценить партнёра
      perform public.notify(v_member.user_id, 'lesson', 'Занятие проведено', 'Оцени партнёра: «' || new.topic || '»', '/pages/lessons.html', 'rate:' || new.id);
    -- конец цикла
    end loop;
  -- elsif — «иначе если»: занятие отменили
  elsif new.status = 'cancelled' and old.status <> 'cancelled' then
    -- цикл по участникам
    for v_member in select user_id from public.partnership_members where partnership_id = new.partnership_id and user_id <> auth.uid() loop
      -- уведомление об отмене
      perform public.notify(v_member.user_id, 'lesson', 'Занятие отменено', new.topic, '/pages/lessons.html', null);
    -- конец цикла
    end loop;
  -- конец условия
  end if;
  -- возвращаем строку
  return new;
-- конец команд
end;
-- конец тела
$$;

-- триггер смены статуса
create trigger after_lesson_update
  -- after update of status — только когда меняется столбец status
  after update of status on public.lessons
  -- для каждой строки
  for each row execute function public.on_lesson_status_changed();

-- ---------------------------------------------------------------------------
-- on_review_created — после отзыва: очки за хорошую оценку и проверка бейджей.
-- Принимает: new — новый отзыв. Возвращает: trigger.
-- ---------------------------------------------------------------------------
-- создаём функцию-триггер
create or replace function public.on_review_created()
-- тип — trigger
returns trigger
-- язык plpgsql
language plpgsql
-- права создателя
security definer
-- только схема public
set search_path = public
-- начало тела
as $$
-- начало команд
begin
  -- хорошая оценка — 4 или 5
  if new.rating >= 4 then
    -- очки помощнику
    perform public.award_points(new.target_id, 'good_review', 'review:' || new.id);
  -- конец условия
  end if;
  -- средняя оценка изменилась — проверяем «Отличника-наставника»
  perform public.check_badges(new.target_id);
  -- возвращаем строку
  return new;
-- конец команд
end;
-- конец тела
$$;

-- триггер на отзывах
create trigger after_review_insert
  -- после вставки
  after insert on public.reviews
  -- для каждой строки
  for each row execute function public.on_review_created();

-- ---------------------------------------------------------------------------
-- on_message_created — после нового сообщения уведомляет других участников.
-- На каждый чат одно уведомление, которое «всплывает» снова (p_bump = true),
-- чтобы колокольчик не заваливало сотней уведомлений.
-- Принимает: new — новое сообщение. Возвращает: trigger.
-- ---------------------------------------------------------------------------
-- создаём функцию-триггер
create or replace function public.on_message_created()
-- тип — trigger
returns trigger
-- язык plpgsql
language plpgsql
-- права создателя
security definer
-- только схема public
set search_path = public
-- начало тела
as $$
-- переменные
declare
  -- строка участника
  v_member record;
-- начало команд
begin
  -- все участники, кроме отправителя
  for v_member in select user_id from public.partnership_members where partnership_id = new.partnership_id and user_id <> new.sender_id loop
    -- заголовок — имя отправителя; текст — первые 80 символов (у голосового — «🎤 Голосовое сообщение»: nullif превращает пустую строку в null, coalesce берёт замену); ключ 'chat:12' — одно уведомление на чат
    perform public.notify(v_member.user_id, 'message', 'Сообщение от ' || public.display_name(new.sender_id), coalesce(nullif(left(new.body, 80), ''), '🎤 Голосовое сообщение'), '/pages/chat.html?id=' || new.partnership_id, 'chat:' || new.partnership_id, true);
  -- конец цикла
  end loop;
  -- возвращаем строку
  return new;
-- конец команд
end;
-- конец тела
$$;

-- триггер на сообщениях
create trigger after_message_insert
  -- после вставки
  after insert on public.messages
  -- для каждой строки
  for each row execute function public.on_message_created();

-- ---------------------------------------------------------------------------
-- on_board_marker — особые строки доски: clear (очистить) и undo (отменить
-- линию). Удаляет то, что они отменяют, чтобы доска не росла бесконечно.
-- Принимает: new — новую строку доски. Возвращает: trigger.
-- ---------------------------------------------------------------------------
-- создаём функцию-триггер
create or replace function public.on_board_marker()
-- тип — trigger
returns trigger
-- язык plpgsql
language plpgsql
-- права создателя: ученик не может удалять строки доски напрямую
security definer
-- только схема public
set search_path = public
-- начало тела
as $$
-- начало команд
begin
  -- очистка: удаляем всё, что нарисовано на этой доске раньше (id меньше)
  if new.kind = 'clear' then
    -- delete — удалить строки
    delete from public.board_strokes where partnership_id = new.partnership_id and id < new.id;
  -- отмена: удаляем кусочки ЭТОЙ линии этого же автора (чужую линию отменить нельзя)
  elsif new.kind = 'undo' then
    -- удаляем линию с таким ключом
    delete from public.board_strokes where partnership_id = new.partnership_id and author_id = new.author_id and stroke_key = new.stroke_key and kind in ('pen', 'eraser');
  -- конец условия
  end if;
  -- after-триггер: возвращаемое значение не важно
  return new;
-- конец команд
end;
-- конец тела
$$;

-- триггер на доске
create trigger after_board_insert
  -- после вставки
  after insert on public.board_strokes
  -- для каждой строки
  for each row execute function public.on_board_marker();

-- ---------------------------------------------------------------------------
-- on_answer_created — новый ответ: уведомляем автора вопроса.
-- На каждый вопрос одно уведомление, которое «всплывает» при новых ответах.
-- Принимает: new — новый ответ. Возвращает: trigger.
-- ---------------------------------------------------------------------------
-- создаём функцию-триггер
create or replace function public.on_answer_created()
-- тип — trigger
returns trigger
-- язык plpgsql
language plpgsql
-- права создателя (уведомление другому ученику)
security definer
-- только схема public
set search_path = public
-- начало тела
as $$
-- переменные
declare
  -- автор вопроса
  v_author uuid;
  -- заголовок вопроса
  v_title text;
-- начало команд
begin
  -- автор вопроса
  v_author := (select author_id from public.questions where id = new.question_id);
  -- заголовок вопроса
  v_title := (select title from public.questions where id = new.question_id);
  -- себе уведомление не нужно
  if v_author is not null and v_author <> new.author_id then
    -- уведомление; ключ 'answers:<вопрос>' — одно на вопрос, «всплывает» при новых ответах (p_bump = true)
    perform public.notify(v_author, 'answer', 'Новый ответ на твой вопрос', left(v_title, 80), '/pages/question.html?id=' || new.question_id, 'answers:' || new.question_id, true);
  -- конец условия
  end if;
  -- возвращаем строку
  return new;
-- конец команд
end;
-- конец тела
$$;

-- триггер на ответах
create trigger after_answer_insert
  -- после вставки
  after insert on public.answers
  -- для каждой строки
  for each row execute function public.on_answer_created();

-- ---------------------------------------------------------------------------
-- on_answer_reviewed — администратор проверил ответ:
--   одобрил → +15 очков автору, проверка бейджей, уведомление;
--   удалил  → уведомление автору с комментарием администратора.
-- Принимает: old, new. Возвращает: trigger.
-- ---------------------------------------------------------------------------
-- создаём функцию-триггер
create or replace function public.on_answer_reviewed()
-- тип — trigger
returns trigger
-- язык plpgsql
language plpgsql
-- права создателя
security definer
-- только схема public
set search_path = public
-- начало тела
as $$
-- переменные
declare
  -- ссылка на вопрос
  v_link text := '/pages/question.html?id=' || new.question_id;
-- начало команд
begin
  -- ответ одобрен впервые
  if new.status = 'approved' and old.status <> 'approved' then
    -- очки; ключ 'answer:<id>' — начислится только один раз, даже если одобрить повторно
    perform public.award_points(new.author_id, 'answer_approved', 'answer:' || new.id);
    -- бейдж «Знаток»
    perform public.check_badges(new.author_id);
    -- уведомление автору
    perform public.notify(new.author_id, 'moderation', 'Ответ одобрен администратором ✅', 'Спасибо за помощь! +' || public.points_for('answer_approved') || ' очков', v_link, 'answer-approved:' || new.id);
  -- ответ удалён
  elsif new.status = 'removed' and old.status <> 'removed' then
    -- уведомление автору с комментарием
    perform public.notify(new.author_id, 'moderation', 'Ответ удалён администратором', coalesce(new.admin_comment, ''), v_link, 'answer-removed:' || new.id);
  -- конец условия
  end if;
  -- возвращаем строку
  return new;
-- конец команд
end;
-- конец тела
$$;

-- триггер смены статуса ответа
create trigger after_answer_status_update
  -- только когда меняется столбец status
  after update of status on public.answers
  -- для каждой строки
  for each row execute function public.on_answer_reviewed();

-- ############################################################################
-- ЧАСТЬ 7. ФУНКЦИИ RPC (вызываются с сайта: supabase.rpc('имя', {...}))
-- Каждая функция сама проверяет права, поэтому её нельзя «обмануть»
-- из консоли браузера.
-- ############################################################################

-- ---------------------------------------------------------------------------
-- create_partnership — предложить обмен (пару или тройку).
-- Принимает: p_links — массив JSON «кто кого чему учит», например:
--   [{"teacher":"uuid-A","learner":"uuid-B","subject":"english"},
--    {"teacher":"uuid-B","learner":"uuid-A","subject":"algebra"}]
-- Возвращает: bigint — id нового партнёрства.
-- ---------------------------------------------------------------------------
-- создаём функцию
create or replace function public.create_partnership(p_links jsonb)
-- возвращает число
returns bigint
-- язык plpgsql
language plpgsql
-- права создателя
security definer
-- только схема public
set search_path = public
-- начало тела
as $$
-- переменные
declare
  -- кто вызвал функцию
  v_me uuid := auth.uid();
  -- школа вызвавшего
  v_school bigint;
  -- jsonb_array_length — сколько элементов в JSON-массиве (2 для пары, 3 для тройки)
  v_count int := jsonb_array_length(p_links);
  -- uuid[] — массив идентификаторов; сюда соберём всех участников
  v_members uuid[];
  -- одна связь «кто кого учит» в цикле
  v_link jsonb;
  -- id созданного партнёрства
  v_id bigint;
-- начало команд
begin
  -- без входа ничего нельзя; is null — «пусто»
  if v_me is null then raise exception 'Нужно войти в аккаунт'; end if;
  -- партнёрство — только пара или тройка; not in — «не входит в список»
  if v_count not in (2, 3) then raise exception 'Обмен возможен только в паре или тройке'; end if;
  -- array_agg — собрать значения в массив; distinct — без повторов; jsonb_array_elements — разворачивает JSON-массив в строки
  v_members := (select array_agg(distinct (l ->> 'teacher')::uuid) from jsonb_array_elements(p_links) l);
  -- каждый участник должен учить ровно одного — значит, разных помощников столько же, сколько связей; array_length(массив, 1) — длина массива
  if array_length(v_members, 1) <> v_count then raise exception 'Неверный состав обмена'; end if;
  -- = any(массив) — «равно хотя бы одному элементу массива»; вызвавший должен быть участником
  if not (v_me = any(v_members)) then raise exception 'Ты должен быть участником обмена'; end if;
  -- каждый участник должен и учиться у кого-то: разных «учеников» столько же, и все они из числа участников
  if (select count(distinct (l ->> 'learner')::uuid) from jsonb_array_elements(p_links) l where (l ->> 'learner')::uuid = any(v_members)) <> v_count then
    -- ошибка
    raise exception 'Каждый участник должен и помогать, и получать помощь';
  -- конец условия
  end if;
  -- школа вызвавшего
  v_school := (select school_id from public.profiles where id = v_me);
  -- все участники — ученики той же школы и не заблокированы
  if (select count(*) from public.profiles where id = any(v_members) and school_id = v_school and role = 'student' and not is_blocked) <> v_count then
    -- ошибка
    raise exception 'Все участники должны быть учениками твоей школы';
  -- конец условия
  end if;
  -- никто из участников не заблокировал другого
  if exists (select 1 from public.blocks where blocker_id = any(v_members) and blocked_id = any(v_members)) then
    -- ошибка
    raise exception 'Обмен с этим учеником невозможен';
  -- конец условия
  end if;
  -- проверяем каждую связь по правилу подбора
  for v_link in select * from jsonb_array_elements(p_links) loop
    -- помощник должен знать предмет на 4–5 и на 2 уровня лучше
    if not public.can_teach((v_link ->> 'teacher')::uuid, (v_link ->> 'learner')::uuid, v_link ->> 'subject') then
      -- ошибка
      raise exception 'Условия обмена больше не выполняются. Обнови страницу совпадений';
    -- конец условия
    end if;
  -- конец цикла
  end loop;
  -- нет ли уже ожидающего или активного партнёрства с кем-то из этих учеников
  if exists (
    -- партнёрства p
    select 1 from public.partnerships p
    -- где участвую я
    join public.partnership_members a on a.partnership_id = p.id and a.user_id = v_me
    -- и кто-то из новых участников
    join public.partnership_members b on b.partnership_id = p.id and b.user_id = any(v_members) and b.user_id <> v_me
    -- и оно ещё не закончено
    where p.status in ('pending', 'active')
  -- конец exists
  ) then
    -- ошибка
    raise exception 'С этим учеником уже есть обмен или запрос';
  -- конец условия
  end if;
  -- создаём партнёрство
  insert into public.partnerships (school_id, kind, created_by)
  -- case: 2 участника — pair, иначе triple
  values (v_school, case when v_count = 2 then 'pair' else 'triple' end, v_me);
  -- lastval() — номер, который счётчик (identity) только что выдал новой строке в этом подключении
  v_id := lastval();
  -- добавляем всех участников одной командой: insert ... select
  insert into public.partnership_members (partnership_id, user_id, teaches_to, teaches_subject, accepted)
  -- тот, кто предлагает, сразу согласен (accepted = true)
  select v_id, (l ->> 'teacher')::uuid, (l ->> 'learner')::uuid, l ->> 'subject', (l ->> 'teacher')::uuid = v_me
  -- из каждого элемента массива
  from jsonb_array_elements(p_links) l;
  -- уведомляем остальных о запросе
  perform public.notify(m.user_id, 'request', 'Запрос на обмен', public.display_name(v_me) || ' предлагает обмен знаниями', '/pages/partners.html', 'request:' || v_id)
  -- для каждого участника, кроме себя
  from public.partnership_members m where m.partnership_id = v_id and m.user_id <> v_me;
  -- возвращаем номер партнёрства
  return v_id;
-- конец команд
end;
-- конец тела
$$;

-- ---------------------------------------------------------------------------
-- respond_partnership — принять или отклонить запрос на обмен.
-- Когда приняли ВСЕ участники — партнёрство становится активным.
-- Принимает: p_partnership_id; p_accept — true (принять) или false (отклонить).
-- Возвращает: text — новый статус партнёрства.
-- ---------------------------------------------------------------------------
-- создаём функцию
create or replace function public.respond_partnership(p_partnership_id bigint, p_accept boolean)
-- возвращает строку
returns text
-- язык plpgsql
language plpgsql
-- права создателя
security definer
-- только схема public
set search_path = public
-- начало тела
as $$
-- переменные
declare
  -- кто отвечает
  v_me uuid := auth.uid();
  -- текущий статус
  v_status text;
-- начало команд
begin
  -- perform ... for update — «занимаем» строку партнёрства до конца операции, чтобы два ответа одновременно не испортили статус
  perform 1 from public.partnerships where id = p_partnership_id for update;
  -- читаем текущий статус в переменную
  v_status := (select status from public.partnerships where id = p_partnership_id);
  -- если партнёрства нет (статус null) или я не участник — ошибка
  if v_status is null or not public.is_partnership_member(p_partnership_id) then raise exception 'Запрос не найден'; end if;
  -- отвечать можно только на ожидающий запрос
  if v_status <> 'pending' then raise exception 'На этот запрос уже ответили'; end if;
  -- если отклонили
  if not p_accept then
    -- статус «отклонено»
    update public.partnerships set status = 'declined', finished_at = now() where id = p_partnership_id;
    -- уведомляем остальных
    perform public.notify(m.user_id, 'declined', 'Запрос отклонён', public.display_name(v_me) || ' отклонил(а) обмен', '/pages/partners.html', null)
    -- всех, кроме себя
    from public.partnership_members m where m.partnership_id = p_partnership_id and m.user_id <> v_me;
    -- возвращаем новый статус
    return 'declined';
  -- конец условия
  end if;
  -- отмечаем своё согласие
  update public.partnership_members set accepted = true where partnership_id = p_partnership_id and user_id = v_me;
  -- если остался хоть один несогласный — ждём дальше
  if exists (select 1 from public.partnership_members where partnership_id = p_partnership_id and not accepted) then
    -- статус пока тот же
    return 'pending';
  -- конец условия
  end if;
  -- все согласны — активируем
  update public.partnerships set status = 'active', accepted_at = now() where id = p_partnership_id;
  -- уведомляем всех участников
  perform public.notify(m.user_id, 'accepted', 'Обмен начался!', 'Все согласились. Можно писать в чат и назначать занятия', '/pages/chat.html?id=' || p_partnership_id, 'accepted:' || p_partnership_id)
  -- всех участников
  from public.partnership_members m where m.partnership_id = p_partnership_id;
  -- возвращаем новый статус
  return 'active';
-- конец команд
end;
-- конец тела
$$;

-- ---------------------------------------------------------------------------
-- finish_partnership — завершить активное партнёрство (или отменить свой запрос).
-- Принимает: p_partnership_id. Возвращает: void.
-- ---------------------------------------------------------------------------
-- создаём функцию
create or replace function public.finish_partnership(p_partnership_id bigint)
-- ничего не возвращает
returns void
-- язык plpgsql
language plpgsql
-- права создателя
security definer
-- только схема public
set search_path = public
-- начало тела
as $$
-- начало команд
begin
  -- только участник
  if not public.is_partnership_member(p_partnership_id) then raise exception 'Партнёрство не найдено'; end if;
  -- завершаем только активное или ожидающее
  update public.partnerships set status = 'finished', finished_at = now()
  -- условие
  where id = p_partnership_id and status in ('active', 'pending');
  -- если ничего не обновилось — уже завершено
  if not found then raise exception 'Партнёрство уже завершено'; end if;
  -- уведомляем остальных
  perform public.notify(m.user_id, 'finished', 'Партнёрство завершено', public.display_name(auth.uid()) || ' завершил(а) обмен', '/pages/partners.html', null)
  -- всех, кроме себя
  from public.partnership_members m where m.partnership_id = p_partnership_id and m.user_id <> auth.uid();
  -- планируемые занятия этого партнёрства отменяем
  update public.lessons set status = 'cancelled' where partnership_id = p_partnership_id and status = 'planned';
-- конец команд
end;
-- конец тела
$$;

-- ---------------------------------------------------------------------------
-- report_message — пожаловаться на сообщение. Копия текста сохраняется в
-- жалобе, поэтому учитель видит только сообщения, на которые пожаловались.
-- Принимает: p_message_id; p_reason — причина (может быть пустой).
-- Возвращает: void.
-- ---------------------------------------------------------------------------
-- создаём функцию
create or replace function public.report_message(p_message_id bigint, p_reason text)
-- ничего не возвращает
returns void
-- язык plpgsql
language plpgsql
-- права создателя
security definer
-- только схема public
set search_path = public
-- начало тела
as $$
-- переменные
declare
  -- партнёрство (чат), где написано сообщение
  v_partnership bigint;
  -- автор сообщения
  v_sender uuid;
  -- текст сообщения
  v_body text;
  -- школа партнёрства
  v_school bigint;
-- начало команд
begin
  -- в каком чате сообщение
  v_partnership := (select partnership_id from public.messages where id = p_message_id);
  -- сообщение должно существовать, а жалующийся — быть участником чата
  if v_partnership is null or not public.is_partnership_member(v_partnership) then raise exception 'Сообщение не найдено'; end if;
  -- кто его написал
  v_sender := (select sender_id from public.messages where id = p_message_id);
  -- его текст (копия попадёт в жалобу); у голосового сообщения текста нет — пишем пометку, а учитель сможет его прослушать
  v_body := (select coalesce(nullif(body, ''), '🎤 Голосовое сообщение') from public.messages where id = p_message_id);
  -- школа партнёрства — её учитель увидит жалобу
  v_school := (select school_id from public.partnerships where id = v_partnership);
  -- на себя жаловаться нельзя
  if v_sender = auth.uid() then raise exception 'Нельзя пожаловаться на своё сообщение'; end if;
  -- второй раз на то же сообщение — нельзя
  if exists (select 1 from public.complaints where message_id = p_message_id and reporter_id = auth.uid()) then
    -- ошибка
    raise exception 'Ты уже пожаловался на это сообщение';
  -- конец условия
  end if;
  -- причина не длиннее 500 символов
  if char_length(coalesce(p_reason, '')) > 500 then raise exception 'Причина слишком длинная (максимум 500 символов)'; end if;
  -- создаём жалобу; nullif(x, '') — пустую строку превращаем в null
  insert into public.complaints (school_id, reporter_id, reported_user_id, message_id, message_text, reason)
  -- значения
  values (v_school, auth.uid(), v_sender, p_message_id, v_body, nullif(trim(coalesce(p_reason, '')), ''));
-- конец команд
end;
-- конец тела
$$;

-- ---------------------------------------------------------------------------
-- leave_review — оценить помощника после проведённого занятия.
-- Принимает: p_lesson_id; p_rating (1–5); p_comment — отзыв (необязательно).
-- Возвращает: void.
-- ---------------------------------------------------------------------------
-- создаём функцию
create or replace function public.leave_review(p_lesson_id bigint, p_rating int, p_comment text)
-- ничего не возвращает
returns void
-- язык plpgsql
language plpgsql
-- права создателя
security definer
-- только схема public
set search_path = public
-- начало тела
as $$
-- переменные
declare
  -- партнёрство занятия
  v_partnership bigint;
  -- статус занятия
  v_status text;
  -- кого оцениваем
  v_target uuid;
-- начало команд
begin
  -- партнёрство, к которому относится занятие
  v_partnership := (select partnership_id from public.lessons where id = p_lesson_id);
  -- статус занятия
  v_status := (select status from public.lessons where id = p_lesson_id);
  -- занятие есть и я участник
  if v_partnership is null or not public.is_partnership_member(v_partnership) then raise exception 'Занятие не найдено'; end if;
  -- только после проведённого
  if v_status <> 'done' then raise exception 'Оценить можно только проведённое занятие'; end if;
  -- оценка от 1 до 5
  if p_rating is null or p_rating not between 1 and 5 then raise exception 'Оценка должна быть от 1 до 5'; end if;
  -- отзыв не длиннее 500 символов
  if char_length(coalesce(p_comment, '')) > 500 then raise exception 'Отзыв слишком длинный (максимум 500 символов)'; end if;
  -- помощник — тот, кто учит МЕНЯ (teaches_to = я)
  v_target := (select user_id from public.partnership_members where partnership_id = v_partnership and teaches_to = auth.uid());
  -- уже оценивал?
  if exists (select 1 from public.reviews where lesson_id = p_lesson_id and author_id = auth.uid()) then
    -- ошибка
    raise exception 'Ты уже оценил это занятие';
  -- конец условия
  end if;
  -- сохраняем отзыв; триггер after_review_insert начислит очки
  insert into public.reviews (lesson_id, author_id, target_id, rating, comment)
  -- значения
  values (p_lesson_id, auth.uid(), v_target, p_rating, nullif(trim(coalesce(p_comment, '')), ''));
-- конец команд
end;
-- конец тела
$$;

-- ---------------------------------------------------------------------------
-- notify_new_match — сайт нашёл новое прямое совпадение (js/matching.js);
-- функция проверяет, что оно настоящее, и уведомляет второго ученика.
-- Принимает: p_other — id второго ученика. Возвращает: void.
-- ---------------------------------------------------------------------------
-- создаём функцию
create or replace function public.notify_new_match(p_other uuid)
-- ничего не возвращает
returns void
-- язык plpgsql
language plpgsql
-- права создателя
security definer
-- только схема public
set search_path = public
-- начало тела
as $$
-- начало команд
begin
  -- второй ученик из моей школы
  if public.school_of(p_other) is distinct from public.my_school_id() then return; end if;
  -- взаимная помощь: я могу научить его хотя бы одному предмету...
  if exists (select 1 from public.skills s where s.user_id = p_other and s.kind = 'learn' and public.can_teach(auth.uid(), p_other, s.subject))
    -- ...и он меня
    and exists (select 1 from public.skills s where s.user_id = auth.uid() and s.kind = 'learn' and public.can_teach(p_other, auth.uid(), s.subject)) then
    -- ключ 'match:<мой id>' — одно уведомление на пару учеников
    perform public.notify(p_other, 'match', 'Новое совпадение!', public.display_name(auth.uid()) || ' может помочь тебе, а ты — ему', '/pages/matches.html', 'match:' || auth.uid());
  -- конец условия
  end if;
-- конец команд
end;
-- конец тела
$$;

-- ---------------------------------------------------------------------------
-- ensure_my_reminders — создаёт напоминания о СЕГОДНЯШНИХ занятиях текущего
-- ученика (сайт вызывает её при каждом открытии страницы; повторов не будет).
-- Принимает: ничего. Возвращает: void.
-- ---------------------------------------------------------------------------
-- создаём функцию
create or replace function public.ensure_my_reminders()
-- ничего не возвращает
returns void
-- язык plpgsql
language plpgsql
-- права создателя
security definer
-- только схема public
set search_path = public
-- начало тела
as $$
-- переменные
declare
  -- данные серии ученика (streak_info)
  v_streak jsonb;
-- начало команд
begin
  -- без входа напоминать некому — просто выходим
  if auth.uid() is null then return; end if;
  -- вставляем сразу много уведомлений командой insert ... select
  insert into public.notifications (user_id, type, title, body, link, dedupe_key)
  -- текст: «Тема в 15:30»
  select auth.uid(), 'reminder', 'Сегодня занятие', l.topic || ' в ' || to_char(l.scheduled_at at time zone public.app_timezone(), 'HH24:MI'), '/pages/lessons.html', 'reminder:' || l.id
  -- из занятий
  from public.lessons l
  -- в которых я участник
  join public.partnership_members m on m.partnership_id = l.partnership_id and m.user_id = auth.uid()
  -- запланированные на сегодня (::date — оставить только дату)
  where l.status = 'planned' and (l.scheduled_at at time zone public.app_timezone())::date = (now() at time zone public.app_timezone())::date
  -- если напоминание уже есть — пропускаем
  on conflict (user_id, dedupe_key) do nothing;
  -- серия под угрозой: с пятницы (isodow 5) по воскресенье напоминаем, что серия сгорит; extract(isodow ...) — день недели 1–7
  v_streak := public.streak_info(auth.uid());
  -- серия есть, эта неделя не засчитана, и уже пятница или позже
  if (v_streak ->> 'at_risk')::boolean and extract(isodow from now() at time zone public.app_timezone()) >= 5 then
    -- одно напоминание на неделю: ключ 'streak:2026-09-21' (понедельник недели)
    perform public.notify(auth.uid(), 'reminder', '🔥 Серия под угрозой', 'Серия ' || (v_streak ->> 'current') || ' нед. сгорит в воскресенье. Проведи занятие или ответь на вопрос!', '/pages/questions.html', 'streak:' || date_trunc('week', now() at time zone public.app_timezone())::date);
  -- конец условия
  end if;
-- конец команд
end;
-- конец тела
$$;

-- ---------------------------------------------------------------------------
-- get_school_leaderboard — 10 лучших помощников школы за текущий месяц.
-- Принимает: ничего. Возвращает: таблицу (id, имя, буква фамилии, аватар,
-- класс, очки за месяц).
-- ---------------------------------------------------------------------------
-- returns table (...) — функция возвращает таблицу с такими столбцами
create or replace function public.get_school_leaderboard()
-- описание столбцов результата
returns table (user_id uuid, first_name text, last_initial text, avatar text, grade int, month_points bigint)
-- на SQL
language sql
-- не меняет данные
stable
-- права создателя
security definer
-- только схема public
set search_path = public
-- начало тела
as $$
  -- sum — сумма очков; ::bigint — перевод в большое целое
  select p.id, p.first_name, p.last_initial, p.avatar, p.grade, sum(pl.points)::bigint
  -- из журнала очков
  from public.points_log pl
  -- соединяем с профилями
  join public.profiles p on p.id = pl.user_id
  -- только ученики моей школы
  where p.school_id = public.my_school_id() and p.role = 'student'
    -- date_trunc('month', ...) — начало текущего месяца по времени сайта
    and pl.created_at >= date_trunc('month', now() at time zone public.app_timezone()) at time zone public.app_timezone()
  -- group by — сгруппировать строки по ученику, чтобы sum считал сумму каждого
  group by p.id
  -- order by ... desc — сортировка по убыванию очков
  order by sum(pl.points) desc
  -- limit 10 — только первые 10
  limit 10
-- конец тела
$$;

-- ---------------------------------------------------------------------------
-- get_school_stats — статистика школы для панели учителя.
-- Принимает: ничего. Возвращает: jsonb — объект с числами и списком предметов.
-- ---------------------------------------------------------------------------
-- создаём функцию
create or replace function public.get_school_stats()
-- возвращает JSON
returns jsonb
-- язык plpgsql
language plpgsql
-- не меняет данные
stable
-- права создателя
security definer
-- только схема public
set search_path = public
-- начало тела
as $$
-- переменные
declare
  -- школа учителя
  v_school bigint := public.my_school_id();
-- начало команд
begin
  -- только учитель этой школы
  if not public.is_teacher_of(v_school) then raise exception 'Эта страница только для учителя'; end if;
  -- jsonb_build_object('ключ', значение, ...) — собрать JSON-объект
  return jsonb_build_object(
    -- число учеников
    'students', (select count(*) from public.profiles where school_id = v_school and role = 'student'),
    -- число проведённых занятий
    'lessons_done', (select count(*) from public.lessons l join public.partnerships p on p.id = l.partnership_id where p.school_id = v_school and l.status = 'done'),
    -- число активных партнёрств
    'active_partnerships', (select count(*) from public.partnerships where school_id = v_school and status = 'active'),
    -- число открытых жалоб
    'open_complaints', (select count(*) from public.complaints where school_id = v_school and status = 'open'),
    -- спрос на предметы: jsonb_agg собирает строки в JSON-массив, отсортированный по количеству
    'demand', coalesce((select jsonb_agg(jsonb_build_object('subject', d.subject, 'count', d.cnt) order by d.cnt desc)
      -- подзапрос: сколько учеников хотят подтянуть каждый предмет
      from (select s.subject, count(*) as cnt from public.skills s join public.profiles pr on pr.id = s.user_id
        -- только «хочу подтянуть» в этой школе
        where pr.school_id = v_school and s.kind = 'learn' group by s.subject) d), '[]'::jsonb)
  -- закрываем jsonb_build_object
  );
-- конец команд
end;
-- конец тела
$$;

-- ---------------------------------------------------------------------------
-- teacher_hide_message — учитель скрывает сообщение.
-- Принимает: p_message_id. Возвращает: void.
-- ---------------------------------------------------------------------------
-- создаём функцию
create or replace function public.teacher_hide_message(p_message_id bigint)
-- ничего не возвращает
returns void
-- язык plpgsql
language plpgsql
-- права создателя
security definer
-- только схема public
set search_path = public
-- начало тела
as $$
-- переменные
declare
  -- школа, где было сообщение
  v_school bigint;
-- начало команд
begin
  -- школа через партнёрство
  v_school := (select p.school_id from public.messages m join public.partnerships p on p.id = m.partnership_id where m.id = p_message_id);
  -- только учитель этой школы
  if not public.is_teacher_of(v_school) then raise exception 'Недостаточно прав'; end if;
  -- скрываем
  update public.messages set is_hidden = true where id = p_message_id;
-- конец команд
end;
-- конец тела
$$;

-- ---------------------------------------------------------------------------
-- teacher_warn_user — учитель выносит ученику предупреждение.
-- Принимает: p_user_id. Возвращает: void.
-- ---------------------------------------------------------------------------
-- создаём функцию
create or replace function public.teacher_warn_user(p_user_id uuid)
-- ничего не возвращает
returns void
-- язык plpgsql
language plpgsql
-- права создателя
security definer
-- только схема public
set search_path = public
-- начало тела
as $$
-- начало команд
begin
  -- только учитель школы этого ученика
  if not public.is_teacher_of(public.school_of(p_user_id)) then raise exception 'Недостаточно прав'; end if;
  -- +1 предупреждение
  update public.profiles set warnings_count = warnings_count + 1 where id = p_user_id;
  -- уведомление ученику
  perform public.notify(p_user_id, 'warning', 'Предупреждение от учителя', 'Пожалуйста, соблюдай правила общения. После нескольких предупреждений аккаунт могут заблокировать.', '/pages/profile.html', null);
-- конец команд
end;
-- конец тела
$$;

-- ---------------------------------------------------------------------------
-- teacher_set_blocked — учитель блокирует или разблокирует ученика.
-- Заблокированный ученик не может писать и не появляется в подборе.
-- Принимает: p_user_id; p_blocked — true/false. Возвращает: void.
-- ---------------------------------------------------------------------------
-- создаём функцию
create or replace function public.teacher_set_blocked(p_user_id uuid, p_blocked boolean)
-- ничего не возвращает
returns void
-- язык plpgsql
language plpgsql
-- права создателя
security definer
-- только схема public
set search_path = public
-- начало тела
as $$
-- начало команд
begin
  -- только учитель школы этого ученика
  if not public.is_teacher_of(public.school_of(p_user_id)) then raise exception 'Недостаточно прав'; end if;
  -- блокировать можно только учеников
  update public.profiles set is_blocked = p_blocked where id = p_user_id and role = 'student';
  -- если никого не обновили
  if not found then raise exception 'Ученик не найден'; end if;
  -- при блокировке — уведомление
  if p_blocked then
    -- текст уведомления
    perform public.notify(p_user_id, 'warning', 'Аккаунт заблокирован', 'Учитель ограничил твой доступ к чату и подбору. Обратись к учителю.', '/pages/profile.html', null);
  -- конец условия
  end if;
-- конец команд
end;
-- конец тела
$$;

-- ---------------------------------------------------------------------------
-- teacher_close_complaint — учитель закрывает жалобу.
-- Принимает: p_complaint_id. Возвращает: void.
-- ---------------------------------------------------------------------------
-- создаём функцию
create or replace function public.teacher_close_complaint(p_complaint_id bigint)
-- ничего не возвращает
returns void
-- язык plpgsql
language plpgsql
-- права создателя
security definer
-- только схема public
set search_path = public
-- начало тела
as $$
-- переменные
declare
  -- школа жалобы
  v_school bigint;
-- начало команд
begin
  -- находим школу
  v_school := (select school_id from public.complaints where id = p_complaint_id);
  -- только учитель этой школы
  if not public.is_teacher_of(v_school) then raise exception 'Недостаточно прав'; end if;
  -- закрываем
  update public.complaints set status = 'closed', closed_at = now(), closed_by = auth.uid() where id = p_complaint_id;
-- конец команд
end;
-- конец тела
$$;

-- ---------------------------------------------------------------------------
-- admin_list_users — список всех пользователей с поиском (только админ).
-- Принимает: p_search — текст поиска (email, имя или фамилия).
-- Возвращает: таблицу пользователей.
-- ---------------------------------------------------------------------------
-- создаём функцию
create or replace function public.admin_list_users(p_search text default '')
-- столбцы результата
returns table (id uuid, email text, first_name text, last_name text, role text, school_id bigint, school_name text, grade int, is_blocked boolean, created_at timestamptz)
-- язык plpgsql
language plpgsql
-- не меняет данные
stable
-- права создателя (нужен доступ к auth.users, где лежат email)
security definer
-- только схема public
set search_path = public
-- начало тела
as $$
-- начало команд
begin
  -- только админ
  if not public.is_admin() then raise exception 'Эта страница только для администратора'; end if;
  -- return query — вернуть результат запроса как таблицу
  return query
  -- email::text — приводим тип varchar к text
  select p.id, u.email::text, p.first_name, pp.last_name, p.role, p.school_id, s.name, p.grade, p.is_blocked, p.created_at
  -- профили
  from public.profiles p
  -- join auth.users — берём email
  join auth.users u on u.id = p.id
  -- left join — присоединяем, даже если строки нет (фамилия, школа)
  left join public.profile_private pp on pp.id = p.id
  -- название школы
  left join public.schools s on s.id = p.school_id
  -- ilike — поиск без учёта регистра; '%' || текст || '%' — «содержит текст»
  where coalesce(p_search, '') = '' or u.email ilike '%' || p_search || '%' or p.first_name ilike '%' || p_search || '%' or pp.last_name ilike '%' || p_search || '%'
  -- новые сверху
  order by p.created_at desc
  -- не больше 200 строк за раз
  limit 200;
-- конец команд
end;
-- конец тела
$$;

-- ---------------------------------------------------------------------------
-- admin_set_teacher — назначить пользователя учителем школы (только админ).
-- Принимает: p_user_id; p_school_id. Возвращает: void.
-- ---------------------------------------------------------------------------
-- создаём функцию
create or replace function public.admin_set_teacher(p_user_id uuid, p_school_id bigint)
-- ничего не возвращает
returns void
-- язык plpgsql
language plpgsql
-- права создателя
security definer
-- только схема public
set search_path = public
-- начало тела
as $$
-- начало команд
begin
  -- только админ
  if not public.is_admin() then raise exception 'Недостаточно прав'; end if;
  -- школа должна существовать
  if not exists (select 1 from public.schools where id = p_school_id) then raise exception 'Школа не найдена'; end if;
  -- меняем роль и школу; класс учителю не нужен; админа не трогаем
  update public.profiles set role = 'teacher', school_id = p_school_id, grade = null where id = p_user_id and role <> 'admin';
  -- если никого не обновили
  if not found then raise exception 'Пользователь не найден или это администратор'; end if;
-- конец команд
end;
-- конец тела
$$;

-- ---------------------------------------------------------------------------
-- admin_remove_teacher — снять роль учителя (станет учеником). Только админ.
-- Принимает: p_user_id. Возвращает: void.
-- ---------------------------------------------------------------------------
-- создаём функцию
create or replace function public.admin_remove_teacher(p_user_id uuid)
-- ничего не возвращает
returns void
-- язык plpgsql
language plpgsql
-- права создателя
security definer
-- только схема public
set search_path = public
-- начало тела
as $$
-- начало команд
begin
  -- только админ
  if not public.is_admin() then raise exception 'Недостаточно прав'; end if;
  -- учитель становится учеником
  update public.profiles set role = 'student' where id = p_user_id and role = 'teacher';
  -- если это был не учитель
  if not found then raise exception 'Этот пользователь не учитель'; end if;
-- конец команд
end;
-- конец тела
$$;

-- ---------------------------------------------------------------------------
-- admin_review_answer — администратор проверяет ответ на вопрос.
-- Принимает: p_answer_id; p_action — 'approve' (одобрить) или 'remove'
--   (удалить); p_comment — комментарий (при удалении обязателен).
-- Возвращает: void. Очки и уведомления делает триггер on_answer_reviewed.
-- ---------------------------------------------------------------------------
-- создаём функцию
create or replace function public.admin_review_answer(p_answer_id bigint, p_action text, p_comment text default '')
-- ничего не возвращает
returns void
-- язык plpgsql
language plpgsql
-- права создателя
security definer
-- только схема public
set search_path = public
-- начало тела
as $$
-- переменные
declare
  -- комментарий без пробелов по краям
  v_comment text := trim(coalesce(p_comment, ''));
-- начало команд
begin
  -- только админ
  if not public.is_admin() then raise exception 'Недостаточно прав'; end if;
  -- комментарий не длиннее 500 символов
  if char_length(v_comment) > 500 then raise exception 'Комментарий слишком длинный (максимум 500 символов)'; end if;
  -- одобрить
  if p_action = 'approve' then
    -- статус approved; nullif — пустой комментарий сохраняем как null
    update public.answers set status = 'approved', admin_comment = nullif(v_comment, ''), reviewed_by = auth.uid(), reviewed_at = now() where id = p_answer_id;
  -- удалить
  elsif p_action = 'remove' then
    -- при удалении ученик должен понять, в чём ошибка
    if char_length(v_comment) < 3 then raise exception 'Напиши комментарий: почему ответ удалён'; end if;
    -- статус removed — ответ видит только его автор
    update public.answers set status = 'removed', admin_comment = v_comment, reviewed_by = auth.uid(), reviewed_at = now() where id = p_answer_id;
  -- неизвестное действие
  else
    -- ошибка
    raise exception 'Неизвестное действие';
  -- конец условия
  end if;
  -- ни одной строки не изменилось — ответа нет
  if not found then raise exception 'Ответ не найден'; end if;
-- конец команд
end;
-- конец тела
$$;

-- ---------------------------------------------------------------------------
-- admin_warn_user — администратор выносит предупреждение (например, за
-- грубые слова в вопросе или ответе).
-- Принимает: p_user_id; p_comment — за что (необязательно). Возвращает: void.
-- ---------------------------------------------------------------------------
-- создаём функцию
create or replace function public.admin_warn_user(p_user_id uuid, p_comment text default '')
-- ничего не возвращает
returns void
-- язык plpgsql
language plpgsql
-- права создателя
security definer
-- только схема public
set search_path = public
-- начало тела
as $$
-- начало команд
begin
  -- только админ
  if not public.is_admin() then raise exception 'Недостаточно прав'; end if;
  -- +1 предупреждение
  update public.profiles set warnings_count = warnings_count + 1 where id = p_user_id;
  -- пользователь не найден
  if not found then raise exception 'Пользователь не найден'; end if;
  -- уведомление; left(..., 500) — не длиннее 500 символов
  perform public.notify(p_user_id, 'warning', 'Предупреждение от администратора', left(coalesce(nullif(trim(p_comment), ''), 'Пожалуйста, соблюдай правила общения: без грубых слов и оскорблений.'), 500), '/pages/profile.html', null);
-- конец команд
end;
-- конец тела
$$;

-- ---------------------------------------------------------------------------
-- admin_delete_question — администратор удаляет вопрос (вместе с ответами)
-- и сообщает автору причину.
-- Принимает: p_question_id; p_comment — причина (обязательна).
-- Возвращает: text[] — пути фото вопроса и ответов в Storage, чтобы сайт
--   удалил и сами файлы.
-- ---------------------------------------------------------------------------
-- создаём функцию
create or replace function public.admin_delete_question(p_question_id bigint, p_comment text)
-- text[] — массив строк
returns text[]
-- язык plpgsql
language plpgsql
-- права создателя
security definer
-- только схема public
set search_path = public
-- начало тела
as $$
-- переменные
declare
  -- автор вопроса
  v_author uuid;
  -- заголовок
  v_title text;
  -- пути картинок
  v_paths text[];
-- начало команд
begin
  -- только админ
  if not public.is_admin() then raise exception 'Недостаточно прав'; end if;
  -- причина обязательна
  if char_length(trim(coalesce(p_comment, ''))) < 3 then raise exception 'Напиши причину удаления'; end if;
  -- автор и заголовок
  v_author := (select author_id from public.questions where id = p_question_id);
  -- заголовок
  v_title := (select title from public.questions where id = p_question_id);
  -- вопроса нет
  if v_author is null then raise exception 'Вопрос не найден'; end if;
  -- все картинки: фото вопроса и фото ответов; array_remove убирает null из массива
  v_paths := array_remove(array_append((select array_agg(image_path) from public.answers where question_id = p_question_id), (select image_path from public.questions where id = p_question_id)), null);
  -- удаляем вопрос (ответы удалятся сами: on delete cascade)
  delete from public.questions where id = p_question_id;
  -- уведомление автору
  perform public.notify(v_author, 'moderation', 'Вопрос удалён администратором', left('«' || v_title || '»: ' || trim(p_comment), 500), '/pages/questions.html', null);
  -- возвращаем пути файлов (или пустой массив)
  return coalesce(v_paths, array[]::text[]);
-- конец команд
end;
-- конец тела
$$;

-- ---------------------------------------------------------------------------
-- get_streak — серия ученика «недель подряд помогает» (для профиля и шапки).
-- Смотреть можно свою серию и серии учеников своей школы.
-- Принимает: p_user_id — чья серия (null — моя). Возвращает: jsonb из streak_info.
-- ---------------------------------------------------------------------------
-- создаём функцию
create or replace function public.get_streak(p_user_id uuid default null)
-- возвращает JSON
returns jsonb
-- язык plpgsql
language plpgsql
-- не меняет данные
stable
-- права создателя
security definer
-- только схема public
set search_path = public
-- начало тела
as $$
-- переменные
declare
  -- чья серия: переданный ученик или я
  v_user uuid := coalesce(p_user_id, auth.uid());
-- начало команд
begin
  -- без входа — нельзя
  if auth.uid() is null then raise exception 'Нужно войти в аккаунт'; end if;
  -- чужую серию — только в своей школе (или администратору); is distinct from — «не равно» с учётом null
  if v_user <> auth.uid() and public.school_of(v_user) is distinct from public.my_school_id() and not public.is_admin() then raise exception 'Ученик не найден'; end if;
  -- считаем серию
  return public.streak_info(v_user);
-- конец команд
end;
-- конец тела
$$;

-- ---------------------------------------------------------------------------
-- get_timer — состояние общего таймера партнёрства и время сервера.
-- server_now нужен, чтобы у всех участников таймер показывал одно и то же,
-- даже если часы на телефонах немного спешат или отстают.
-- Принимает: p_partnership_id. Возвращает: jsonb (строка таймера + server_now).
-- ---------------------------------------------------------------------------
-- создаём функцию
create or replace function public.get_timer(p_partnership_id bigint)
-- возвращает JSON
returns jsonb
-- язык plpgsql
language plpgsql
-- не меняет данные
stable
-- права создателя
security definer
-- только схема public
set search_path = public
-- начало тела
as $$
-- переменные
declare
  -- строка таймера как JSON (null — таймер ещё ни разу не запускали)
  v_timer jsonb;
-- начало команд
begin
  -- только участники партнёрства
  if not public.is_partnership_member(p_partnership_id) then raise exception 'Чат не найден'; end if;
  -- to_jsonb(t) — вся строка таблицы в виде JSON
  v_timer := (select to_jsonb(t) from public.partnership_timers t where t.partnership_id = p_partnership_id);
  -- таймера нет — отдаём «выключен» с настройками по умолчанию
  if v_timer is null then v_timer := jsonb_build_object('partnership_id', p_partnership_id, 'status', 'stopped', 'work_minutes', 25, 'break_minutes', 5); end if;
  -- || — склеить два JSON-объекта: добавляем время сервера
  return v_timer || jsonb_build_object('server_now', now());
-- конец команд
end;
-- конец тела
$$;

-- ---------------------------------------------------------------------------
-- timer_control — управление общим таймером: start, pause, resume, stop.
-- Нажать может любой участник активного обмена; остальные увидят изменение
-- сразу (Realtime на таблице partnership_timers).
-- Принимает: p_partnership_id; p_action; p_work_minutes и p_break_minutes —
--   длина занятия и перерыва (нужны только для start).
-- Возвращает: jsonb — новое состояние (как get_timer).
-- ---------------------------------------------------------------------------
-- создаём функцию
create or replace function public.timer_control(p_partnership_id bigint, p_action text, p_work_minutes int default 25, p_break_minutes int default 5)
-- возвращает JSON
returns jsonb
-- язык plpgsql
language plpgsql
-- права создателя: напрямую менять таблицу таймеров нельзя
security definer
-- только схема public
set search_path = public
-- начало тела
as $$
-- переменные
declare
  -- текущий статус таймера
  v_status text;
-- начало команд
begin
  -- те же условия, что и для сообщений: активный обмен, без блокировок
  if not public.can_send_message(p_partnership_id) then raise exception 'Таймер доступен только участникам активного обмена'; end if;
  -- создаём строку таймера, если её ещё нет
  insert into public.partnership_timers (partnership_id) values (p_partnership_id) on conflict (partnership_id) do nothing;
  -- текущий статус
  v_status := (select status from public.partnership_timers where partnership_id = p_partnership_id);
  -- запуск
  if p_action = 'start' then
    -- проверка длины занятия
    if p_work_minutes is null or p_work_minutes not between 1 and 120 then raise exception 'Длина занятия — от 1 до 120 минут'; end if;
    -- проверка перерыва
    if p_break_minutes is null or p_break_minutes not between 0 and 30 then raise exception 'Перерыв — от 0 до 30 минут'; end if;
    -- make_interval(mins => n) — промежуток в n минут; цикл закончится через «занятие + перерыв»
    update public.partnership_timers set status = 'running', work_minutes = p_work_minutes, break_minutes = p_break_minutes, ends_at = now() + make_interval(mins => p_work_minutes + p_break_minutes), remaining_seconds = null, updated_by = auth.uid(), updated_at = now() where partnership_id = p_partnership_id;
  -- пауза
  elsif p_action = 'pause' then
    -- ставить на паузу можно только идущий таймер
    if v_status <> 'running' then raise exception 'Таймер не запущен'; end if;
    -- extract(epoch from промежуток) — сколько это секунд; ceil — округление вверх; greatest(0, ...) — не меньше нуля
    update public.partnership_timers set status = 'paused', remaining_seconds = greatest(0, ceil(extract(epoch from ends_at - now())))::int, ends_at = null, updated_by = auth.uid(), updated_at = now() where partnership_id = p_partnership_id;
  -- продолжить
  elsif p_action = 'resume' then
    -- продолжить можно только таймер на паузе
    if v_status <> 'paused' then raise exception 'Таймер не на паузе'; end if;
    -- make_interval(secs => n) — промежуток в n секунд
    update public.partnership_timers set status = 'running', ends_at = now() + make_interval(secs => remaining_seconds), remaining_seconds = null, updated_by = auth.uid(), updated_at = now() where partnership_id = p_partnership_id;
  -- выключить
  elsif p_action = 'stop' then
    -- сбрасываем
    update public.partnership_timers set status = 'stopped', ends_at = null, remaining_seconds = null, updated_by = auth.uid(), updated_at = now() where partnership_id = p_partnership_id;
  -- другое слово — ошибка
  else
    -- сообщение
    raise exception 'Неизвестное действие';
  -- конец условия
  end if;
  -- возвращаем новое состояние
  return public.get_timer(p_partnership_id);
-- конец команд
end;
-- конец тела
$$;

-- ---------------------------------------------------------------------------
-- start_quiz — начать мини-тест для подтверждения уровня по предмету.
-- Правила: предмет отмечен «знаю» на 4–5 и ещё не подтверждён; после
-- неудачной попытки повторить можно через 30 минут. Из вопросов предмета
-- случайно выбираются 5 — БЕЗ правильных ответов (их знает только база).
-- Принимает: p_subject — id предмета. Возвращает: jsonb
--   { attempt_id, questions: [{ id, question, options }] }.
-- ---------------------------------------------------------------------------
-- создаём функцию
create or replace function public.start_quiz(p_subject text)
-- возвращает JSON
returns jsonb
-- язык plpgsql
language plpgsql
-- права создателя: у ученика нет доступа к таблице вопросов
security definer
-- только схема public
set search_path = public
-- начало тела
as $$
-- переменные
declare
  -- номера выбранных вопросов
  v_ids bigint[];
  -- номер новой попытки
  v_attempt bigint;
  -- когда закончилась последняя неудачная попытка
  v_last timestamptz;
-- начало команд
begin
  -- только незаблокированный ученик
  if not public.i_am_active_student() then raise exception 'Тест доступен только ученикам'; end if;
  -- ::text — сравниваем предмет как строку (так неверное название не вызовет ошибку типа)
  if not exists (select 1 from public.skills where user_id = auth.uid() and subject::text = p_subject and kind = 'know' and level >= 4) then
    -- объясняем, что сделать
    raise exception 'Тест можно пройти по предмету «Знаю» с уровнем 4 или 5. Сначала отметь его в профиле и сохрани';
  -- конец условия
  end if;
  -- уже подтверждён
  if exists (select 1 from public.skills where user_id = auth.uid() and subject::text = p_subject and verified_at is not null) then raise exception 'Уровень по этому предмету уже подтверждён'; end if;
  -- max — самая поздняя неудачная попытка
  v_last := (select max(finished_at) from public.quiz_attempts where user_id = auth.uid() and subject::text = p_subject and passed = false);
  -- после неудачи — перерыв 30 минут; % в тексте заменится числом минут
  if v_last > now() - interval '30 minutes' then raise exception 'Повторить тест можно через % мин. А пока повтори тему!', ceil(extract(epoch from v_last + interval '30 minutes' - now()) / 60)::int; end if;
  -- order by random() — случайный порядок; limit 5 — берём 5 вопросов
  v_ids := array(select id from public.quiz_questions where subject::text = p_subject order by random() limit 5);
  -- вопросов меньше 5 — теста по предмету нет; coalesce — у пустого массива длина null
  if coalesce(array_length(v_ids, 1), 0) < 5 then raise exception 'Для этого предмета пока нет теста'; end if;
  -- записываем попытку; ::public.subject_code — строку в тип предмета
  insert into public.quiz_attempts (user_id, subject, question_ids) values (auth.uid(), p_subject::public.subject_code, v_ids);
  -- номер только что созданной попытки (счётчик именно этой таблицы)
  v_attempt := currval(pg_get_serial_sequence('public.quiz_attempts', 'id'));
  -- отдаём вопросы без правильных ответов; array_position — место вопроса в выбранном порядке
  return jsonb_build_object('attempt_id', v_attempt, 'questions', (select jsonb_agg(jsonb_build_object('id', q.id, 'question', q.question, 'options', to_jsonb(q.options)) order by array_position(v_ids, q.id)) from public.quiz_questions q where q.id = any(v_ids)));
-- конец команд
end;
-- конец тела
$$;

-- ---------------------------------------------------------------------------
-- submit_quiz — проверить ответы теста. Проверяет БАЗА: ученик не знает
-- правильных ответов, пока не отправит свои. 4 из 5 — тест сдан: уровень
-- предмета отмечается подтверждённым, +10 очков, проверка бейджей.
-- Принимает: p_attempt_id; p_answers — номера выбранных вариантов (0–3)
--   по порядку вопросов. Возвращает: jsonb { score, total, passed, subject,
--   results: [{ id, question, options, correct, chosen, explanation }] }.
-- ---------------------------------------------------------------------------
-- создаём функцию
create or replace function public.submit_quiz(p_attempt_id bigint, p_answers int[])
-- возвращает JSON
returns jsonb
-- язык plpgsql
language plpgsql
-- права создателя
security definer
-- только схема public
set search_path = public
-- начало тела
as $$
-- переменные
declare
  -- чья попытка
  v_user uuid;
  -- предмет попытки
  v_subject public.subject_code;
  -- вопросы попытки
  v_ids bigint[];
  -- когда начата
  v_started timestamptz;
  -- когда закончена (null — ещё нет)
  v_finished timestamptz;
  -- правильных ответов
  v_score int;
  -- сдан ли
  v_passed boolean;
  -- разбор ответов
  v_results jsonb;
-- начало команд
begin
  -- данные попытки по одному полю
  v_user := (select user_id from public.quiz_attempts where id = p_attempt_id);
  -- предмет
  v_subject := (select subject from public.quiz_attempts where id = p_attempt_id);
  -- вопросы
  v_ids := (select question_ids from public.quiz_attempts where id = p_attempt_id);
  -- начало
  v_started := (select started_at from public.quiz_attempts where id = p_attempt_id);
  -- окончание
  v_finished := (select finished_at from public.quiz_attempts where id = p_attempt_id);
  -- попытка должна быть моей
  if v_user is null or v_user <> auth.uid() then raise exception 'Попытка не найдена'; end if;
  -- второй раз отправить нельзя
  if v_finished is not null then raise exception 'Этот тест уже проверен'; end if;
  -- на тест даётся 30 минут
  if v_started < now() - interval '30 minutes' then raise exception 'Время на тест вышло (30 минут). Начни заново'; end if;
  -- ответов должно быть столько же, сколько вопросов
  if coalesce(array_length(p_answers, 1), 0) <> array_length(v_ids, 1) then raise exception 'Ответь на все вопросы'; end if;
  -- generate_subscripts(массив, 1) — номера элементов 1, 2, ...; считаем совпадения выбранного и правильного
  v_score := (select count(*) from generate_subscripts(v_ids, 1) i join public.quiz_questions q on q.id = v_ids[i] where q.correct = p_answers[i]);
  -- 4 из 5 — сдан
  v_passed := v_score >= 4;
  -- разбор: вопрос, варианты, правильный, выбранный, пояснение — по порядку
  v_results := (select jsonb_agg(jsonb_build_object('id', q.id, 'question', q.question, 'options', to_jsonb(q.options), 'correct', q.correct, 'chosen', p_answers[i], 'explanation', q.explanation) order by i) from generate_subscripts(v_ids, 1) i join public.quiz_questions q on q.id = v_ids[i]);
  -- сохраняем результат попытки
  update public.quiz_attempts set score = v_score, passed = v_passed, finished_at = now() where id = p_attempt_id;
  -- тест сдан
  if v_passed then
    -- set_config(имя, значение, true) — флаг до конца этого запроса: триггер skills_protect_verified разрешит отметку
    perform set_config('skillswap.verify', 'on', true);
    -- отмечаем уровень подтверждённым
    update public.skills set verified_at = now() where user_id = auth.uid() and subject = v_subject and kind = 'know' and level >= 4;
    -- выключаем флаг сразу
    perform set_config('skillswap.verify', 'off', true);
    -- +10 очков один раз за предмет (ключ 'verify:algebra')
    perform public.award_points(auth.uid(), 'skill_verified', 'verify:' || v_subject::text);
    -- проверяем бейджи («Проверенные знания»)
    perform public.check_badges(auth.uid());
  -- конец условия
  end if;
  -- результат для страницы
  return jsonb_build_object('score', v_score, 'total', array_length(v_ids, 1), 'passed', v_passed, 'subject', v_subject, 'results', v_results);
-- конец команд
end;
-- конец тела
$$;

-- ############################################################################
-- ЧАСТЬ 8. ROW LEVEL SECURITY (RLS)
-- alter table ... enable row level security — включить RLS. После этого
-- таблица ЗАКРЫТА для всех, и открыто только то, что разрешают политики.
-- create policy имя on таблица for действие to роль using (условие)
--   for select/insert/update/delete — к какому действию относится правило;
--   to authenticated — только для вошедших пользователей (anon — гости);
--   using (...) — какие СУЩЕСТВУЮЩИЕ строки видны или доступны;
--   with check (...) — какие НОВЫЕ или изменённые строки можно сохранить.
-- ############################################################################

-- включаем RLS на таблице школ
alter table public.schools enable row level security;
-- включаем RLS на профилях
alter table public.profiles enable row level security;
-- на закрытых данных профиля
alter table public.profile_private enable row level security;
-- на навыках
alter table public.skills enable row level security;
-- на свободном времени
alter table public.availability enable row level security;
-- на партнёрствах
alter table public.partnerships enable row level security;
-- на участниках партнёрств
alter table public.partnership_members enable row level security;
-- на сообщениях
alter table public.messages enable row level security;
-- на блокировках
alter table public.blocks enable row level security;
-- на жалобах
alter table public.complaints enable row level security;
-- на занятиях
alter table public.lessons enable row level security;
-- на отзывах
alter table public.reviews enable row level security;
-- на материалах
alter table public.materials enable row level security;
-- на журнале очков
alter table public.points_log enable row level security;
-- на бейджах
alter table public.user_badges enable row level security;
-- на уведомлениях
alter table public.notifications enable row level security;
-- на вопросах
alter table public.questions enable row level security;
-- на ответах
alter table public.answers enable row level security;
-- на доске
alter table public.board_strokes enable row level security;
-- на таймерах
alter table public.partnership_timers enable row level security;
-- на вопросах тестов (правил для учеников нет вообще — доступ только через функции)
alter table public.quiz_questions enable row level security;
-- на попытках тестов
alter table public.quiz_attempts enable row level security;

-- --- schools ---
-- список школ видят все, даже гости (он нужен в форме регистрации); using (true) — любая строка
create policy schools_select_all on public.schools for select to anon, authenticated using (true);
-- добавлять школы может только админ
create policy schools_insert_admin on public.schools for insert to authenticated with check (public.is_admin());
-- изменять — только админ
create policy schools_update_admin on public.schools for update to authenticated using (public.is_admin()) with check (public.is_admin());
-- удалять — только админ
create policy schools_delete_admin on public.schools for delete to authenticated using (public.is_admin());

-- --- profiles ---
-- видно: свой профиль, профили своей школы (ученик видит только свою школу), админу — все
create policy profiles_select on public.profiles for select to authenticated using (id = auth.uid() or school_id = public.my_school_id() or public.is_admin());
-- менять можно только свой профиль (какие именно столбцы — ограничено в части 9)
create policy profiles_update_own on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- --- profile_private (полная фамилия) ---
-- видят: сам ученик, учитель его школы, админ
create policy private_select on public.profile_private for select to authenticated using (id = auth.uid() or public.is_teacher_of(public.school_of(id)) or public.is_admin());
-- менять может только сам ученик
create policy private_update_own on public.profile_private for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- --- skills ---
-- видны навыки учеников своей школы (нужно для подбора)
create policy skills_select_school on public.skills for select to authenticated using (public.school_of(user_id) = public.my_school_id() or public.is_admin());
-- добавлять — только свои
create policy skills_insert_own on public.skills for insert to authenticated with check (user_id = auth.uid());
-- изменять — только свои
create policy skills_update_own on public.skills for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
-- удалять — только свои
create policy skills_delete_own on public.skills for delete to authenticated using (user_id = auth.uid());

-- --- availability ---
-- видно свободное время учеников своей школы (для процента совместимости)
create policy availability_select_school on public.availability for select to authenticated using (public.school_of(user_id) = public.my_school_id() or public.is_admin());
-- добавлять — только своё
create policy availability_insert_own on public.availability for insert to authenticated with check (user_id = auth.uid());
-- удалять — только своё
create policy availability_delete_own on public.availability for delete to authenticated using (user_id = auth.uid());

-- --- partnerships и partnership_members ---
-- партнёрство видят только его участники; создание и изменение — только через функции RPC
create policy partnerships_select_member on public.partnerships for select to authenticated using (public.is_partnership_member(id));
-- участников видят только участники того же партнёрства
create policy members_select_member on public.partnership_members for select to authenticated using (public.is_partnership_member(partnership_id));

-- --- messages ---
-- сообщения видят участники чата (кроме скрытых учителем) и учитель школы, но ТОЛЬКО те, на которые есть жалоба
create policy messages_select on public.messages for select to authenticated using (
  -- участник и сообщение не скрыто
  (public.is_partnership_member(partnership_id) and not is_hidden)
  -- or — «ИЛИ»: есть жалоба на это сообщение в школе, где пользователь учитель
  or exists (select 1 from public.complaints c where c.message_id = messages.id and public.is_teacher_of(c.school_id))
-- закрываем using
);
-- писать можно только от своего имени и только если can_send_message разрешает
create policy messages_insert on public.messages for insert to authenticated with check (sender_id = auth.uid() and public.can_send_message(partnership_id));

-- --- blocks ---
-- видно блокировки, где пользователь участвует с любой стороны (нужно, чтобы не предлагать таких в подборе)
create policy blocks_select_own on public.blocks for select to authenticated using (blocker_id = auth.uid() or blocked_id = auth.uid());
-- заблокировать может только сам пользователь
create policy blocks_insert_own on public.blocks for insert to authenticated with check (blocker_id = auth.uid());
-- разблокировать — тоже только сам
create policy blocks_delete_own on public.blocks for delete to authenticated using (blocker_id = auth.uid());

-- --- complaints ---
-- жалобу видят её автор, учитель школы и админ; создаются через report_message
create policy complaints_select on public.complaints for select to authenticated using (reporter_id = auth.uid() or public.is_teacher_of(school_id) or public.is_admin());

-- --- lessons ---
-- занятия видят участники партнёрства
create policy lessons_select_member on public.lessons for select to authenticated using (public.is_partnership_member(partnership_id));
-- назначить занятие может активный участник, от своего имени и только на будущее время
create policy lessons_insert_member on public.lessons for insert to authenticated with check (created_by = auth.uid() and public.is_active_member(partnership_id) and scheduled_at > now());
-- менять (только статус, см. часть 9) может участник
create policy lessons_update_member on public.lessons for update to authenticated using (public.is_partnership_member(partnership_id)) with check (public.is_partnership_member(partnership_id));

-- --- reviews ---
-- отзывы видны ученикам той же школы (для профиля партнёра); создаются через leave_review
create policy reviews_select_school on public.reviews for select to authenticated using (public.school_of(target_id) = public.my_school_id() or public.is_admin());

-- --- materials ---
-- материалы видят участники партнёрства
create policy materials_select_member on public.materials for select to authenticated using (public.is_partnership_member(partnership_id));
-- добавлять — активный участник от своего имени
create policy materials_insert_member on public.materials for insert to authenticated with check (uploader_id = auth.uid() and public.is_active_member(partnership_id));
-- удалять — только тот, кто загрузил
create policy materials_delete_own on public.materials for delete to authenticated using (uploader_id = auth.uid());

-- --- points_log ---
-- свою историю очков видит только сам ученик (рейтинг считается функцией get_school_leaderboard)
create policy points_select_own on public.points_log for select to authenticated using (user_id = auth.uid());

-- --- user_badges ---
-- бейджи видны ученикам своей школы
create policy badges_select_school on public.user_badges for select to authenticated using (public.school_of(user_id) = public.my_school_id() or public.is_admin());

-- --- notifications ---
-- свои уведомления видит только получатель
create policy notifications_select_own on public.notifications for select to authenticated using (user_id = auth.uid());
-- отмечать прочитанными — только свои
create policy notifications_update_own on public.notifications for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());


-- --- questions ---
-- раздел вопросов общий: using (true) — вопросы видят все вошедшие пользователи из любой школы
create policy questions_select on public.questions for select to authenticated using (true);
-- задать вопрос может незаблокированный ученик — от своего имени; school_id — его школа (показывается рядом с вопросом)
create policy questions_insert on public.questions for insert to authenticated with check (author_id = auth.uid() and school_id = public.my_school_id() and public.i_am_active_student());
-- удалить вопрос может его автор (админ удаляет через admin_delete_question, чтобы автор узнал причину)
create policy questions_delete_own on public.questions for delete to authenticated using (author_id = auth.uid());

-- --- answers ---
-- ответы видят все (кроме удалённых админом); удалённый видит только его автор (чтобы прочитать комментарий) и админ
create policy answers_select on public.answers for select to authenticated using (status <> 'removed' or author_id = auth.uid() or public.is_admin());
-- ответить может незаблокированный ученик из любой школы; статус только 'pending' — одобрить сам себя нельзя
create policy answers_insert on public.answers for insert to authenticated with check (
  -- от своего имени, без отметок администратора
  author_id = auth.uid() and status = 'pending' and admin_comment is null and reviewed_by is null and reviewed_at is null
  -- я активный ученик (не заблокирован)
  and public.i_am_active_student()
  -- на свой собственный вопрос отвечать нельзя
  and not exists (select 1 from public.questions q where q.id = question_id and q.author_id = auth.uid())
-- закрываем with check
);
-- удалить можно только свой ответ
create policy answers_delete_own on public.answers for delete to authenticated using (author_id = auth.uid());

-- --- board_strokes ---
-- доску видят только участники партнёрства
create policy board_select_member on public.board_strokes for select to authenticated using (public.is_partnership_member(partnership_id));
-- рисовать — от своего имени и только там, где можно писать сообщения (активный обмен, без блокировок)
create policy board_insert_member on public.board_strokes for insert to authenticated with check (author_id = auth.uid() and public.can_send_message(partnership_id));

-- --- partnership_timers ---
-- таймер видят участники (менять — только через функцию timer_control)
create policy timers_select_member on public.partnership_timers for select to authenticated using (public.is_partnership_member(partnership_id));

-- --- quiz_attempts ---
-- свои попытки (создаёт и проверяет их только база: start_quiz и submit_quiz)
create policy quiz_attempts_select_own on public.quiz_attempts for select to authenticated using (user_id = auth.uid());

-- ############################################################################
-- ЧАСТЬ 9. ПРАВА НА ТАБЛИЦЫ И СТОЛБЦЫ
-- RLS решает, КАКИЕ СТРОКИ можно менять, а grant/revoke — КАКИЕ ТАБЛИЦЫ,
-- СТОЛБЦЫ и ФУНКЦИИ вообще доступны роли.
-- grant — выдать право, revoke — отобрать право.
-- Supabase обычно выдаёт эти права сам, но пропишем их явно — так схема
-- работает в любом проекте и её легче объяснить.
-- ############################################################################

-- usage on schema — право «заходить» в схему public; anon — гости, authenticated — вошедшие
grant usage on schema public to anon, authenticated;
-- гостям — только чтение списка школ (для формы регистрации)
grant select on public.schools to anon;
-- вошедшим — все действия с таблицами; что именно можно, дальше ограничивает RLS
grant select, insert, update, delete on all tables in schema public to authenticated;
-- sequences — счётчики номеров (identity); без этого права нельзя вставить строку с автономером
grant usage, select on all sequences in schema public to authenticated;
-- execute on all functions — право вызывать наши функции; каждая функция сама проверяет, можно ли тебе
grant execute on all functions in schema public to authenticated;

-- отбираем право менять профили целиком...
revoke update on public.profiles from authenticated, anon;
-- ...и разрешаем менять только имя, класс и аватар (роль, школу, очки, блокировку ученик изменить не может)
grant update (first_name, grade, avatar) on public.profiles to authenticated;
-- в закрытых данных — то же самое
revoke update on public.profile_private from authenticated, anon;
-- можно менять только фамилию
grant update (last_name) on public.profile_private to authenticated;
-- в занятиях...
revoke update on public.lessons from authenticated, anon;
-- ...можно менять только статус
grant update (status) on public.lessons to authenticated;
-- в уведомлениях...
revoke update on public.notifications from authenticated, anon;
-- ...можно менять только отметку «прочитано»
grant update (is_read) on public.notifications to authenticated;
-- вопросы тестов с правильными ответами — никаких прав напрямую (только через start_quiz и submit_quiz)
revoke all on public.quiz_questions from authenticated, anon;


-- ############################################################################
-- ЧАСТЬ 10. ХРАНИЛИЩЕ ФАЙЛОВ (Storage)
-- Две закрытые «корзины» (bucket):
--   • materials — файлы партнёрств; путь начинается с номера партнёрства:
--     «12/1712345678-konspekt.pdf» — по нему правила проверяют участника;
--   • qa-images — фото к вопросам и ответам; путь начинается с номера школы:
--     «3/1712345678-ab12cd.jpg» — видят только ученики этой школы и админ.
-- ############################################################################

-- создаём корзину: public = false — файлы НЕ доступны по прямой ссылке всем подряд
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
-- 5242880 байт = 5 МБ; разрешены только картинки и PDF — сервер сам отклонит другие файлы
values ('materials', 'materials', false, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'])
-- если корзина уже есть — ничего не делаем
on conflict (id) do nothing;

-- корзина фото для вопросов и ответов: закрытая, до 5 МБ, только картинки (без PDF)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
-- значения
values ('qa-images', 'qa-images', false, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
-- если корзина уже есть — ничего не делаем
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- storage_folder_id — достаёт число из первой папки пути файла:
-- для materials это номер партнёрства, для qa-images — номер школы.
-- Принимает: p_object_name — путь, например '12/file.pdf'.
-- Возвращает: bigint — номер (12) или null, если путь неправильный.
-- ---------------------------------------------------------------------------
-- создаём функцию
create or replace function public.storage_folder_id(p_object_name text)
-- возвращает число
returns bigint
-- язык plpgsql
language plpgsql
-- зависит только от параметра
immutable
-- начало тела
as $$
-- переменные
declare
  -- split_part(строка, '/', 1) — первая часть строки до знака «/»
  v_folder text := split_part(p_object_name, '/', 1);
-- начало команд
begin
  -- если первая папка не число — путь неправильный
  if v_folder !~ '^[0-9]+$' then return null; end if;
  -- превращаем в число и возвращаем
  return v_folder::bigint;
-- конец команд
end;
-- конец тела
$$;

-- скачивать (читать) файлы могут только участники партнёрства
create policy materials_files_select on storage.objects for select to authenticated
  -- bucket_id — корзина; name — путь файла
  using (bucket_id = 'materials' and public.is_partnership_member(public.storage_folder_id(name)));
-- загружать — только активные участники
create policy materials_files_insert on storage.objects for insert to authenticated
  -- проверка для нового файла
  with check (bucket_id = 'materials' and public.is_active_member(public.storage_folder_id(name)));
-- удалять — участники партнёрства (кнопку удаления сайт показывает только автору, а строку в materials удалит только автор)
create policy materials_files_delete on storage.objects for delete to authenticated
  -- проверка
  using (bucket_id = 'materials' and public.is_partnership_member(public.storage_folder_id(name)));

-- раздел вопросов общий: фото из корзины qa-images может открыть любой вошедший пользователь
create policy qa_images_select on storage.objects for select to authenticated
  -- проверка: только эта корзина
  using (bucket_id = 'qa-images');
-- загружать — активные ученики, только в папку своей школы
create policy qa_images_insert on storage.objects for insert to authenticated
  -- проверка для нового файла
  with check (bucket_id = 'qa-images' and public.storage_folder_id(name) = public.my_school_id() and public.i_am_active_student());
-- удалять — владелец файла (owner — кто загрузил, Supabase ставит его сам) или админ
create policy qa_images_delete on storage.objects for delete to authenticated
  -- проверка
  using (bucket_id = 'qa-images' and (owner = auth.uid() or public.is_admin()));

-- корзина голосовых сообщений: закрытая, до 3 МБ, только звук (webm — Chrome/Android, mp4 — iPhone)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
-- 3145728 байт = 3 МБ (2 минуты голоса занимают меньше 1 МБ)
values ('voice', 'voice', false, 3145728, array['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/wav'])
-- если корзина уже есть — ничего не делаем
on conflict (id) do nothing;

-- голосовые слушают участники чата (первая папка пути = номер партнёрства)
create policy voice_select on storage.objects for select to authenticated
  -- и учитель школы, если на это голосовое пожаловались (так же, как с текстом сообщения)
  using (bucket_id = 'voice' and (public.is_partnership_member(public.storage_folder_id(name)) or exists (select 1 from public.messages m join public.complaints c on c.message_id = m.id where m.voice_path = name and public.is_teacher_of(c.school_id))));
-- записывать — только тот, кто может писать в этот чат
create policy voice_insert on storage.objects for insert to authenticated
  -- проверка для нового файла
  with check (bucket_id = 'voice' and public.can_send_message(public.storage_folder_id(name)));
-- удалять — только свой файл (если сообщение не отправилось)
create policy voice_delete on storage.objects for delete to authenticated
  -- проверка
  using (bucket_id = 'voice' and owner = auth.uid());


-- ############################################################################
-- ЧАСТЬ 11. REALTIME
-- Добавляем таблицы в «публикацию» supabase_realtime: тогда сайт получает
-- новые строки мгновенно. Realtime тоже соблюдает RLS — чужие сообщения
-- и уведомления никому не придут.
-- ############################################################################

-- alter publication ... add table — подписать таблицу сообщений на Realtime
alter publication supabase_realtime add table public.messages;
-- и таблицу уведомлений
alter publication supabase_realtime add table public.notifications;
-- рисунки общей доски
alter publication supabase_realtime add table public.board_strokes;
-- общий таймер занятия
alter publication supabase_realtime add table public.partnership_timers;


-- ############################################################################
-- ЧАСТЬ 12. ПРОФИЛИ ДЛЯ УЖЕ СУЩЕСТВУЮЩИХ ПОЛЬЗОВАТЕЛЕЙ
-- Если схему выполняют заново (после reset.sql), аккаунты в Authentication
-- остаются, а их профили были удалены. Создаём им профили заново из данных
-- регистрации. Роль администратора после этого нужно выдать себе ещё раз.
-- ############################################################################

-- select функция(...) from auth.users where not exists (...) — вызвать create_profile для каждого пользователя без профиля
select public.create_profile(u.id, u.raw_user_meta_data)
-- таблица пользователей Supabase под коротким именем u
from auth.users u
-- только те, у кого профиля ещё нет
where not exists (select 1 from public.profiles p where p.id = u.id);


-- ############################################################################
-- ЧАСТЬ 13. ВОПРОСЫ МИНИ-ТЕСТОВ (подтверждение уровня)
-- По 8 вопросов на предмет; в каждой попытке start_quiz случайно выбирает 5.
-- Хочешь добавить вопрос — допиши строку: (предмет, вопрос, 4 варианта,
-- номер правильного варианта от 0 до 3, пояснение). Повторный запуск не
-- создаёт дублей: on conflict (subject, question) do nothing.
-- ############################################################################

-- Математика: добавляем вопросы (subject — предмет, options — 4 варианта, correct — номер правильного с нуля)
insert into public.quiz_questions (subject, question, options, correct, explanation) values
  -- Математика 1: правильный ответ — А) 30
  ('math', 'Сколько будет 15% от 200?', array['30', '20', '35', '15'], 0, '200 × 0,15 = 30.'),
  -- Математика 2: правильный ответ — Г) 17
  ('math', 'Чему равно 2³ + 3²?', array['13', '36', '12', '17'], 3, '2³ = 8, 3² = 9, 8 + 9 = 17.'),
  -- Математика 3: правильный ответ — В) 3/4
  ('math', 'Какая дробь больше: 3/4 или 5/8?', array['Они равны', '5/8', '3/4', 'Сравнить нельзя'], 2, '3/4 = 6/8, а 6/8 > 5/8.'),
  -- Математика 4: правильный ответ — Б) 12
  ('math', 'Чему равен НОД чисел 24 и 36?', array['6', '12', '4', '72'], 1, '12 — самое большое число, на которое делятся и 24, и 36.'),
  -- Математика 5: правильный ответ — А) 150
  ('math', 'Машина едет 60 км/ч. Сколько километров она проедет за 2,5 часа?', array['150', '120', '140', '160'], 0, 's = v · t = 60 · 2,5 = 150 км.'),
  -- Математика 6: правильный ответ — Г) 8
  ('math', 'Чему равно −7 + 12 − (−3)?', array['2', '22', '−8', '8'], 3, '−7 + 12 = 5; минус минус три — это плюс три: 5 + 3 = 8.'),
  -- Математика 7: правильный ответ — В) 7
  ('math', 'Найдите среднее арифметическое чисел 4, 7 и 10.', array['6', '8', '7', '21'], 2, '(4 + 7 + 10) : 3 = 21 : 3 = 7.'),
  -- Математика 8: правильный ответ — Б) 81 см²
  ('math', 'Периметр квадрата 36 см. Чему равна его площадь?', array['36 см²', '81 см²', '144 см²', '18 см²'], 1, 'Сторона 36 : 4 = 9 см, площадь 9 · 9 = 81 см².')
-- если такой вопрос уже есть — пропускаем
on conflict (subject, question) do nothing;

-- Алгебра: добавляем вопросы (subject — предмет, options — 4 варианта, correct — номер правильного с нуля)
insert into public.quiz_questions (subject, question, options, correct, explanation) values
  -- Алгебра 1: правильный ответ — Б) x = 6
  ('algebra', 'Решите уравнение 3x − 7 = 11.', array['x = 4/3', 'x = 6', 'x = 18', 'x = 5'], 1, '3x = 18, значит x = 6.'),
  -- Алгебра 2: правильный ответ — А) a² + 2ab + b²
  ('algebra', 'Чему равно (a + b)²?', array['a² + 2ab + b²', 'a² + b²', 'a² − 2ab + b²', '2a + 2b'], 0, 'Формула квадрата суммы: a² + 2ab + b².'),
  -- Алгебра 3: правильный ответ — Г) 2 и 3
  ('algebra', 'Найдите корни уравнения x² − 5x + 6 = 0.', array['−1 и 6', '−2 и −3', '1 и 6', '2 и 3'], 3, 'По теореме Виета: сумма корней 5, произведение 6 — это 2 и 3.'),
  -- Алгебра 4: правильный ответ — В) x⁶
  ('algebra', 'Чему равно (x³)²?', array['x⁵', 'x⁹', 'x⁶', '2x³'], 2, 'При возведении степени в степень показатели перемножаются: 3 · 2 = 6.'),
  -- Алгебра 5: правильный ответ — Б) 11
  ('algebra', 'Чему равно √49 + √16?', array['√65', '11', '13', '9'], 1, '√49 = 7, √16 = 4, 7 + 4 = 11.'),
  -- Алгебра 6: правильный ответ — А) −5
  ('algebra', 'Дана функция y = 2x + 1. Чему равен y при x = −3?', array['−5', '−7', '7', '5'], 0, 'y = 2 · (−3) + 1 = −6 + 1 = −5.'),
  -- Алгебра 7: правильный ответ — Г) (x − 3)(x + 3)
  ('algebra', 'Разложите на множители x² − 9.', array['(x − 3)²', '(x − 9)(x + 1)', 'x(x − 9)', '(x − 3)(x + 3)'], 3, 'Разность квадратов: a² − b² = (a − b)(a + b).'),
  -- Алгебра 8: правильный ответ — В) 0
  ('algebra', 'Чему равен дискриминант уравнения x² + 4x + 4 = 0?', array['16', '8', '0', '−8'], 2, 'D = b² − 4ac = 16 − 16 = 0, поэтому корень один: x = −2.')
-- если такой вопрос уже есть — пропускаем
on conflict (subject, question) do nothing;

-- Геометрия: добавляем вопросы (subject — предмет, options — 4 варианта, correct — номер правильного с нуля)
insert into public.quiz_questions (subject, question, options, correct, explanation) values
  -- Геометрия 1: правильный ответ — В) 180°
  ('geometry', 'Чему равна сумма углов треугольника?', array['90°', '270°', '180°', '360°'], 2, 'Сумма углов любого треугольника — 180°.'),
  -- Геометрия 2: правильный ответ — Б) 5
  ('geometry', 'Катеты прямоугольного треугольника 3 и 4. Чему равна гипотенуза?', array['7', '5', '6', '√7'], 1, 'По теореме Пифагора: √(3² + 4²) = √25 = 5.'),
  -- Геометрия 3: правильный ответ — А) 30
  ('geometry', 'Основание треугольника 10, высота 6. Чему равна площадь?', array['30', '60', '16', '15'], 0, 'S = ½ · a · h = ½ · 10 · 6 = 30.'),
  -- Геометрия 4: правильный ответ — Г) 2πr
  ('geometry', 'По какой формуле находят длину окружности радиуса r?', array['πr²', '2r', 'πd²', '2πr'], 3, 'C = 2πr (πr² — это площадь круга).'),
  -- Геометрия 5: правильный ответ — В) 360°
  ('geometry', 'Чему равна сумма углов выпуклого четырёхугольника?', array['180°', '540°', '360°', '720°'], 2, 'Диагональ делит его на два треугольника: 2 · 180° = 360°.'),
  -- Геометрия 6: правильный ответ — Б) Они равны
  ('geometry', 'Что верно для углов при основании равнобедренного треугольника?', array['В сумме дают 90°', 'Они равны', 'Всегда по 60°', 'Они смежные'], 1, 'Это свойство равнобедренного треугольника.'),
  -- Геометрия 7: правильный ответ — А) 9
  ('geometry', 'Сколько диагоналей у шестиугольника?', array['9', '6', '12', '3'], 0, 'По формуле n(n − 3) / 2 = 6 · 3 / 2 = 9.'),
  -- Геометрия 8: правильный ответ — Г) Они равны
  ('geometry', 'Что верно для вертикальных углов?', array['В сумме 180°', 'Они всегда прямые', 'В сумме 90°', 'Они равны'], 3, 'Вертикальные углы равны.')
-- если такой вопрос уже есть — пропускаем
on conflict (subject, question) do nothing;

-- Физика: добавляем вопросы (subject — предмет, options — 4 варианта, correct — номер правильного с нуля)
insert into public.quiz_questions (subject, question, options, correct, explanation) values
  -- Физика 1: правильный ответ — Г) Ньютон
  ('physics', 'В каких единицах измеряют силу в системе СИ?', array['Джоуль', 'Ватт', 'Паскаль', 'Ньютон'], 3, 'Сила измеряется в ньютонах (Н).'),
  -- Физика 2: правильный ответ — В) v = s / t
  ('physics', 'По какой формуле находят скорость равномерного движения?', array['v = s · t', 'v = t / s', 'v = s / t', 'v = m · a'], 2, 'Скорость = путь : время.'),
  -- Физика 3: правильный ответ — Б) F = m · a
  ('physics', 'Как записывается второй закон Ньютона?', array['F = m / a', 'F = m · a', 'E = m · c²', 'p = m · v'], 1, 'Сила равна произведению массы на ускорение.'),
  -- Физика 4: правильный ответ — А) 9,8 м/с²
  ('physics', 'Чему примерно равно ускорение свободного падения на Земле?', array['9,8 м/с²', '1 м/с²', '98 м/с²', '0,98 м/с²'], 0, 'g ≈ 9,8 м/с².'),
  -- Физика 5: правильный ответ — Г) I = U / R
  ('physics', 'Как записывается закон Ома для участка цепи?', array['R = U · I', 'I = U · R', 'U = I / R', 'I = U / R'], 3, 'Сила тока = напряжение : сопротивление.'),
  -- Физика 6: правильный ответ — В) Расширяются
  ('physics', 'Что обычно происходит с телами при нагревании?', array['Сжимаются', 'Не меняются', 'Расширяются', 'Теряют массу'], 2, 'При нагревании частицы движутся быстрее, и тело расширяется.'),
  -- Физика 7: правильный ответ — Б) Давление
  ('physics', 'Что измеряют в паскалях?', array['Работу', 'Давление', 'Мощность', 'Заряд'], 1, '1 Па = 1 Н / 1 м² — единица давления.'),
  -- Физика 8: правильный ответ — А) 300 000 км/с
  ('physics', 'Чему примерно равна скорость света в вакууме?', array['300 000 км/с', '300 км/с', '340 м/с', '3 000 км/ч'], 0, 'c ≈ 300 000 км/с (340 м/с — скорость звука в воздухе).')
-- если такой вопрос уже есть — пропускаем
on conflict (subject, question) do nothing;

-- Химия: добавляем вопросы (subject — предмет, options — 4 варианта, correct — номер правильного с нуля)
insert into public.quiz_questions (subject, question, options, correct, explanation) values
  -- Химия 1: правильный ответ — А) H₂O
  ('chemistry', 'Какая химическая формула у воды?', array['H₂O', 'H₂O₂', 'HO', 'CO₂'], 0, 'Молекула воды: два атома водорода и один атом кислорода.'),
  -- Химия 2: правильный ответ — Г) Na
  ('chemistry', 'Какой химический символ у натрия?', array['N', 'S', 'Nt', 'Na'], 3, 'Na — от латинского Natrium (N — это азот).'),
  -- Химия 3: правильный ответ — В) 7
  ('chemistry', 'Чему равен pH нейтрального раствора?', array['0', '14', '7', '1'], 2, 'pH 7 — нейтральная среда, меньше 7 — кислая, больше 7 — щелочная.'),
  -- Химия 4: правильный ответ — Б) 6
  ('chemistry', 'Сколько протонов в ядре атома углерода?', array['12', '6', '14', '4'], 1, 'Порядковый номер углерода — 6, значит в ядре 6 протонов.'),
  -- Химия 5: правильный ответ — А) CO₂
  ('chemistry', 'Какой газ образуется при полном сгорании углерода?', array['CO₂', 'O₃', 'H₂', 'N₂'], 0, 'C + O₂ → CO₂ (углекислый газ).'),
  -- Химия 6: правильный ответ — Г) NaCl
  ('chemistry', 'Какая формула у поваренной соли?', array['KCl', 'NaOH', 'CaCO₃', 'NaCl'], 3, 'Поваренная соль — хлорид натрия NaCl.'),
  -- Химия 7: правильный ответ — В) Нейтрализация
  ('chemistry', 'Как называется реакция кислоты со щёлочью?', array['Разложение', 'Окисление', 'Нейтрализация', 'Электролиз'], 2, 'Кислота + щёлочь → соль + вода: это нейтрализация.'),
  -- Химия 8: правильный ответ — Б) Красным
  ('chemistry', 'Каким становится лакмус в кислой среде?', array['Синим', 'Красным', 'Зелёным', 'Бесцветным'], 1, 'В кислой среде лакмус красный, в щелочной — синий.')
-- если такой вопрос уже есть — пропускаем
on conflict (subject, question) do nothing;

-- Биология: добавляем вопросы (subject — предмет, options — 4 варианта, correct — номер правильного с нуля)
insert into public.quiz_questions (subject, question, options, correct, explanation) values
  -- Биология 1: правильный ответ — Б) Митохондрия
  ('biology', 'Какой органоид называют «энергетической станцией» клетки?', array['Ядро', 'Митохондрия', 'Рибосома', 'Вакуоль'], 1, 'В митохондриях образуется энергия (АТФ).'),
  -- Биология 2: правильный ответ — А) Фотосинтез
  ('biology', 'Как называется образование органических веществ на свету в растениях?', array['Фотосинтез', 'Дыхание', 'Брожение', 'Испарение'], 0, 'Фотосинтез идёт в хлоропластах с помощью света.'),
  -- Биология 3: правильный ответ — Г) 4
  ('biology', 'Сколько камер в сердце человека?', array['2', '3', '5', '4'], 3, 'Два предсердия и два желудочка.'),
  -- Биология 4: правильный ответ — В) ДНК
  ('biology', 'Что хранит наследственную информацию?', array['Глюкоза', 'АТФ', 'ДНК', 'Крахмал'], 2, 'Наследственная информация записана в ДНК.'),
  -- Биология 5: правильный ответ — Б) Дельфин
  ('biology', 'Кто из этих животных — млекопитающее?', array['Акула', 'Дельфин', 'Пингвин', 'Крокодил'], 1, 'Дельфин дышит лёгкими и выкармливает детёнышей молоком.'),
  -- Биология 6: правильный ответ — А) В поджелудочной железе
  ('biology', 'Где вырабатывается инсулин?', array['В поджелудочной железе', 'В печени', 'В почках', 'В щитовидной железе'], 0, 'Инсулин вырабатывает поджелудочная железа.'),
  -- Биология 7: правильный ответ — Г) В хлоропластах
  ('biology', 'Где находится хлорофилл?', array['В лизосомах', 'В митохондриях', 'В ядре', 'В хлоропластах'], 3, 'Хлорофилл — зелёный пигмент хлоропластов.'),
  -- Биология 8: правильный ответ — В) 46
  ('biology', 'Сколько хромосом в клетках тела человека?', array['23', '44', '46', '48'], 2, '46 хромосом — 23 пары (в половых клетках — 23).')
-- если такой вопрос уже есть — пропускаем
on conflict (subject, question) do nothing;

-- Информатика: добавляем вопросы (subject — предмет, options — 4 варианта, correct — номер правильного с нуля)
insert into public.quiz_questions (subject, question, options, correct, explanation) values
  -- Информатика 1: правильный ответ — В) 8
  ('informatics', 'Сколько бит в одном байте?', array['4', '10', '8', '16'], 2, '1 байт = 8 бит.'),
  -- Информатика 2: правильный ответ — Б) 10
  ('informatics', 'Чему равно двоичное число 1010 в десятичной системе?', array['8', '10', '12', '5'], 1, '1·8 + 0·4 + 1·2 + 0·1 = 10.'),
  -- Информатика 3: правильный ответ — А) Python
  ('informatics', 'Что из этого — язык программирования?', array['Python', 'HTML', 'HTTP', 'JPEG'], 0, 'HTML — язык разметки, HTTP — протокол, JPEG — формат картинок.'),
  -- Информатика 4: правильный ответ — Г) 1024
  ('informatics', 'Сколько байт в 1 килобайте (в информатике)?', array['1000', '2048', '512', '1024'], 3, '1 КБ = 2¹⁰ = 1024 байта.'),
  -- Информатика 5: правильный ответ — В) Ложь
  ('informatics', 'Чему равно логическое выражение «истина И ложь»?', array['Истина', 'Не определено', 'Ложь', 'Ошибка'], 2, 'И (AND) истинно, только если истинны оба условия.'),
  -- Информатика 6: правильный ответ — Б) Повторять действия
  ('informatics', 'Для чего нужен цикл в программе?', array['Сохранять файл', 'Повторять действия', 'Рисовать окно', 'Удалять переменную'], 1, 'Цикл выполняет одни и те же команды несколько раз.'),
  -- Информатика 7: правильный ответ — А) Баг
  ('informatics', 'Как программисты называют ошибку в программе?', array['Баг', 'Байт', 'Бит', 'Бот'], 0, 'Баг (от английского bug — «жук»).'),
  -- Информатика 8: правильный ответ — Г) .html
  ('informatics', 'Какое расширение у файла веб-страницы?', array['.exe', '.mp3', '.docx', '.html'], 3, 'Веб-страницы пишут на HTML и сохраняют с расширением .html.')
-- если такой вопрос уже есть — пропускаем
on conflict (subject, question) do nothing;

-- Английский язык: добавляем вопросы (subject — предмет, options — 4 варианта, correct — номер правильного с нуля)
insert into public.quiz_questions (subject, question, options, correct, explanation) values
  -- Английский язык 1: правильный ответ — Г) goes
  ('english', 'She ___ to school every day.', array['go', 'gone', 'going', 'goes'], 3, 'Present Simple: he / she / it + глагол с окончанием -s.'),
  -- Английский язык 2: правильный ответ — В) bought
  ('english', 'Какая форма Past Simple у глагола «buy»?', array['buyed', 'brought', 'bought', 'buys'], 2, 'buy — bought — bought (brought — от bring).'),
  -- Английский язык 3: правильный ответ — Б) since
  ('english', 'I have lived here ___ 2015.', array['for', 'since', 'from', 'during'], 1, 'since + момент времени, for + период («for 5 years»).'),
  -- Английский язык 4: правильный ответ — А) Библиотека
  ('english', 'Как переводится слово «library»?', array['Библиотека', 'Книжный магазин', 'Лаборатория', 'Учебник'], 0, 'library — библиотека (bookshop — книжный магазин).'),
  -- Английский язык 5: правильный ответ — Г) are
  ('english', 'There ___ many apples on the table.', array['is', 'be', 'am', 'are'], 3, 'many apples — множественное число, значит are.'),
  -- Английский язык 6: правильный ответ — В) better
  ('english', 'Какая сравнительная степень у «good»?', array['gooder', 'best', 'better', 'more good'], 2, 'good — better — the best.'),
  -- Английский язык 7: правильный ответ — Б) will stay
  ('english', 'If it rains tomorrow, we ___ at home.', array['stay', 'will stay', 'stayed', 'would stayed'], 1, 'Первый тип условных: If + Present Simple, will + глагол.'),
  -- Английский язык 8: правильный ответ — А) cheap
  ('english', 'Какой антоним у слова «expensive»?', array['cheap', 'rich', 'costly', 'big'], 0, 'expensive — дорогой, cheap — дешёвый.')
-- если такой вопрос уже есть — пропускаем
on conflict (subject, question) do nothing;

-- Русский язык: добавляем вопросы (subject — предмет, options — 4 варианта, correct — номер правильного с нуля)
insert into public.quiz_questions (subject, question, options, correct, explanation) values
  -- Русский язык 1: правильный ответ — А) ноч…
  ('russian', 'В каком слове на конце пишется мягкий знак?', array['ноч…', 'мяч…', 'врач…', 'луч…'], 0, 'Ночь — существительное женского рода, после шипящей пишется Ь.'),
  -- Русский язык 2: правильный ответ — Г) 6
  ('russian', 'Сколько падежей в русском языке?', array['5', '8', '7', '6'], 3, 'Именительный, родительный, дательный, винительный, творительный, предложный.'),
  -- Русский язык 3: правильный ответ — В) Наречие
  ('russian', 'Какая часть речи слово «быстро» в предложении «Он быстро бежит»?', array['Прилагательное', 'Глагол', 'Наречие', 'Существительное'], 2, 'Отвечает на вопрос «как?» и относится к глаголу — это наречие.'),
  -- Русский язык 4: правильный ответ — Б) в течение дня
  ('russian', 'Как пишется правильно?', array['в течении дня', 'в течение дня', 'втечение дня', 'в теченье дня'], 1, 'Предлог «в течение» (о времени) пишется раздельно и с Е на конце.'),
  -- Русский язык 5: правильный ответ — А) (не)навидеть
  ('russian', 'Какое слово пишется с НЕ слитно?', array['(не)навидеть', '(не)был', '(не)знал', '(не)хочу'], 0, 'Без НЕ глагол не употребляется: «ненавидеть».'),
  -- Русский язык 6: правильный ответ — Г) Смелый
  ('russian', 'Какой синоним у слова «храбрый»?', array['Трусливый', 'Весёлый', 'Умный', 'Смелый'], 3, 'Храбрый и смелый — близкие по смыслу слова.'),
  -- Русский язык 7: правильный ответ — В) звонИт
  ('russian', 'Где ударение поставлено правильно?', array['звОнит', 'Оба варианта верны', 'звонИт', 'В слове нет ударения'], 2, 'По норме: звонИт, звонЯт.'),
  -- Русский язык 8: правильный ответ — Б) Кто? Что?
  ('russian', 'На какой вопрос обычно отвечает подлежащее?', array['Что делает?', 'Кто? Что?', 'Какой?', 'Где?'], 1, 'Подлежащее отвечает на вопросы именительного падежа: кто? что?')
-- если такой вопрос уже есть — пропускаем
on conflict (subject, question) do nothing;

-- Узбекский язык: добавляем вопросы (subject — предмет, options — 4 варианта, correct — номер правильного с нуля)
insert into public.quiz_questions (subject, question, options, correct, explanation) values
  -- Узбекский язык 1: правильный ответ — Б) Rahmat
  ('uzbek', 'Как по-узбекски «спасибо»?', array['Salom', 'Rahmat', 'Xayr', 'Kechirasiz'], 1, 'Rahmat — спасибо; Salom — привет; Xayr — до свидания.'),
  -- Узбекский язык 2: правильный ответ — А) Книга
  ('uzbek', 'Как переводится слово «kitob»?', array['Книга', 'Тетрадь', 'Ручка', 'Стол'], 0, 'Kitob — книга.'),
  -- Узбекский язык 3: правильный ответ — Г) Школа
  ('uzbek', 'Что означает слово «maktab»?', array['Дом', 'Магазин', 'Больница', 'Школа'], 3, 'Maktab — школа.'),
  -- Узбекский язык 4: правильный ответ — В) suv
  ('uzbek', 'Какое слово означает «вода»?', array['non', 'olma', 'suv', 'choy'], 2, 'Suv — вода; non — хлеб; olma — яблоко; choy — чай.'),
  -- Узбекский язык 5: правильный ответ — Б) Xayr
  ('uzbek', 'Как сказать «до свидания»?', array['Rahmat', 'Xayr', 'Ha', 'Yo‘q'], 1, 'Xayr — до свидания; ha — да; yo‘q — нет.'),
  -- Узбекский язык 6: правильный ответ — А) 5
  ('uzbek', 'Какое число обозначает слово «besh»?', array['5', '3', '7', '10'], 0, 'Bir, ikki, uch, to‘rt, besh — 1, 2, 3, 4, 5.'),
  -- Узбекский язык 7: правильный ответ — Г) -lar
  ('uzbek', 'Каким окончанием образуется множественное число?', array['-ga', '-ning', '-da', '-lar'], 3, 'Kitob — kitoblar (книга — книги).'),
  -- Узбекский язык 8: правильный ответ — В) Я ученик
  ('uzbek', 'Как переводится «Men o‘quvchiman»?', array['Я учитель', 'Он ученик', 'Я ученик', 'Мы учимся'], 2, 'O‘quvchi — ученик, -man — «я есть».')
-- если такой вопрос уже есть — пропускаем
on conflict (subject, question) do nothing;

-- История: добавляем вопросы (subject — предмет, options — 4 варианта, correct — номер правильного с нуля)
insert into public.quiz_questions (subject, question, options, correct, explanation) values
  -- История 1: правильный ответ — В) 1939
  ('history', 'В каком году началась Вторая мировая война?', array['1914', '1941', '1939', '1945'], 2, 'Война началась 1 сентября 1939 года.'),
  -- История 2: правильный ответ — Б) Самарканд
  ('history', 'Какой город был столицей государства Амира Темура?', array['Бухара', 'Самарканд', 'Хива', 'Ташкент'], 1, 'Амир Темур сделал столицей Самарканд.'),
  -- История 3: правильный ответ — А) Мирзо Улугбек
  ('history', 'Кто построил знаменитую обсерваторию в Самарканде в XV веке?', array['Мирзо Улугбек', 'Амир Темур', 'Бабур', 'Алишер Навои'], 0, 'Обсерваторию построил внук Темура — учёный Мирзо Улугбек.'),
  -- История 4: правильный ответ — Г) 1991
  ('history', 'В каком году провозглашена независимость Республики Узбекистан?', array['1989', '2000', '1995', '1991'], 3, 'Независимость провозглашена 31 августа 1991 года.'),
  -- История 5: правильный ответ — В) Китай и Средиземноморье
  ('history', 'Что соединял Великий шёлковый путь?', array['Европу и Америку', 'Африку и Австралию', 'Китай и Средиземноморье', 'Индию и Америку'], 2, 'Караванные дороги шли из Китая через Среднюю Азию к Средиземному морю.'),
  -- История 6: правильный ответ — Б) Юрий Гагарин
  ('history', 'Кто первым полетел в космос?', array['Нил Армстронг', 'Юрий Гагарин', 'Герман Титов', 'Валентина Терешкова'], 1, 'Юрий Гагарин, 12 апреля 1961 года.'),
  -- История 7: правильный ответ — А) Как гробницы фараонов
  ('history', 'Для чего строили египетские пирамиды?', array['Как гробницы фараонов', 'Как крепости', 'Для торговли', 'Как обсерватории'], 0, 'Пирамиды — гробницы фараонов.'),
  -- История 8: правильный ответ — Г) Бабур
  ('history', 'Кто основал державу Великих Моголов в Индии?', array['Шейбани-хан', 'Акбар', 'Улугбек', 'Бабур'], 3, 'Захириддин Мухаммад Бабур, уроженец Андижана, в 1526 году.')
-- если такой вопрос уже есть — пропускаем
on conflict (subject, question) do nothing;

-- География: добавляем вопросы (subject — предмет, options — 4 варианта, correct — номер правильного с нуля)
insert into public.quiz_questions (subject, question, options, correct, explanation) values
  -- География 1: правильный ответ — Г) Тихий
  ('geography', 'Какой океан самый большой?', array['Атлантический', 'Индийский', 'Северный Ледовитый', 'Тихий'], 3, 'Тихий океан — самый большой и глубокий.'),
  -- География 2: правильный ответ — В) Ташкент
  ('geography', 'Какой город — столица Узбекистана?', array['Самарканд', 'Бухара', 'Ташкент', 'Наманган'], 2, 'Столица — Ташкент.'),
  -- География 3: правильный ответ — Б) Эверест (Джомолунгма)
  ('geography', 'Какая гора самая высокая в мире?', array['Эльбрус', 'Эверест (Джомолунгма)', 'Килиманджаро', 'Монблан'], 1, 'Эверест — около 8849 м.'),
  -- География 4: правильный ответ — А) 6
  ('geography', 'Сколько материков на Земле?', array['6', '5', '7', '4'], 0, 'Евразия, Африка, Северная и Южная Америка, Австралия, Антарктида.'),
  -- География 5: правильный ответ — Г) Амударья и Сырдарья
  ('geography', 'Какие реки впадают в Аральское море?', array['Волга и Урал', 'Нил и Конго', 'Обь и Иртыш', 'Амударья и Сырдарья'], 3, 'Аральское море питают Амударья и Сырдарья.'),
  -- География 6: правильный ответ — В) Экватор
  ('geography', 'Как называется линия, которая делит Землю на Северное и Южное полушария?', array['Меридиан', 'Тропик', 'Экватор', 'Нулевой меридиан'], 2, 'Экватор (меридианы делят на Западное и Восточное).'),
  -- География 7: правильный ответ — Б) Кызылкум
  ('geography', 'Какая пустыня занимает большую часть Узбекистана?', array['Сахара', 'Кызылкум', 'Каракум', 'Гоби'], 1, 'Кызылкум лежит между Амударьёй и Сырдарьёй.'),
  -- География 8: правильный ответ — А) Нил
  ('geography', 'Какая река самая длинная в Африке?', array['Нил', 'Конго', 'Нигер', 'Замбези'], 0, 'Нил — около 6650 км.')
-- если такой вопрос уже есть — пропускаем
on conflict (subject, question) do nothing;

-- Литература: добавляем вопросы (subject — предмет, options — 4 варианта, correct — номер правильного с нуля)
insert into public.quiz_questions (subject, question, options, correct, explanation) values
  -- Литература 1: правильный ответ — А) А. С. Пушкин
  ('literature', 'Кто написал роман в стихах «Евгений Онегин»?', array['А. С. Пушкин', 'М. Ю. Лермонтов', 'Н. В. Гоголь', 'Л. Н. Толстой'], 0, 'Роман написал Александр Сергеевич Пушкин.'),
  -- Литература 2: правильный ответ — Г) На староузбекском (тюркском)
  ('literature', 'На каком языке Алишер Навои написал «Хамсу»?', array['На персидском', 'На турецком', 'На арабском', 'На староузбекском (тюркском)'], 3, 'Навои доказал, что на тюркском языке можно писать великие произведения.'),
  -- Литература 3: правильный ответ — В) Л. Н. Толстой
  ('literature', 'Кто написал роман «Война и мир»?', array['Ф. М. Достоевский', 'А. П. Чехов', 'Л. Н. Толстой', 'И. С. Тургенев'], 2, 'Роман-эпопея Льва Николаевича Толстого.'),
  -- Литература 4: правильный ответ — Б) Ф. М. Достоевский
  ('literature', 'Кто автор романа «Преступление и наказание»?', array['И. А. Гончаров', 'Ф. М. Достоевский', 'М. А. Булгаков', 'Л. Н. Толстой'], 1, 'Роман Фёдора Михайловича Достоевского.'),
  -- Литература 5: правильный ответ — А) М. Ю. Лермонтов
  ('literature', 'Кто написал поэму «Мцыри»?', array['М. Ю. Лермонтов', 'А. С. Пушкин', 'Н. А. Некрасов', 'С. А. Есенин'], 0, 'Поэма Михаила Юрьевича Лермонтова.'),
  -- Литература 6: правильный ответ — Г) Образное определение
  ('literature', 'Что такое эпитет?', array['Повтор звуков', 'Рифма', 'Сравнение со словом «как»', 'Образное определение'], 3, 'Например: «золотая осень», «грустный дождь».'),
  -- Литература 7: правильный ответ — В) Абдулла Кадыри
  ('literature', 'Кто написал роман «Минувшие дни» («O‘tkan kunlar»)?', array['Гафур Гулям', 'Чулпан', 'Абдулла Кадыри', 'Айбек'], 2, 'Первый узбекский роман написал Абдулла Кадыри.'),
  -- Литература 8: правильный ответ — Б) А. П. Чехов
  ('literature', 'Кто автор рассказа «Каштанка»?', array['М. Горький', 'А. П. Чехов', 'А. И. Куприн', 'И. А. Бунин'], 1, 'Рассказ Антона Павловича Чехова.')
-- если такой вопрос уже есть — пропускаем
on conflict (subject, question) do nothing;

-- ############################################################################
-- ЧАСТЬ 14. ПОДСКАЗКИ ИИ К ВОПРОСАМ (таблицы, лимит в день, RLS)
-- Подсказки создаёт только серверная функция supabase/functions/ai-hint:
-- у неё служебный ключ, поэтому правил на запись для учеников здесь нет.
-- ############################################################################

-- ############################################################################
-- ШАГ 1. ТАБЛИЦЫ
-- ############################################################################

-- ---------------------------------------------------------------------------
-- Таблица ai_hints — подсказки ИИ. Одна строка на вопрос.
-- ---------------------------------------------------------------------------
-- create table if not exists — создать таблицу, если её ещё нет
create table if not exists public.ai_hints (
  -- номер вопроса; primary key — у вопроса не больше одной подсказки; удалили вопрос → удалится подсказка
  question_id bigint primary key references public.questions (id) on delete cascade,
  -- текст подсказки: от 1 до 4000 символов
  hint text not null check (char_length(hint) between 1 and 4000),
  -- какая модель ИИ написала подсказку (для истории)
  model text not null default '',
  -- кто первым попросил подсказку; удалили пользователя → останется null
  requested_by uuid references public.profiles (id) on delete set null,
  -- когда создана
  created_at timestamptz not null default now()
-- конец таблицы ai_hints
);

-- ---------------------------------------------------------------------------
-- Таблица ai_usage — счётчик подсказок ученика за день.
-- ---------------------------------------------------------------------------
-- создаём таблицу
create table if not exists public.ai_usage (
  -- кто
  user_id uuid not null references public.profiles (id) on delete cascade,
  -- date — только дата без времени; current_date — сегодня (по времени сервера, UTC)
  day date not null default current_date,
  -- сколько подсказок запрошено за этот день
  requests int not null default 0 check (requests >= 0),
  -- primary key из двух столбцов: у ученика одна строка на каждый день
  primary key (user_id, day)
-- конец таблицы ai_usage
);


-- ############################################################################
-- ШАГ 2. ФУНКЦИИ ЛИМИТА
-- ############################################################################

-- ---------------------------------------------------------------------------
-- ai_daily_limit — сколько новых подсказок в день можно запросить. ЗДЕСЬ
-- меняется лимит (на сайте то же число — AI_DAILY_LIMIT в js/config.js).
-- Принимает: ничего. Возвращает: int.
-- ---------------------------------------------------------------------------
-- create or replace function — создать или заменить функцию
create or replace function public.ai_daily_limit()
-- возвращает целое число
returns int
-- на SQL
language sql
-- immutable — результат всегда одинаковый
immutable
-- начало тела
as $$
  -- 10 подсказок в день
  select 10
-- конец тела
$$;

-- ---------------------------------------------------------------------------
-- ai_take_quota — «списывает» одну подсказку из дневного лимита текущего
-- пользователя. Всё делается ОДНОЙ командой, поэтому даже при двух быстрых
-- нажатиях подряд лимит не превысить.
-- Вызывает серверная функция ai-hint от имени ученика (auth.uid() — он).
-- Принимает: ничего. Возвращает: int — сколько подсказок осталось после
--   списания, или -1, если лимит уже исчерпан.
-- ---------------------------------------------------------------------------
-- создаём функцию
create or replace function public.ai_take_quota()
-- возвращает целое число
returns int
-- язык plpgsql
language plpgsql
-- права создателя: у ученика нет права писать в ai_usage напрямую
security definer
-- только схема public
set search_path = public
-- начало тела
as $$
-- переменные
declare
  -- сколько запросов стало после списания
  v_used int;
-- начало команд
begin
  -- не вошёл — ошибка
  if auth.uid() is null then raise exception 'Нужно войти в аккаунт'; end if;
  -- insert ... on conflict do update — «вставь строку, а если за сегодня она уже есть — увеличь счётчик»
  insert into public.ai_usage (user_id, day, requests) values (auth.uid(), current_date, 1)
  -- конфликт по ключу (пользователь, день)
  on conflict (user_id, day) do update set requests = public.ai_usage.requests + 1
  -- where — увеличиваем, только если лимит ещё не исчерпан (иначе строка не меняется)
  where public.ai_usage.requests < public.ai_daily_limit()
  -- returning ... into — положить новое значение счётчика в переменную
  returning requests into v_used;
  -- строка не изменилась (v_used пустой) — лимит исчерпан
  if v_used is null then return -1; end if;
  -- сколько осталось
  return public.ai_daily_limit() - v_used;
-- конец команд
end;
-- конец тела
$$;

-- ---------------------------------------------------------------------------
-- ai_hints_left — сколько подсказок текущий пользователь ещё может запросить
-- сегодня (для надписи «Осталось сегодня: 7»).
-- Принимает: ничего. Возвращает: int.
-- ---------------------------------------------------------------------------
-- создаём функцию
create or replace function public.ai_hints_left()
-- возвращает целое число
returns int
-- на SQL
language sql
-- stable — только читает
stable
-- права создателя
security definer
-- только схема public
set search_path = public
-- начало тела
as $$
  -- greatest — большее из чисел (не меньше 0); coalesce — если строки за сегодня нет, считаем 0 запросов
  select greatest(public.ai_daily_limit() - coalesce((select requests from public.ai_usage where user_id = auth.uid() and day = current_date), 0), 0)
-- конец тела
$$;


-- ############################################################################
-- ШАГ 3. ЗАЩИТА ДАННЫХ (RLS) И ПРАВА
-- ############################################################################

-- включаем RLS на подсказках
alter table public.ai_hints enable row level security;
-- включаем RLS на счётчике
alter table public.ai_usage enable row level security;

-- drop policy if exists — убираем старое правило, чтобы создать заново
drop policy if exists ai_hints_select on public.ai_hints;
-- подсказки видят все вошедшие (вопросы общие для всех школ); правил insert/update нет — писать может только сервер
create policy ai_hints_select on public.ai_hints for select to authenticated using (true);
-- убираем старое правило
drop policy if exists ai_usage_select_own on public.ai_usage;
-- свой счётчик видит только сам пользователь
create policy ai_usage_select_own on public.ai_usage for select to authenticated using (user_id = auth.uid());

-- grant select — право читать (какие строки — решают правила RLS выше)
grant select on public.ai_hints, public.ai_usage to authenticated;
-- право вызывать функции лимита
grant execute on function public.ai_daily_limit(), public.ai_take_quota(), public.ai_hints_left() to authenticated;

-- notify pgrst — просим API Supabase перечитать схему (иначе новые таблицы могут быть «не найдены»)
notify pgrst, 'reload schema';
