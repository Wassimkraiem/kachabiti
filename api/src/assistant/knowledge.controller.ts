import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Post,
  Query,
} from '@nestjs/common';
import { z } from 'zod';
import { CurrentActor, Public } from '../auth/decorators';
import type { RequestActor } from '../auth/auth.guard';
import { ApiError, idsFrom, Zod } from '../common/api';
import { Database } from '../db/database';
import {
  EMBEDDING_MODEL,
  embeddingsConfigured,
  KnowledgeService,
} from './knowledge';

const entrySchema = z.object({
  kind: z.enum(['faq', 'doc']),
  title: z.string().trim().min(1).max(500),
  content: z.string().trim().min(1).max(100_000),
  language: z.enum(['darija', 'ar', 'fr', 'en']).nullable().optional(),
  active: z.boolean().optional(),
});
const saveSchema = entrySchema.extend({ id: z.guid().nullable().optional() });
const importSchema = z.object({
  entries: z.array(entrySchema).min(1).max(500),
});

/**
 * Admin → Support bot → Knowledge (owners and admins, like the rest of /api/admin/assistant in
 * lib/api-access.ts): the Q&A and documents the bot searches for each customer message.
 */
@Controller('admin/assistant/knowledge')
@Public()
export class KnowledgeController {
  constructor(
    private readonly db: Database,
    private readonly knowledge: KnowledgeService,
  ) {}

  @Get()
  async list() {
    const entries = await this.db
      .selectFrom('knowledge_entries as e')
      .select([
        'e.id',
        'e.kind',
        'e.title',
        'e.content',
        'e.language',
        'e.active',
        'e.updated_at',
        'e.created_by_email',
      ])
      .select((eb) => [
        eb
          .selectFrom('knowledge_chunks as c')
          .whereRef('c.entry_id', '=', 'e.id')
          .select((c) => c.fn.countAll<number>().as('n'))
          .as('chunks'),
        eb
          .selectFrom('knowledge_chunks as c')
          .whereRef('c.entry_id', '=', 'e.id')
          .where('c.embedding_model', '=', EMBEDDING_MODEL)
          .select((c) => c.fn.countAll<number>().as('n'))
          .as('embedded'),
      ])
      .where('e.deleted_at', 'is', null)
      .orderBy('e.updated_at', 'desc')
      .execute();
    return {
      entries: entries.map((e) => ({
        ...e,
        chunks: Number(e.chunks),
        embedded: Number(e.embedded),
      })),
      embeddings: {
        configured: embeddingsConfigured(),
        model: EMBEDDING_MODEL,
      },
    };
  }

  @Post()
  @HttpCode(200)
  save(
    @Body(new Zod(saveSchema)) body: z.infer<typeof saveSchema>,
    @CurrentActor() actor: RequestActor,
  ) {
    const { id, ...entry } = body;
    return this.knowledge.save(id ?? null, entry, actor);
  }

  /** Many entries at once (a CSV of questions and answers, or several documents). */
  @Post('import')
  @HttpCode(200)
  async import(
    @Body(new Zod(importSchema)) body: z.infer<typeof importSchema>,
    @CurrentActor() actor: RequestActor,
  ) {
    let saved = 0;
    const warnings = new Set<string>();
    for (const entry of body.entries) {
      const result = await this.knowledge.save(null, entry, actor);
      saved += 1;
      if (result.warning) warnings.add(result.warning);
    }
    return { saved, warnings: [...warnings] };
  }

  /** Embeds the chunks that have no embedding yet (after adding VOYAGE_API_KEY, or a failed call). */
  @Post('embed')
  @HttpCode(200)
  async embed() {
    if (!embeddingsConfigured())
      throw new ApiError('Add VOYAGE_API_KEY to the server environment first');
    try {
      return await this.knowledge.embedMissing();
    } catch (error) {
      throw new ApiError((error as Error).message, 502);
    }
  }

  @Delete()
  async remove(
    @Query() query: { ids?: string },
    @CurrentActor() actor: RequestActor,
  ) {
    const ids = idsFrom(query);
    if (!ids.length) throw new ApiError('No entry selected');
    await this.knowledge.remove(ids, actor);
    return { removed: ids.length };
  }

  /** What the bot would get for a message: to check the knowledge answers what customers ask. */
  @Get('search')
  search(@Query('q') q = '') {
    return this.knowledge.search(q);
  }
}
