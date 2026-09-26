-- ============================================================================
-- Файл: sql/seed.sql
-- Зачем нужен: ДЕМО-ДАННЫЕ для защиты проекта:
--   • 3 школы; 21 ученик в первой школе, по 2–3 в других; 2 учителя, 1 админ;
--   • у всех email — имя и фамилия латиницей (ilyanikolaev@gmail.com),
--     пароль у всех один: 12345678; email уже подтверждён — можно сразу входить;
--   • предметы подобраны так, чтобы на экране совпадений были и ПАРЫ
--     (например, у Ильи Николаева), и ТРОЙКА (у Марьям Азимовой:
--     Марьям → Бекзод → Сабина → Марьям);
--   • готовые обмены, переписка, жалоба для учителя, занятия с отзывами,
--     вопросы и ответы (одобренные, непроверенные, удалённый, с грубым словом).
-- Очки и бейджи здесь НЕ вписаны вручную — их начисляют триггеры базы
-- (как у настоящих учеников).
-- Как связан с остальными: выполнять ПОСЛЕ sql/schema.sql (SQL Editor → New
-- query → вставить → Run). Можно запускать повторно: сначала удаляются
-- старые демо-аккаунты. Твои собственные аккаунты скрипт не трогает.
-- ВНИМАНИЕ: gmail.com — настоящий сервис; не нажимай «Забыли пароль?» для
-- демо-аккаунтов, иначе письмо уйдёт постороннему человеку.
-- ============================================================================

-- ############################################################################
-- ЧАСТЬ 0. ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
-- pg_temp — временная схема: функции в ней живут только пока выполняется этот
-- скрипт и сами исчезают после. Они делают код ниже коротким и понятным.
-- ############################################################################

-- ---------------------------------------------------------------------------
-- uid — id пользователя по email.
-- Принимает: p_email. Возвращает: uuid.
-- ---------------------------------------------------------------------------
-- create or replace function pg_temp.имя — создать временную функцию
create or replace function pg_temp.uid(p_email text)
-- возвращает uuid
returns uuid
-- на SQL
language sql
-- тело функции
as $$ select id from auth.users where email = p_email $$;

-- ---------------------------------------------------------------------------
-- add_user — создаёт пользователя Supabase Auth (как при регистрации).
-- Триггер handle_new_user из schema.sql сам создаст ему профиль.
-- Принимает: email, имя, фамилию, название школы, класс (или null), аватар.
-- Возвращает: uuid нового пользователя.
-- ---------------------------------------------------------------------------
-- создаём функцию
create or replace function pg_temp.add_user(p_email text, p_first text, p_last text, p_school text, p_grade int, p_avatar text)
-- возвращает uuid
returns uuid
-- язык plpgsql
language plpgsql
-- начало тела
as $$
-- переменные
declare
-- gen_random_uuid() — новый случайный id
  v_id uuid := gen_random_uuid();
-- номер школы по названию
  v_school bigint := (select id from public.schools where name = p_school);
