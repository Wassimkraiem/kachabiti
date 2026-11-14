import { randomUUID } from 'node:crypto';
import {
  Body,
  Controller,
  Delete,
  Get,
  Post,
  Put,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { sql } from 'kysely';
import { z } from 'zod';
import { TICKET_PRIORITIES, TICKET_STATUSES } from '@shared/erp/constants';
import type { RequestActor } from '../auth/auth.guard';
import { CurrentActor, Public } from '../auth/decorators';
import { ApiError, idsFrom, isManager, Zod, zDate, zId } from '../common/api';
import { putObject, signedUrl } from '../common/storage';
import { Database } from '../db/database';
import { IMAGE_TYPES, type Upload } from '../files/files.controllers';
import { memberEmail } from '../sales/commerce';

const ticketSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(5000).nullish(),
  status: z.enum(TICKET_STATUSES).optional(),
  priority: z.enum(TICKET_PRIORITIES).optional(),
  due_date: zDate.nullish(),
  assigned_to: zId.nullish(),
  position: z.number().finite().optional(),
});
const ticketUpdateSchema = ticketSchema.partial().extend({ id: zId });
const commentSchema = z.object({
  ticket_id: zId,
  body: z.string().trim().max(2000).default(''),
});

/**
 * Team tasks (Admin → Team tasks). Open to the whole back office through the /api/admin rule in
 * lib/api-access.ts: everyone sees and moves every ticket; assignment notifications are a trigger.
 */
@Controller('admin/tickets')
@Public()
export class TicketsController {
  constructor(private readonly db: Database) {}

  private async assigneeEmail(id: string) {
    const email = await memberEmail(this.db, id);
    if (!email) throw new ApiError('This person is not on the team.');
    return email;
  }

  /**
   * An owner's ticket assigned to nobody or to themselves is their private note: only that owner
   * sees it (the board, edits, deletes and comments). Assigning it to someone shares it.
   */
  private visibleTo(actor: RequestActor) {
    return sql<boolean>`(team_tickets.created_by = ${actor.userId} or not (
      team_tickets.created_by is not null
      and (team_tickets.assigned_to is null or team_tickets.assigned_to = team_tickets.created_by)
      and team_tickets.created_by in (select user_id from back_office_users where role = 'owner' and deleted_at is null)))`;
  }

  /** 404 for a ticket that is gone or someone else's private note. */
  private async assertVisible(id: string, actor: RequestActor) {
    const ticket = await this.db
      .selectFrom('team_tickets')
      .select('id')
      .where('id', '=', id)
      .where('deleted_at', 'is', null)
      .where(this.visibleTo(actor))
      .executeTakeFirst();
    if (!ticket) throw new ApiError('This task no longer exists.', 404);
  }

  // shortcut: at most 1000 rows, finished ones for 30 days; add paging if a team outgrows it.
  @Get()
  list(@CurrentActor() actor: RequestActor) {
    return this.db
      .selectFrom('team_tickets')
      .selectAll()
      .select((eb) =>
        eb
          .selectFrom('team_ticket_comments as c')
          .select(eb.fn.countAll<number>().as('n'))
          .whereRef('c.ticket_id', '=', 'team_tickets.id')
          .where('c.deleted_at', 'is', null)
          .as('comment_count'),
      )
      .where('deleted_at', 'is', null)
      .where(this.visibleTo(actor))
      .where((eb) =>
        eb.or([
          eb('status', '<>', 'done'),
          eb(
            'done_at',
            '>',
            new Date(Date.now() - 30 * 86_400_000).toISOString(),
          ),
        ]),
      )
      .orderBy('position')
      .limit(1000)
      .execute();
  }

  @Post()
  async create(
    @Body(new Zod(ticketSchema)) body: z.infer<typeof ticketSchema>,
    @CurrentActor() actor: RequestActor,
  ) {
    const assignee = body.assigned_to ?? null;
    const email = assignee ? await this.assigneeEmail(assignee) : null;
    return this.db.withActor(actor, (trx) =>
      trx
        .insertInto('team_tickets')
        .values({
          title: body.title,
          description: body.description || null,
          status: body.status,
          priority: body.priority,
          position: body.position,
          due_date: body.due_date ?? null,
          assigned_to: assignee,
          assigned_to_email: email,
          done_at: body.status === 'done' ? new Date() : null,
          created_by: actor.userId,
          created_by_email: actor.email,
        })
        .returningAll()
        .executeTakeFirstOrThrow(),
    );
  }

