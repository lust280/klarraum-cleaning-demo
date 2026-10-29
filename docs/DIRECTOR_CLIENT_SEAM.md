# Director ↔ Client seam

Contract for the Client booking funnel. **Do not edit Client / public booking files from the Director branch.** Partner Admin owns `booking_mode` and Connect; Ops owns job status transitions; Director owns operator Support threads with the partner (Help), not Ops jobs.

Sources: `SPECIALIST_READY.md` / `SPECIALIST_FIXES.md` (B1, B7, B8 A1–A2, B3), Partner Admin PR #14, Ops `docs/OPS_HANDOFF.md` (PR #13), Director shell PR #16.

---

## 1. What Client reads (from Partner Admin / config)

### Booking mode

One setting: `booking_mode = paused | request | instant` (Settings → Booking mode / mock 45). Default for a new company: **request**.

| Public value | Meaning for Client |
| --- | --- |
| `paused` | No booking form. Show «Booking paused» (client-gaps/07 / D19). No inquiry created. |
| `request` | Client sends a request. Job starts as Ops `new` (New request), payment `Unpaid`. No card at booking. |
| `instant` | Booking becomes Ops `accepted` immediately. Pay on site → Unpaid; card with Connect ON → charge now → Paid online. |

**Trial ended (SaaS):** Partner Admin exposes an effective public mode of **`paused`** even if the company still has `storedBookingMode` of `request` or `instant`. Client must use the **effective** public mode (`bookingMode` / equivalent on `partnerBooking`), not the stored setting. Billing / Help / Export stay open for the partner; the public page looks paused.

### API / config shapes (Admin PR #14)

Client should consume (names as shipped on `klarraum/partner-admin`):

- `GET /api/partner/booking-mode` and/or `partnerBooking` on `GET /api/config`:
  - `bookingMode` — what the public site must show (`paused` while trial is over).
  - `storedBookingMode` — company’s saved Paused / Request / Instant.
  - Prices, max area, currency, whether card payments are available (Connect).
- `quoteEuros({ rate, area, minimum })` → `max(rate × area, minimum)` (euros; round to 0.01). Demo: 70 m² · €2.20/m² · no higher minimum → **€154.00**.
- Duration helper used by Ops slots: `jobDurationMinutes(areaM2, speedM2PerHour)` — round up to 30 minutes. Client only needs free slots from Ops; it does not own the slot engine.

Only **free** calendar slots are selectable (Request and Instant). Busy times must not be choosable.

### Instant charge vs Request slot hold (24 h)

| Mode | Card | Slot |
| --- | --- | --- |
| **Request** | **No card / no hold** at booking (A2). Pay on site, or pay-by-link after partner Accept. | `new` holds the slot for **24 hours** from creation (A1). After 24 h the slot frees; the request can remain `new` for the partner. |
| **Instant** | Connect ON + card → **charge immediately** → Paid online (08 / D15). Connect OFF or Pay on site → Accepted, Unpaid (15 / D21). | Status is already `accepted` (holds like other accepted jobs per Ops). |

Do not implement a card authorization hold in Request. «Hold 24 h» means **calendar slot**, not Stripe hold.

### Client finals after Contacts (B1)

| `bookingMode` | Condition | Screen | Job / payment |
| --- | --- | --- | --- |
| paused | — | 07 / D19 | no job |
| request | any | 04 / D14 Request sent | `new`, Unpaid |
| instant | Pay on site or Connect OFF | 15 / D21 | `accepted`, Unpaid |
| instant | Connect ON, card OK | 08 / D15 | `accepted`, Paid online |

Card error → D18 → Try again / Pay on site. Pay-blocked (client-gaps/09) only if the client reached card pay and Connect dropped; if Connect is OFF, hide card pay.

Inquiry → Ops: `POST /api/inquiries` copies into Ops as `status: "new"` (see Ops handoff). Instant path must land as `accepted` per Admin/Ops contract when Client wires it — do not invent Director APIs for that.

---

## 2. What Director Support sees (from the partner) — not Ops jobs

Partner **Settings → Help** opens a thread with the Klarraum operator (B3). Layout on the partner side mirrors the Support thread; **Director** owns the operator console side (manual replies when AI OFF — PR #16).

Director Support list / thread shows **partner ↔ operator** conversations, for example:

- Connect / customer payment / refund questions («customer paid twice…»)
- SaaS plan / billing confusion (still a Support thread; Attention may also show SaaS **Past due** separately)
- Product / how-to questions

Director Support does **not**:

- List or mutate Ops jobs (`new` → `done`, decline, cancel, assign)
- Own Worker timer / report / can’t-make-it flows
- Mix Connect-refund threads with SaaS Past due Attention rows or with Ops job boards

Attention (Director) may show Trials ending, Support flags (unread partner messages), Storage alerts — still not an Ops job feed.

AI ON auto-replies are **Director AI** (out of this seam). Manual shell: operator types every reply.

---

## 3. Ownership cheat sheet

| Concern | Owner | Client / Director note |
| --- | --- | --- |
| `booking_mode`, Connect stubs, plan catalogue, `quoteEuros`, trial→public paused | Partner Admin | Client reads; Director payments panel is read-only SaaS + Connect status |
| Slot engine, Accept/Decline, job status | Partner Ops | Client creates inquiry → Ops `new`; Instant accept semantics per Admin+Ops |
| Worker job execution | Worker | Not Director Support |
| Operator Help / Support thread | Director (UI) + Admin (partner Help entry) | This seam §2 |
| Customer emails EN/DE/RU | Client | Out of Director |

---

## 4. Out of scope for this doc

- Editing Client HTML/JS or the Client cloud branch
- Live Stripe keys
- Director AI screens 21–26
- Changing Ops `/api/admin/ops/*`

When Client needs a change to this contract, coordinate via Новый бот; patch this file on `klarraum/director` (PR #16) rather than forking conflicting copies.