-- начало команд
begin
-- auth.users — таблица аккаунтов Supabase; пароль шифруем функцией crypt (bf — алгоритм bcrypt), email_confirmed_at = now() — email уже подтверждён
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
-- значения; raw_user_meta_data — те же данные, что сайт передаёт при регистрации; пустые строки '' в токенах — так требует Supabase Auth
  values ('00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated', p_email, extensions.crypt('12345678', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, jsonb_build_object('first_name', p_first, 'last_name', p_last, 'school_id', coalesce(v_school::text, ''), 'grade', coalesce(p_grade::text, ''), 'avatar', p_avatar), now(), now(), '', '', '', '');
-- auth.identities — «способ входа» пользователя (по email); без этой строки вход по паролю не работает
  insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
-- значения
  values (gen_random_uuid(), v_id, v_id::text, jsonb_build_object('sub', v_id::text, 'email', p_email, 'email_verified', true), 'email', now(), now(), now());
-- возвращаем id
  return v_id;
-- конец команд
end;
-- конец тела
$$;

-- ---------------------------------------------------------------------------
-- make_partnership — партнёрство из двух человек: A учит B, B учит A.
-- Принимает: email создателя, email второго, чему учит создатель, чему учит второй,
--   статус, сколько дней назад создано. Возвращает: bigint — номер партнёрства.
-- ---------------------------------------------------------------------------
-- создаём функцию
create or replace function pg_temp.make_partnership(p_a text, p_b text, p_a_teaches text, p_b_teaches text, p_status text, p_days_ago int)
-- возвращает число
returns bigint
-- язык plpgsql
language plpgsql
-- начало тела
as $$
-- переменные
declare
-- номер партнёрства
  v_id bigint;
-- начало команд
begin
-- само партнёрство; accepted_at заполняем, если обмен уже был принят (active или finished)
  insert into public.partnerships (school_id, kind, status, created_by, created_at, accepted_at, finished_at)
-- значения; make_interval(days => n) — промежуток в n дней
  values (public.school_of(pg_temp.uid(p_a)), 'pair', p_status, pg_temp.uid(p_a), now() - make_interval(days => p_days_ago), case when p_status in ('active', 'finished') then now() - make_interval(days => p_days_ago) + interval '2 hours' end, case when p_status = 'finished' then now() - interval '1 day' end);
-- currval(последовательность таблицы) — номер только что созданной строки ИМЕННО этой таблицы (lastval не подходит: триггеры тоже берут номера)
  v_id := currval(pg_get_serial_sequence('public.partnerships', 'id'));
-- участники: A учит B (A уже согласен — он предложил)
  insert into public.partnership_members (partnership_id, user_id, teaches_to, teaches_subject, accepted) values (v_id, pg_temp.uid(p_a), pg_temp.uid(p_b), p_a_teaches, true);
-- B учит A; B согласен, если обмен не в статусе pending
  insert into public.partnership_members (partnership_id, user_id, teaches_to, teaches_subject, accepted) values (v_id, pg_temp.uid(p_b), pg_temp.uid(p_a), p_b_teaches, p_status <> 'pending');
-- возвращаем номер
  return v_id;
-- конец команд
end;
-- конец тела
$$;

-- ---------------------------------------------------------------------------
-- pair_id — номер последнего партнёрства двух учеников.
-- Принимает: два email. Возвращает: bigint.
-- ---------------------------------------------------------------------------
-- создаём функцию
create or replace function pg_temp.pair_id(p_a text, p_b text)
-- возвращает число
returns bigint
-- на SQL
language sql
-- партнёрство, где есть оба ученика; самое новое
as $$ select a.partnership_id from public.partnership_members a join public.partnership_members b on b.partnership_id = a.partnership_id where a.user_id = pg_temp.uid(p_a) and b.user_id = pg_temp.uid(p_b) order by a.partnership_id desc limit 1 $$;

-- ---------------------------------------------------------------------------
-- message — сообщение в чате двух учеников.
-- Принимает: email двух участников, email отправителя, текст, сколько минут назад.
-- ---------------------------------------------------------------------------
-- создаём функцию
create or replace function pg_temp.message(p_a text, p_b text, p_sender text, p_body text, p_minutes_ago int)
-- ничего не возвращает
returns void
-- на SQL
language sql
-- вставляем сообщение; триггер пришлёт получателю уведомление
as $$ insert into public.messages (partnership_id, sender_id, body, created_at) values (pg_temp.pair_id(p_a, p_b), pg_temp.uid(p_sender), p_body, now() - make_interval(mins => p_minutes_ago)) $$;

-- ---------------------------------------------------------------------------
-- lesson — занятие двух учеников. Сначала создаётся «запланировано», потом
-- статус меняется — тогда триггеры начислят очки и бейджи, как в жизни.
-- Принимает: email двух участников, email создателя, тему, место,
--   смещение от текущего времени (минус — в прошлом), итоговый статус.
-- ---------------------------------------------------------------------------
-- создаём функцию
create or replace function pg_temp.lesson(p_a text, p_b text, p_creator text, p_topic text, p_place text, p_shift interval, p_status text)
-- ничего не возвращает
returns void
-- язык plpgsql
language plpgsql
-- начало тела
as $$
-- переменные
declare
-- номер занятия
  v_id bigint;
-- начало команд
begin
-- создаём запланированное занятие
  insert into public.lessons (partnership_id, created_by, scheduled_at, topic, place) values (pg_temp.pair_id(p_a, p_b), pg_temp.uid(p_creator), now() + p_shift, p_topic, p_place);
-- номер нового занятия; pg_get_serial_sequence находит счётчик столбца id
  v_id := currval(pg_get_serial_sequence('public.lessons', 'id'));
-- если итоговый статус не 'planned' — меняем его (триггеры сработают)
  if p_status <> 'planned' then update public.lessons set status = p_status where id = v_id; end if;
-- конец команд
end;
-- конец тела
$$;

-- ---------------------------------------------------------------------------
-- review — оценка после занятия: автор оценивает того, кто помогал ему.
-- Принимает: тему занятия, email автора, оценку, отзыв.
-- ---------------------------------------------------------------------------
-- создаём функцию
create or replace function pg_temp.review(p_topic text, p_author text, p_rating int, p_comment text)
-- ничего не возвращает
returns void
-- на SQL
language sql
-- target — участник, который учит автора (teaches_to = автор); триггер начислит очки за оценку 4–5
as $$ insert into public.reviews (lesson_id, author_id, target_id, rating, comment) select l.id, pg_temp.uid(p_author), m.user_id, p_rating, p_comment from public.lessons l join public.partnership_members m on m.partnership_id = l.partnership_id and m.teaches_to = pg_temp.uid(p_author) where l.topic = p_topic limit 1 $$;

-- ---------------------------------------------------------------------------
-- question — вопрос ученика. Принимает: email, предмет, заголовок, подробности,
--   сколько часов назад. Возвращает: bigint — номер вопроса.
-- ---------------------------------------------------------------------------
-- создаём функцию
create or replace function pg_temp.question(p_email text, p_subject text, p_title text, p_body text, p_hours_ago int)
-- возвращает число
returns bigint
-- на SQL
language sql
-- вставляем вопрос и сразу возвращаем его номер (returning id)
as $$ insert into public.questions (school_id, author_id, subject, title, body, created_at) values (public.school_of(pg_temp.uid(p_email)), pg_temp.uid(p_email), p_subject, p_title, p_body, now() - make_interval(hours => p_hours_ago)) returning id $$;

-- ---------------------------------------------------------------------------
-- answer — ответ на вопрос. Сначала ответ «не проверен» (pending); если нужно,
-- администратор его одобряет или удаляет — триггер начислит очки и пришлёт
-- уведомление, как в жизни.
-- Принимает: заголовок вопроса, email автора, текст, часов назад, итоговый
--   статус, комментарий администратора.
-- ---------------------------------------------------------------------------
-- создаём функцию
create or replace function pg_temp.answer(p_title text, p_email text, p_body text, p_hours_ago int, p_status text, p_comment text)
-- ничего не возвращает
returns void
-- язык plpgsql
language plpgsql
-- начало тела
as $$
-- переменные
declare
-- номер ответа
  v_id bigint;
-- начало команд
begin
-- вставляем ответ (статус pending по умолчанию); триггер уведомит автора вопроса
  insert into public.answers (question_id, author_id, body, created_at) values ((select id from public.questions where title = p_title limit 1), pg_temp.uid(p_email), p_body, now() - make_interval(hours => p_hours_ago));
-- номер ответа (счётчик именно таблицы answers — триггер уведомлений тоже брал номер)
  v_id := currval(pg_get_serial_sequence('public.answers', 'id'));
-- проверка администратором (демо-админ Азиз Рахимов)
  if p_status <> 'pending' then update public.answers set status = p_status, admin_comment = p_comment, reviewed_by = pg_temp.uid('azizrakhimov@gmail.com'), reviewed_at = now() where id = v_id; end if;
-- конец команд
end;
-- конец тела
$$;


-- ############################################################################
-- ЧАСТЬ 1. УБИРАЕМ СТАРЫЕ ДЕМО-ДАННЫЕ (если скрипт запускают повторно)
-- ############################################################################

-- удаляем демо-аккаунты по email; профили и всё связанное удалятся каскадом (on delete cascade)
delete from auth.users where email = any(array[
-- Азиз Рахимов
  'azizrakhimov@gmail.com',
-- Нодира Каримова
  'nodirakarimova@gmail.com',
-- Дилшод Юсупов
  'dilshodyusupov@gmail.com',
-- Илья Николаев
  'ilyanikolaev@gmail.com',
-- Анна Смирнова
  'annasmirnova@gmail.com',
-- Тимур Каримов
  'timurkarimov@gmail.com',
-- Дина Юсупова
  'dinayusupova@gmail.com',
-- Амир Рашидов
  'amirrashidov@gmail.com',
-- Лейла Хасанова
  'leylakhasanova@gmail.com',
-- Марьям Азимова
  'maryamazimova@gmail.com',
-- Бекзод Нурматов
  'bekzodnurmatov@gmail.com',
-- Сабина Рахматова
  'sabinarakhmatova@gmail.com',
-- Ольга Ким
  'olgakim@gmail.com',
-- Руслан Ахмедов
  'ruslanakhmedov@gmail.com',
-- Камила Туляганова
  'kamilatulyaganova@gmail.com',
-- Артём Ли
  'artemli@gmail.com',
-- Нигора Саидова
  'nigorasaidova@gmail.com',
-- Шахзод Алиев
  'shakhzodaliev@gmail.com',
-- Полина Воронова
  'polinavoronova@gmail.com',
-- Даниил Орлов
  'daniilorlov@gmail.com',
-- Зарина Мирзаева
  'zarinamirzaeva@gmail.com',
-- Ислом Каримов
  'islomkarimov@gmail.com',
-- Эльвира Султанова
  'elvirasultanova@gmail.com',
-- Максим Петров
  'maksimpetrov@gmail.com',
-- Сардор Ибрагимов
  'sardoribragimov@gmail.com',
-- Малика Юнусова
  'malikayunusova@gmail.com',
-- Жасур Хамидов
  'zhasurkhamidov@gmail.com',
-- Азамат Турсунов
  'azamattursunov@gmail.com',
-- Севара Назарова
  'sevaranazarova@gmail.com'
-- конец списка
]);
-- удаляем демо-школы, если в них больше нет пользователей (школы с пользователями база удалить не даст)
delete from public.schools s where s.name = any(array['Школа №1 им. Алишера Навои', 'Школа №110', 'Президентская школа']) and not exists (select 1 from public.profiles p where p.school_id = s.id);

-- ############################################################################
-- ЧАСТЬ 2. ШКОЛЫ
-- ############################################################################

-- добавляем три школы; on conflict (name) do nothing — если школа уже есть, пропускаем
insert into public.schools (name, city) values
-- Школа №1 им. Алишера Навои, Ташкент
  ('Школа №1 им. Алишера Навои', 'Ташкент'),
-- Школа №110, Ташкент
  ('Школа №110', 'Ташкент'),
-- Президентская школа, Самарканд
  ('Президентская школа', 'Самарканд')
-- если такая школа уже есть — не дублируем
on conflict (name) do nothing;

-- ############################################################################
-- ЧАСТЬ 3. ПОЛЬЗОВАТЕЛИ (пароль у всех: 12345678)
-- select pg_temp.add_user(...) — вызываем функцию для каждого пользователя.
-- ############################################################################

-- Азиз Рахимов — демо-АДМИНИСТРАТОР (azizrakhimov@gmail.com)
select pg_temp.add_user('azizrakhimov@gmail.com', 'Азиз', 'Рахимов', 'Школа №1 им. Алишера Навои', null, '🦉');
-- Нодира Каримова — учитель школы №1 (nodirakarimova@gmail.com)
select pg_temp.add_user('nodirakarimova@gmail.com', 'Нодира', 'Каримова', 'Школа №1 им. Алишера Навои', null, '🦉');
-- Дилшод Юсупов — учитель школы №110 (dilshodyusupov@gmail.com)
select pg_temp.add_user('dilshodyusupov@gmail.com', 'Дилшод', 'Юсупов', 'Школа №110', null, '🐢');
-- Илья Николаев, 8 класс — главный демо-ученик: есть пары, входящий запрос, занятия, отзывы
select pg_temp.add_user('ilyanikolaev@gmail.com', 'Илья', 'Николаев', 'Школа №1 им. Алишера Навои', 8, '🦊');
-- Анна Смирнова, 7 класс — активный обмен с Ильёй
select pg_temp.add_user('annasmirnova@gmail.com', 'Анна', 'Смирнова', 'Школа №1 им. Алишера Навои', 7, '🐼');
-- Тимур Каримов, 9 класс — пара для Ильи; обмен с Ольгой
select pg_temp.add_user('timurkarimov@gmail.com', 'Тимур', 'Каримов', 'Школа №1 им. Алишера Навои', 9, '🐯');
-- Дина Юсупова, 11 класс — пара для Ильи с низким процентом (далёкий класс, нет общего времени)
select pg_temp.add_user('dinayusupova@gmail.com', 'Дина', 'Юсупова', 'Школа №1 им. Алишера Навои', 11, '🦄');
-- Амир Рашидов, 8 класс — обмен с Артёмом, на него жалоба
select pg_temp.add_user('amirrashidov@gmail.com', 'Амир', 'Рашидов', 'Школа №1 им. Алишера Навои', 8, '🦁');
-- Лейла Хасанова, 6 класс — пара с Русланом
select pg_temp.add_user('leylakhasanova@gmail.com', 'Лейла', 'Хасанова', 'Школа №1 им. Алишера Навои', 6, '🦋');
-- Марьям Азимова, 7 класс — нет прямой пары — только ТРОЙКА с Бекзодом и Сабиной
select pg_temp.add_user('maryamazimova@gmail.com', 'Марьям', 'Азимова', 'Школа №1 им. Алишера Навои', 7, '🐬');
-- Бекзод Нурматов, 8 класс — тройка: Марьям учит его химии, он учит Сабину узбекскому
select pg_temp.add_user('bekzodnurmatov@gmail.com', 'Бекзод', 'Нурматов', 'Школа №1 им. Алишера Навои', 8, '⚽');
-- Сабина Рахматова, 7 класс — тройка: учит Марьям геометрии
select pg_temp.add_user('sabinarakhmatova@gmail.com', 'Сабина', 'Рахматова', 'Школа №1 им. Алишера Навои', 7, '🌟');
-- Ольга Ким, 9 класс — обмен с Тимуром
select pg_temp.add_user('olgakim@gmail.com', 'Ольга', 'Ким', 'Школа №1 им. Алишера Навои', 9, '🐧');
-- Руслан Ахмедов, 10 класс — завершённый обмен с Полиной
select pg_temp.add_user('ruslanakhmedov@gmail.com', 'Руслан', 'Ахмедов', 'Школа №1 им. Алишера Навои', 10, '🚀');
-- Камила Туляганова, 8 класс — отправила Илье запрос на обмен
select pg_temp.add_user('kamilatulyaganova@gmail.com', 'Камила', 'Туляганова', 'Школа №1 им. Алишера Навои', 8, '🎨');
-- Артём Ли, 9 класс — обмен с Амиром; ответ с грубым словом для модерации
select pg_temp.add_user('artemli@gmail.com', 'Артём', 'Ли', 'Школа №1 им. Алишера Навои', 9, '🐙');
-- Нигора Саидова, 6 класс — пара с Тимуром
select pg_temp.add_user('nigorasaidova@gmail.com', 'Нигора', 'Саидова', 'Школа №1 им. Алишера Навои', 6, '🐝');
-- Шахзод Алиев, 10 класс — задал вопрос про небо
select pg_temp.add_user('shakhzodaliev@gmail.com', 'Шахзод', 'Алиев', 'Школа №1 им. Алишера Навои', 10, '🐳');
-- Полина Воронова, 5 класс — вопрос без ответа
select pg_temp.add_user('polinavoronova@gmail.com', 'Полина', 'Воронова', 'Школа №1 им. Алишера Навои', 5, '🐨');
-- Даниил Орлов, 11 класс — пара с Камилой
select pg_temp.add_user('daniilorlov@gmail.com', 'Даниил', 'Орлов', 'Школа №1 им. Алишера Навои', 11, '🎸');
-- Зарина Мирзаева, 7 класс — вопрос про проценты
select pg_temp.add_user('zarinamirzaeva@gmail.com', 'Зарина', 'Мирзаева', 'Школа №1 им. Алишера Навои', 7, '🐸');
-- Ислом Каримов, 8 класс — неверный ответ, удалённый админом
select pg_temp.add_user('islomkarimov@gmail.com', 'Ислом', 'Каримов', 'Школа №1 им. Алишера Навои', 8, '🐢');
-- Эльвира Султанова, 9 класс
select pg_temp.add_user('elvirasultanova@gmail.com', 'Эльвира', 'Султанова', 'Школа №1 им. Алишера Навои', 9, '🦉');
-- Максим Петров, 10 класс — ЗАБЛОКИРОВАН учителем — не появляется в подборе
select pg_temp.add_user('maksimpetrov@gmail.com', 'Максим', 'Петров', 'Школа №1 им. Алишера Навои', 10, '🐯');
-- Сардор Ибрагимов, 8 класс — другая школа
select pg_temp.add_user('sardoribragimov@gmail.com', 'Сардор', 'Ибрагимов', 'Школа №110', 8, '🚀');
-- Малика Юнусова, 8 класс — другая школа
select pg_temp.add_user('malikayunusova@gmail.com', 'Малика', 'Юнусова', 'Школа №110', 8, '🌟');
-- Жасур Хамидов, 9 класс — другая школа
select pg_temp.add_user('zhasurkhamidov@gmail.com', 'Жасур', 'Хамидов', 'Школа №110', 9, '🐳');
-- Азамат Турсунов, 10 класс — третья школа
select pg_temp.add_user('azamattursunov@gmail.com', 'Азамат', 'Турсунов', 'Президентская школа', 10, '🦁');
-- Севара Назарова, 9 класс — третья школа
select pg_temp.add_user('sevaranazarova@gmail.com', 'Севара', 'Назарова', 'Президентская школа', 9, '🦋');

-- ############################################################################
-- ЧАСТЬ 4. РОЛИ И БЛОКИРОВКА
-- ############################################################################

-- Азиз Рахимов — роль admin
update public.profiles set role = 'admin', grade = null where id = pg_temp.uid('azizrakhimov@gmail.com');
-- Нодира Каримова — роль teacher
update public.profiles set role = 'teacher', grade = null where id = pg_temp.uid('nodirakarimova@gmail.com');
-- Дилшод Юсупов — роль teacher
update public.profiles set role = 'teacher', grade = null where id = pg_temp.uid('dilshodyusupov@gmail.com');
-- Максим Петров заблокирован учителем, у него 2 предупреждения — в подборе его нет
update public.profiles set is_blocked = true, warnings_count = 2 where id = pg_temp.uid('maksimpetrov@gmail.com');

-- ############################################################################
-- ЧАСТЬ 5. ПРЕДМЕТЫ И УДОБНОЕ ВРЕМЯ
-- За заполненный профиль триггер сам начислит каждому ученику +20 очков.
-- ############################################################################

-- Илья: знает английский 5, информатика 4; хочет подтянуть алгебра 2, физика 2, литература 2
insert into public.skills (user_id, subject, kind, level) values (pg_temp.uid('ilyanikolaev@gmail.com'), 'english', 'know', 5), (pg_temp.uid('ilyanikolaev@gmail.com'), 'informatics', 'know', 4), (pg_temp.uid('ilyanikolaev@gmail.com'), 'algebra', 'learn', 2), (pg_temp.uid('ilyanikolaev@gmail.com'), 'physics', 'learn', 2), (pg_temp.uid('ilyanikolaev@gmail.com'), 'literature', 'learn', 2);
-- Илья: удобно — пн после уроков, ср после уроков, сб до уроков
insert into public.availability (user_id, day, part) values (pg_temp.uid('ilyanikolaev@gmail.com'), 1, 'afternoon'), (pg_temp.uid('ilyanikolaev@gmail.com'), 3, 'afternoon'), (pg_temp.uid('ilyanikolaev@gmail.com'), 6, 'morning');
-- Анна: знает алгебра 5, геометрия 4; хочет подтянуть английский 2
insert into public.skills (user_id, subject, kind, level) values (pg_temp.uid('annasmirnova@gmail.com'), 'algebra', 'know', 5), (pg_temp.uid('annasmirnova@gmail.com'), 'geometry', 'know', 4), (pg_temp.uid('annasmirnova@gmail.com'), 'english', 'learn', 2);
-- Анна: удобно — пн после уроков, ср после уроков, пт после уроков
insert into public.availability (user_id, day, part) values (pg_temp.uid('annasmirnova@gmail.com'), 1, 'afternoon'), (pg_temp.uid('annasmirnova@gmail.com'), 3, 'afternoon'), (pg_temp.uid('annasmirnova@gmail.com'), 5, 'afternoon');
-- Тимур: знает физика 5, математика 4; хочет подтянуть английский 3, информатика 1
insert into public.skills (user_id, subject, kind, level) values (pg_temp.uid('timurkarimov@gmail.com'), 'physics', 'know', 5), (pg_temp.uid('timurkarimov@gmail.com'), 'math', 'know', 4), (pg_temp.uid('timurkarimov@gmail.com'), 'english', 'learn', 3), (pg_temp.uid('timurkarimov@gmail.com'), 'informatics', 'learn', 1);
-- Тимур: удобно — вт после уроков, ср после уроков, сб до уроков
insert into public.availability (user_id, day, part) values (pg_temp.uid('timurkarimov@gmail.com'), 2, 'afternoon'), (pg_temp.uid('timurkarimov@gmail.com'), 3, 'afternoon'), (pg_temp.uid('timurkarimov@gmail.com'), 6, 'morning');
-- Дина: знает алгебра 4; хочет подтянуть английский 2
insert into public.skills (user_id, subject, kind, level) values (pg_temp.uid('dinayusupova@gmail.com'), 'algebra', 'know', 4), (pg_temp.uid('dinayusupova@gmail.com'), 'english', 'learn', 2);
-- Дина: удобно — вс вечер
insert into public.availability (user_id, day, part) values (pg_temp.uid('dinayusupova@gmail.com'), 7, 'evening');
-- Амир: знает русский 5, история 4; хочет подтянуть математика 2, английский 2
insert into public.skills (user_id, subject, kind, level) values (pg_temp.uid('amirrashidov@gmail.com'), 'russian', 'know', 5), (pg_temp.uid('amirrashidov@gmail.com'), 'history', 'know', 4), (pg_temp.uid('amirrashidov@gmail.com'), 'math', 'learn', 2), (pg_temp.uid('amirrashidov@gmail.com'), 'english', 'learn', 2);
-- Амир: удобно — вт вечер, чт вечер
insert into public.availability (user_id, day, part) values (pg_temp.uid('amirrashidov@gmail.com'), 2, 'evening'), (pg_temp.uid('amirrashidov@gmail.com'), 4, 'evening');
-- Лейла: знает биология 5; хочет подтянуть русский 1, математика 2
insert into public.skills (user_id, subject, kind, level) values (pg_temp.uid('leylakhasanova@gmail.com'), 'biology', 'know', 5), (pg_temp.uid('leylakhasanova@gmail.com'), 'russian', 'learn', 1), (pg_temp.uid('leylakhasanova@gmail.com'), 'math', 'learn', 2);
-- Лейла: удобно — вт вечер, чт после уроков
insert into public.availability (user_id, day, part) values (pg_temp.uid('leylakhasanova@gmail.com'), 2, 'evening'), (pg_temp.uid('leylakhasanova@gmail.com'), 4, 'afternoon');
-- Марьям: знает химия 5; хочет подтянуть геометрия 1
insert into public.skills (user_id, subject, kind, level) values (pg_temp.uid('maryamazimova@gmail.com'), 'chemistry', 'know', 5), (pg_temp.uid('maryamazimova@gmail.com'), 'geometry', 'learn', 1);
-- Марьям: удобно — пн вечер, ср вечер
insert into public.availability (user_id, day, part) values (pg_temp.uid('maryamazimova@gmail.com'), 1, 'evening'), (pg_temp.uid('maryamazimova@gmail.com'), 3, 'evening');
-- Бекзод: знает узбекский 5; хочет подтянуть химия 2
insert into public.skills (user_id, subject, kind, level) values (pg_temp.uid('bekzodnurmatov@gmail.com'), 'uzbek', 'know', 5), (pg_temp.uid('bekzodnurmatov@gmail.com'), 'chemistry', 'learn', 2);
-- Бекзод: удобно — пн вечер, пт вечер
insert into public.availability (user_id, day, part) values (pg_temp.uid('bekzodnurmatov@gmail.com'), 1, 'evening'), (pg_temp.uid('bekzodnurmatov@gmail.com'), 5, 'evening');
-- Сабина: знает геометрия 5; хочет подтянуть узбекский 1
insert into public.skills (user_id, subject, kind, level) values (pg_temp.uid('sabinarakhmatova@gmail.com'), 'geometry', 'know', 5), (pg_temp.uid('sabinarakhmatova@gmail.com'), 'uzbek', 'learn', 1);
-- Сабина: удобно — ср вечер, пт вечер
insert into public.availability (user_id, day, part) values (pg_temp.uid('sabinarakhmatova@gmail.com'), 3, 'evening'), (pg_temp.uid('sabinarakhmatova@gmail.com'), 5, 'evening');
-- Ольга: знает английский 5; хочет подтянуть физика 2
insert into public.skills (user_id, subject, kind, level) values (pg_temp.uid('olgakim@gmail.com'), 'english', 'know', 5), (pg_temp.uid('olgakim@gmail.com'), 'physics', 'learn', 2);
-- Ольга: удобно — вт после уроков, чт после уроков
insert into public.availability (user_id, day, part) values (pg_temp.uid('olgakim@gmail.com'), 2, 'afternoon'), (pg_temp.uid('olgakim@gmail.com'), 4, 'afternoon');
-- Руслан: знает математика 5, алгебра 5; хочет подтянуть биология 2
insert into public.skills (user_id, subject, kind, level) values (pg_temp.uid('ruslanakhmedov@gmail.com'), 'math', 'know', 5), (pg_temp.uid('ruslanakhmedov@gmail.com'), 'algebra', 'know', 5), (pg_temp.uid('ruslanakhmedov@gmail.com'), 'biology', 'learn', 2);
-- Руслан: удобно — чт после уроков, сб после уроков
insert into public.availability (user_id, day, part) values (pg_temp.uid('ruslanakhmedov@gmail.com'), 4, 'afternoon'), (pg_temp.uid('ruslanakhmedov@gmail.com'), 6, 'afternoon');
-- Камила: знает литература 5, русский 4; хочет подтянуть информатика 2
insert into public.skills (user_id, subject, kind, level) values (pg_temp.uid('kamilatulyaganova@gmail.com'), 'literature', 'know', 5), (pg_temp.uid('kamilatulyaganova@gmail.com'), 'russian', 'know', 4), (pg_temp.uid('kamilatulyaganova@gmail.com'), 'informatics', 'learn', 2);
-- Камила: удобно — пн после уроков, сб до уроков
insert into public.availability (user_id, day, part) values (pg_temp.uid('kamilatulyaganova@gmail.com'), 1, 'afternoon'), (pg_temp.uid('kamilatulyaganova@gmail.com'), 6, 'morning');
-- Артём: знает информатика 5, английский 4; хочет подтянуть история 2
insert into public.skills (user_id, subject, kind, level) values (pg_temp.uid('artemli@gmail.com'), 'informatics', 'know', 5), (pg_temp.uid('artemli@gmail.com'), 'english', 'know', 4), (pg_temp.uid('artemli@gmail.com'), 'history', 'learn', 2);
-- Артём: удобно — вт вечер, чт вечер
insert into public.availability (user_id, day, part) values (pg_temp.uid('artemli@gmail.com'), 2, 'evening'), (pg_temp.uid('artemli@gmail.com'), 4, 'evening');
-- Нигора: знает английский 5; хочет подтянуть математика 1
insert into public.skills (user_id, subject, kind, level) values (pg_temp.uid('nigorasaidova@gmail.com'), 'english', 'know', 5), (pg_temp.uid('nigorasaidova@gmail.com'), 'math', 'learn', 1);
-- Нигора: удобно — ср после уроков, пт после уроков
insert into public.availability (user_id, day, part) values (pg_temp.uid('nigorasaidova@gmail.com'), 3, 'afternoon'), (pg_temp.uid('nigorasaidova@gmail.com'), 5, 'afternoon');
-- Шахзод: знает география 5; хочет подтянуть физика 2
insert into public.skills (user_id, subject, kind, level) values (pg_temp.uid('shakhzodaliev@gmail.com'), 'geography', 'know', 5), (pg_temp.uid('shakhzodaliev@gmail.com'), 'physics', 'learn', 2);
-- Шахзод: удобно — сб после уроков
insert into public.availability (user_id, day, part) values (pg_temp.uid('shakhzodaliev@gmail.com'), 6, 'afternoon');
-- Полина: знает биология 4, английский 4; хочет подтянуть математика 1
insert into public.skills (user_id, subject, kind, level) values (pg_temp.uid('polinavoronova@gmail.com'), 'biology', 'know', 4), (pg_temp.uid('polinavoronova@gmail.com'), 'english', 'know', 4), (pg_temp.uid('polinavoronova@gmail.com'), 'math', 'learn', 1);
-- Полина: удобно — чт после уроков, сб после уроков
insert into public.availability (user_id, day, part) values (pg_temp.uid('polinavoronova@gmail.com'), 4, 'afternoon'), (pg_temp.uid('polinavoronova@gmail.com'), 6, 'afternoon');
-- Даниил: знает информатика 5, химия 4; хочет подтянуть литература 1
insert into public.skills (user_id, subject, kind, level) values (pg_temp.uid('daniilorlov@gmail.com'), 'informatics', 'know', 5), (pg_temp.uid('daniilorlov@gmail.com'), 'chemistry', 'know', 4), (pg_temp.uid('daniilorlov@gmail.com'), 'literature', 'learn', 1);
-- Даниил: удобно — сб до уроков, вс до уроков
insert into public.availability (user_id, day, part) values (pg_temp.uid('daniilorlov@gmail.com'), 6, 'morning'), (pg_temp.uid('daniilorlov@gmail.com'), 7, 'morning');
-- Зарина: знает узбекский 4; хочет подтянуть география 2, русский 2
insert into public.skills (user_id, subject, kind, level) values (pg_temp.uid('zarinamirzaeva@gmail.com'), 'uzbek', 'know', 4), (pg_temp.uid('zarinamirzaeva@gmail.com'), 'geography', 'learn', 2), (pg_temp.uid('zarinamirzaeva@gmail.com'), 'russian', 'learn', 2);
-- Зарина: удобно — пт после уроков
insert into public.availability (user_id, day, part) values (pg_temp.uid('zarinamirzaeva@gmail.com'), 5, 'afternoon');
-- Ислом: знает математика 5; хочет подтянуть узбекский 2
insert into public.skills (user_id, subject, kind, level) values (pg_temp.uid('islomkarimov@gmail.com'), 'math', 'know', 5), (pg_temp.uid('islomkarimov@gmail.com'), 'uzbek', 'learn', 2);
-- Ислом: удобно — пн вечер
insert into public.availability (user_id, day, part) values (pg_temp.uid('islomkarimov@gmail.com'), 1, 'evening');
-- Эльвира: знает история 5, география 4; хочет подтянуть химия 3
insert into public.skills (user_id, subject, kind, level) values (pg_temp.uid('elvirasultanova@gmail.com'), 'history', 'know', 5), (pg_temp.uid('elvirasultanova@gmail.com'), 'geography', 'know', 4), (pg_temp.uid('elvirasultanova@gmail.com'), 'chemistry', 'learn', 3);
-- Эльвира: удобно — ср вечер
insert into public.availability (user_id, day, part) values (pg_temp.uid('elvirasultanova@gmail.com'), 3, 'evening');
-- Максим: знает физика 5; хочет подтянуть английский 2
insert into public.skills (user_id, subject, kind, level) values (pg_temp.uid('maksimpetrov@gmail.com'), 'physics', 'know', 5), (pg_temp.uid('maksimpetrov@gmail.com'), 'english', 'learn', 2);
-- Максим: удобно — пн после уроков
insert into public.availability (user_id, day, part) values (pg_temp.uid('maksimpetrov@gmail.com'), 1, 'afternoon');
-- Сардор: знает математика 5; хочет подтянуть информатика 2
insert into public.skills (user_id, subject, kind, level) values (pg_temp.uid('sardoribragimov@gmail.com'), 'math', 'know', 5), (pg_temp.uid('sardoribragimov@gmail.com'), 'informatics', 'learn', 2);
-- Сардор: удобно — вт после уроков
insert into public.availability (user_id, day, part) values (pg_temp.uid('sardoribragimov@gmail.com'), 2, 'afternoon');
-- Малика: знает информатика 5; хочет подтянуть математика 2
insert into public.skills (user_id, subject, kind, level) values (pg_temp.uid('malikayunusova@gmail.com'), 'informatics', 'know', 5), (pg_temp.uid('malikayunusova@gmail.com'), 'math', 'learn', 2);
-- Малика: удобно — вт после уроков
insert into public.availability (user_id, day, part) values (pg_temp.uid('malikayunusova@gmail.com'), 2, 'afternoon');
-- Жасур: знает история 5; хочет подтянуть английский 2
insert into public.skills (user_id, subject, kind, level) values (pg_temp.uid('zhasurkhamidov@gmail.com'), 'history', 'know', 5), (pg_temp.uid('zhasurkhamidov@gmail.com'), 'english', 'learn', 2);
-- Жасур: удобно — чт вечер
insert into public.availability (user_id, day, part) values (pg_temp.uid('zhasurkhamidov@gmail.com'), 4, 'evening');
-- Азамат: знает физика 5; хочет подтянуть биология 2
insert into public.skills (user_id, subject, kind, level) values (pg_temp.uid('azamattursunov@gmail.com'), 'physics', 'know', 5), (pg_temp.uid('azamattursunov@gmail.com'), 'biology', 'learn', 2);
-- Азамат: удобно — ср после уроков
insert into public.availability (user_id, day, part) values (pg_temp.uid('azamattursunov@gmail.com'), 3, 'afternoon');
-- Севара: знает биология 5; хочет подтянуть физика 2
insert into public.skills (user_id, subject, kind, level) values (pg_temp.uid('sevaranazarova@gmail.com'), 'biology', 'know', 5), (pg_temp.uid('sevaranazarova@gmail.com'), 'physics', 'learn', 2);
-- Севара: удобно — ср после уроков
insert into public.availability (user_id, day, part) values (pg_temp.uid('sevaranazarova@gmail.com'), 3, 'afternoon');

-- ############################################################################
-- ЧАСТЬ 5Б. УРОВНИ, ПОДТВЕРЖДЁННЫЕ ТЕСТОМ
-- Обычно отметку ставит функция submit_quiz после сданного теста. Здесь ставим её
-- сразу, чтобы в подборе и профилях были видны галочки ✔ (и начисляем +10 очков).
-- ############################################################################

-- включаем флаг, как это делает submit_quiz: без него триггер skills_protect_verified не даст поставить отметку
select set_config('skillswap.verify', 'on', false);
-- Илья Николаев: уровень «английский» подтверждён тестом неделю назад
update public.skills set verified_at = now() - interval '7 days' where user_id = pg_temp.uid('ilyanikolaev@gmail.com') and subject = 'english';
-- +10 очков Илья Николаев за подтверждённый уровень (ключ не даст начислить дважды)
select public.award_points(pg_temp.uid('ilyanikolaev@gmail.com'), 'skill_verified', 'verify:english');
-- Анна Смирнова: уровень «алгебра» подтверждён тестом неделю назад
update public.skills set verified_at = now() - interval '7 days' where user_id = pg_temp.uid('annasmirnova@gmail.com') and subject = 'algebra';
-- +10 очков Анна Смирнова за подтверждённый уровень (ключ не даст начислить дважды)
select public.award_points(pg_temp.uid('annasmirnova@gmail.com'), 'skill_verified', 'verify:algebra');
-- Тимур Каримов: уровень «физика» подтверждён тестом неделю назад
update public.skills set verified_at = now() - interval '7 days' where user_id = pg_temp.uid('timurkarimov@gmail.com') and subject = 'physics';
-- +10 очков Тимур Каримов за подтверждённый уровень (ключ не даст начислить дважды)
select public.award_points(pg_temp.uid('timurkarimov@gmail.com'), 'skill_verified', 'verify:physics');
-- выключаем флаг
select set_config('skillswap.verify', 'off', false);

-- ############################################################################
-- ЧАСТЬ 6. ОБМЕНЫ, ПЕРЕПИСКА, ЗАНЯТИЯ, ОТЗЫВЫ, ЖАЛОБА
-- ############################################################################

-- Илья ↔ Анна: активный обмен (английский ↔ алгебра), начат 14 дней назад
select pg_temp.make_partnership('ilyanikolaev@gmail.com', 'annasmirnova@gmail.com', 'english', 'algebra', 'active', 14);
-- Тимур ↔ Ольга: активный обмен (физика ↔ английский)
select pg_temp.make_partnership('timurkarimov@gmail.com', 'olgakim@gmail.com', 'physics', 'english', 'active', 7);
-- Камила предложила Илье обмен (литература ↔ информатика) — у Ильи это «входящий запрос»
select pg_temp.make_partnership('kamilatulyaganova@gmail.com', 'ilyanikolaev@gmail.com', 'literature', 'informatics', 'pending', 1);
-- Амир ↔ Артём: активный обмен (история ↔ английский)
select pg_temp.make_partnership('amirrashidov@gmail.com', 'artemli@gmail.com', 'history', 'english', 'active', 5);
-- Руслан ↔ Полина: завершённый обмен (для истории)
select pg_temp.make_partnership('ruslanakhmedov@gmail.com', 'polinavoronova@gmail.com', 'math', 'biology', 'finished', 30);

-- сообщение от Анна Смирнова
select pg_temp.message('ilyanikolaev@gmail.com', 'annasmirnova@gmail.com', 'annasmirnova@gmail.com', 'Привет! Давай заниматься по понедельникам после уроков в библиотеке?', 20000);
-- сообщение от Илья Николаев
select pg_temp.message('ilyanikolaev@gmail.com', 'annasmirnova@gmail.com', 'ilyanikolaev@gmail.com', 'Давай! Я помогу с английским, а ты мне с уравнениями 🙂', 19990);
-- сообщение от Анна Смирнова
select pg_temp.message('ilyanikolaev@gmail.com', 'annasmirnova@gmail.com', 'annasmirnova@gmail.com', 'Спасибо за занятие! Present Perfect теперь понятнее.', 7000);
-- сообщение от Илья Николаев
select pg_temp.message('ilyanikolaev@gmail.com', 'annasmirnova@gmail.com', 'ilyanikolaev@gmail.com', 'Круто! Завтра разберём неправильные глаголы?', 90);
-- сообщение от Ольга Ким
select pg_temp.message('timurkarimov@gmail.com', 'olgakim@gmail.com', 'olgakim@gmail.com', 'Тимур, можешь ещё раз объяснить второй закон Ньютона?', 3000);
-- сообщение от Тимур Каримов
select pg_temp.message('timurkarimov@gmail.com', 'olgakim@gmail.com', 'timurkarimov@gmail.com', 'Конечно! F = m·a: чем больше сила, тем больше ускорение.', 2990);
-- сообщение от Артём Ли
select pg_temp.message('amirrashidov@gmail.com', 'artemli@gmail.com', 'artemli@gmail.com', 'Привет! Когда удобно встретиться?', 5000);
-- сообщение от Амир Рашидов
select pg_temp.message('amirrashidov@gmail.com', 'artemli@gmail.com', 'amirrashidov@gmail.com', 'Дай свой номер 998901234567, так быстрее договоримся', 4990);
-- сообщение от Артём Ли
select pg_temp.message('amirrashidov@gmail.com', 'artemli@gmail.com', 'artemli@gmail.com', 'Лучше договоримся здесь, в чате 🙂', 4980);

-- жалоба Артёма на сообщение Амира с номером телефона — её увидит учитель Нодира Каримова
insert into public.complaints (school_id, reporter_id, reported_user_id, message_id, message_text, reason)
-- копию текста берём из сообщения
select m_p.school_id, pg_temp.uid('artemli@gmail.com'), m.sender_id, m.id, m.body, 'Просит номер телефона' from public.messages m join public.partnerships m_p on m_p.id = m.partnership_id where m.body like 'Дай свой номер%' limit 1;

-- занятие 3–4 недели назад — начало серии Ильи и Анны (занятия ровно через 7 дней — каждое в следующей неделе)
select pg_temp.lesson('ilyanikolaev@gmail.com', 'annasmirnova@gmail.com', 'ilyanikolaev@gmail.com', 'Времена группы Simple', 'library', interval '-24 days', 'done');
-- следующая неделя — серия продолжается
select pg_temp.lesson('ilyanikolaev@gmail.com', 'annasmirnova@gmail.com', 'annasmirnova@gmail.com', 'Линейные уравнения', 'classroom', interval '-17 days', 'done');
-- проведённое занятие Ильи и Анны (10 дней назад) — триггер даст обоим +10 очков и бейдж «Первое занятие»
select pg_temp.lesson('ilyanikolaev@gmail.com', 'annasmirnova@gmail.com', 'ilyanikolaev@gmail.com', 'Present Perfect', 'library', interval '-10 days', 'done');
-- четвёртая неделя подряд: у Ильи и Анны серия 4 недели и бейдж «🔥 Серия 4 недели»
select pg_temp.lesson('ilyanikolaev@gmail.com', 'annasmirnova@gmail.com', 'annasmirnova@gmail.com', 'Квадратные уравнения', 'classroom', interval '-3 days', 'done');
-- запланировано на завтра
select pg_temp.lesson('ilyanikolaev@gmail.com', 'annasmirnova@gmail.com', 'ilyanikolaev@gmail.com', 'Неправильные глаголы', 'online', interval '1 day', 'planned');
-- запланировано сегодня — при входе придёт напоминание «Сегодня занятие»
select pg_temp.lesson('ilyanikolaev@gmail.com', 'annasmirnova@gmail.com', 'annasmirnova@gmail.com', 'Дроби и проценты', 'library', interval '3 hours', 'planned');
-- проведённое занятие Тимура и Ольги
select pg_temp.lesson('timurkarimov@gmail.com', 'olgakim@gmail.com', 'timurkarimov@gmail.com', 'Законы Ньютона', 'classroom', interval '-3 days', 'done');
-- занятие из завершённого обмена
select pg_temp.lesson('ruslanakhmedov@gmail.com', 'polinavoronova@gmail.com', 'ruslanakhmedov@gmail.com', 'Таблица умножения на 7', 'library', interval '-20 days', 'done');
-- отменённое занятие
select pg_temp.lesson('amirrashidov@gmail.com', 'artemli@gmail.com', 'artemli@gmail.com', 'Древний Египет', 'library', interval '-2 days', 'cancelled');

-- Анна Смирнова ставит 5 за «Present Perfect»
select pg_temp.review('Present Perfect', 'annasmirnova@gmail.com', 5, 'Илья очень понятно объясняет, с примерами из фильмов!');
-- Илья Николаев ставит 5 за «Present Perfect»
select pg_temp.review('Present Perfect', 'ilyanikolaev@gmail.com', 5, 'Анна терпеливая, спасибо!');
-- Илья Николаев ставит 5 за «Квадратные уравнения»
select pg_temp.review('Квадратные уравнения', 'ilyanikolaev@gmail.com', 5, 'Теперь решаю через дискриминант сам.');
-- Анна Смирнова ставит 4 за «Квадратные уравнения»
select pg_temp.review('Квадратные уравнения', 'annasmirnova@gmail.com', 4, 'Хорошо, но хотелось бы больше практики.');
-- Ольга Ким ставит 5 за «Законы Ньютона»
select pg_temp.review('Законы Ньютона', 'olgakim@gmail.com', 5, 'Тимур — лучший!');
-- Тимур Каримов ставит 4 за «Законы Ньютона»
select pg_temp.review('Законы Ньютона', 'timurkarimov@gmail.com', 4, 'Ольга хорошо помогает с произношением.');
-- Полина Воронова ставит 5 за «Таблица умножения на 7»
select pg_temp.review('Таблица умножения на 7', 'polinavoronova@gmail.com', 5, 'Руслан придумал классную игру для запоминания.');

-- ############################################################################
-- ЧАСТЬ 7. ВОПРОСЫ И ОТВЕТЫ
-- Одобренный ответ даёт автору +15 очков (триггер on_answer_reviewed).
-- ############################################################################

-- вопрос: Илья Николаев, алгебра
select pg_temp.question('ilyanikolaev@gmail.com', 'algebra', 'Как решить квадратное уравнение x² − 5x + 6 = 0?', 'Учитель объяснял через дискриминант, но я запутался. Можно по шагам?', 26);
-- ответ Анны — ОДОБРЕН администратором (E'…' — строка, в которой \n означает перевод строки)
select pg_temp.answer('Как решить квадратное уравнение x² − 5x + 6 = 0?', 'annasmirnova@gmail.com', E'1) Считаем дискриминант: D = b² − 4ac = 25 − 24 = 1.\n2) Корни: x = (5 ± 1) / 2.\n3) Получаем x₁ = 3 и x₂ = 2.\nПроверка: 3² − 5·3 + 6 = 0 ✔', 24, 'approved', 'Отличное пошаговое объяснение!');
-- ответ Руслана — ещё НЕ проверен
select pg_temp.answer('Как решить квадратное уравнение x² − 5x + 6 = 0?', 'ruslanakhmedov@gmail.com', 'Можно ещё по теореме Виета: x₁ + x₂ = 5, x₁ · x₂ = 6. Подходят числа 2 и 3.', 20, 'pending', null);
-- вопрос: Лейла Хасанова, русский
select pg_temp.question('leylakhasanova@gmail.com', 'russian', 'Когда «не» с прилагательными пишется слитно?', 'Всегда путаюсь: «небольшой» или «не большой»?', 20);
-- ответ Камилы — одобрен (E'…' — строка, в которой \n означает перевод строки)
select pg_temp.answer('Когда «не» с прилагательными пишется слитно?', 'kamilatulyaganova@gmail.com', E'Слитно — если без «не» слово не употребляется (небрежный) или его можно заменить синонимом без «не»: небольшой = маленький.\nРаздельно — если есть противопоставление с «а»: «не большой, а маленький».', 18, 'approved', null);
-- вопрос: Шахзод Алиев, физика
select pg_temp.question('shakhzodaliev@gmail.com', 'physics', 'Почему небо голубое?', 'Мне задали доклад, а в интернете слишком сложно объясняют.', 30);
-- ответ Тимура — одобрен
select pg_temp.answer('Почему небо голубое?', 'timurkarimov@gmail.com', 'Солнечный свет состоит из разных цветов. Синий свет сильнее всего рассеивается на молекулах воздуха (это называется рассеяние Рэлея), поэтому приходит к нам со всех сторон неба.', 28, 'approved', 'Верно и понятно!');
-- ответ Ислома — УДАЛЁН администратором с комментарием (его видит только Ислом)
select pg_temp.answer('Почему небо голубое?', 'islomkarimov@gmail.com', 'Небо голубое, потому что в нём отражается океан.', 27, 'removed', 'Это популярный миф: цвет неба не зависит от океана. Всё дело в рассеянии света в атмосфере — посмотри ответ Тимура.');
-- вопрос: Марьям Азимова, геометрия
select pg_temp.question('maryamazimova@gmail.com', 'geometry', 'Как найти площадь треугольника, если известны три стороны?', 'Стороны 5, 6 и 7 см.', 5);
-- ответ Сабины — не проверен (E'…' — строка, в которой \n означает перевод строки)
select pg_temp.answer('Как найти площадь треугольника, если известны три стороны?', 'sabinarakhmatova@gmail.com', E'Используй формулу Герона. Полупериметр p = (5 + 6 + 7) / 2 = 9.\nS = √(p(p − a)(p − b)(p − c)) = √(9 · 4 · 3 · 2) = √216 ≈ 14,7 см².', 4, 'pending', null);
-- вопрос: Полина Воронова, английский
select pg_temp.question('polinavoronova@gmail.com', 'english', 'Чем отличается Present Simple от Present Continuous?', 'Когда что использовать?', 3);
-- (на этот вопрос пока нет ответов — видно в фильтре «Без ответа»)
-- вопрос: Зарина Мирзаева, математика
select pg_temp.question('zarinamirzaeva@gmail.com', 'math', 'Как решать задачи на проценты?', 'Например: товар стоил 200 тысяч сумов и подешевел на 15%. Сколько он стоит сейчас?', 8);
-- ответ Артёма с ГРУБЫМ СЛОВОМ — админ увидит его подсвеченным и может вынести предупреждение
select pg_temp.answer('Как решать задачи на проценты?', 'artemli@gmail.com', 'Тупой вопрос, это же элементарно: 200 × 0,85 = 170 тысяч.', 6, 'pending', null);
-- вежливый ответ Ислома — не проверен
select pg_temp.answer('Как решать задачи на проценты?', 'islomkarimov@gmail.com', '15% от 200 — это 200 × 0,15 = 30 тысяч. Новая цена: 200 − 30 = 170 тысяч сумов.', 5, 'pending', null);
-- вопрос: Сардор Ибрагимов, информатика
select pg_temp.question('sardoribragimov@gmail.com', 'informatics', 'Что такое цикл for в Python?', 'Не понимаю, как работает range().', 10);
-- вопрос и ответ в ДРУГОЙ школе — ученики первой школы их не видят, админ видит
select pg_temp.answer('Что такое цикл for в Python?', 'malikayunusova@gmail.com', 'for i in range(5): print(i) — выведет числа от 0 до 4. range(5) даёт числа 0, 1, 2, 3, 4.', 9, 'pending', null);

-- ############################################################################
-- ЧАСТЬ 8. ИТОГ: СПИСОК ДЕМО-АККАУНТОВ
-- Этот запрос покажет таблицу входов прямо в SQL Editor.
-- ############################################################################

-- выбираем: имя и фамилию, email, роль, школу, класс и очки
select p.first_name || ' ' || pp.last_name as "Имя", u.email as "Email (пароль 12345678)", p.role as "Роль", s.name as "Школа", p.grade as "Класс", p.points as "Очки"
-- из пользователей Supabase
from auth.users u
-- профили
join public.profiles p on p.id = u.id
-- фамилии
join public.profile_private pp on pp.id = u.id
-- названия школ
left join public.schools s on s.id = p.school_id
-- только демо-аккаунты
where u.email like '%@gmail.com' and u.email = any(array['azizrakhimov@gmail.com', 'nodirakarimova@gmail.com', 'dilshodyusupov@gmail.com', 'ilyanikolaev@gmail.com', 'annasmirnova@gmail.com', 'timurkarimov@gmail.com', 'dinayusupova@gmail.com', 'amirrashidov@gmail.com', 'leylakhasanova@gmail.com', 'maryamazimova@gmail.com', 'bekzodnurmatov@gmail.com', 'sabinarakhmatova@gmail.com', 'olgakim@gmail.com', 'ruslanakhmedov@gmail.com', 'kamilatulyaganova@gmail.com', 'artemli@gmail.com', 'nigorasaidova@gmail.com', 'shakhzodaliev@gmail.com', 'polinavoronova@gmail.com', 'daniilorlov@gmail.com', 'zarinamirzaeva@gmail.com', 'islomkarimov@gmail.com', 'elvirasultanova@gmail.com', 'maksimpetrov@gmail.com', 'sardoribragimov@gmail.com', 'malikayunusova@gmail.com', 'zhasurkhamidov@gmail.com', 'azamattursunov@gmail.com', 'sevaranazarova@gmail.com'])
-- сначала админ, потом учителя, потом ученики по очкам
order by case p.role when 'admin' then 0 when 'teacher' then 1 else 2 end, p.points desc;
