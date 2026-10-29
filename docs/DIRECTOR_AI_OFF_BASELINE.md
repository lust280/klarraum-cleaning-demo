# Director AI OFF baseline (manual shell)

What the **manual Director shell** (PR #16, branch `klarraum/director`) already ships with **AI OFF**. For Klarraum Director AI (`bc-69999fde` and zone screens 21–26).

**Do not edit Director AI files or the Director AI branch from this PR.** Add AI-on behavior on the AI zone branch; treat this file as the contract for what is already hidden / operator-only.

Sources: `SPECIALIST_FIXES.md` B5–B6 / B9 C5, `docs/DIRECTOR_SHELL_CHECKLIST.md`, PR #16.

---

## 1. Nav and chrome — AI UI is absent (hidden, not disabled stubs)

Manual shell:

| Item | AI OFF behavior |
| --- | --- |
| Sidebar / mobile tabs | **Attention · Companies · Support** only |
| «AI settings» nav item | **Not rendered** (not greyed-out) |
| Header «Manual \| AI assist» segmented control | **Not rendered** (B6) |
| Companies table «AI hint» column | **Not rendered** (canon is 12 minus that column) |
| 4th mobile «Settings» tab that only opens AI settings | **Not present** — three tabs only |
| Attention rows Approve / Dismiss / Review / «Handled by AI» / Weekly review entry | **Not present** |

Operator chrome: KlarraumApp + Director subtitle, badges (Attention open count, Support unread), operator card + Sign out. Role copy in UI: **Operator**.

---

## 2. Support = operator typed replies only

- Support list + thread follow manual layout **07** (and mobile 15 / 17).
- Every reply is typed and sent by the operator. **No** AI suggestions, drafts, Approve chip, or auto-send.
- Send stays disabled until there is non-empty operator text.
- Partner Help (Settings → Help) is the other side of the same thread model (B3); Director console is this operator side.
- Support **flag** (Attention) in this demo: unread thread whose latest message is from the partner; opening marks read. No AI escalation queue in the manual shell.

Director AI owns: auto-reply when AI ON, escalation (unknown / money / angry → 24 h), AI log **25**, weekly review **26**, AI settings **21/22**, Attention/Support AI variants **23/24**, etc.

---

## 3. Zone split — what Director AI must own (not already in manual shell)

| Screen / capability | Owner |
| --- | --- |
| Manual Attention / Companies / Support / payments RO / login / nav | **Director** (this baseline) |
| AI settings (21/22), AI assist toggle behavior, auto-reply engine | **Director AI** |
| Support AI thread / auto (23), Attention AI auto (24) | **Director AI** |
| Approve / Dismiss / Review flows | **Director AI** |
| AI log (25), weekly review (26) | **Director AI** |
| Escalation queue + Attention badge for escalations | **Director AI** (Director shell may later show badge when AI ON — not in #16) |

Superseded mocks (do not code): director/05, 06, 08, 09, 10, 14. Reference only: 02, 03.

---

## 4. Unchanged product rules (both zones)

- No live Stripe. Payments panel is read-only SaaS plan + partner Connect status.
- Plans: Starter €49 / 2 · Pro €89 / 5 · Plus €149 / 10; trial Pro ≤ 5 days, no card.
- Director does **not** mutate Ops job status (`docs/OPS_HANDOFF.md`).
- Client booking seam: `docs/DIRECTOR_CLIENT_SEAM.md`.
- Magic link copy: **15 minutes**.

---

## 5. How Director AI should extend without fighting this baseline

1. Prefer **showing** AI nav / toggle / columns when AI ON over leaving permanent disabled controls in the OFF shell.
2. Do not reintroduce Finance/Backup or AI settings into the default OFF nav.
3. Keep Support composer operator-owned when AI OFF; when AI ON, layer draft/Approve/auto-send without removing the ability to fall back to manual.
4. Land AI work on the Director AI branch/PR — not by rewriting `#16` shell files unless the coordinator asks for a shared merge.

Checklist Pass/Fail for the OFF shell lives in `docs/DIRECTOR_SHELL_CHECKLIST.md` on PR #16.
