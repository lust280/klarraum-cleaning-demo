# Вход через Google для владельца новой компании

Это отдельно от Google Календаря. Календарь по-прежнему использует область `calendar.events` и адрес `/api/google/calendar/callback`. Вход использует OpenID (`openid email profile`) и другой адрес возврата. Один и тот же OAuth-клиент Google Cloud подходит для обоих потоков: у каждого свой redirect URI и свой набор областей. Stripe Checkout остаётся выключенным.

Владелец выбирает Solo, Starter, Team, Business, Scale или Plus на публичной странице цен и нажимает «Continue with Google». Первый успешный вход создаёт компанию на этом плане, начинает 15-дневный пробный период и открывает кабинет владельца. Повторный вход с тем же аккаунтом Google возвращает в ту же компанию и план не меняет.

Пароль владельца — случайный хеш, его никому не показывают. Такой владелец снова входит через Google. Пробный период по почте остаётся запасным путём. В консоли директора нет кнопки «Создать компанию»: там список компаний по шести планам, поддержка, удаление тестовой компании, резервные копии и расходы.

Пока на **этом** процессе нет ключей Google, кнопка скрыта, а `/api/google/signup/status` отвечает `{"enabled":false}`. `/api/google/signup/start` отвечает 404, не 500.

## Окружение на обоих хостах

`klarraumapp.com` и `platform.klarraumapp.com` — две разные службы Render. Кнопка появляется только на той службе, где заданы `GOOGLE_CLIENT_ID` и `GOOGLE_CLIENT_SECRET`. Один и тот же OAuth-клиент. Если запрос пришёл на один из этих доменов, адрес возврата берётся с этого домена и не подменяется чужим `GOOGLE_SIGNIN_REDIRECT_URI`.

Сейчас платформа уже отвечает `{"enabled":true}`. Публичный сайт отвечает `{"enabled":false}`, пока на его службе нет тех же ключей.

На службе **публичного сайта** `klarraumapp.com` (процесс `server.mjs`):

```text
GOOGLE_CLIENT_ID=<тот же client id, что уже стоит на платформе>
GOOGLE_CLIENT_SECRET=<тот же secret>
```

`GOOGLE_SIGNIN_REDIRECT_URI` на этой службе лучше не задавать. Тогда вход с `https://klarraumapp.com` использует `https://klarraumapp.com/api/google/signup/callback`. Если переменная нужна явно:

```text
GOOGLE_SIGNIN_REDIRECT_URI=https://klarraumapp.com/api/google/signup/callback
```

Не копируйте сюда адрес платформы. После сохранения перезапустите именно публичную службу и откройте `https://klarraumapp.com/api/google/signup/status`. Ожидается `{"enabled":true}`.

На службе **платформы** `platform.klarraumapp.com` (процесс `director.mjs`) ключи уже включены. Адрес возврата: `https://platform.klarraumapp.com/api/google/signup/callback`. Явный вариант, если origin службы другой:

```text
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_SIGNIN_REDIRECT_URI=https://platform.klarraumapp.com/api/google/signup/callback
```

`GOOGLE_CALENDAR_REDIRECT_URI` не перенаправляйте на адрес входа. Stripe Checkout остаётся выключенным.

## Адреса возврата

Добавьте оба адреса входа в тот же Web client, рядом с адресами календаря. Google сравнивает адрес целиком.

Вход:

- `https://platform.klarraumapp.com/api/google/signup/callback`
- `https://klarraumapp.com/api/google/signup/callback`

Календарь (без изменений):

- `https://platform.klarraumapp.com/api/google/calendar/callback`
- `https://klarraumapp.com/api/google/calendar/callback`

На экране согласия добавьте области `openid`, `email` и `profile` рядом с `https://www.googleapis.com/auth/calendar.events`. JavaScript origins не нужны. Пока приложение Google в режиме Testing, добавьте аккаунт владельца как Test user. Не придумывайте client id в репозитории.

## Как проверить путь с кнопки

1. На публичной службе задайте тот же client id и secret, сохраните и перезапустите её. Платформу повторно настраивать не нужно, если статус там уже `enabled:true`.
2. Откройте `https://klarraumapp.com/pricing.html`, `https://klarraumapp.com/for-companies.html` или те же страницы на `platform.klarraumapp.com`.
3. Выберите план. Страница переходит к Continue with Google для этого плана.
4. Google возвращает браузер на `/api/google/signup/callback`, и директор открывает `/admin.html` этой компании.
5. Кабинет открывается без ручного создания компании директором.

Если кнопки нет, `GET /api/google/signup/status` возвращает `{"enabled":false}`: ключи не видны этому процессу.
