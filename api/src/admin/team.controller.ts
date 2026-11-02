import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { hash } from 'bcryptjs';
import { sql, type Kysely } from 'kysely';
import { z } from 'zod';
import {
  ALL_PERMISSIONS,
  DEFAULT_STAFF_PERMISSIONS,
  getAdminRole,
  getPermissions,
  isRoleFromSettings,
  type AdminRole,
  type Permission,
} from '@shared/admin-auth';
import type { RequestActor } from '../auth/auth.guard';
import { AdminOnly, CurrentActor } from '../auth/decorators';
import { ApiError, Zod } from '../common/api';
import { Database } from '../db/database';
import type { DB } from '../db/types';

// Back-office team (owners, admins and staff), now accounts in public.users. Owners and admins
// only (lib/api-access.ts); only owners can make someone an owner or change or delete an owner.

type Row = {
  id: string;
  email: string | null;
  app_metadata: unknown;
  last_sign_in_at: string | null;
  created_at: string;
};
const asUser = (row: Row) => ({
  email: row.email ?? undefined,
  app_metadata: (row.app_metadata ?? {}) as Record<string, unknown>,
});
const member = (row: Row) => ({
  id: row.id,
  email: row.email ?? '',
  role: getAdminRole(asUser(row)),
  permissions: getPermissions(asUser(row)),
  // OWNER_EMAILS owners and ADMIN_EMAILS admins can't be changed from here.
  locked: isRoleFromSettings(asUser(row)),
  last_sign_in_at: row.last_sign_in_at,
  created_at: row.created_at,
});

const role = z.enum(['owner', 'admin', 'staff']);
// Keeps only known permission names.
const permissions = z
  .array(z.string())
  .transform((list) => ALL_PERMISSIONS.filter((p) => list.includes(p)))
  .optional();
const createSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8).max(72).optional().or(z.literal('')),
  role,
  permissions,
});
const updateSchema = z.object({
  id: z.string().uuid(),
  role: role.nullable(),
  permissions,
});

const ownersOnly = () =>
  new ApiError(
    'Only an owner can give the owner role or change an owner.',
    403,
  );
const settingsEmails = () =>
  `${process.env.OWNER_EMAILS ?? ''},${process.env.ADMIN_EMAILS ?? ''}`
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

@Controller('admin/team')
@AdminOnly()
export class TeamController {
  constructor(private readonly db: Database) {}

  private accounts() {
    return this.db
      .selectFrom('users')
      .select(['id', 'email', 'app_metadata', 'last_sign_in_at', 'created_at'])
      .where('deleted_at', 'is', null);
  }

  private async find(id: string) {
    const row = await this.accounts().where('id', '=', id).executeTakeFirst();
    if (!row) throw new ApiError('User not found', 404);
    return row;
  }

  /** back_office_users decides who receives notifications; activity_log records the change. */
  private async record(
    trx: Kysely<DB>,
    actor: RequestActor,
    row: { id: string; email: string | null },
    roleNow: AdminRole | null,
    permissionsNow: Permission[],
    entry: { action: string; changes: Record<string, unknown> },
  ) {
    await (roleNow
      ? trx
          .insertInto('back_office_users')
          .values({
            user_id: row.id,
            email: row.email,
            role: roleNow,
            permissions: permissionsNow,
            deleted_at: null,
          })
          .onConflict((oc) =>
            oc.column('user_id').doUpdateSet({
              email: row.email,
              role: roleNow,
              permissions: permissionsNow,
              deleted_at: null,
            }),
          )
          .execute()
      : trx
          .updateTable('back_office_users')
          .set({ deleted_at: new Date() })
          .where('user_id', '=', row.id)
          .where('deleted_at', 'is', null)
          .execute());
    await trx
      .insertInto('activity_log')
      .values({
        actor_id: actor.userId,
        actor_email: actor.email,
        actor_role: actor.role,
        action: entry.action,
        entity: 'team_member',
        entity_id: row.id,
        label: row.email,
        changes: JSON.stringify(entry.changes),
      })
      .execute();
  }

  /** Signing out a member whose access changed, so the change applies now, not at their next refresh. */
  private revokeSessions(trx: Kysely<DB>, userId: string) {
    return trx
      .updateTable('user_sessions')
      .set({ revoked_at: new Date() })
      .where('user_id', '=', userId)
      .where('revoked_at', 'is', null)
      .execute();
  }

  @Get()
  async list() {
    const emails = settingsEmails();
    const rows = await this.accounts()
      .where((eb) =>
        eb.or([
          eb(sql`app_metadata ->> 'role'`, 'is not', null),
          ...(emails.length
            ? [eb(eb.fn('lower', ['email']), 'in', emails)]
            : []),
        ]),
      )
      .orderBy('created_at')
      .execute();
    return rows.filter((row) => getAdminRole(asUser(row))).map(member);
  }

