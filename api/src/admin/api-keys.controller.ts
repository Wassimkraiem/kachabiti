import { randomBytes, createHash } from 'node:crypto';
import { Body, Controller, Delete, Get, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { ALL_PERMISSIONS, type Permission } from '@shared/admin-auth';
import { AdminOnly, CurrentActor } from '../auth/decorators';
import type { RequestActor } from '../auth/auth.guard';
import { ApiError, Zod } from '../common/api';
import { Database } from '../db/database';

// Permissions a key may carry: everything but permanent deletes (AuthGuard drops it too).
const KEY_PERMISSIONS = ALL_PERMISSIONS.filter((p) => p !== 'hard_delete') as [
  Permission,
  ...Permission[],
];

const createSchema = z.object({
  name: z.string().trim().min(1).max(80),
  permissions: z.array(z.enum(KEY_PERMISSIONS)).min(1),
  expires_in_days: z.number().int().min(1).max(365).default(30),
});

/**
 * Admin → Team → API keys: keys for outside systems (a developer, a customer-support agent). A key
 * acts as a staff member with only its permissions (AuthGuard, header x-api-key). Only its sha256
 * is stored, so the key is returned once, when made. Creating and revoking are in the activity log.
 */
@Controller('admin/team/api-keys')
@AdminOnly()
export class ApiKeysController {
  constructor(private readonly db: Database) {}

  @Get()
  list() {
    return this.db
      .selectFrom('api_keys')
      .select([
        'id',
        'name',
        'prefix',
        'permissions',
        'created_by_email',
        'expires_at',
        'last_used_at',
        'created_at',
      ])
      .where('deleted_at', 'is', null)
      .orderBy('created_at', 'desc')
      .execute();
  }

  /** { name, permissions, expires_in_days } → the key (shown once) and its row. */
  @Post()
  async create(
    @Body(new Zod(createSchema)) body: z.infer<typeof createSchema>,
    @CurrentActor() actor: RequestActor,
  ) {
    const key = `kb_${randomBytes(32).toString('base64url')}`;
    const row = await this.db
      .insertInto('api_keys')
      .values({
        name: body.name,
        prefix: key.slice(0, 10),
        key_hash: createHash('sha256').update(key).digest('hex'),
        permissions: [...new Set(body.permissions)],
        created_by: actor.userId,
        created_by_email: actor.email,
        expires_at: new Date(Date.now() + body.expires_in_days * 86_400_000),
      })
      .returning([
        'id',
        'name',
        'prefix',
        'permissions',
        'expires_at',
        'created_at',
      ])
      .executeTakeFirstOrThrow();
    await this.log(actor, 'create', row.id, row.name);
    return { ...row, key };
  }

  /** ?id= — revokes a key at once (its next request gets 401). */
  @Delete()
  async revoke(
    @Query('id') id: string | undefined,
    @CurrentActor() actor: RequestActor,
  ) {
    if (!id || !z.guid().safeParse(id).success)
      throw new ApiError('Missing id');
    const row = await this.db
      .updateTable('api_keys')
      .set({ deleted_at: new Date() })
      .where('id', '=', id)
      .where('deleted_at', 'is', null)
      .returning(['id', 'name'])
      .executeTakeFirst();
    if (!row) throw new ApiError('This key no longer exists', 404);
    await this.log(actor, 'delete', row.id, row.name);
    return { id: row.id };
  }

  private log(actor: RequestActor, action: string, id: string, name: string) {
    return this.db
      .insertInto('activity_log')
      .values({
        actor_id: actor.userId,
        actor_email: actor.email,
        actor_role: actor.role,
        action,
        entity: 'api_key',
        entity_id: id,
        label: name,
      })
      .execute();
  }
}
