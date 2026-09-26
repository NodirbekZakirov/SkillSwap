-- ============================================================================
-- Файл: sql/reset.sql
-- Зачем нужен: ПОЛНОСТЬЮ удаляет всё, что создал sql/schema.sql (таблицы,
-- функции, триггеры, правила Storage), чтобы выполнить схему заново.
-- ВНИМАНИЕ: все данные сайта (профили, сообщения, занятия) будут удалены!
-- Пользователи в Authentication останутся — удали их вручную в панели
-- Supabase (Authentication → Users), если нужно начать совсем с нуля.
-- Как связан с остальными: выполняется ПЕРЕД повторным запуском schema.sql.
-- ============================================================================

-- drop trigger if exists — удалить триггер, если он есть (if exists — не выдавать ошибку, если его нет)
drop trigger if exists on_auth_user_created on auth.users;

-- drop policy if exists имя on таблица — удалить правило Storage для чтения файлов
drop policy if exists materials_files_select on storage.objects;
-- удалить правило загрузки файлов
drop policy if exists materials_files_insert on storage.objects;
-- удалить правило удаления файлов
drop policy if exists materials_files_delete on storage.objects;
-- правила корзины фото вопросов и ответов: чтение
drop policy if exists qa_images_select on storage.objects;
-- загрузка
drop policy if exists qa_images_insert on storage.objects;
-- удаление
drop policy if exists qa_images_delete on storage.objects;
-- правила корзины голосовых сообщений: прослушивание
drop policy if exists voice_select on storage.objects;
-- запись
drop policy if exists voice_insert on storage.objects;
-- удаление
drop policy if exists voice_delete on storage.objects;

-- drop table ... cascade — удалить таблицу; cascade — заодно удалить всё, что от неё зависит (связи, правила, триггеры)
drop table if exists public.notifications cascade;
-- подсказки ИИ к вопросам
drop table if exists public.ai_hints cascade;
-- счётчик подсказок ИИ за день
drop table if exists public.ai_usage cascade;
-- рисунки общей доски
drop table if exists public.board_strokes cascade;
-- общие таймеры
drop table if exists public.partnership_timers cascade;
-- попытки тестов
drop table if exists public.quiz_attempts cascade;
-- вопросы тестов
drop table if exists public.quiz_questions cascade;
-- ответы на вопросы
drop table if exists public.answers cascade;
-- вопросы
drop table if exists public.questions cascade;
-- бейджи
drop table if exists public.user_badges cascade;
-- журнал очков
drop table if exists public.points_log cascade;
-- материалы
drop table if exists public.materials cascade;
-- отзывы
drop table if exists public.reviews cascade;
-- занятия
drop table if exists public.lessons cascade;
-- жалобы
drop table if exists public.complaints cascade;
-- блокировки
drop table if exists public.blocks cascade;
-- сообщения
drop table if exists public.messages cascade;
-- участники партнёрств
drop table if exists public.partnership_members cascade;
-- партнёрства
drop table if exists public.partnerships cascade;
-- свободное время
drop table if exists public.availability cascade;
-- навыки
drop table if exists public.skills cascade;
-- закрытые данные профиля
drop table if exists public.profile_private cascade;
-- профили
drop table if exists public.profiles cascade;
-- школы
drop table if exists public.schools cascade;