  @Put()
  async update(
    @Body(new Zod(ticketUpdateSchema))
    { id, ...body }: z.infer<typeof ticketUpdateSchema>,
    @CurrentActor() actor: RequestActor,
  ) {
    const row: Record<string, unknown> = { ...body };
    if (body.description !== undefined)
      row.description = body.description || null;
    if (body.status)
      row.done_at =
        body.status === 'done' ? sql`coalesce(done_at, now())` : null;
    if (body.assigned_to !== undefined)
      row.assigned_to_email = body.assigned_to
        ? await this.assigneeEmail(body.assigned_to)
        : null;
    const saved = await this.db.withActor(actor, (trx) =>
      trx
        .updateTable('team_tickets')
        .set(row)
        .where('id', '=', id)
        .where('deleted_at', 'is', null)
        .where(this.visibleTo(actor))
        .returningAll()
        .executeTakeFirst(),
    );
    if (!saved) throw new ApiError('This task no longer exists.', 404);
    return saved;
  }

  private canDeleteAny(actor: RequestActor) {
    return isManager(actor) || actor.permissions.includes('delete');
  }

  /** ?id= | ?ids=a,b (the board's "Delete done tasks"). Their author, or the `delete` permission. */
  @Delete()
  async remove(
    @Query() query: Record<string, string>,
    @CurrentActor() actor: RequestActor,
  ) {
    const ids = z.array(zId).min(1).max(1000).parse(idsFrom(query));
    const tickets = await this.db
      .selectFrom('team_tickets')
      .select(['id', 'created_by'])
      .where('id', 'in', ids)
      .where('deleted_at', 'is', null)
      .where(this.visibleTo(actor))
      .execute();
    if (tickets.length === 0)
      throw new ApiError('This task no longer exists.', 404);
    if (
      !this.canDeleteAny(actor) &&
      tickets.some((ticket) => ticket.created_by !== actor.userId)
    )
      throw new ApiError('Only its author can delete this task.', 403);
    await this.db.withActor(actor, (trx) =>
      trx
        .updateTable('team_tickets')
        .set({ deleted_at: new Date() })
        .where(
          'id',
          'in',
          tickets.map((ticket) => ticket.id),
        )
        .execute(),
    );
    return { ids: tickets.map((ticket) => ticket.id) };
  }

  /** A ticket's comments, oldest first; image links last an hour. */
  @Get('comments')
  async comments(
    @Query('ticket_id', new Zod(zId)) ticketId: string,
    @CurrentActor() actor: RequestActor,
  ) {
    await this.assertVisible(ticketId, actor);
    const rows = await this.db
      .selectFrom('team_ticket_comments')
      .selectAll()
      .where('ticket_id', '=', ticketId)
      .where('deleted_at', 'is', null)
      .orderBy('created_at')
      .execute();
    return Promise.all(
      rows.map(async ({ image_path, ...row }) => ({
        ...row,
        image_url: image_path
          ? await signedUrl('documents', image_path, 3600)
          : null,
      })),
    );
  }

  /** multipart/form-data: ticket_id, body and/or an image `file`. */
  @Post('comments')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }),
  )
  async comment(
    @UploadedFile() file: Upload | undefined,
    @Body() fields: Record<string, unknown>,
    @CurrentActor() actor: RequestActor,
  ) {
    const { ticket_id, body } = commentSchema.parse(fields ?? {});
    if (!body && !file) throw new ApiError('Write a comment or add an image.');
    const extension = file && IMAGE_TYPES[file.mimetype];
    if (file && !extension)
      throw new ApiError(
        'Invalid file type. Only JPEG, PNG, WebP, and GIF are allowed.',
      );
    await this.assertVisible(ticket_id, actor);
    const image_path = file
      ? `tickets/${ticket_id}/${randomUUID()}.${extension}`
      : null;
    if (file && image_path)
      await putObject('documents', image_path, file.buffer, file.mimetype);
    return this.db.withActor(actor, (trx) =>
      trx
        .insertInto('team_ticket_comments')
        .values({
          ticket_id,
          body,
          image_path,
          author_id: actor.userId,
          author_email: actor.email,
        })
        .returning('id')
        .executeTakeFirstOrThrow(),
    );
  }

  /** Its author, or the `delete` permission. */
  @Delete('comments')
  async removeComment(
    @Query('id', new Zod(zId)) id: string,
    @CurrentActor() actor: RequestActor,
  ) {
    const comment = await this.db
      .selectFrom('team_ticket_comments')
      .select(['author_id', 'ticket_id'])
      .where('id', '=', id)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    if (!comment) throw new ApiError('This comment no longer exists.', 404);
    await this.assertVisible(comment.ticket_id, actor);
    if (comment.author_id !== actor.userId && !this.canDeleteAny(actor))
      throw new ApiError('Only its author can delete this comment.', 403);
    await this.db.withActor(actor, (trx) =>
      trx
        .updateTable('team_ticket_comments')
        .set({ deleted_at: new Date() })
        .where('id', '=', id)
        .execute(),
    );
    return { id };
  }
}
