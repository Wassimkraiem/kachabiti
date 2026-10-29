import {
  Injectable,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import * as Sentry from '@sentry/nestjs';
import { sql } from 'kysely';
import {
  downloadMetaMedia,
  sendMetaText,
  type MetaAttachment,
  type MetaChannel,
} from '@shared/erp/meta';
import { putObject, signedUrl } from '../common/storage';
import { Database } from '../db/database';
import { audioCost, costOf } from './costs';
import { KnowledgeService, knowledgeBlock } from './knowledge';
import { PROMPT_VERSION, systemPrompt } from './prompt';
import { HANDOFF_REASONS, LABELS, runTool, TOOLS } from './tools';
import { Trace } from './trace';
import { transcribe, transcriptionConfigured } from './transcribe';

// The support bot (docs/SUPPORT-BOT.md). The Meta webhook stores each message and calls
// received(); this copies the message's files to storage, transcribes voice notes, waits a few
// seconds for the customer's next lines, then answers with Claude and the catalog tools, or hands
// the customer to an agent. One API instance is assumed (the queue lives in memory).

export interface AssistantSettings {
  enabled: boolean;
  channels: string[];
  monthly_budget_usd: number;
  knowledge: string;
  handoff_message: string;
  model: string;
  // Used for the turn after the bot didn't understand, before giving up and handing off.
  escalation_model: string;
  budget_alerts?: { month: string; sent: number[] };
}

const DEFAULTS: AssistantSettings = {
  enabled: false,
  channels: ['facebook'],
  monthly_budget_usd: 20,
  knowledge: '',
  handoff_message: 'Merci 🙏 Nthabet ml ma3louma w narja3lk .',
  model: 'claude-haiku-5-5',
  escalation_model: 'claude-sonnet-5-5',
};

const DEBOUNCE_MS = 4_000;
const HISTORY = 30;
const MAX_STEPS = 6;
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const CONTROL_TOOLS = new Set(['set_label', 'mark_unclear', 'handoff']);

type Attachment = MetaAttachment & {
  key?: string;
  mime?: string;
  transcript?: string;
  seconds?: number;
  error?: string;
};

export interface TurnResult {
  outcome: 'replied' | 'handoff' | 'error';
  reply: string | null;
  handoffReason: string | null;
  costUsd: number;
  toolCalls: { name: string; input: unknown; output: unknown }[];
}

const extension = (mime: string) =>
  mime
    .split('/')[1]
    ?.replace('jpeg', 'jpg')
    .replace(/[^a-z0-9]/g, '') || 'bin';

@Injectable()
export class AssistantService implements OnModuleInit, OnModuleDestroy {
  private readonly client = process.env.ANTHROPIC_API_KEY
    ? new Anthropic()
    : null;
  private readonly timers = new Map<string, NodeJS.Timeout>();
  // One turn at a time per customer, in arrival order.
  private readonly queues = new Map<string, Promise<void>>();

  constructor(
    private readonly db: Database,
    private readonly knowledge: KnowledgeService,
  ) {}

  onModuleInit() {
    // Messages that arrived while the server was restarting get their answer now.
    setTimeout(() => void this.recover(), 10_000).unref();
  }

  onModuleDestroy() {
    for (const timer of this.timers.values()) clearTimeout(timer);
  }

  async settings(): Promise<AssistantSettings> {
    const row = await this.db
      .selectFrom('erp_settings')
      .select('value')
      .where('key', '=', 'assistant')
      .executeTakeFirst();
    return {
      ...DEFAULTS,
      ...((row?.value as Partial<AssistantSettings>) ?? {}),
    };
  }

  /** A new customer message was stored (called by the Meta webhook, not awaited). */
  async received(customerId: string, interactionId: string) {
    try {
      await this.storeAttachments(customerId, interactionId);
    } catch (error) {
      Sentry.captureException(error, { tags: { area: 'assistant-media' } });
    }
    const settings = await this.settings();
    if (!settings.enabled || !this.client) return;
    const timer = this.timers.get(customerId);
    if (timer) clearTimeout(timer);
    this.timers.set(
      customerId,
      setTimeout(() => {
        this.timers.delete(customerId);
        this.enqueue(customerId);
      }, DEBOUNCE_MS),
    );
  }

  private enqueue(customerId: string) {
    const previous = this.queues.get(customerId) ?? Promise.resolve();
    const next = previous
      .then(() => this.respond(customerId))
      .catch((error) => {
        Sentry.captureException(error, { tags: { area: 'assistant' } });
      })
      .finally(() => {
        if (this.queues.get(customerId) === next)
          this.queues.delete(customerId);
      });
    this.queues.set(customerId, next);
  }

  /** Customers whose last message (in the last 10 minutes) has no answer yet. */
  private async recover() {
    try {
      const settings = await this.settings();
      if (!settings.enabled || !this.client) return;
      const rows = await sql<{ customer_id: string }>`
        select distinct on (x.customer_id) x.customer_id, x.direction
          from public.customer_interactions x
          join public.customers c on c.id = x.customer_id
         where x.deleted_at is null and x.direction <> 'note'
           and x.created_at > now() - interval '10 minutes'
           and c.bot_status = 'bot' and c.deleted_at is null
         order by x.customer_id, x.created_at desc`.execute(this.db);
      for (const row of rows.rows as {
        customer_id: string;
        direction: string;
      }[])
        if (row.direction === 'in') this.enqueue(row.customer_id);
    } catch (error) {
      Sentry.captureException(error, { tags: { area: 'assistant-recover' } });
    }
  }

  /** Copies Meta's files to the private bucket and transcribes voice notes. */
  private async storeAttachments(customerId: string, interactionId: string) {
    const row = await this.db
      .selectFrom('customer_interactions')
      .select(['attachments', 'body', 'channel'])
      .where('id', '=', interactionId)
      .executeTakeFirst();
    const attachments = (row?.attachments ?? []) as unknown as Attachment[];
    if (!row || !attachments.some((a) => !a.key && !a.error)) return;
    let body = row.body;
    let seconds = 0;
    for (const [index, attachment] of attachments.entries()) {
      if (attachment.key || attachment.error) continue;
      try {
        const file = await downloadMetaMedia(attachment);
        const key = `conversations/${customerId}/${interactionId}-${index}.${extension(file.mime)}`;
        await putObject('documents', key, file.data, file.mime);
        attachment.key = key;
        attachment.mime = file.mime;
        if (attachment.type === 'audio' && transcriptionConfigured()) {
          const result = await transcribe(file.data, file.mime);
          attachment.transcript = result.text;
          attachment.seconds = result.seconds;
          seconds += result.seconds;
        }
      } catch (error) {
        attachment.error = (error as Error).message.slice(0, 200);
      }
      // Meta's link stops working soon and is not needed once the file is stored.
      delete attachment.url;
    }
    const transcripts = attachments
      .map((a) => a.transcript)
      .filter((t): t is string => Boolean(t));
    if (transcripts.length)
      body = `🎤 ${transcripts.join('\n')}${/^\[[a-z, ]+\]$/.test(body) ? '' : `\n${body}`}`;
    await this.db
      .updateTable('customer_interactions')
      .set({
        attachments: JSON.stringify(attachments),
        body: body.slice(0, 5000),
      })
      .where('id', '=', interactionId)
      .execute();
    if (seconds > 0)
      await this.db
        .insertInto('assistant_runs')
        .values({
          customer_id: customerId,
          channel: row.channel,
          model: 'whisper-large-v3',
          prompt_version: PROMPT_VERSION,
          audio_seconds: seconds,
          cost_usd: audioCost(seconds),
          outcome: 'transcribed',
        })
        .execute();
  }

  private async respond(customerId: string) {
    const settings = await this.settings();
    if (!settings.enabled || !this.client) return;
    const customer = await this.db
      .selectFrom('customers')
      .select([
        'id',
        'phone',
        'external_ids',
        'bot_status',
        'bot_unclear_count',
        'stage',
        'anonymized_at',
      ])
      .where('id', '=', customerId)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    if (!customer || customer.bot_status !== 'bot' || customer.anonymized_at)
      return;
    const history = (
      await this.db
        .selectFrom('customer_interactions')
        .select(['direction', 'body', 'channel', 'attachments', 'created_at'])
        .where('customer_id', '=', customerId)
        .where('deleted_at', 'is', null)
        .where('direction', '<>', 'note')
        .orderBy('created_at', 'desc')
        .limit(HISTORY)
        .execute()
    ).reverse();
    const last = history.at(-1);
    // Someone already answered, or the channel isn't one the bot covers.
    if (!last || last.direction !== 'in') return;
    if (!settings.channels.includes(last.channel)) return;

    const result = await this.turn(customerId, last.channel, history, {
      settings,
      unclearCount: customer.bot_unclear_count,
    });

    const ids = (customer.external_ids ?? {}) as Record<string, string>;
    const channel = last.channel as MetaChannel;
    const recipient =
      channel === 'whatsapp'
        ? (ids.whatsapp ?? (customer.phone ? `216${customer.phone}` : null))
        : ids[channel === 'facebook' ? 'messenger' : 'instagram'];
    const text =
      result.outcome === 'replied' ? result.reply : settings.handoff_message;
    if (text && recipient) {
      try {
        const externalId = await sendMetaText(channel, recipient, text);
        await this.db
          .insertInto('customer_interactions')
          .values({
            customer_id: customerId,
            channel,
            direction: 'out',
            body: text.slice(0, 5000),
            external_id: externalId,
            by_bot: true,
            read_at: new Date(),
          })
          .execute();
      } catch (error) {
        // Meta refused (24-hour window, token…): an agent must take it from here.
        Sentry.captureException(error, { tags: { area: 'assistant-send' } });
        if (result.outcome === 'replied') {
          result.outcome = 'handoff';
          result.handoffReason = 'error';
          await this.handoff(
            customerId,
            'error',
            `The bot's reply could not be sent: ${(error as Error).message}`,
          );
        }
      }
    }
    await this.checkBudget(settings);
  }

  /**
   * One bot turn over a conversation: Claude with the tools until it replies or hands off.
   * Records the run (assistant_runs) and its trace. Used by respond() and the chat script.
   */
  async turn(
    customerId: string,
    channel: string,
    history: {
      direction: string;
      body: string;
      attachments: unknown;
      created_at: unknown;
    }[],
    options: { settings?: AssistantSettings; unclearCount?: number } = {},
  ): Promise<TurnResult> {
    const settings = options.settings ?? (await this.settings());
    const unclearCount = options.unclearCount ?? 0;
    // Second chance with the stronger model when the last turn didn't understand.
    const model = unclearCount > 0 ? settings.escalation_model : settings.model;
    const started = Date.now();
    const trace = new Trace('support-turn', customerId, {
      channel,
      model,
      prompt_version: PROMPT_VERSION,
    });
    const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    const result: TurnResult = {
      outcome: 'error',
      reply: null,
      handoffReason: null,
      costUsd: 0,
      toolCalls: [],
    };
    let error: string | null = null;
    let unclear = false;
    let handoff: { reason: string; summary: string } | null = null;

    try {
      if (!this.client) throw new Error('ANTHROPIC_API_KEY is not set');
      const system: Anthropic.TextBlockParam[] = [
        {
          type: 'text',
          text: systemPrompt(settings.knowledge),
          cache_control: { type: 'ephemeral' },
        },
      ];
      const messages = await this.toMessages(history);
      // Only the knowledge that matches the customer's latest lines, not the whole base.
      const last = messages.at(-1);
      if (last?.role === 'user' && Array.isArray(last.content)) {
        const question = last.content
          .filter((b): b is Anthropic.TextBlockParam => b.type === 'text')
          .map((b) => b.text)
          .join('\n');
        const searched = new Date();
        const hits = await this.knowledge.search(question).catch((e) => {
          Sentry.captureException(e, { tags: { area: 'assistant-knowledge' } });
          return [];
        });
        const block = knowledgeBlock(hits);
        if (block) last.content.unshift({ type: 'text', text: block });
        const found = hits.map((h) => ({
          title: h.title,
          score: h.score,
          found_by: h.found_by,
        }));
        trace.span('knowledge', searched, question, found);
        result.toolCalls.push({
          name: 'knowledge',
          input: { question },
          output: found,
        });
      }
      for (let step = 0; step < MAX_STEPS && !handoff; step++) {
        const start = new Date();
        const response = await this.client.messages.create({
          model,
          max_tokens: 4096,
          system,
          tools: TOOLS,
          messages,
          // Chat replies don't need deep reasoning; this keeps thinking tokens (billed as output) low.
          output_config: { effort: 'low' },
          // Caches the conversation so far, so each tool step reads it instead of paying again.
          cache_control: { type: 'ephemeral' },
        });
        const cost = costOf(model, response.usage);
        result.costUsd += cost;
        usage.input += response.usage.input_tokens;
        usage.output += response.usage.output_tokens;
        usage.cacheRead += response.usage.cache_read_input_tokens ?? 0;
        usage.cacheWrite += response.usage.cache_creation_input_tokens ?? 0;
        trace.generation({
          model,
          start,
          end: new Date(),
          input: step === 0 ? messages : messages.slice(-1),
          output: response.content,
          usage: {
            input: response.usage.input_tokens,
            output: response.usage.output_tokens,
            cacheRead: response.usage.cache_read_input_tokens ?? 0,
            cacheWrite: response.usage.cache_creation_input_tokens ?? 0,
          },
          costUsd: cost,
        });

        if (
          response.stop_reason === 'refusal' ||
          response.stop_reason === 'max_tokens'
        ) {
          handoff = {
            reason: 'unknown',
            summary: `The model stopped (${response.stop_reason}).`,
          };
          break;
        }
        const calls = response.content.filter(
          (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
        );
        if (!calls.length) {
          result.reply =
            response.content
              .filter((b): b is Anthropic.TextBlock => b.type === 'text')
              .map((b) => b.text)
              .join('\n')
              .trim() || null;
          break;
        }
        messages.push({ role: 'assistant', content: response.content });
        const results: Anthropic.ToolResultBlockParam[] = [];
        for (const call of calls) {
          const toolStart = new Date();
          const input = (call.input ?? {}) as Record<string, unknown>;
          let output: unknown;
          try {
            if (CONTROL_TOOLS.has(call.name)) {
              if (call.name === 'handoff') {
                const reason =
                  HANDOFF_REASONS.find((r) => r === input.reason) ?? 'unknown';
                handoff = {
                  reason,
                  summary:
                    typeof input.summary === 'string' ? input.summary : '',
                };
                output = { ok: true };
              } else if (call.name === 'mark_unclear') {
                unclear = true;
                // Already asked once and still unclear: a person takes over.
                if (unclearCount >= 1) {
                  handoff = {
                    reason: 'unclear',
                    summary:
                      'The bot did not understand the customer twice in a row.',
                  };
                }
                output = { ok: true };
              } else {
                const label = LABELS.find((l) => l === input.label);
                if (label) await this.setLabel(customerId, label);
                output = { ok: Boolean(label) };
              }
            } else {
              output = await runTool(this.db, call.name, input, {
                channel,
                customerId,
              });
            }
          } catch (toolError) {
            Sentry.captureException(toolError, {
              tags: { area: 'assistant-tool', tool: call.name },
            });
            output = {
              error: 'This tool failed. Do not retry; hand off if you need it.',
            };
          }
          result.toolCalls.push({ name: call.name, input, output });
          trace.span(call.name, toolStart, input, output);
          results.push({
            type: 'tool_result',
            tool_use_id: call.id,
            content: JSON.stringify(output),
            is_error: Boolean((output as { error?: string })?.error),
          });
        }
        messages.push({ role: 'user', content: results });
      }
      if (!handoff && !result.reply)
        handoff = {
          reason: 'unknown',
          summary: 'The bot ended without a reply.',
        };
    } catch (turnError) {
      error = (turnError as Error).message;
      Sentry.captureException(turnError, { tags: { area: 'assistant' } });
      handoff = {
        reason: 'error',
        summary: `Bot error: ${error.slice(0, 200)}`,
      };
    }

    if (handoff) {
      result.outcome = 'handoff';
      result.handoffReason = handoff.reason;
      result.reply = null;
      await this.handoff(customerId, handoff.reason, handoff.summary);
    } else {
      result.outcome = 'replied';
      await this.db
        .updateTable('customers')
        .set({ bot_unclear_count: unclear ? unclearCount + 1 : 0 })
        .where('id', '=', customerId)
        .execute();
    }
    if (error) result.outcome = 'error';

    trace.end(result.reply ?? handoff, {
      outcome: result.outcome,
      cost_usd: result.costUsd,
    });
    const traceId = await trace.flush();
    await this.db
      .insertInto('assistant_runs')
      .values({
        customer_id: customerId,
        channel,
        model,
        prompt_version: PROMPT_VERSION,
        input_tokens: usage.input,
        output_tokens: usage.output,
        cache_read_tokens: usage.cacheRead,
        cache_write_tokens: usage.cacheWrite,
        cost_usd: result.costUsd,
        latency_ms: Date.now() - started,
        outcome: result.outcome,
        handoff_reason: result.handoffReason,
        reply: result.reply,
        tool_calls: JSON.stringify(result.toolCalls),
        error,
        trace_id: traceId,
      })
      .execute();
    return result;
  }

  /** The stored conversation as Claude messages; photos are attached for the unanswered lines only. */
  private async toMessages(
    history: { direction: string; body: string; attachments: unknown }[],
  ): Promise<Anthropic.MessageParam[]> {
    const lastOut = history.map((h) => h.direction).lastIndexOf('out');
    const messages: Anthropic.MessageParam[] = [];
    for (const [index, item] of history.entries()) {
      const role = item.direction === 'in' ? 'user' : 'assistant';
      if (!messages.length && role === 'assistant') continue;
      const content: Anthropic.ContentBlockParam[] = [];
      const attachments = (item.attachments ?? []) as Attachment[];
      if (role === 'user' && index > lastOut) {
        for (const attachment of attachments) {
          if (
            attachment.type !== 'image' ||
            !attachment.key ||
            !IMAGE_TYPES.includes(attachment.mime ?? '')
          )
            continue;
          try {
            const response = await fetch(
              await signedUrl('documents', attachment.key, 300),
              { signal: AbortSignal.timeout(15_000) },
            );
            if (!response.ok) continue;
            content.push({
              type: 'image',
              source: {
                type: 'base64',
                media_type: attachment.mime as 'image/jpeg',
                data: Buffer.from(await response.arrayBuffer()).toString(
                  'base64',
                ),
              },
            });
          } catch {
            // The photo is described as missing below; the text still goes through.
          }
        }
      }
      const failed = attachments.filter(
        (a) => a.error || (a.type === 'audio' && !a.transcript),
      );
      let text = item.body;
      if (role === 'user' && failed.length && /^\[[a-z, ]+\]$/.test(text))
        text = `[${failed.map((a) => a.type).join(', ')} the bot could not open]`;
      if (/^🎤 /.test(text)) text = `[voice note] ${text.slice(3)}`;
      content.push({ type: 'text', text });
      const previous = messages.at(-1);
      // Consecutive lines from the same side become one turn.
      if (previous?.role === role && Array.isArray(previous.content))
        previous.content.push(...content);
      else messages.push({ role, content });
    }
    return messages;
  }

  private async setLabel(customerId: string, label: string) {
    await this.db
      .updateTable('customers')
      .set({ lead_label: label })
      .where('id', '=', customerId)
      .execute();
    // The pipeline's "interested" stage is set by hand; the bot does it for new contacts.
    if (label === 'interested')
      await this.db
        .updateTable('customers')
        .set({ stage: 'interested' })
        .where('id', '=', customerId)
        .where('stage', '=', 'new')
        .execute();
  }

  async handoff(customerId: string, reason: string, summary: string) {
    await this.db.withActor(null, async (trx) => {
      await trx
        .updateTable('customers')
        .set({
          bot_status: 'human',
          bot_handoff_reason: reason,
          bot_handoff_at: new Date(),
          bot_unclear_count: 0,
        })
        .where('id', '=', customerId)
        .execute();
      await trx
        .insertInto('customer_interactions')
        .values({
          customer_id: customerId,
          channel: 'other',
          direction: 'note',
          body: `🤖 → 👤 (${reason}) ${summary}`.slice(0, 5000),
          by_bot: true,
          read_at: new Date(),
        })
        .execute();
      await this.db.call(
        'notify_bot_handoff',
        { p_customer_id: customerId, p_reason: reason, p_summary: summary },
        trx,
      );
    });
  }

  /** This month's spend (Tunis calendar month) and the 80% / 100% owner alerts, once each. */
  async monthSpend(): Promise<number> {
    const row = await sql<{ spent: number }>`
      select coalesce(sum(cost_usd), 0)::float8 as spent from public.assistant_runs
       where created_at >= date_trunc('month', now() at time zone 'Africa/Tunis') at time zone 'Africa/Tunis'`.execute(
      this.db,
    );
    return Number(row.rows[0]?.spent ?? 0);
  }

  private async checkBudget(settings: AssistantSettings) {
    const budget = Number(settings.monthly_budget_usd) || 0;
    if (budget <= 0) return;
    const spent = await this.monthSpend();
    const month = new Date()
      .toLocaleString('sv', { timeZone: 'Africa/Tunis' })
      .slice(0, 7);
    const sent =
      settings.budget_alerts?.month === month
        ? settings.budget_alerts.sent
        : [];
    const due = [80, 100].filter(
      (p) => spent >= (budget * p) / 100 && !sent.includes(p),
    );
    if (!due.length) return;
    const percent = Math.max(...due);
    await this.db.call('notify_bot_budget', {
      p_spent: spent,
      p_budget: budget,
      p_percent: percent,
    });
    await sql`update public.erp_settings
                 set value = value || jsonb_build_object('budget_alerts', ${JSON.stringify({ month, sent: [...sent, ...due] })}::jsonb)
               where key = 'assistant'`.execute(this.db);
  }
}
