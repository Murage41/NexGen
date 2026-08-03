import type { Knex } from 'knex';

export type ShiftReviewStatus = 'pending_review' | 'reviewed' | 'flagged';

export interface ShiftReviewActor {
  employeeId?: number | null;
  role?: string | null;
}

export interface UpdateShiftReviewInput {
  status: Exclude<ShiftReviewStatus, 'pending_review'>;
  notes?: string | null;
  actor?: ShiftReviewActor;
}

function reviewError(message: string, httpStatus: number, code: string) {
  return Object.assign(new Error(message), { httpStatus, code });
}

export async function getShiftReview(
  connection: Knex | Knex.Transaction,
  shiftId: number,
) {
  return connection('shift_reviews')
    .leftJoin('employees as reviewer', 'shift_reviews.reviewed_by_employee_id', 'reviewer.id')
    .where('shift_reviews.shift_id', shiftId)
    .select('shift_reviews.*', 'reviewer.name as reviewed_by_name')
    .first();
}

export async function updateShiftReview(
  connection: Knex,
  shiftId: number,
  input: UpdateShiftReviewInput,
) {
  return connection.transaction(async (trx) => {
    const shift = await trx('shifts').where({ id: shiftId }).select('id', 'status', 'end_time').first();
    if (!shift) throw reviewError('Shift not found', 404, 'SHIFT_NOT_FOUND');
    if (shift.status !== 'closed') {
      throw reviewError('Only closed shifts can be reviewed.', 400, 'SHIFT_NOT_CLOSED');
    }

    let current = await trx('shift_reviews').where({ shift_id: shiftId }).first();
    if (!current) {
      const initialTime = shift.end_time || new Date().toISOString();
      await trx('shift_reviews').insert({
        shift_id: shiftId,
        review_status: 'pending_review',
        created_at: initialTime,
        updated_at: initialTime,
      });
      current = await trx('shift_reviews').where({ shift_id: shiftId }).first();
    }

    if (current.review_status === input.status) {
      throw reviewError(`Shift is already ${input.status.replace('_', ' ')}.`, 409, 'REVIEW_NO_CHANGE');
    }

    const notes = String(input.notes || '').trim();
    if (input.status === 'flagged' && notes.length < 3) {
      throw reviewError('A reason is required when flagging a shift.', 400, 'FLAG_REASON_REQUIRED');
    }
    if (current.review_status === 'flagged' && input.status === 'reviewed' && notes.length < 3) {
      throw reviewError('Record how the flagged issue was resolved.', 400, 'RESOLUTION_REQUIRED');
    }

    const changedAt = new Date().toISOString();
    const actorId = Number(input.actor?.employeeId || 0) > 0
      ? Number(input.actor?.employeeId)
      : null;
    const actorRole = input.actor?.role || 'admin';

    await trx('shift_reviews').where({ shift_id: shiftId }).update({
      review_status: input.status,
      notes: notes || null,
      reviewed_by_employee_id: actorId,
      reviewed_by_role: actorRole,
      reviewed_at: changedAt,
      updated_at: changedAt,
    });
    await trx('shift_review_events').insert({
      shift_id: shiftId,
      from_status: current.review_status,
      to_status: input.status,
      notes: notes || null,
      actor_employee_id: actorId,
      actor_role: actorRole,
      created_at: changedAt,
    });

    return getShiftReview(trx, shiftId);
  });
}
