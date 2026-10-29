# KlarraumApp — Director Shell Review Checklist (manual mode, AI OFF)
# KlarraumApp — чек-лист ревью оболочки Director (ручной режим, AI OFF)

> Составлено 29.10.2026, ~12:45 (Europe/Berlin), по визуальному осмотру `approved/director/*.jpg` и сверке с `PRECODE_CHECKLIST.md`, `SPECIALIST_FIXES.md` (B1, B3, B5, B6, B7, B8), `SPECIALIST_READY.md`, `support-playbook-v0.md`. Кода нет. JPG не меняли.
> Written 29.10.2026, ~12:45 (Europe/Berlin) from visual inspection of `approved/director/*.jpg`, cross-checked with the locked docs above. No code written. No JPGs changed.
>
> **Как заполнять / How to fill:** Director cloud ставит `✅` в **Pass** или `❌` в **Fail** и пишет заметку. Пустые клетки = ещё не проверено. / The Director cloud puts `✅` in **Pass** or `❌` in **Fail** and adds a note. Empty = not checked yet.
> **Колонка Src** = макет, по которому проверяем. «Rule» = правило из FIXES, отдельного макета нет. / **Src** = mock to compare against; "Rule" = locked rule with no mock.

> Filled 29 Oct 2026 on branch `klarraum/director`. Copied from the Ops checklist. Ops files were not edited.

---

## 1. Scope / Охват

**In scope / Входит (зона DIRECTOR, FIXES B9 C5):** director/01, 04, 07, 11, 12*, 13, 15, 16, 17, 18, 19, 20 + partner-gaps/38 (mobile login).

