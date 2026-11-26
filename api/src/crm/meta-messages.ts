import { sql } from 'kysely';
import type { IncomingMessage } from '@shared/erp/meta';
import type { RequestActor } from '../auth/auth.guard';
import { ApiError, isManager } from '../common/api';
import { Database } from '../db/database';

/** Stores a message on its customer, once. `id` is undefined when it was there already. */
export async function keepMessage(
  trx: Database,
  message: IncomingMessage,
  readAt: Date | null,
) {
  // The webhook and the import may meet the same new person: one record.
  await sql`select pg_advisory_xact_lock(hashtext(${`${message.channel}:${message.senderId}`}))`.execute(
    trx,
  );
  const customerId = await customerFor(trx, message);
  const row = await trx
    .insertInto('customer_interactions')
    .values({
      customer_id: customerId,
      channel: message.channel,
      direction: message.direction,
      body: message.text.slice(0, 5000),
      attachments: message.attachments.length
        ? JSON.stringify(message.attachments)
        : null,
      external_id: message.externalId,
      sender_name: message.senderName,
      created_at: message.sentAt,
      read_at: readAt,
    })
    .onConflict((oc) => oc.columns(['channel', 'external_id']).doNothing())
    .returning('id')
    .executeTakeFirst();
  if (row)
    await trx
      .updateTable('customers')
      .set({ updated_at: new Date() })
      .where('id', '=', customerId)
      .execute();
  return { id: row?.id, customer_id: customerId };
}

async function customerFor(
  trx: Database,
  message: IncomingMessage,
): Promise<string> {
  const key = message.channel === 'facebook' ? 'messenger' : message.channel;
  const byId = await trx
    .selectFrom('customers')
    .select('id')
    .where(
      sql<boolean>`external_ids @> ${JSON.stringify({ [key]: message.senderId })}::jsonb`,
    )
    .where('deleted_at', 'is', null)
    .limit(1)
    .executeTakeFirst();
  if (byId) return byId.id;

  let phone: string | null = null;
  if (message.phone) {
    phone =
      (
        await sql<{
          p: string | null;
        }>`select public.normalize_phone(${message.phone}) as p`.execute(trx)
      ).rows[0]?.p ?? null;
    if (phone) {
      const byPhone = await trx
        .selectFrom('customers')
        .select(['id', 'external_ids'])
        .where('phone', '=', phone)
        .where('deleted_at', 'is', null)
        .executeTakeFirst();
      if (byPhone) {
        await trx
          .updateTable('customers')
          .set({
            external_ids: JSON.stringify({
              ...((byPhone.external_ids as object) ?? {}),
              [key]: message.senderId,
            }),
          })
          .where('id', '=', byPhone.id)
          .execute();
        return byPhone.id;
      }
    }
  }
  const created = await trx
    .insertInto('customers')
    .values({
      phone,
      full_name: message.senderName ?? '',
      channel: message.channel,
      stage: 'new',
      external_ids: JSON.stringify({ [key]: message.senderId }),
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return created.id;
}

/**
 * Gives an unassigned customer to whoever answers them. Someone else's customer is refused, except
 * to owners and admins (who leave it assigned as it is, or `take` it).
 */
export async function claimCustomer(
  db: Database,
  actor: RequestActor,
  customerId: string,
  take = false,
) {
  const claimed = await db.withActor(actor, (trx) => {
    let query = trx
      .updateTable('customers')
      .set({ assigned_to: actor.userId, assigned_to_email: actor.email })
      .where('id', '=', customerId)
      .where('deleted_at', 'is', null);
    query = take
      ? query.where((eb) =>
          eb.or([
            eb('assigned_to', 'is', null),
            eb('assigned_to', '!=', actor.userId),
          ]),
        )
      : query.where('assigned_to', 'is', null);
    return query.returning('assigned_to_email').executeTakeFirst();
  });
  if (claimed) return claimed;
  const current = await db
    .selectFrom('customers')
    .select(['assigned_to', 'assigned_to_email'])
    .where('id', '=', customerId)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();
  if (!current) throw new ApiError('This customer no longer exists.', 404);
  if (current.assigned_to !== actor.userId && !isManager(actor))
    throw new ApiError(
      'This conversation is assigned to another agent.',
      409,
      'ASSIGNED',
      { assigned_to_email: current.assigned_to_email },
    );
  return { assigned_to_email: current.assigned_to_email };
}