-- drop function if exists имя(типы параметров) cascade — удалить функцию
drop function if exists public.app_timezone() cascade;
-- школа текущего пользователя
drop function if exists public.my_school_id() cascade;
-- проверка админа
drop function if exists public.is_admin() cascade;
-- проверка учителя
drop function if exists public.is_teacher_of(bigint) cascade;
-- школа пользователя
drop function if exists public.school_of(uuid) cascade;
-- короткое имя
drop function if exists public.display_name(uuid) cascade;
-- участник партнёрства
drop function if exists public.is_partnership_member(bigint) cascade;
-- активный участник
drop function if exists public.is_active_member(bigint) cascade;
-- правило помощи
drop function if exists public.can_teach(uuid, uuid, text) cascade;
-- право писать в чат
drop function if exists public.can_send_message(bigint) cascade;
-- создание уведомления
drop function if exists public.notify(uuid, text, text, text, text, text, boolean) cascade;
-- регистрация
drop function if exists public.handle_new_user() cascade;
-- создание профиля
drop function if exists public.create_profile(uuid, jsonb) cascade;
-- школа вопроса (старая функция, могла остаться в базе)
drop function if exists public.question_school(bigint) cascade;
-- авторы вопросов и ответов
drop function if exists public.get_qa_authors(uuid[]) cascade;
-- лимит подсказок ИИ в день
drop function if exists public.ai_daily_limit() cascade;
-- списание подсказки из лимита
drop function if exists public.ai_take_quota() cascade;
-- сколько подсказок осталось
drop function if exists public.ai_hints_left() cascade;
-- активный ученик
drop function if exists public.i_am_active_student() cascade;
-- новый ответ
drop function if exists public.on_answer_created() cascade;
-- проверка ответа
drop function if exists public.on_answer_reviewed() cascade;
-- модерация ответа
drop function if exists public.admin_review_answer(bigint, text, text) cascade;
-- предупреждение от админа
drop function if exists public.admin_warn_user(uuid, text) cascade;
-- удаление вопроса админом
drop function if exists public.admin_delete_question(bigint, text) cascade;
-- первая буква фамилии
drop function if exists public.sync_last_initial() cascade;
-- правила очков
drop function if exists public.points_for(text) cascade;
-- начисление очков
drop function if exists public.award_points(uuid, text, text) cascade;
-- название бейджа
drop function if exists public.badge_title(text) cascade;
-- выдача бейджа
drop function if exists public.grant_badge(uuid, text) cascade;
-- проверка бейджей
drop function if exists public.check_badges(uuid) cascade;
-- заполненность профиля
drop function if exists public.check_profile_complete(uuid) cascade;
-- триггер профиля
drop function if exists public.on_profile_data_added() cascade;
-- проверка смены статуса занятия
drop function if exists public.lessons_validate_update() cascade;
-- новое занятие
drop function if exists public.on_lesson_created() cascade;
-- смена статуса занятия
drop function if exists public.on_lesson_status_changed() cascade;
-- новый отзыв
drop function if exists public.on_review_created() cascade;
-- новое сообщение
drop function if exists public.on_message_created() cascade;
-- очистка и отмена на доске
drop function if exists public.on_board_marker() cascade;
-- защита отметки «уровень подтверждён»
drop function if exists public.skills_protect_verified() cascade;
-- подсчёт серии
drop function if exists public.streak_info(uuid) cascade;
-- серия для сайта
drop function if exists public.get_streak(uuid) cascade;
-- состояние таймера
drop function if exists public.get_timer(bigint) cascade;
-- управление таймером
drop function if exists public.timer_control(bigint, text, int, int) cascade;
-- начать тест
drop function if exists public.start_quiz(text) cascade;
-- проверить тест
drop function if exists public.submit_quiz(bigint, int[]) cascade;
-- предложить обмен
drop function if exists public.create_partnership(jsonb) cascade;
-- ответ на запрос
drop function if exists public.respond_partnership(bigint, boolean) cascade;
-- завершить обмен
drop function if exists public.finish_partnership(bigint) cascade;
-- жалоба
drop function if exists public.report_message(bigint, text) cascade;
-- отзыв
drop function if exists public.leave_review(bigint, int, text) cascade;
-- уведомление о совпадении
drop function if exists public.notify_new_match(uuid) cascade;
-- напоминания
drop function if exists public.ensure_my_reminders() cascade;
-- рейтинг
drop function if exists public.get_school_leaderboard() cascade;
-- статистика
drop function if exists public.get_school_stats() cascade;
-- скрыть сообщение
drop function if exists public.teacher_hide_message(bigint) cascade;
-- предупреждение
drop function if exists public.teacher_warn_user(uuid) cascade;
-- блокировка учителем
drop function if exists public.teacher_set_blocked(uuid, boolean) cascade;
-- закрыть жалобу
drop function if exists public.teacher_close_complaint(bigint) cascade;
-- список пользователей
drop function if exists public.admin_list_users(text) cascade;
-- назначить учителя
drop function if exists public.admin_set_teacher(uuid, bigint) cascade;
-- снять учителя
drop function if exists public.admin_remove_teacher(uuid) cascade;
-- номер из первой папки пути файла
drop function if exists public.storage_folder_id(text) cascade;
-- старое название той же функции (из первой версии схемы)
drop function if exists public.material_partnership_id(text) cascade;

-- drop domain — удалить наш тип «код предмета»
drop domain if exists public.subject_code cascade;

-- Корзины Storage «materials», «qa-images» и «voice» этот скрипт НЕ удаляет: schema.sql создаёт их
-- командой «on conflict do nothing», поэтому повторный запуск пройдёт без ошибок.
-- Если нужно удалить и файлы: Storage → materials → выбрать все → Delete.