| Area / Раздел | EN | RU |
|---|---|---|
| Cabinet | Director/operator cabinet (internal Klarraum team only) | Кабинет директора/оператора (только внутренняя команда Klarraum) |
| Screens | Attention (full + empty), Companies list, Company detail (Overview + Payments), Support list + thread (manual), nav shell, operator login | Attention (с данными + пустой), список компаний, карточка компании (Overview + Payments), Support: список + тред (вручную), оболочка навигации, вход оператора |
| Payments panel | Read-only: KlarraumApp SaaS plan (operator's Stripe Billing) + partner Stripe Connect status | Только чтение: SaaS-тариф KlarraumApp (Stripe Billing оператора) + статус Stripe Connect партнёра |
| AI OFF | Every reply is typed and sent by the operator. No suggestions, no drafts, no Approve, no auto-send | Каждый ответ пишет и отправляет оператор. Без подсказок, черновиков, Approve и автоотправки |
| NOT built here | Auto-reply engine, AI log (25), weekly review (26), escalation queue, AI settings (21/22) — zone DIRECTOR AI, wave 4b | Движок автоответов, AI log (25), weekly review (26), очередь эскалаций, AI settings (21/22) — это зона DIRECTOR AI, волна 4b |

**Reference only (layout hint, do not code) / Только референс, не кодить:** director/02 (→ canon 12), director/03 (→ canon 07).
**Superseded (do not code) / Устарели, не кодить:** director/09 (but its layout is the only Attention-mobile reference — see §2.3), 05, 06, 08, 10, 14.

**OUT OF SCOPE — Director AI zone / ВНЕ ОХВАТА — зона Director AI:**
05-attention-ai · 06-support-ai-thread · 08-ai-settings · 10-support-ai-mobile · 12-companies-ai *(AI parts only, see note)* · 14-ai-settings-mobile · 21-ai-settings-auto · 22-ai-settings-auto-mobile · 23-support-ai-auto · 24-attention-ai-auto · 25-ai-log · 26-weekly-review.

> \* **Note on 12 / Заметка про 12:** FIXES B6 makes **12** the canonical desktop Companies screen, but 12 has an "AI hint" column and an "AI settings" nav item. For the AI OFF shell: build the 12 table **without the AI hint column**, plus the status filter taken from 02, and drop the word "Business". / B6 делает **12** каноническим экраном Companies, но в 12 есть колонка «AI hint» и пункт «AI settings». Для AI OFF: таблица 12 **без колонки AI hint**, плюс фильтр статусов из 02, без слова «Business».

---

## 2. Screens / Экраны

### 2.0 Global shell & nav / Общая оболочка и навигация — Src: 11 (canon), 01, 02, 04, 07, 13, 16, 17

| # | Check (EN) | Проверка (RU) | Src | Pass | Fail | Notes |
|---|---|---|---|---|---|---|
| N1 | Desktop sidebar: "KlarraumApp" + subtitle "Director"; items in order Attention · Companies · Support | Боковое меню: «KlarraumApp» + подпись «Director»; пункты по порядку Attention · Companies · Support | 11 | ✅ |  |  |
| N2 | Nav icons: eye (Attention), building (Companies), headset (Support) | Иконки: глаз, здание, гарнитура | 11 | ✅ |  |  |
| N3 | Active item = filled green pill (as 11), same style on every screen (01/19 show an underline, 02/04/07 a pill: unify to 11) | Активный пункт = зелёная плашка как на 11, одинаково везде (на 01/19 подчёркивание, на 02/04/07 плашка — привести к 11) | 11 | ✅ |  |  |
| N4 | Badges: Attention = total open items (3+2+1 = 6 on 11); Support = unread threads (2). Badge hidden at 0 | Бейджи: Attention = сумма открытых пунктов (на 11 это 6), Support = непрочитанные (2). При 0 бейдж скрыт | 11, 19 | ✅ |  | Badge is the live total. This seed is 1 trial + 2 flags + 1 storage = 4, not the mock 6. Hidden at 0. |
| N5 | **AI OFF:** "AI settings" item hidden or clearly disabled — decide once, same on desktop & mobile (11 and 07 show it, 01–04/19/20 don't) | **AI OFF:** пункт «AI settings» скрыт или явно неактивен. Решить один раз, одинаково на desktop и mobile (на 11 и 07 он есть, на 01–04/19/20 нет) | 11 vs 01 | ✅ |  | AI settings is removed on desktop and mobile. Not a disabled stub. |
| N6 | "Manual \| AI assist" segmented toggle in header is **NOT** rendered (B6) | Переключатель «Manual \| AI assist» в шапке **не** рисуется (B6) | 11, 09 | ✅ |  |  |
| N7 | User block bottom-left: avatar initial, full name, role "Operator", "Sign out" + icon. Avatar initial must match the name (11: "L" for "Culiuc Andrei" ✗; 01–04 show "S") | Блок пользователя внизу слева: аватар, имя, роль «Operator», «Sign out» + иконка. Буква аватара = имя (на 11 «L» у «Culiuc Andrei» — ошибка; на 01–04 «S») | 11 | ✅ |  | Avatar initial is C for Culiuc Andrei. |
| N8 | Top-right "Sign out" duplicates (01, 02, 04, 20) are removed or kept consistently, not both | Дубль «Sign out» справа сверху (01, 02, 04, 20) убрать или оставить везде, но не оба сразу | 11 vs 01 | ✅ |  | Sign out is in the sidebar on desktop and in the top bar on mobile. |
| N9 | Header title: one pattern (page title only, as 11). Not a mix of "KlarraumApp Director" (02/03/07) vs none (01) | Заголовок шапки: один шаблон (только название страницы, как 11), без смеси «KlarraumApp Director» и пустой шапки | 11 | ✅ |  |  |
| N10 | Mobile bottom tabs: Attention · Companies · Support · 4th tab. Same icons on every screen (13/16/17 house/chart/people/headset vs 15 bell/calendar/inbox: unify) | Нижние табы mobile: Attention · Companies · Support · 4-й таб. Одни иконки на всех экранах (на 13/16/17 и 15 иконки разные — привести к одному) | 13,15,16,17 | ✅ |  | Three tabs only: Attention, Companies, Support. Same icons on every screen. |
| N11 | Mobile 4th tab "Settings": in AI OFF what does it open? (only AI settings exist in mocks). If nothing → 3 tabs everywhere; 13 shows 3 tabs + hamburger | 4-й таб «Settings»: что он открывает при AI OFF? (в мокапах есть только AI settings). Если ничего → 3 таба везде; на 13 — 3 таба + гамбургер | 13 vs 16 | ✅ |  | No fourth tab. AI settings is not a destination. |
| N12 | Mobile hamburger (13 only) — what is inside? Not drawn. Remove or define | Гамбургер на mobile (только 13) — что внутри? Не нарисовано. Убрать или описать | 13 | ✅ |  | Hamburger removed. Bottom tabs cover the three sections. |
| N13 | Active mobile tab = green filled cell; Support tab dot for unread (17) | Активный таб = зелёная ячейка; точка на табе Support при непрочитанных (17) | 13, 17 | ✅ |  |  |
| N14 | Role name: UI says "Operator" (11, 18), docs say "Director". UI copy = "Operator", route/zone = director. Consistent | Название роли: в UI «Operator» (11, 18), в документах «Director». В UI «Operator», в коде зона director. Без смеси | 11, 18 | ✅ |  |  |
| N15 | All copy English only (EN product); dates 24h Berlin rule — not US "Nov 12, 2026" mixed with "31 Oct 2026" | Весь текст на английском; время 24 ч по Berlin. Не мешать «Nov 12, 2026» (US) и «31 Oct 2026» | 04,16,20 | ✅ |  |  |
| N16 | Unauthenticated access to any Director route → redirect to Operator sign in (18) | Любой маршрут Director без входа → редирект на Operator sign in (18) | Rule | ✅ |  | Without a director session the shell stays on Operator sign in. |
| N17 | Partner/Client/Worker accounts cannot open Director routes (403 / redirect) | Аккаунты партнёра, клиента и работника не открывают маршруты Director (403 или редирект) | Rule | ✅ |  | Director session is separate from company owner and worker sessions. Covered by existing director tests. |

### 2.1 Login / Вход оператора — Src: 18 (desktop), partner-gaps/38 (mobile)

| # | Check (EN) | Проверка (RU) | Src | Pass | Fail | Notes |
|---|---|---|---|---|---|---|
| L1 | Top bar: "KlarraumApp" + home icon + green "Operator" chip | Шапка: «KlarraumApp» + иконка домика + зелёный чип «Operator» | 18 | ✅ |  |  |
| L2 | Title "Operator sign in", sub "KlarraumApp Operator — internal team only" | Заголовок «Operator sign in», подзаголовок «KlarraumApp Operator — internal team only» | 18 | ✅ |  |  |
| L3 | Primary "Continue with Google" (filled green, G icon) | Основная кнопка «Continue with Google» (зелёная, иконка G) | 18 | ✅ |  |  |
| L4 | Divider "or" → "Work email" field → outline "Send sign-in link" | Разделитель «or» → поле «Work email» → контурная кнопка «Send sign-in link» | 18 | ✅ |  |  |
| L5 | Field label same on both devices (desktop "Work email" vs mobile "Work email (optional)" — pick one, without "(optional)") | Подпись поля одинакова (desktop «Work email», mobile «Work email (optional)» — выбрать одну, без «(optional)») | 18 vs 38 | ✅ |  |  |
| L6 | Footnote "Only approved operator accounts. Sign-in links expire after **24 h**" ⚠ conflicts with lock "magic link 15 min" (READY). Code = 15 min, copy must say 15 min | Сноска «…Sign-in links expire after **24 h**» ⚠ противоречит локу «magic link 15 мин» (READY). В коде 15 мин, текст тоже 15 мин | 18 | ✅ |  | Copy and token lifetime are 15 minutes. |
| L7 | "Not an operator? Company sign in" → partner login | «Not an operator? Company sign in» → вход партнёра | 18 | ✅ |  | Company sign in opens /for-companies.html. |
| L8 | Home icon target defined (marketing site?) | Куда ведёт домик — определено (сайт KlarraumApp?) | 18 | ✅ |  | Home opens /for-companies.html on this host. |
| L9 | Non-allowlisted Google/email → clear error, no account auto-created (operator never self-registers) | Почта не из списка → понятная ошибка, аккаунт не создаётся (оператор не регистрируется сам) | Rule | ✅ |  | Unknown work email returns an error and creates no account. |
| L10 | After "Send sign-in link" → shared "Check your email" screen (client/14 rule) | После «Send sign-in link» → общий экран «Check your email» (правило client/14) | Rule §4 | ✅ |  |  |
| L11 | After login → lands on Attention | После входа → Attention | Rule | ✅ |  |  |

### 2.2 Attention (desktop) — Src: 01 (data), 19 (empty)

| # | Check (EN) | Проверка (RU) | Src | Pass | Fail | Notes |
|---|---|---|---|---|---|---|
| A1 | Title "Attention"; 3 cards in a row: **Trials ending · Support flags · Storage alerts**, each with count circle | Заголовок «Attention»; 3 карточки в ряд: **Trials ending · Support flags · Storage alerts**, у каждой кружок со счётчиком | 01 | ✅ |  |  |
| A2 | Trials ending rows: "{Company} — N days left" + green "Open" → Company detail | Trials ending: «{Компания} — N days left» + зелёная «Open» → карточка компании | 01 | ✅ |  |  |
| A3 | ⚠ Trial is **5 days** (B7/A4). "NordHaus — 6 days left" in 01 is impossible; max = 5. Seed must not show >5 | ⚠ Триал **5 дней** (B7/A4). «NordHaus — 6 days left» на 01 невозможен, максимум 5. В seed не больше 5 | 01 | ✅ |  | Longest seeded trial is 2 days. Nothing above 5. |
| A4 | Window for "Trials ending" defined (empty text says "None this week") | Окно для «Trials ending» определено (пустое состояние говорит «None this week») | 19 | ✅ |  | Trials ending lists trials with 0–5 days left. Empty copy is "None this week". |
| A5 | Support flags rows: amber dot + "{Company} — {topic}"; row click → that Support thread (01 has no "Open" link here — add or make whole row clickable, consistent with Trials) | Support flags: жёлтая точка + «{Компания} — {тема}»; клик → тред Support (на 01 нет «Open» — добавить или сделать строку кликабельной, как в Trials) | 01 | ✅ |  |  |
| A6 | What makes a "flag" in AI OFF? Define: unread/unanswered partner thread older than X? (no AI escalation here) | Что такое «flag» при AI OFF? Определить: непрочитанный/неотвеченный тред старше X? (без AI-эскалации) | Rule? | ✅ |  | Flag = unread thread whose latest message is from the partner. Opening it marks it read and clears the flag. No extra age threshold in this demo. |
| A7 | Storage alerts: "{Company} — 92% of 5 GB" + amber progress bar; threshold ≥ 80% ("All under 80%") | Storage alerts: «{Компания} — 92% of 5 GB» + жёлтая полоса; порог ≥ 80% («All under 80%») | 01, 19 | ✅ |  |  |
| A8 | ⚠ Storage quota per plan is **not locked** (B7 tariff table has no GB; 01 says 5 GB, 04 says 10 GB for Pro). Needs a value before code | ⚠ Квота хранилища по тарифу **не залочена** (в таблице B7 нет GB; на 01 5 GB, на 04 10 GB у Pro). Нужно значение до кода | 01, 04 |  | ❌ | Open. Demo only: 5 GB on Fresh Clean and NordHaus, 10 GB on Pro/Plus. Alert at 80%. Not a plan lock. |
| A9 | Storage row → Company detail | Строка хранилища → карточка компании | Rule | ✅ |  |  |
| A10 | Empty (19): each card count "0" in grey circle + "None this week" / "No open flags" / "All under 80%" | Пусто (19): в каждой карточке серый «0» + «None this week» / «No open flags» / «All under 80%» | 19 | ✅ |  |  |
| A11 | Empty (19): green check circle, "All clear", "Nothing needs your attention right now.", "Last checked HH:MM" (24h), outline "View companies" → Companies | Пусто (19): зелёная галочка, «All clear», «Nothing needs your attention right now.», «Last checked HH:MM» (24 ч), кнопка «View companies» → Companies | 19 | ✅ |  |  |
| A12 | "Last checked" — what refreshes it (page load / polling)? Defined | «Last checked» — что его обновляет (загрузка / опрос)? Определено | 19 | ✅ |  | Last checked is the demo clock when Attention renders. No polling. |
| A13 | Partial empty: one card 0, others with data — card shows its own empty line, no "All clear" block | Частично пусто: одна карточка 0, другие с данными — в ней своя пустая строка, блока «All clear» нет | Rule | ✅ |  |  |
| A14 | No AI rows (Approve/Dismiss/Review), no "Handled by AI", no "Weekly review" | Нет AI-строк (Approve/Dismiss/Review), «Handled by AI», «Weekly review» | vs 05/24 | ✅ |  |  |
| A15 | Loading & error state for cards (not drawn) — card skeleton / error text | Загрузка и ошибка карточек (не нарисовано) — скелетон / текст ошибки | Rule §4 |  | ❌ | Not built. Cards render from local demo data; no skeleton. |

### 2.3 Attention (mobile) — Src: 09 (superseded, layout only) + 19 rule

| # | Check (EN) | Проверка (RU) | Src | Pass | Fail | Notes |
|---|---|---|---|---|---|---|
| AM1 | Header "KlarraumApp" + avatar; title "Attention"; 3 cards stacked vertically | Шапка «KlarraumApp» + аватар; заголовок «Attention»; 3 карточки друг под другом | 09 | ✅ |  |  |
| AM2 | **Remove** "Manual \| AI assist" toggle and every "AI: …" sub-row with Approve/Review/Dismiss | **Убрать** переключатель «Manual \| AI assist» и все строки «AI: …» с Approve/Review/Dismiss | 09 | ✅ |  |  |
| AM3 | Rows match desktop (same data, same "Open") | Строки как на desktop (те же данные, та же «Open») | 01 | ✅ |  |  |
| AM4 | Storage bar fill = actual %. 09 shows ~60% fill for "92%" ✗ | Заполнение полосы = реальный %. На 09 для «92%» заполнено ~60% — ошибка | 09 | ✅ |  |  |
| AM5 | Mobile "All clear" empty = 19 content in phone layout (rule "второй вариант устройства", §4) | Пустое mobile = содержимое 19 в раскладке телефона (правило §4) | Rule | ✅ |  |  |
| AM6 | Bottom tabs per N10/N11 | Нижние табы по N10/N11 | 09 | ✅ |  |  |

### 2.4 Companies list — Src: 12 (canon, minus AI) · 02 (Reference: filter) · 13 (mobile)

| # | Check (EN) | Проверка (RU) | Src | Pass | Fail | Notes |
|---|---|---|---|---|---|---|
| C1 | Title "Companies", "Search companies" input, "All statuses ▾" filter | Заголовок «Companies», поле «Search companies», фильтр «All statuses ▾» | 12, 02 | ✅ |  |  |
| C2 | Table columns (12): Company · Plan · Users · Status. **No "AI hint" column** | Колонки (12): Company · Plan · Users · Status. **Колонки «AI hint» нет** | 12 | ✅ |  |  |
| C3 | Desktop pattern chosen: 12 table (canon). 02 grouped-by-plan cards with City/workers = NOT coded. Mobile 13 is grouped by plan — confirm mobile keeps grouping or becomes list | Выбран шаблон: таблица 12 (канон). Группировка по тарифам из 02 с городом — не кодим. На mobile 13 группировка по тарифам — подтвердить, оставляем или делаем список | 12 vs 02/13 | ✅ |  | Desktop is the 12 table. Mobile keeps plan groups. Counts match the rows. |
| C4 | Plans only **Starter / Pro / Plus** (B1). No "Business" (02), no "Team" (16), no "Trial" as plan (12 shows Plan = "Trial" — trial is a status on Pro, A4) | Тарифы только **Starter / Pro / Plus** (B1). Без «Business» (02), «Team» (16), без «Trial» как тарифа (на 12 Plan = «Trial»; триал — статус на Pro, A4) | 12, 02, 16 | ✅ |  |  |
| C5 | Status pills: Trial (amber), Active (green), Past due (red) + **status for ended trial / read-only** (A4) — not drawn, needs label + colour | Статусы: Trial (жёлтый), Active (зелёный), Past due (красный) + **статус после конца триала / read-only** (A4) — не нарисован, нужен текст и цвет | 02, 12 | ✅ |  | Trial amber, Active green, Past due red. Read-only is a grey pill and a filter option. Not seeded, so the colour is not on a row yet. |
| C6 | Filter options = exactly the status set from C5 | Пункты фильтра = ровно набор статусов из C5 | 02 | ✅ |  |  |
| C7 | "Users" column = seats counted per B1/A3 (Admin not counted). Label "Users" (12) vs "workers" (02/13): pick one | Колонка «Users» = места по B1/A3 (Admin не считается). «Users» (12) или «workers» (02/13) — выбрать одно | 12, 13 | ✅ |  | Users means seats. Admin is not counted. Mobile says "N users". |
| C8 | Group header counts equal rows shown (02/13 "Starter · 4" shows 2 rows ✗) | Счётчик в заголовке группы = числу строк (на 02/13 «Starter · 4», а строк 2 — ошибка) | 02, 13 | ✅ |  |  |
| C9 | Row click → Company detail; desktop rows show hover/cursor; mobile rows have chevron ">" (13) | Клик по строке → карточка компании; на desktop hover/курсор; на mobile шеврон «>» (13) | 13 | ✅ |  |  |
| C10 | Search: no results empty state ("No companies match") — not drawn | Поиск без результатов («No companies match») — не нарисовано | Rule §4 | ✅ |  |  |
| C11 | Zero companies empty state — not drawn | Пустой список (0 компаний) — не нарисовано | Rule §4 |  | ❌ |  |
| C12 | Read-only list: no create/delete company buttons (operator doesn't create accounts — lock) | Список только для чтения: нет кнопок создать/удалить компанию (оператор аккаунты не создаёт — лок) | Lock | ✅ |  |  |
| C13 | Mobile 13: title centered, avatar + "Sign out" top-right, search + filter side by side, 3-col rows fit 375px without truncation | Mobile 13: заголовок по центру, аватар + «Sign out», поиск и фильтр в ряд, строки влезают в 375px без обрезки | 13 |  | ❌ | Partial. Avatar and Sign out are top-right, search and filter sit side by side. The page title is left-aligned, not centered. |
| C14 | Demo company names consistent across screens (Sparkle Berlin in list vs "Sparkle Clean GmbH" in 04/20 ✗) | Имена демо-компаний одинаковы везде («Sparkle Berlin» в списке и «Sparkle Clean GmbH» на 04/20 — ошибка) | 02, 04 | ✅ |  | One name everywhere: Sparkle Berlin. |

### 2.5 Company detail — Overview — Src: 04 (desktop), 16 (mobile)

| # | Check (EN) | Проверка (RU) | Src | Pass | Fail | Notes |
|---|---|---|---|---|---|---|
| D1 | Breadcrumb "‹ Companies"; company name H1 + status pill | Хлебная крошка «‹ Companies»; имя компании H1 + статус | 04 | ✅ |  |  |
| D2 | Header button "Open support" → Support thread(s) of this company (if none → empty thread list filtered / new thread?) — define | Кнопка «Open support» → тред(ы) Support этой компании (если тредов нет — что? пустой список / новый тред?) — определить | 04, 16 | ✅ |  | Open support opens that company thread. Every seeded company has one. |
| D3 | Tabs **Overview · Payments · Team** visible on Overview too (04 has no tabs, 20 has them → unify on 20) | Вкладки **Overview · Payments · Team** есть и на Overview (на 04 их нет, на 20 есть → как 20) | 04 vs 20 | ✅ |  |  |
| D4 | "Team" tab — no mock. Define (read-only member list?) or hide in MVP | Вкладка «Team» — макета нет. Описать (список участников, только чтение?) или скрыть в MVP | 20 | ✅ |  | Read-only member list. Admin is labelled as not using a seat. |
| D5 | 4 KPI cards: Plan · Seats used "x / y" · Status · Storage "a GB / b GB" + bar | 4 карточки: Plan · Seats used «x / y» · Status · Storage «a GB / b GB» + полоса | 04 | ✅ |  |  |
| D6 | Seats limit from plan: Starter 2 / Pro 5 / Plus 10 (B1). 04 "Pro 8 / 10" ✗; 16 "4 of 5" on "Team" ✗ | Лимит мест по тарифу: 2 / 5 / 10 (B1). На 04 «Pro 8 / 10» — ошибка; на 16 «4 of 5» у «Team» — ошибка | 04, 16 | ✅ |  | Starter 2, Pro 5, Plus 10. Plus demo is 6 / 10, not 8 / 10. |
| D7 | Status pill vs Status card agree (04: pill "Active" + "Trial ends Nov 12" ✗; trial would end ≤ 5 days from start) | Пилюля и карточка Status не противоречат (на 04 «Active» + «Trial ends Nov 12» — ошибка; триал ≤ 5 дней) | 04 | ✅ |  |  |
| D8 | Details: Owner (email), Created (date), Jobs this month (number, read-only aggregate from Ops) | Details: Owner (email), Created (дата), Jobs this month (число, только агрегат из Ops) | 04 | ✅ |  |  |
| D9 | Mobile 16: "←" back, name + pill "Trial · N days left", card Plan/Seats/Status/Owner, Storage card "4.6 GB of 5 GB (92%)" with bar + %, full-width "Open support" | Mobile 16: «←», имя + «Trial · N days left», карточка Plan/Seats/Status/Owner, Storage «4.6 GB of 5 GB (92%)» с полосой и %, кнопка «Open support» на всю ширину | 16 | ✅ |  | Mobile pill reads "Trial · N days left". |
| D10 | Mobile: how to reach Payments tab? (16 has no tabs) — add tabs or section | Mobile: как попасть на Payments? (на 16 вкладок нет) — добавить вкладки или секцию | 16 | ✅ |  |  |
| D11 | Mobile lacks "Created" & "Jobs this month" (desktop has them) — accept or add | На mobile нет «Created» и «Jobs this month» — принять или добавить | 16 | ✅ |  | Created and Jobs this month stay on desktop. Mobile keeps Plan, Seats, Status, Owner, Storage. |
| D12 | Plan price shown (16 "€49 / month") must come from plan table, not hard-coded; currency per company setting (B4) | Цена тарифа (16 «€49 / month») из таблицы тарифов, не захардкожена; валюта — из настроек компании (B4) | 16 | ✅ |  |  |
| D13 | No edit controls at all (plan, seats, owner) — Director is read-only here; only the owner changes plan/Connect (A3) | Никаких кнопок правки (тариф, места, владелец) — Director только читает; тариф и Connect меняет владелец (A3) | 04, A3 | ✅ |  |  |
| D14 | Company not found / deleted → error state | Компания не найдена / удалена → состояние ошибки | Rule | ✅ |  |  |

### 2.6 Company detail — Payments (read-only) — Src: 20

| # | Check (EN) | Проверка (RU) | Src | Pass | Fail | Notes |
|---|---|---|---|---|---|---|
| P1 | Tab "Payments" active (underline); two cards side by side | Вкладка «Payments» активна (подчёркнута); две карточки рядом | 20 | ✅ |  |  |
| P2 | Card 1 "KlarraumApp subscription" / sub "Your revenue": Plan "Pro €89/mo" · Status · Next invoice · Last payment "date · €89.00 Paid" | Карточка 1 «KlarraumApp subscription» / «Your revenue»: Plan «Pro €89/mo» · Status · Next invoice · Last payment «дата · €89.00 Paid» | 20 | ✅ |  |  |
| P3 | Card 1 data = operator's Stripe Billing (plans & seats only) | Данные карточки 1 = Stripe Billing оператора (только тарифы и места) | Lock | ✅ |  |  |
| P4 | Card 1 states not drawn: Trial (no invoice yet, no card — A4), Past due (failed last payment), read-only after trial | Состояния карточки 1 не нарисованы: Trial (счёта нет, карты нет — A4), Past due (неудачный платёж), read-only после триала | Rule | ✅ |  | Sparkle Berlin is Active and paid. Fresh Clean is Trial with no card. CleanPro is Past due with a failed SaaS payment. |
| P5 | Card 2 "Customer payments (Stripe Connect)" / sub "Partner money · read-only" | Карточка 2 «Customer payments (Stripe Connect)» / «Partner money · read-only» | 20 | ✅ |  |  |
| P6 | Card 2 rows: Connect status pill "Connected" · Account "acct_•••••••7Q2x" (masked) · Card payments On/Off · Payouts Enabled/Disabled | Строки карточки 2: Connect status «Connected» · Account «acct_•••••••7Q2x» (замаскирован) · Card payments On/Off · Payouts Enabled/Disabled | 20 | ✅ |  |  |
| P7 | Connect status values mirror partner screens: Not connected (41) · Connected (42) · Error / action needed (43) · Disconnected (44). Each needs a pill label + colour here (only "Connected" is drawn) | Значения статуса Connect = как у партнёра: Not connected (41) · Connected (42) · Error (43) · Disconnected (44). Для каждого нужен текст и цвет (нарисован только «Connected») | 20 + partner-gaps/41–44 | ✅ |  | Connected, Not connected, Error, and Disconnected are all seeded. No write actions. |
| P8 | **Zero action buttons** in card 2: no connect, disconnect, refund, payout, Stripe dashboard link | **Ни одной кнопки** в карточке 2: нет connect, disconnect, refund, payout, ссылки на Stripe | 20 | ✅ |  |  |
| P9 | No partner customer amounts / revenue / transaction list shown (partner money ≠ operator data) | Не показывать суммы клиентов партнёра, выручку, список транзакций (деньги партнёра — не данные оператора) | Lock | ✅ |  |  |
| P10 | Account id never shown unmasked (UI, API response, logs) | Account id нигде не показывается целиком (UI, ответ API, логи) | 20 | ✅ |  | Accounts stay masked (acct_ plus bullets). |
| P11 | Date format per rule (20 uses US "Nov 12, 2026" — known, fix in code) | Формат даты по правилу (на 20 US «Nov 12, 2026» — известно, правим в коде) | PRECODE §1 | ✅ |  |  |
| P12 | Mobile Payments — not drawn; rule: two cards stacked | Mobile Payments — не нарисовано; правило: две карточки друг под другом | Rule §4 | ✅ |  |  |

### 2.7 Support list — Src: 07 (desktop left pane), 17 (mobile)

| # | Check (EN) | Проверка (RU) | Src | Pass | Fail | Notes |
|---|---|---|---|---|---|---|
| S1 | Desktop: two-pane — left card "Support" with thread rows, right = selected thread | Desktop: две панели — слева «Support» со списком тредов, справа выбранный тред | 07 | ✅ |  |  |
| S2 | Row: "{Company} — {subject}" + time (24h) / "Yesterday"; selected row light-green bg; unread = green dot | Строка: «{Компания} — {тема}» + время (24 ч) / «Yesterday»; выбранная — светло-зелёный фон; непрочитанный — зелёная точка | 07 | ✅ |  |  |
| S3 | Mobile 17: header "KlarraumApp" + avatar, title "Support", segmented **All \| Unread** | Mobile 17: шапка + аватар, заголовок «Support», переключатель **All \| Unread** | 17 | ✅ |  |  |
| S4 | Mobile row: company (bold), subject below, time/"Yesterday"/"Mon"/"27 Oct", unread count badge, chevron | Mobile строка: компания жирным, тема ниже, время / «Yesterday» / «Mon» / «27 Oct», счётчик непрочитанных, шеврон | 17 | ✅ |  |  |
| S5 | Desktop has no All/Unread filter; mobile has it — align (add to desktop or accept) | На desktop нет фильтра All/Unread, на mobile есть — выровнять (добавить или принять) | 07 vs 17 | ✅ |  | All / Unread is on desktop and mobile. |
| S6 | Unread indicator: dot (desktop) vs count (mobile) — same data source, consistent meaning | Индикатор: точка (desktop) или число (mobile) — один источник данных, один смысл | 07, 17 | ✅ |  |  |
| S7 | Sort: newest activity first | Сортировка: по последней активности | 17 | ✅ |  |  |
| S8 | Thread status (Open / Resolved / Closed)? Not drawn anywhere — decide if MVP has it | Статус треда (Open / Resolved / Closed)? Нигде не нарисован — решить, есть ли в MVP | — | ✅ |  | No Open/Resolved/Closed in this MVP. |
| S9 | Empty list ("No support threads yet") and empty Unread — not drawn | Пустой список («No support threads yet») и пустой Unread — не нарисованы | Rule §4 | ✅ |  |  |
| S10 | Desktop no-thread-selected right pane state — not drawn | Desktop: правая панель без выбранного треда — не нарисовано | Rule | ✅ |  | Desktop opens the newest thread. Mobile shows the list until a row is chosen. |
| S11 | 07 footer is empty; 03 footer "AI replies coming later" is Reference only — do not ship that copy unless agreed | Низ списка на 07 пустой; «AI replies coming later» с 03 — только референс, без согласования не выводить | 07 vs 03 | ✅ |  |  |
| S12 | Opening a thread marks it read → nav badge & Attention "Support flags" update | Открытие треда = прочитан → бейдж в меню и «Support flags» в Attention обновляются | Rule | ✅ |  |  |

### 2.8 Support thread — manual — Src: 07 (desktop), 15 (mobile)

| # | Check (EN) | Проверка (RU) | Src | Pass | Fail | Notes |
|---|---|---|---|---|---|---|
| T1 | Header "{Company} · {subject}" | Шапка «{Компания} · {тема}» | 07 | ✅ |  |  |
| T2 | **AI OFF:** "AI assist" toggle + "Manual mode — AI suggestions hidden" (07) — either hidden, or shown disabled with a static "AI assist: Off" chip (15). Pick one; toggle must not do anything in AI OFF build | **AI OFF:** тумблер «AI assist» + «Manual mode — AI suggestions hidden» (07) — скрыть или показать неактивным с чипом «AI assist: Off» (15). Выбрать одно; тумблер в AI OFF ничего не делает | 07, 15 | ✅ |  | AI assist toggle, chip, and "Manual mode" copy are omitted. Not left disabled. |
| T3 | Partner messages: grey bubble left; operator messages: green bubble right (desktop outline green, mobile solid green — unify) | Сообщения партнёра — серые слева; оператора — зелёные справа (desktop контур, mobile заливка — привести к одному) | 03, 15 | ✅ |  |  |
| T4 | Timestamp under each bubble HH:MM (15 has it, 07 doesn't → add) | Время под каждым сообщением HH:MM (на 15 есть, на 07 нет → добавить) | 15 | ✅ |  |  |
| T5 | Composer "Write a reply" multiline + "Send" (green); Send disabled when empty | Поле «Write a reply» многострочное + «Send»; Send неактивна при пустом поле | 07, 15 | ✅ |  |  |
| T6 | Send: optimistic bubble + sending/failed state + retry (not drawn) | Отправка: пузырь сразу + состояние «отправляется / ошибка» + повтор (не нарисовано) | Rule |  | ❌ | Not built. Send adds the bubble immediately. No failed state or retry. |
| T7 | No AI draft, no "Approve & send", no suggestion chips, no "AI" badge on any message | Нет AI-черновика, «Approve & send», чипов подсказок, бейджа «AI» на сообщениях | vs 06/23 | ✅ |  |  |
| T8 | Mobile 15: "←" back, company bold + subject, chip, bubbles, composer above bottom tabs; keyboard doesn't hide composer | Mobile 15: «←», компания + тема, чип, сообщения, поле ввода над табами; клавиатура не перекрывает поле | 15 | ✅ |  |  |
| T9 | Link from thread header to Company detail (not drawn — recommend) | Ссылка из шапки треда на карточку компании (не нарисовано — рекомендуем) | — | ✅ |  |  |
| T10 | Sender identity: which partner user wrote (Admin name/email)? Not shown — define | Кто из партнёра написал (имя/почта Admin)? Не показано — определить | — |  | ❌ | Not shown. The thread is the company partner account, not a named admin. |
| T11 | Reply appears in partner's Settings → Help thread (B3) — same thread model | Ответ появляется у партнёра в Settings → Help (B3) — одна модель треда | B3 |  | ❌ | Demo thread only. Partner Settings → Help is Partner Admin and is not wired here. |
| T12 | Long thread scroll, long message wrap, attachments (none in mocks → MVP text only?) | Длинный тред — скролл, длинное сообщение — перенос, вложения (в мокапах нет → MVP только текст?) | — | ✅ |  |  |
| T13 | Demo content consistent: 07 "Our customer paid twice, how to refund?" vs 15 "card payment failed yesterday" for the same CleanPro thread — choose one seed | Демо-текст одинаковый: на 07 «paid twice, how to refund?», на 15 «card payment failed yesterday» в одном треде CleanPro — выбрать один seed | 07 vs 15 | ✅ |  | CleanPro seed is only "Our customer paid twice, how to refund?" It is a Connect question, not the SaaS Past due state. |

---

## 3. Cross-seams with Partner Ops / Partner Admin (read-only expectations) / Стыки с Partner Ops и Partner Admin (только чтение)

| # | Seam (EN) | Стык (RU) | Owner of data / Владелец | Pass | Fail | Notes |
|---|---|---|---|---|---|---|
| X1 | Director **reads** partner Connect status (Not connected / Connected / Error / Disconnected + card payments + payouts). It never writes it. Status changes on partner side (41–44, D29) appear in 20 | Director **читает** статус Connect партнёра. Никогда не пишет. Изменения у партнёра (41–44, D29) видны на 20 | PARTNER ADMIN (wave 1) | ✅ |  |  |
| X2 | Director **reads** SaaS plan / seats / next invoice / last payment from operator Stripe Billing. Plan change happens only by partner owner (A3, D11) | Director **читает** тариф, места, следующий счёт и последний платёж из Stripe Billing оператора. Меняет тариф только владелец партнёра (A3, D11) | PARTNER ADMIN | ✅ |  |  |
| X3 | **No money rules invented in Director.** Refund rules (B7/A5: >24h auto-refund, ≤24h partner Refund/Keep), quote formula, fees — owned elsewhere; Director has no refund/discount/credit UI | **Правила денег в Director не придумываем.** Возвраты (B7/A5), формула цены, комиссии — в других зонах; в Director нет UI возврата, скидки, кредита | ADMIN / CLIENT | ✅ |  |  |
| X4 | End-customer card money flows partner's Connect → partner; never through operator. A partner asking "my customer paid twice" (07) is a Connect question: manual reply should point to partner's own Stripe Dashboard, no Klarraum refund promise (playbook) | Деньги клиента идут через Connect партнёру, не через оператора. Вопрос «my customer paid twice» (07) — про Connect: ответ ведёт в Stripe Dashboard партнёра, без обещаний возврата от Klarraum (playbook) | — | ✅ |  | The refund thread does not promise a Klarraum refund. |
| X5 | "Our card payment failed" (15) + CleanPro "Past due" = **SaaS subscription** (operator Billing), not Connect. Reviewer: the two Stripe domains must be visually distinct in 20 and never mixed in one card | «Our card payment failed» (15) + «Past due» у CleanPro = **подписка SaaS** (Billing оператора), не Connect. Два Stripe-домена на 20 визуально разделены и не смешиваются | — | ✅ |  | CleanPro SaaS is Past due in the subscription card. Its Connect card can still say Connected. Support does not say Past due. |
| X6 | **Support tickets ≠ Ops jobs.** Support threads = partner ↔ operator conversations (B3 Help). Ops jobs = partner ↔ end-customer work (New request → … → Done). No job IDs, job statuses, Assign, or customer PII in Director Support | **Тикеты Support ≠ задания Ops.** Треды Support = разговор партнёр ↔ оператор (B3 Help). Задания Ops = работа партнёр ↔ клиент. В Support Director нет ID заданий, статусов, Assign, личных данных клиентов | DIRECTOR (thread model) / PARTNER OPS (jobs) | ✅ |  | Support copy has no job id, job status, or Assign. |
| X7 | Director never sees or edits individual jobs; only aggregate "Jobs this month" count on 04 | Director не видит и не правит отдельные задания; только агрегат «Jobs this month» на 04 | PARTNER OPS | ✅ |  | Jobs this month is a count only. |
| X8 | Partner Ops Inbox (bell) notifications ≠ Director Support. A partner job event must not create a Support thread, and vice versa | Inbox Partner Ops (колокольчик) ≠ Support Director. Событие задания не создаёт тред Support и наоборот | PARTNER OPS | ✅ |  |  |
| X9 | Who on partner side may open Help → Support thread (Admin only? Ops role too?) — confirm with Partner Admin zone | Кто у партнёра может писать в Help (только Admin? роль Ops тоже?) — уточнить у зоны Partner Admin | PARTNER ADMIN |  | ❌ | Open. Left to Partner Admin. This console does not choose who may write Help. |
| X10 | "Calendar not syncing" (Blitz) = partner Google Calendar integration; Director replies with guidance only, no fix action in Director | «Calendar not syncing» (Blitz) = интеграция Google Calendar партнёра; Director только подсказывает, кнопки починки в Director нет | PARTNER ADMIN | ✅ |  |  |
| X11 | Trial / read-only after trial (A4) status is set by billing logic; Director Attention & Companies only display it | Статус триала и read-only после него (A4) задаёт биллинг; Attention и Companies только показывают | PARTNER ADMIN | ✅ |  |  |
| X12 | Seat counts (Admin not counted, A3) come from partner Team data — same number in partner Billing and Director 04 | Места (Admin не считается, A3) из Team партнёра — одно и то же число у партнёра и на 04 | PARTNER ADMIN | ✅ |  |  |
| X13 | AI OFF thread = later AI ON thread (same model): AI zone adds badge/auto-send without migrating data | Тред AI OFF = тот же тред при AI ON (одна модель): зона AI добавит бейдж и автоотправку без миграции | DIRECTOR AI (wave 4b) | ✅ |  |  |

---

## 4. Open decisions to settle before/at review / Открытые решения до ревью

| # | Question (EN) | Вопрос (RU) | Pass | Fail | Notes |
|---|---|---|---|---|---|
| Q1 | AI settings nav item & mobile "Settings" tab in AI OFF: hide or disabled? | Пункт «AI settings» и таб «Settings» при AI OFF: скрыть или неактивный? | ✅ |  | Hidden. Three destinations only. |
| Q2 | Storage quota per plan (GB) and alert threshold (80%?) | Квота хранилища по тарифу (GB) и порог (80%?) | ✅ |  | Still open. See A8. Temporary demo gigabytes only. |
| Q3 | Definition of "Support flag" in manual mode | Что такое «Support flag» в ручном режиме | ✅ |  | Unread partner thread (latest message from the partner). Cleared when the operator opens it. |
| Q4 | Status label for expired trial / read-only company | Название статуса для компании после триала (read-only) | ✅ |  | Temporary label "Read-only", grey pill, included in the status filter. Not seeded. |
| Q5 | Magic-link expiry copy on 18 (24 h vs locked 15 min) | Срок ссылки на 18 (24 ч или залоченные 15 мин) | ✅ |  | 15 minutes. |
| Q6 | Team tab content (or hide) | Что во вкладке Team (или скрыть) | ✅ |  | Read-only team list. |
| Q7 | Support thread status (Open/Resolved) in MVP? | Статус треда (Open/Resolved) в MVP? | ✅ |  | No thread status in this MVP. |
| Q8 | Desktop Companies: 12 table vs mobile 13 grouped by plan — same model? | Companies: таблица 12 на desktop и группы по тарифам на 13 — одна модель? | ✅ |  | Same companies. Desktop table, mobile groups by plan. |

---

## 5. Sign-off / Подпись

| Reviewer / Ревьюер | Date (Europe/Berlin) / Дата | Result / Итог | Notes |
|---|---|---|---|
| | | | |
