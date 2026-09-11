# Shift-close debt recovery: mechanism correction (2026-09-10)

## What was wrong

Debt recovery entered at shift close was recorded as **wage withholding**: the confirmed recovery amount reduced `wage_paid`/`direct_wage_cash_amount`, on the assumption that the employee received *less* than their full earnings. In practice, the owner's actual operating model is different: the employee is always paid their full earnings, and any debt recovery is a **separate cash repayment** handed back afterward. Recording a repayment as a wage reduction silently subtracted it from that same shift's own variance a second time — the repayment was never "missing" money in the first place, so removing it from `wage_paid` understated `total_accounted` by the repayment amount.

When the resulting corrupted variance went negative, the close handler (correctly, on its own terms) treated it as a genuine till shortfall and created a **new** staff debt for it — compounding the error: a real repayment produced a fabricated debt.

## Confirmed on real data

| | Shift 103 | Shift 105 |
|---|---|---|
| True variance (full wage, repayment excluded entirely) | +500.60 | +11.04 |
| Repayment recorded via the old (wrong) mechanism | 120 | 350 |
| Variance as corrupted | +380.60 | **-338.96** |
| Phantom debt created | none (stayed positive) | **debt #20, balance 338.96** |

Both employee-history entries independently confirmed: Mutati's outstanding debt *before* shift 103's recovery was 2,981.31 (captured in that recovery's own preview snapshot). He genuinely repaid 120 + 350 = 470 across the two shifts with no real new shortfall in either. 2,981.31 − 470 = 2,511.31 — exactly what an independent from-scratch recomputation of his current debt produces after the fix below. This cross-check, computed two different ways from two different starting points, is the strongest evidence the correction is right.

## The fix

**Mechanism** (`backend/src/services/shiftSettlement.ts`, `backend/src/routes/shifts.ts`): shift-close recovery is now always a repayment, for every compensation plan type (the previous daily-only restriction is removed, since repayment doesn't depend on how the employee is normally paid):

- `wage_paid`/`direct_wage_cash_amount` are always the full amount entered — recovery never touches them.
- A confirmed recovery is recorded as a `credit_payments` receipt (`payment_type: 'staff_debt'`, no `shift_id`) and allocated against outstanding debt FIFO via `allocateEmployeeDebt`, exactly the mechanism the existing "Collect Payment" flow already uses correctly for debt collected *during* a shift (`employeePay.ts`'s `recordEmployeeDebtReceipt`). The two are deliberately different in one respect: "Collect Payment" mid-shift sets `shift_id`, because that cash is documented to be counted into the shift's own collections; a close-time recovery does not, because it is a separate, personal settlement, not drawer cash for that shift. This is what makes the fix correct: the receipt reduces staff debt and appears in the employee's payment history, but has zero effect on the shift's own variance.
- If a shift's variance is still genuinely negative after this, a staff debt is still created for the real shortfall — unchanged, and no longer entangled with same-shift recovery.

**Data correction** (`backend/scripts/fix_mutati_recovery_103_105.ts`, one transaction, verified via before/after logging plus an independent fresh-connection re-derivation afterward — see script for full detail): reversed both incorrect wage-withholding allocations, restored both shifts' wage fields to 800, re-recorded both repayments as proper receipts against debt #18 (which nets to the identical final balance, 559.32, just via the correct audit trail), voided phantom debt #20, recomputed both shifts' `shift_close_reconciliations` and Mutati's `credit_accounts` mirror. Every correction is also logged in `shift_accountability_adjustments` (both shifts, with before/after variance) and `staff_debt_adjustments` (the phantom debt removal) for permanent audit trail — nothing was hard-deleted. The script reads `../data/nexgen.db` relative to its own location, so it always targets whichever database sits next to it — dry-run by default (prints before/after, then rolls back), `--apply` to commit.

Applied 2026-09-10 and verified against a copy of the station's database pasted into the development machine for this investigation — **not yet applied to the station PC's own live database.** Until it is run there too (as its own explicit step during the next station update, after `npm run migrate`/`audit:*` and before the stack restarts — see `docs/DEPLOYMENT.md`), the station's live data for shifts 103/105 and Mutati's debt still has the old, corrupted numbers. The station's real database was never touched by the investigation, only a copy of it.

## Not yet done

**Run `fix_mutati_recovery_103_105.ts --apply` against the station PC's actual live database.** This is the only remaining step to make the station's real data correct — everything above was verified on a copy only. The script is self-guarded (it aborts without changing anything if the shifts aren't in the exact corrupted state it expects, so it cannot double-apply or silently do the wrong thing), and takes its own dry run first.

`payroll.ts`'s equivalent (non-daily, period-based) recovery mechanism has the same wage-withholding design and should get the same treatment for full consistency across all compensation types, per the stated goal. It has never actually been used (`payroll_debt_allocations` is empty in the live data), so there is no historical data to correct there — only a code change is outstanding. Flagged for a follow-up pass rather than bundled into this one, to keep this correction's scope contained and fully verifiable on its own.

The shared `RecoveryEditor`/`DailyRecovery` UI components were updated minimally (removed the now-inaccurate "cash already paid cannot also repay debt" message and the daily-only gate) but have not had a full UX pass reflecting the new model — the informational "earned/cash paid/existing deductions" line simply no longer renders for shift-close recovery (those fields are no longer populated), which is correct but not yet polished.
