# SkillSwap

Сайт, где школьники учат друг друга. Ученик отмечает, какие предметы знает хорошо и какие хочет подтянуть, а сайт находит ему партнёра из его школы: тот знает то, что нужно мне, а я — то, что нужно ему. Если прямой пары нет, сайт ищет тройку (А учит Б, Б учит В, В учит А).

Дипломный проект, STEP Academy.

## Возможности

- Регистрация, вход, восстановление пароля; аватар вместо фото, без телефонов и адресов.
- Профиль: предметы «знаю» и «хочу подтянуть» с уровнем 1–5, удобное время, мини-тесты для подтверждения уровня.
- Подбор пар и троек с процентом совместимости (алгоритм — `js/matching.js`).
- Партнёрство, чат в реальном времени (текст и голос), общая доска, таймер занятия, жалобы и блокировка.
- Занятия, оценки и отзывы, материалы (фото и PDF), очки, бейджи, рейтинг школы, серия недель.
- «Вопросы и ответы» — общие для всех школ, с проверкой ответов администратором и «💡 Подсказкой от ИИ».
- Уведомления в реальном времени, панель учителя и панель администратора.
- Светлая и тёмная тема, удобно на телефоне, планшете и компьютере.

## Технологии

- HTML, CSS и чистый JavaScript (ES-модули), без фреймворков и сборщиков.
- Supabase: Auth, PostgreSQL с RLS, Storage, Realtime, Edge Functions.
- Google Gemini — подсказки к вопросам (через серверную функцию, ключ хранится только в Supabase).
- Хостинг — Vercel (статический сайт).

## Структура папок

```
skillswap/
├── index.html              главная страница для гостей
├── pages/                  остальные страницы сайта (вход, профиль, совпадения, чат, …)
├── css/
│   ├── variables.css       все цвета, шрифты, отступы, радиусы; светлая и тёмная тема
│   ├── base.css            базовые стили и анимации
│   ├── components.css      кнопки, карточки, формы, шапка, нижнее меню
│   ├── landing.css         главная страница и её анимации
│   └── pages.css           стили внутренних страниц
├── js/
│   ├── config.js           адрес и публичный ключ Supabase, справочники и настройки
│   ├── supabase.js         подключение к Supabase
│   ├── matching.js         АЛГОРИТМ ПОДБОРА (чистые функции без базы)
│   ├── ai.js               блок «Подсказка от ИИ»
│   ├── …                   остальные общие модули (чат, уведомления, файлы и т.д.)
│   └── pages/              скрипты отдельных страниц
├── sql/
│   ├── schema.sql          вся база: таблицы, функции, RLS, Storage, Realtime
│   ├── seed.sql            демо-данные для показа
│   └── reset.sql           полная очистка базы
├── supabase/functions/
│   └── ai-hint/index.ts    серверная функция для подсказок ИИ
├── tests/                  автотесты (npm test)
├── assets/                 значок сайта
├── start.bat               установка и запуск на Windows одним щелчком
└── package.json            локальный сервер и тесты
```

## Запуск на своём компьютере

**Windows:** дважды щёлкни `start.bat`. Он проверит Node.js (если его нет — предложит установить), установит зависимости и откроет сайт по адресу `http://localhost:5500`.

**Вручную** (нужен [Node.js](https://nodejs.org)):

```bash
npm install
```

```bash
npm start
```

Затем открой `http://localhost:5500`. Двойной щелчок по `index.html` не подойдёт: ES-модули не работают с адресом `file://`.

Автотесты алгоритма и проверок:

```bash
npm test
```

## Настройка Supabase (новый проект)

1. Зарегистрируйся на [supabase.com](https://supabase.com) → **New project** → придумай пароль базы → дождись создания.
2. **SQL Editor → New query** → вставь весь файл `sql/schema.sql` → **Run**.
3. Демо-данные (по желанию): так же выполни `sql/seed.sql`. У демо-аккаунтов пароль `12345678`, email — в начале файла `seed.sql`.
4. **Project Settings → API**: скопируй **Project URL** и **anon public** ключ в `js/config.js` (`SUPABASE_URL` и `SUPABASE_ANON_KEY`). Этот ключ публичный — данные защищает RLS. Ключ `service_role` в сайт вставлять **нельзя**.
5. **Назначить себя администратором.** Зарегистрируйся на сайте, затем в SQL Editor выполни (подставь свой email):

   ```sql
   update public.profiles set role = 'admin', grade = null
   where id = (select id from auth.users where email = 'твой@email.com');
   ```

   Выйди и войди снова — появится «Панель администратора».

### Подсказки ИИ (Gemini)

ИИ не решает задачу, а подсказывает правило и первый шаг. Подсказка к вопросу создаётся один раз и хранится в базе, дальше её видят все. Новых подсказок — не больше 10 в день на ученика (`ai_daily_limit` в `sql/schema.sql` и `AI_DAILY_LIMIT` в `js/config.js`).

Ключ ИИ хранится **только** в секретах Supabase — в файлах сайта его нет.

1. Получи ключ в [Google AI Studio](https://aistudio.google.com/apikey).
2. Supabase → **Edge Functions → Secrets** → секрет `GEMINI_API_KEY` = ключ → **Save**. (Необязательно: `GEMINI_MODEL`, по умолчанию `gemini-3.5-flash`.)
3. Загрузи функцию (PROJECT_REF — часть адреса `https://PROJECT_REF.supabase.co`):

   ```bash
   npx supabase login
   ```

   ```bash
   npx supabase functions deploy ai-hint --project-ref PROJECT_REF
   ```

Если не работает — Supabase → **Edge Functions → ai-hint → Logs**.

## Публикация: GitHub + Vercel

### 1. Загрузить проект на GitHub

1. Создай аккаунт на [github.com](https://github.com) → **New repository** → имя `skillswap` → **Create repository** (без README — он уже есть).
2. В папке проекта (нужен [Git](https://git-scm.com)):

   ```bash
   git init
   ```

   ```bash
   git add .
   ```

   ```bash
   git commit -m "SkillSwap"
   ```

   ```bash
   git branch -M main
   ```

   ```bash
   git remote add origin https://github.com/ТВОЙ_ЛОГИН/skillswap.git
   ```

   ```bash
   git push -u origin main
   ```

   Папка `node_modules` и служебные файлы не загрузятся — они перечислены в `.gitignore`.

### 2. Опубликовать на Vercel

1. Зайди на [vercel.com](https://vercel.com) → **Sign Up → Continue with GitHub**.
2. **Add New… → Project** → напротив `skillswap` нажми **Import**.
3. Настройки:
   - **Framework Preset:** `Other`;
   - **Root Directory:** `./`;
   - **Build Command** и **Output Directory** — оставь пустыми (сборка не нужна).
4. **Deploy** → через минуту появится адрес вида `https://skillswap-xxxx.vercel.app`.

Папки `sql/`, `supabase/`, `tests/` на сайт не попадут — они перечислены в `.vercelignore`.

### 3. Сообщить Supabase адрес сайта (обязательно)

Без этого ссылки из писем (подтверждение email, восстановление пароля) будут вести на `localhost`.

Supabase → **Authentication → URL Configuration**:

- **Site URL:** `https://skillswap-xxxx.vercel.app`
- **Redirect URLs → Add URL:** `https://skillswap-xxxx.vercel.app/**` и `http://localhost:5500/**`

### 4. Обновления

После любых изменений:

```bash
git add .
```

```bash
git commit -m "Что изменил"
```

```bash
git push
```

Vercel опубликует новую версию автоматически.
