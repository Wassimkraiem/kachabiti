// Chat with the support bot in the terminal, against the database in DATABASE_URL (use the local
// Docker one: create_order really creates orders). Needs `npm run build` first and ANTHROPIC_API_KEY.
//
//   cd api && npm run build && DATABASE_URL=… AUTH_SECRET=… ANTHROPIC_API_KEY=… node scripts/assistant-chat.mjs [channel]
//
// Each line you type is stored as a customer message on a test customer, the bot answers with the
// same code as production (prompt, tools, costs, Langfuse when configured), and the tools it
// called and the cost are printed. Commands: /new (fresh customer), /quit.

import { createInterface } from 'node:readline/promises';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../dist/api/src/app.module.js';
import { AssistantService } from '../dist/api/src/assistant/assistant.service.js';
import { Database } from '../dist/api/src/db/database.js';

const channel = process.argv[2] ?? 'facebook';
const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
const db = app.get(Database);
const assistant = app.get(AssistantService);

async function newCustomer() {
  const row = await db
    .insertInto('customers')
    .values({ full_name: `Test bot ${new Date().toISOString().slice(0, 16)}`, channel, stage: 'new' })
    .returning('id')
    .executeTakeFirstOrThrow();
  console.log(`\nTest customer ${row.id} (Admin → Customers). Type a message:\n`);
  return row.id;
}

let customerId = await newCustomer();
const rl = createInterface({ input: process.stdin, output: process.stdout });
try {
  for (;;) {
    const line = (await rl.question('you> ')).trim();
    if (!line) continue;
    if (line === '/quit') break;
    if (line === '/new') {
      customerId = await newCustomer();
      continue;
    }
    await db
      .insertInto('customer_interactions')
      .values({ customer_id: customerId, channel, direction: 'in', body: line, read_at: new Date() })
      .execute();
    const history = (
      await db
        .selectFrom('customer_interactions')
        .select(['direction', 'body', 'attachments', 'created_at'])
        .where('customer_id', '=', customerId)
        .where('direction', '<>', 'note')
        .where('deleted_at', 'is', null)
        .orderBy('created_at', 'desc')
        .limit(30)
        .execute()
    ).reverse();
    const customer = await db
      .selectFrom('customers')
      .select(['bot_status', 'bot_unclear_count'])
      .where('id', '=', customerId)
      .executeTakeFirstOrThrow();
    if (customer.bot_status !== 'bot') {
      console.log('  (the bot handed this customer over; /new to start again)\n');
      continue;
    }
    const result = await assistant.turn(customerId, channel, history, {
      unclearCount: customer.bot_unclear_count,
    });
    for (const call of result.toolCalls)
      console.log(`  ⚙ ${call.name} ${JSON.stringify(call.input)}\n    → ${JSON.stringify(call.output).slice(0, 300)}`);
    const settings = await assistant.settings();
    const text = result.outcome === 'replied' ? result.reply : `${settings.handoff_message}  [handoff: ${result.handoffReason}]`;
    if (text)
      await db
        .insertInto('customer_interactions')
        .values({ customer_id: customerId, channel, direction: 'out', body: text, by_bot: true, read_at: new Date() })
        .execute();
    console.log(`bot> ${text}\n  ($${result.costUsd.toFixed(5)}, ${result.outcome})\n`);
  }
} finally {
  rl.close();
  await app.close();
}
