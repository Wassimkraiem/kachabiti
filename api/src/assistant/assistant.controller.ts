import { Body, Controller, Get, Put, Query } from '@nestjs/common';
import { sql } from 'kysely';
import { z } from 'zod';
import { metaConfigured } from '@shared/erp/meta';
import { CurrentActor, Public } from '../auth/decorators';
import type { RequestActor } from '../auth/auth.guard';
import { params, Zod } from '../common/api';
import { Database } from '../db/database';
import { one } from '../db/embed';
import { AssistantService } from './assistant.service';
import { MODEL_PRICES } from './costs';
import { PROMPT_VERSION } from './prompt';

const settingsSchema = z
  .object({
    enabled: z.boolean(),
    channels: z.array(z.enum(['facebook', 'instagram', 'whatsapp'])).max(3),
    monthly_budget_usd: z.number().min(0).max(10_000),
    knowledge: z.string().max(20_000),
    handoff_message: z.string().trim().min(1).max(1000),
    model: z.enum(Object.keys(MODEL_PRICES) as [string, ...string[]]),
    escalation_model: z.enum(
      Object.keys(MODEL_PRICES) as [string, ...string[]],
    ),
  })
  .partial();

/**
 * Admin → Assistant (owners and admins, rule in lib/api-access.ts): the bot's settings, this
 * month's spend, its recent turns and who is waiting for an agent. ?customer_id= lists one
 * customer's turns.
 */
@Controller('admin/assistant')
@Public()
export class AssistantController {
  constructor(
    private readonly db: Database,
    private readonly assistant: AssistantService,
  ) {}

  @Get()
  async get(@Query() query: Record<string, string>) {
    const q = params(query);
    const runs = (limit: number) =>
      this.db
        .selectFrom('assistant_runs as r')
        .selectAll('r')
        .select((eb) =>
          one(
            eb,
            'customers as c',
            ['c.full_name', 'c.phone'],
            'c.id',
            'r.customer_id',
          ).as('customer'),
        )
        .orderBy('r.created_at', 'desc')
        .limit(limit);
    const customerId = q.get('customer_id');
    if (customerId)
      return runs(200).where('r.customer_id', '=', customerId).execute();

    const [settings, spent, recent, waiting, days] = await Promise.all([
      this.assistant.settings(),
      this.assistant.monthSpend(),
      runs(q.int('limit', 100, 500)).execute(),
      this.db
        .selectFrom('customers')
        .select([
          'id',
          'full_name',
          'phone',
          'channel',
          'bot_handoff_reason',
          'bot_handoff_at',
          'assigned_to_email',
        ])
        .where('bot_status', '=', 'human')
        .where('deleted_at', 'is', null)
        .orderBy('bot_handoff_at', 'desc')
        .limit(100)
        .execute(),
      sql<{
        day: string;
        turns: number;
        handoffs: number;
        cost: number;
      }>`select to_char(created_at at time zone 'Africa/Tunis', 'YYYY-MM-DD') as day,
                count(*) filter (where outcome <> 'transcribed')::int as turns,
                count(*) filter (where outcome in ('handoff', 'error'))::int as handoffs,
                sum(cost_usd)::float8 as cost
           from public.assistant_runs
          where created_at > now() - interval '30 days'
          group by 1 order by 1`.execute(this.db),
    ]);
    return {
      settings,
      spent,
      days: days.rows,
      runs: recent,
      waiting,
      prompt_version: PROMPT_VERSION,
      connected: {
        anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
        groq: Boolean(process.env.GROQ_API_KEY),
        langfuse: Boolean(
          process.env.LANGFUSE_PUBLIC_KEY && process.env.LANGFUSE_SECRET_KEY,
        ),
        langfuse_url:
          process.env.LANGFUSE_BASE_URL || 'https://cloud.langfuse.com',
        meta_app_id: Boolean(process.env.META_APP_ID),
        ...metaConfigured(),
      },
    };
  }

  @Put()
  async save(
    @Body(new Zod(settingsSchema)) body: z.infer<typeof settingsSchema>,
    @CurrentActor() actor: RequestActor,
  ) {
    const value = { ...(await this.assistant.settings()), ...body };
    await this.db.withActor(actor, (trx) =>
      trx
        .insertInto('erp_settings')
        .values({ key: 'assistant', value: JSON.stringify(value) })
        .onConflict((oc) =>
          oc
            .column('key')
            .doUpdateSet((eb) => ({ value: eb.ref('excluded.value') })),
        )
        .execute(),
    );
    return value;
  }
}
