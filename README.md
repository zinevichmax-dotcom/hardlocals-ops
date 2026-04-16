# Hard Locals — Content Operations

Dashboard для управления контентом мотоклуба Hard Locals. Генерация постов через Claude API, автопостинг в Telegram/VK, редактор блоков, баннер-генератор.

## Стек

- Backend: Node.js 22 + Express + SQLite
- Frontend: React 18 (CDN, без сборки)
- Инфра: Docker Compose
- AI: Anthropic Claude Sonnet 4 + web_search
- TG: локальный Bot API
- Фото: Unsplash + Pexels

## Фичи

- 15 рубрик контента с голосом бренда
- Редактор блоков для мотоновостей (regen/delete/add-by-URL)
- Баннер-генератор с upload и поиском фото
- Автопостинг в TG/VK
- История публикаций
- HTML-превью как в Telegram

## Деплой на свежий сервер

```bash
# Клонируй репо
git clone https://github.com/zinevichmax-dotcom/hardlocals-ops.git
cd hardlocals-ops

# Настрой .env
cp .env.example .env
nano .env  # заполни ключи

# Запусти
docker compose up -d

# Проверь
docker compose logs -f
```

Доступ: `http://SERVER_IP:4000`

## Обновление кода

```bash
git pull
docker compose restart
```

Файлы `public/index.html` и `server.js` примонтированы как volumes — изменения применяются без пересборки образа.

## Переменные окружения

Обязательные:
- `ANTHROPIC_API_KEY` — для генерации
- `TG_BOT_TOKEN` + `TG_CHANNEL_ID` — для постинга в Telegram
- `ADMIN_USER` + `ADMIN_PASS` — логин/пароль для входа
- `JWT_SECRET` — случайная строка 64 символа

Опциональные:
- `VK_ACCESS_TOKEN` + `VK_GROUP_ID` — автопостинг в VK
- `UNSPLASH_KEY`, `PEXELS_KEY` — поиск фото

## Структура

```
.
├── server.js           # Express бэкенд
├── public/
│   ├── index.html      # React SPA
│   └── assets/         # Статика (лого и т.п.)
├── data/               # SQLite (gitignored)
├── uploads/            # Загруженные медиа (gitignored)
├── Dockerfile
├── docker-compose.yml
└── .env                # Секреты (gitignored)
```

## Работа с git

Все правки логики — через PR. Секреты (`.env`, `data/`, `uploads/`) исключены через `.gitignore`.

```bash
git checkout -b feature/my-feature
# ... правки ...
git commit -am "feat: describe change"
git push origin feature/my-feature
```
