# Google Календарь

Владелец компании подключает один Google Календарь и копирует в него предстоящие задания. Это не вход через Google. Сотрудник не подключает свой Google-аккаунт. Событие содержит название задания, время начала и конца, имя сотрудника и адрес объекта. Телефон и email клиента в событие не входят.

Кнопка скрыта, пока не заданы и `GOOGLE_CLIENT_ID`, и `GOOGLE_CLIENT_SECRET`. Без ключа маршрут подключения отвечает 404, а не ошибкой 500. Stripe Checkout остаётся выключенным.

## Где лежат переменные

Их задают на службе платформы, которая запускает `director.mjs`. Директор копирует их в процесс каждой компании. У компаний нет отдельной службы Render.

Одиночная установка `server.mjs` читает те же три имени из своего окружения.

`GOOGLE_CALENDAR_REDIRECT_URI` можно не задавать. Тогда директор использует `DIRECTOR_ORIGIN` + `/api/google/calendar/callback`.

## Google Cloud Console

1. APIs & Services → Library → включить **Google Calendar API**.
2. OAuth consent screen, тип External. Имя приложения KlarraumApp. Область только `https://www.googleapis.com/auth/calendar.events`.
3. Пока приложение в режиме Testing, добавьте Google-аккаунт, который будет подключаться, как Test user. Публикация приложения — отдельная проверка Google. Не придумывайте client id в репозитории.
4. Credentials → Create credentials → OAuth client ID → Web application.
5. Authorized redirect URIs. Google сравнивает адрес целиком и не принимает маску поддомена. На одном клиенте зарегистрируйте оба адреса:

   - `https://platform.klarraumapp.com/api/google/calendar/callback`
   - `https://klarraumapp.com/api/google/calendar/callback`

   Поддомены компаний (`https://<company-id>.<COMPANY_BASE_DOMAIN>/...`) не являются redirect URI. Ответ Google принимает адрес платформы, токен обновления пишется в базу этой компании, а владелец возвращается на `/admin.html` своей компании. Предпросмотр по пути `/companies/<id>/` использует callback `klarraumapp.com`: этот хост передаёт `/api/google/calendar/callback` директору.

6. JavaScript origins для этого серверного перенаправления не нужны.
7. Client id и client secret вставьте в Render. Не коммитьте их.

## Render

На веб-службе платформы:

```text
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_CALENDAR_REDIRECT_URI=https://platform.klarraumapp.com/api/google/calendar/callback
```

На публичном демо-хосте, если подключение календаря нужно и там, тот же клиент и:

```text
GOOGLE_CALENDAR_REDIRECT_URI=https://klarraumapp.com/api/google/calendar/callback
```

После сохранения перезапустите службу. Владелец открывает управление компанией, нажимает Connect Google Calendar, затем Sync jobs. Disconnect не удаляет уже созданные события в Google.
