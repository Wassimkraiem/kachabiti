import {
  Body,
  Controller,
  Delete,
  Get,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { z } from 'zod';
import type { RequestActor } from '../auth/auth.guard';
import { CurrentActor, Public } from '../auth/decorators';
import { ApiError, Zod, zId } from '../common/api';
import { Database } from '../db/database';

const replySchema = z.object({
  title: z.string().trim().min(1).max(80),
  body: z.string().trim().min(1).max(2000),
  position: z.number().int().min(0).max(10_000).optional(),
});
const updateSchema = replySchema.partial().extend({ id: zId });

/** Admin → Messenger → Saved replies, shared by the team. Access: lib/api-access.ts (customers; deleting: delete). */
@Controller('crm/replies')
@Public()
export class SavedRepliesController {
  constructor(private readonly db: Database) {}

  @Get()
  list() {
    return this.db
      .selectFrom('saved_replies')
      .select(['id', 'title', 'body', 'position'])
      .where('deleted_at', 'is', null)
      .orderBy('position')
      .orderBy('created_at')
      .execute();
  }

  @Post()
  create(
    @Body(new Zod(replySchema)) body: z.infer<typeof replySchema>,
    @CurrentActor() actor: RequestActor,
  ) {
    return this.db.withActor(actor, async (trx) => {
      // A new one goes last unless told otherwise.
      const last = await trx
        .selectFrom('saved_replies')
        .select((eb) => eb.fn.max('position').as('n'))
        .where('deleted_at', 'is', null)
        .executeTakeFirst();
      return trx
        .insertInto('saved_replies')
        .values({
          position: Number(last?.n ?? -1) + 1,
          ...body,
          created_by: actor.userId,
          created_by_email: actor.email,
        })
        .returning(['id', 'title', 'body', 'position'])
        .executeTakeFirstOrThrow();
    });
  }

  @Put()
  async update(
    @Body(new Zod(updateSchema)) body: z.infer<typeof updateSchema>,
    @CurrentActor() actor: RequestActor,
  ) {
    const { id, ...values } = body;
    const row = await this.db.withActor(actor, (trx) =>
      trx
        .updateTable('saved_replies')
        .set(values)
        .where('id', '=', id)
        .where('deleted_at', 'is', null)
        .returning(['id', 'title', 'body', 'position'])
        .executeTakeFirst(),
    );
    if (!row) throw new ApiError('This saved reply no longer exists.', 404);
    return row;
  }

  @Delete()
  async remove(
    @Query('id') id: string | undefined,
    @CurrentActor() actor: RequestActor,
  ) {
    if (!id || !zId.safeParse(id).success) throw new ApiError('Missing id');
    await this.db.withActor(actor, (trx) =>
      trx
        .updateTable('saved_replies')
        .set({ deleted_at: new Date() })
        .where('id', '=', id)
        .execute(),
    );
    return { id };
  }
}