  /** A new back-office account (confirmed; without a password it is set with "forgot password"). */
  @Post()
  @HttpCode(200)
  async create(
    @CurrentActor() actor: RequestActor,
    @Body(new Zod(createSchema)) body: z.infer<typeof createSchema>,
  ) {
    if (body.role === 'owner' && actor.role !== 'owner') throw ownersOnly();
    // Owners and admins have every permission, so only staff store a list.
    const appMetadata =
      body.role === 'staff'
        ? {
            role: body.role,
            permissions: body.permissions ?? DEFAULT_STAFF_PERMISSIONS,
          }
        : { role: body.role };
    const passwordHash = body.password ? await hash(body.password, 10) : null;
    const created = await this.db
      .withActor(null, async (trx) => {
        const row = await trx
          .insertInto('users')
          .values({
            email: body.email,
            password_hash: passwordHash,
            app_metadata: JSON.stringify(appMetadata),
            email_confirmed_at: new Date(),
          })
          .returning([
            'id',
            'email',
            'app_metadata',
            'last_sign_in_at',
            'created_at',
          ])
          .executeTakeFirstOrThrow();
        const result = member(row);
        await this.record(trx, actor, row, result.role, result.permissions, {
          action: 'create',
          changes: { role: result.role, permissions: result.permissions },
        });
        return result;
      })
      .catch((error: { code?: string }) => {
        if (error?.code === '23505')
          throw new ApiError(
            'An account with this email already exists. Change its role from the list instead.',
            409,
          );
        throw error;
      });
    return created;
  }

  /** A member's role and staff permissions; role null removes back-office access (the account stays). */
  @Put()
  async update(
    @CurrentActor() actor: RequestActor,
    @Body(new Zod(updateSchema)) body: z.infer<typeof updateSchema>,
  ) {
    if (body.id === actor.userId)
      throw new ApiError('You cannot change your own role.');
    const existing = await this.find(body.id);
    const before = asUser(existing);
    const roleBefore = getAdminRole(before);
    if (
      (body.role === 'owner' || roleBefore === 'owner') &&
      actor.role !== 'owner'
    )
      throw ownersOnly();
    if (isRoleFromSettings(before))
      throw new ApiError(
        'This role comes from the OWNER_EMAILS or ADMIN_EMAILS setting. Change it there.',
      );

    const appMetadata: Record<string, unknown> = {
      ...before.app_metadata,
      role: body.role,
    };
    if (body.role === 'staff') {
      // Keep a staff member's list; someone becoming staff starts from the default set.
      appMetadata.permissions =
        body.permissions ??
        (roleBefore === 'staff'
          ? getPermissions(before)
          : DEFAULT_STAFF_PERMISSIONS);
    } else {
      delete appMetadata.permissions;
    }
    return this.db.withActor(null, async (trx) => {
      const row = await trx
        .updateTable('users')
        .set({ app_metadata: JSON.stringify(appMetadata) })
        .where('id', '=', body.id)
        .returning([
          'id',
          'email',
          'app_metadata',
          'last_sign_in_at',
          'created_at',
        ])
        .executeTakeFirstOrThrow();
      const result = member(row);
      await this.record(trx, actor, row, result.role, result.permissions, {
        action: body.role === null ? 'remove_access' : 'update',
        changes: {
          role: { from: roleBefore, to: body.role },
          permissions: {
            from: roleBefore ? getPermissions(before) : [],
            to: appMetadata.permissions ?? null,
          },
        },
      });
      await this.revokeSessions(trx, body.id);
      return result;
    });
  }

  /** Soft-deletes a back-office account: it can no longer sign in; its history stays. */
  @Delete()
  async remove(
    @CurrentActor() actor: RequestActor,
    @Query('id') id: string | undefined,
  ) {
    if (!id || !z.string().uuid().safeParse(id).success)
      throw new ApiError('Missing id');
    if (id === actor.userId)
      throw new ApiError('You cannot delete your own account.');
    const existing = await this.find(id);
    const before = asUser(existing);
    if (getAdminRole(before) === 'owner' && actor.role !== 'owner')
      throw ownersOnly();
    if (isRoleFromSettings(before))
      throw new ApiError(
        'This role comes from the OWNER_EMAILS or ADMIN_EMAILS setting. Remove it there first.',
      );

    const appMetadata: Record<string, unknown> = {
      ...before.app_metadata,
      role: null,
    };
    delete appMetadata.permissions;
    await this.db.withActor(null, async (trx) => {
      await trx
        .updateTable('users')
        .set({
          app_metadata: JSON.stringify(appMetadata),
          deleted_at: new Date(),
        })
        .where('id', '=', id)
        .execute();
      await this.record(trx, actor, existing, null, [], {
        action: 'delete',
        changes: { role: { from: getAdminRole(before), to: null } },
      });
      await this.revokeSessions(trx, id);
    });
    return null;
  }
}
