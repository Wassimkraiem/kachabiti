import {
  Body,
  Controller,
  Delete,
  Get,
  Patch,
  Post,
  Put,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import {
  ACCOUNT_TYPES,
  BILL_CATEGORIES,
  BILL_CATEGORY_ACCOUNTS,
  FIXED_CATEGORIES,
  JOURNALS,
  TREASURY_CATEGORIES,
} from '@shared/erp/constants';
import { CurrentActor, Public } from '../auth/decorators';
import type { RequestActor } from '../auth/auth.guard';
import {
  ApiError,
  isManager,
  params,
  Raw,
  Zod,
  zDate,
  zId,
  zMoney,
} from '../common/api';
import { Database } from '../db/database';
import { many, one } from '../db/embed';

// Ports of app/api/finance/* except documents (files move with phase 4). Rules: `finance`.

const today = () => new Date().toISOString().slice(0, 10);
const round = (n: number) => Math.round(n * 1000) / 1000;

// ── Journal ──

const accountCode = z
  .string()
  .trim()
  .regex(/^[1-7][0-9A-Za-z]*$/, 'Invalid account');
const lineSchema = z.object({
  account: accountCode,
  label: z.string().trim().max(300).default(''),
  debit: z.number().min(0).max(1_000_000_000).default(0),
  credit: z.number().min(0).max(1_000_000_000).default(0),
  partner_name: z.string().trim().max(150).optional(),
});
const journalAction = z.discriminatedUnion('action', [
  // Post (validate) drafts: by ids, or every draft up to a date.
  z.object({
    action: z.literal('post'),
    ids: z.array(zId).max(5000).optional(),
    until: zDate.optional(),
  }),
  // Create or edit (draft only) a hand-written entry.
  z.object({
    action: z.literal('save'),
    id: zId.optional(),
    journal: z.enum(JOURNALS),
    entry_date: zDate,
    label: z.string().trim().min(1).max(300),
    lines: z.array(lineSchema).min(2).max(200),
  }),
  z.object({ action: z.literal('reverse'), id: zId, date: zDate.optional() }),
  // Remove a draft (automatic drafts come back if their event happens again).
  z.object({ action: z.literal('discard'), id: zId }),
  // Period end: bring the stock accounts to the stock's value.
  z.object({ action: z.literal('stock_variation'), date: zDate }),
]);

const ENTRY_COLUMNS = [
  'e.id',
  'e.journal',
  'e.number',
  'e.entry_date',
  'e.label',
  'e.source_type',
  'e.source_id',
  'e.source_event',
  'e.status',
  'e.posted_at',
  'e.posted_by_email',
  'e.reversal_of',
  'e.reversed_at',
  'e.created_by_email',
  'e.created_at',
] as const;
const LINE_COLUMNS = [
  'l.id',
  'l.account_code',
  'l.label',
  'l.debit',
  'l.credit',
  'l.partner_type',
  'l.partner_id',
  'l.partner_name',
  'l.position',
];

@Controller('finance/accounting')
@Public()
export class AccountingController {
  constructor(private readonly db: Database) {}

  /** ?id= | list: ?journal=&status=&from=&to=&account=&q=&source_type=&page=&size= */
  @Get()
  async get(@Query() query: Record<string, string>) {
    const q = params(query);
    const id = q.get('id');
    const account = q.get('account');
    // With an account, entries that have a line on it, showing those lines (PostgREST's !inner).
    const linesOf = (eb: any) =>
      many(
        eb,
        'journal_lines as l',
        LINE_COLUMNS,
        'l.entry_id',
        'e.id',
        (q2) =>
          account ? q2.where('l.account_code', 'like', `${account}%`) : q2,
      ).as('lines');
    if (id) {
      const entry = await this.db
        .selectFrom('journal_entries as e')
        .select(ENTRY_COLUMNS)
        .select(linesOf)
        .where('e.id', '=', id)
        .where('e.deleted_at', 'is', null)
        .executeTakeFirst();
      if (!entry) throw new ApiError('This entry no longer exists.', 404);
      return entry;
    }
    const page = q.int('page', 1, 100_000);
    const size = q.int('size', 50, 500);
    let filtered = this.db
      .selectFrom('journal_entries as e')
      .where('e.deleted_at', 'is', null);
    if (account) {
      filtered = filtered.where((eb) =>
        eb.exists(
          eb
            .selectFrom('journal_lines as l')
            .select('l.id')
            .whereRef('l.entry_id', '=', 'e.id')
            .where('l.account_code', 'like', `${account}%`),
        ),
      );
    }
    if (q.get('journal'))
      filtered = filtered.where('e.journal', '=', q.get('journal')!);
    if (q.get('status'))
      filtered = filtered.where('e.status', '=', q.get('status')!);
    if (q.get('source_type'))
      filtered = filtered.where('e.source_type', '=', q.get('source_type')!);
    if (q.get('from'))
      filtered = filtered.where('e.entry_date', '>=', q.get('from')!);
    if (q.get('to'))
      filtered = filtered.where('e.entry_date', '<=', q.get('to')!);
    const term = q.get('q')?.replace(/[%,()]/g, ' ');
    if (term)
      filtered = filtered.where((eb) =>
        eb.or([
          eb('e.label', 'ilike', `%${term}%`),
          eb('e.number', 'ilike', `%${term}%`),
        ]),
      );
    const [rows, count, drafts] = await Promise.all([
      filtered
        .select(ENTRY_COLUMNS)
        .select(linesOf)
        .orderBy('e.entry_date', 'desc')
        .orderBy('e.created_at', 'desc')
        .limit(size)
        .offset((page - 1) * size)
        .execute(),
      filtered
        .select((eb) => eb.fn.countAll<number>().as('n'))
        .executeTakeFirstOrThrow(),
      this.db
        .selectFrom('journal_entries')
        .select((eb) => eb.fn.countAll<number>().as('n'))
        .where('deleted_at', 'is', null)
        .where('status', '=', 'draft')
        .executeTakeFirstOrThrow(),
    ]);
    return { rows, total: count.n, page, size, drafts: drafts.n };
  }

  @Post()
  async act(
    @Body(new Zod(journalAction)) body: z.infer<typeof journalAction>,
    @CurrentActor() actor: RequestActor,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.status(body.action === 'save' && !body.id ? 201 : 200);
    if (body.action === 'post') {
      let ids = body.ids ?? [];
      if (!body.ids) {
        let drafts = this.db
          .selectFrom('journal_entries')
          .select('id')
          .where('status', '=', 'draft')
          .where('deleted_at', 'is', null);
        if (body.until) drafts = drafts.where('entry_date', '<=', body.until);
        ids = (await drafts.limit(5000).execute()).map((e) => e.id);
      }
      if (!ids.length) return { posted: 0 };
      const posted = await this.db.withActor(actor, (trx) =>
        this.db.call(
          'post_journal_entries',
          { p_ids: ids, p_actor: actor.userId, p_actor_email: actor.email },
          trx,
        ),
      );
      return { posted };
    }
    if (body.action === 'save') {
      const debit = body.lines.reduce((s, l) => s + l.debit, 0);
      const credit = body.lines.reduce((s, l) => s + l.credit, 0);
      if (Math.abs(debit - credit) > 0.0005 || debit === 0)
        throw new ApiError('Debits and credits must be equal (and not zero).');
      const accounts = [...new Set(body.lines.map((l) => l.account))];
      const known = await this.db
        .selectFrom('accounts')
        .select('code')
        .where('code', 'in', accounts)
        .where('deleted_at', 'is', null)
        .execute();
      const missing = accounts.filter((a) => !known.some((k) => k.code === a));
      if (missing.length)
        throw new ApiError(
          `Unknown account(s): ${missing.join(', ')}. Add them to the chart of accounts first.`,
        );
      return this.db.withActor(actor, (trx) =>
        this.db.call(
          'save_manual_entry',
          {
            p_id: body.id ?? null,
            p_entry: {
              journal: body.journal,
              entry_date: body.entry_date,
              label: body.label,
            },
            p_lines: body.lines,
            p_actor: actor.userId,
            p_actor_email: actor.email,
          },
          trx,
        ),
      );
    }
    if (body.action === 'reverse') {
      const id = await this.db.withActor(actor, (trx) =>
        this.db.call(
          'reverse_journal_entry',
          {
            p_id: body.id,
            p_date: body.date ?? null,
            p_actor: actor.userId,
            p_actor_email: actor.email,
          },
          trx,
        ),
      );
      return { id };
    }
    if (body.action === 'discard') {
      const entry = await this.db
        .selectFrom('journal_entries')
        .select('status')
        .where('id', '=', body.id)
        .where('deleted_at', 'is', null)
        .executeTakeFirst();
      if (!entry) throw new ApiError('This entry no longer exists.', 404);
      if (entry.status !== 'draft')
        throw new ApiError(
          'This entry is posted and can no longer change. Reverse it instead.',
          409,
        );
      await this.db.withActor(actor, (trx) =>
        trx
          .updateTable('journal_entries')
          .set({ deleted_at: new Date() })
          .where('id', '=', body.id)
          .execute(),
      );
      return { id: body.id };
    }
    return this.db.withActor(actor, (trx) =>
      this.db.call(
        'book_stock_variation',
        {
          p_date: body.date,
          p_actor: actor.userId,
          p_actor_email: actor.email,
        },
        trx,
      ),
    );
  }
}

// ── Chart of accounts and accounting settings ──

const accountSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^[1-7][0-9A-Za-z]{0,9}$/, 'Codes start with the class (1-7)'),
  name: z.string().trim().min(1).max(150),
  name_en: z.string().trim().max(150).nullable().optional(),
  name_ar: z.string().trim().max(150).nullable().optional(),
  type: z.enum(ACCOUNT_TYPES),
  is_active: z.boolean().default(true),
});
const accountUpdate = accountSchema.partial().required({ code: true });
const settingsSchema = z
  .object({
    start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    auto_post: z.boolean(),
    vat_registered: z.boolean(),
    sales_vat_rate: z.number().min(0).max(100),
    invoice_stamp: z.number().min(0).max(100),
    company: z
      .object({
        name: z.string().trim().max(150),
        tax_id: z.string().trim().max(50),
        address: z.string().trim().max(300),
        phone: z.string().trim().max(50),
        email: z.string().trim().max(150),
        rc: z.string().trim().max(50),
      })
      .partial(),
    accounts: z.record(z.string(), accountCode),
  })
  .partial();

@Controller('finance/accounts')
@Public()
export class AccountsController {
  constructor(private readonly db: Database) {}

  /** The accounts; ?settings=1 — the settings. */
  @Get()
  async get(@Query() query: Record<string, string>) {
    if (params(query).bool('settings')) {
      const row = await this.db
        .selectFrom('erp_settings')
        .select(['value', 'updated_at'])
        .where('key', '=', 'accounting')
        .executeTakeFirst();
      return row ?? { value: {} };
    }
    return this.db
      .selectFrom('accounts')
      .selectAll()
      .where('deleted_at', 'is', null)
      .orderBy('code')
      .execute();
  }

  @Post()
  async create(
    @Body(new Zod(accountSchema)) body: z.infer<typeof accountSchema>,
    @CurrentActor() actor: RequestActor,
  ) {
    const existing = await this.db
      .selectFrom('accounts')
      .select(['code', 'deleted_at'])
      .where('code', '=', body.code)
      .executeTakeFirst();
    if (existing && !existing.deleted_at)
      throw new ApiError('This account code already exists.', 409);
    return this.db.withActor(actor, (trx) =>
      existing
        ? trx
            .updateTable('accounts')
            .set({ ...body, deleted_at: null })
            .where('code', '=', body.code)
            .returningAll()
            .executeTakeFirstOrThrow()
        : trx
            .insertInto('accounts')
            .values(body)
            .returningAll()
            .executeTakeFirstOrThrow(),
    );
  }

  @Put()
  async update(
    @Body(new Zod(accountUpdate)) body: z.infer<typeof accountUpdate>,
    @CurrentActor() actor: RequestActor,
  ) {
    const { code, ...row } = body;
    const saved = await this.db.withActor(actor, (trx) =>
      trx
        .updateTable('accounts')
        .set(row)
        .where('code', '=', code)
        .where('deleted_at', 'is', null)
        .returningAll()
        .executeTakeFirst(),
    );
    if (!saved) throw new ApiError('This account no longer exists.', 404);
    return saved;
  }

  /** Settings (owners and admins, or finance staff for everything but the start date). */
  @Patch()
  async settings(
    @Body(new Zod(settingsSchema)) body: z.infer<typeof settingsSchema>,
    @CurrentActor() actor: RequestActor,
  ) {
    if (body.start_date && !isManager(actor))
      throw new ApiError(
        'Only owners and admins can move the start date of the books.',
        403,
      );
    if (body.accounts) {
      const codes = [...new Set(Object.values(body.accounts))];
      const known = await this.db
        .selectFrom('accounts')
        .select('code')
        .where('code', 'in', codes)
        .where('deleted_at', 'is', null)
        .execute();
      const missing = codes.filter((c) => !known.some((k) => k.code === c));
      if (missing.length)
        throw new ApiError(`Unknown account(s): ${missing.join(', ')}`);
    }
    const current = await this.db
      .selectFrom('erp_settings')
      .select('value')
      .where('key', '=', 'accounting')
      .executeTakeFirst();
    const value = (current?.value ?? {}) as Record<string, any>;
    const next = {
      ...value,
      ...body,
      company: { ...(value.company ?? {}), ...(body.company ?? {}) },
      accounts: { ...(value.accounts ?? {}), ...(body.accounts ?? {}) },
    };
    return this.db.withActor(actor, (trx) =>
      trx
        .insertInto('erp_settings')
        .values({ key: 'accounting', value: JSON.stringify(next) })
        .onConflict((oc) =>
          oc.column('key').doUpdateSet({ value: JSON.stringify(next) }),
        )
        .returning('value')
        .executeTakeFirstOrThrow(),
    );
  }

  /** ?code= — accounts without entries that automatic entries don't use. */
  @Delete()
  async remove(
    @Query('code') code: string | undefined,
    @CurrentActor() actor: RequestActor,
  ) {
    if (!code) throw new ApiError('Missing code');
    const account = await this.db
      .selectFrom('accounts')
      .select('is_system')
      .where('code', '=', code)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    if (!account) throw new ApiError('This account no longer exists.', 404);
    if (account.is_system)
      throw new ApiError(
        'Automatic entries use this account; it can be renamed but not removed.',
        409,
      );
    const used = await this.db
      .selectFrom('journal_lines')
      .select('id')
      .where('account_code', '=', code)
      .executeTakeFirst();
    if (used)
      throw new ApiError(
        'This account has entries; deactivate it instead.',
        409,
      );
    await this.db.withActor(actor, (trx) =>
      trx
        .updateTable('accounts')
        .set({ deleted_at: new Date() })
        .where('code', '=', code)
        .execute(),
    );
    return { code };
  }
}

// ── Bank reconciliation ──

const importSchema = z.object({
  batch: z.string().trim().max(100).optional(),
  lines: z
    .array(
      z.object({
        statement_date: zDate,
        label: z.string().trim().max(300).default(''),
        amount: z
          .number()
          .finite()
          .refine((v) => v !== 0, 'Amount cannot be zero'),
        reference: z.string().trim().max(100).optional(),
      }),
    )
    .min(1)
    .max(2000),
});
const matchSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('match'), statement_id: zId, line_id: zId }),
  z.object({ action: z.literal('unmatch'), statement_id: zId }),
  z.object({
    action: z.literal('auto'),
    days: z.number().int().min(0).max(31).default(5),
  }),
]);

@Controller('finance/bank')
@Public()
export class BankController {
  constructor(private readonly db: Database) {}

  /** Statement lines, bank lines of the books not matched yet, and both balances (?from=&to=). */
  @Get()
  async get(@Query() query: Record<string, string>) {
    const q = params(query);
    const settings = await this.db
      .selectFrom('erp_settings')
      .select('value')
      .where('key', '=', 'accounting')
      .executeTakeFirst();
    const bankAccount =
      (settings?.value as { accounts?: Record<string, string> } | null)
        ?.accounts?.bank ?? '532';
    let statement = this.db
      .selectFrom('bank_statement_lines as b')
      .selectAll('b')
      .select((eb) =>
        one(
          eb,
          'journal_lines as l',
          ['l.id', 'l.label', 'l.debit', 'l.credit'],
          'l.id',
          'b.matched_line_id',
          (q2) =>
            q2.select((e: any) =>
              one(
                e,
                'journal_entries as e',
                ['e.number', 'e.entry_date', 'e.label'],
                'e.id',
                'l.entry_id',
              ).as('entry'),
            ),
        ).as('matched'),
      )
      .where('b.deleted_at', 'is', null);
    if (q.get('from'))
      statement = statement.where('b.statement_date', '>=', q.get('from')!);
    if (q.get('to'))
      statement = statement.where('b.statement_date', '<=', q.get('to')!);
    const [statementLines, bookLines, matchedIds] = await Promise.all([
      statement.orderBy('b.statement_date', 'desc').limit(2000).execute(),
      this.db
        .selectFrom('journal_lines as l')
        .innerJoin('journal_entries as je', 'je.id', 'l.entry_id')
        .select(['l.id', 'l.label', 'l.debit', 'l.credit'])
        .select((eb) =>
          one(
            eb,
            'journal_entries as e',
            [
              'e.id',
              'e.number',
              'e.entry_date',
              'e.label',
              'e.status',
              'e.deleted_at',
            ],
            'e.id',
            'l.entry_id',
          ).as('entry'),
        )
        .where('l.account_code', '=', bankAccount)
        .where('je.deleted_at', 'is', null)
        .limit(5000)
        .execute(),
      this.db
        .selectFrom('bank_statement_lines')
        .select('matched_line_id')
        .where('matched_line_id', 'is not', null)
        .where('deleted_at', 'is', null)
        .execute(),
    ]);
    const matched = new Set(matchedIds.map((m) => m.matched_line_id));
    const entryDate = (l: { entry: unknown }) =>
      (l.entry as { entry_date: string }).entry_date;
    return {
      account: bankAccount,
      statement: statementLines,
      unmatched_books: bookLines
        .filter((l) => !matched.has(l.id))
        .sort((a, b) => entryDate(b).localeCompare(entryDate(a))),
      balance_books: round(
        bookLines.reduce((s, l) => s + Number(l.debit) - Number(l.credit), 0),
      ),
      balance_statement: round(
        statementLines.reduce((s, l) => s + Number(l.amount), 0),
      ),
    };
  }

  /** Adds statement lines (CSV parsed in the browser, or one typed line), then auto-matches. */
  @Post()
  async import(
    @Body(new Zod(importSchema)) body: z.infer<typeof importSchema>,
    @CurrentActor() actor: RequestActor,
  ) {
    const batch = body.batch || `import-${new Date().toISOString()}`;
    return this.db.withActor(actor, async (trx) => {
      const inserted = await trx
        .insertInto('bank_statement_lines')
        .values(
          body.lines.map((l) => ({
            ...l,
            reference: l.reference || null,
            import_batch: batch,
            created_by: actor.userId,
            created_by_email: actor.email,
          })),
        )
        .returning('id')
        .execute();
      const matched = await this.db.call(
        'auto_match_bank',
        { p_days: 5, p_actor: actor.userId },
        trx,
      );
      return { imported: inserted.length, matched };
    });
  }

  /** { action: match, statement_id, line_id } | { action: unmatch, statement_id } | { action: auto, days } */
  @Patch()
  async match(
    @Body(new Zod(matchSchema)) body: z.infer<typeof matchSchema>,
    @CurrentActor() actor: RequestActor,
  ) {
    if (body.action === 'auto') {
      return {
        matched: await this.db.withActor(actor, (trx) =>
          this.db.call(
            'auto_match_bank',
            { p_days: body.days, p_actor: actor.userId },
            trx,
          ),
        ),
      };
    }
    if (body.action === 'unmatch') {
      await this.db.withActor(actor, (trx) =>
        trx
          .updateTable('bank_statement_lines')
          .set({ matched_line_id: null, matched_at: null, matched_by: null })
          .where('id', '=', body.statement_id)
          .execute(),
      );
      return { id: body.statement_id };
    }
    const taken = await this.db
      .selectFrom('bank_statement_lines')
      .select('id')
      .where('matched_line_id', '=', body.line_id)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    if (taken)
      throw new ApiError('This line of the books is already matched.', 409);
    return this.db.withActor(actor, (trx) =>
      trx
        .updateTable('bank_statement_lines')
        .set({
          matched_line_id: body.line_id,
          matched_at: new Date(),
          matched_by: actor.userId,
        })
        .where('id', '=', body.statement_id)
        .returningAll()
        .executeTakeFirstOrThrow(),
    );
  }

  @Delete()
  async remove(
    @Query('id') id: string | undefined,
    @CurrentActor() actor: RequestActor,
  ) {
    if (!id) throw new ApiError('Missing id');
    await this.db.withActor(actor, (trx) =>
      trx
        .updateTable('bank_statement_lines')
        .set({ deleted_at: new Date(), matched_line_id: null })
        .where('id', '=', id)
        .execute(),
    );
    return { id };
  }
}

// ── Bills and their payments ──

const billFields = {
  supplier_id: zId.nullable(),
  payee: z.string().trim().max(150).nullable(),
  purchase_order_id: zId.nullable(),
  supplier_reference: z.string().trim().max(100).nullable(),
  category: z.enum(BILL_CATEGORIES),
  cost_type: z.enum(['fixed', 'variable']),
  account_code: accountCode,
  bill_date: zDate,
  due_date: zDate.nullable(),
  amount_ht: zMoney,
  vat_amount: zMoney,
  stamp: zMoney,
  notes: z.string().trim().max(2000).nullable(),
  document_id: zId.nullable(),
};
const billCreate = z
  .object(billFields)
  .partial()
  .required({ category: true, amount_ht: true })
  .extend({
    // Paid on the spot (cash or bank): the payment is recorded with the bill.
    paid_now: z
      .object({
        account: z.enum(['cash', 'bank']),
        method: z.enum(['cash', 'bank_transfer', 'check', 'card', 'other']),
      })
      .optional(),
  });
const billUpdate = z
  .object({ id: zId, ...billFields })
  .partial()
  .required({ id: true });
const paySchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('pay'),
    bill_id: zId,
    amount: z.number().positive().max(100_000_000),
    paid_on: zDate.optional(),
    account: z.enum(['cash', 'bank']),
    method: z.enum(['cash', 'bank_transfer', 'check', 'card', 'other']),
    reference: z.string().trim().max(100).optional(),
    note: z.string().trim().max(500).optional(),
  }),
  z.object({ action: z.literal('unpay'), payment_id: zId }),
]);

@Controller('finance/bills')
@Public()
export class BillsController {
  constructor(private readonly db: Database) {}

  private bills() {
    return this.db
      .selectFrom('bills as b')
      .selectAll('b')
      .select((eb) => [
        one(
          eb,
          'suppliers as s',
          ['s.id', 's.name', 's.payment_terms_days'],
          's.id',
          'b.supplier_id',
        ).as('supplier'),
        one(
          eb,
          'purchase_orders as po',
          ['po.id', 'po.number'],
          'po.id',
          'b.purchase_order_id',
        ).as('purchase_order'),
      ])
      .where('b.deleted_at', 'is', null);
  }

  /** ?id= (with payments) | list: ?status=unpaid|partial|paid|open|overdue&category=&supplier_id=&from=&to=&cost_type= */
  @Get()
  async get(@Query() query: Record<string, string>) {
    const q = params(query);
    const id = q.get('id');
    if (id) {
      const [bill, payments] = await Promise.all([
        this.bills().where('b.id', '=', id).executeTakeFirst(),
        this.db
          .selectFrom('bill_payments')
          .selectAll()
          .where('bill_id', '=', id)
          .where('deleted_at', 'is', null)
          .orderBy('paid_on')
          .execute(),
      ]);
      if (!bill) throw new ApiError('This bill no longer exists.', 404);
      return { ...bill, payments };
    }
    let rows = this.bills();
    const status = q.get('status');
    if (status === 'open') rows = rows.where('b.status', '<>', 'paid');
    else if (status === 'overdue')
      rows = rows
        .where('b.status', '<>', 'paid')
        .where('b.due_date', '<', today());
    else if (status) rows = rows.where('b.status', '=', status);
    if (q.get('category'))
      rows = rows.where('b.category', '=', q.get('category')!);
    if (q.get('cost_type'))
      rows = rows.where('b.cost_type', '=', q.get('cost_type')!);
    if (q.get('supplier_id'))
      rows = rows.where('b.supplier_id', '=', q.get('supplier_id')!);
    if (q.get('from')) rows = rows.where('b.bill_date', '>=', q.get('from')!);
    if (q.get('to')) rows = rows.where('b.bill_date', '<=', q.get('to')!);
    return rows
      .orderBy('b.bill_date', 'desc')
      .limit(q.int('limit', 500, 2000))
      .execute();
  }

  private async dueDate(
    supplierId: string | null | undefined,
    billDate: string,
  ) {
    if (!supplierId) return null;
    const supplier = await this.db
      .selectFrom('suppliers')
      .select('payment_terms_days')
      .where('id', '=', supplierId)
      .executeTakeFirst();
    const d = new Date(`${billDate}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + Number(supplier?.payment_terms_days ?? 0));
    return d.toISOString().slice(0, 10);
  }

  @Post()
  async create(
    @Body(new Zod(billCreate)) body: z.infer<typeof billCreate>,
    @CurrentActor() actor: RequestActor,
  ) {
    const { paid_now, ...row } = body;
    if (!row.supplier_id && !row.payee)
      throw new ApiError('Choose a supplier or enter who is paid.');
    const billDate = row.bill_date ?? today();
    const insert = {
      ...row,
      bill_date: billDate,
      account_code: row.account_code ?? BILL_CATEGORY_ACCOUNTS[row.category],
      cost_type:
        row.cost_type ??
        (FIXED_CATEGORIES.includes(row.category) ? 'fixed' : 'variable'),
      due_date:
        row.due_date === undefined
          ? await this.dueDate(row.supplier_id, billDate)
          : row.due_date,
      created_by: actor.userId,
      created_by_email: actor.email,
    };
    const id = await this.db.withActor(actor, async (trx) => {
      if (!paid_now)
        return (
          await trx
            .insertInto('bills')
            .values(insert)
            .returning('id')
            .executeTakeFirstOrThrow()
        ).id;
      // Bill and payment together.
      const created = await this.db.call<{ id: string }>(
        'create_paid_bill',
        {
          p_bill: insert,
          p_account: paid_now.account,
          p_method: paid_now.method,
          p_actor: actor.userId,
          p_actor_email: actor.email,
        },
        trx,
      );
      return created.id;
    });
    return this.bills().where('b.id', '=', id).executeTakeFirstOrThrow();
  }

  @Put()
  async update(
    @Body(new Zod(billUpdate)) body: z.infer<typeof billUpdate>,
    @CurrentActor() actor: RequestActor,
  ) {
    const { id, ...row } = body;
    const current = await this.db
      .selectFrom('bills')
      .select('paid_amount')
      .where('id', '=', id)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    if (!current) throw new ApiError('This bill no longer exists.', 404);
    const total =
      (row.amount_ht ?? 0) + (row.vat_amount ?? 0) + (row.stamp ?? 0);
    if (
      row.amount_ht !== undefined &&
      total < Number(current.paid_amount) - 0.0005
    ) {
      throw new ApiError(
        'The new total is less than what was already paid.',
        409,
      );
    }
    await this.db.withActor(actor, (trx) =>
      trx.updateTable('bills').set(row).where('id', '=', id).execute(),
    );
    return this.bills().where('b.id', '=', id).executeTakeFirstOrThrow();
  }

  /** Pay a bill (part or all), or remove a payment entered by mistake. */
  @Patch()
  async pay(
    @Body(new Zod(paySchema)) body: z.infer<typeof paySchema>,
    @CurrentActor() actor: RequestActor,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (body.action === 'unpay') {
      await this.db.withActor(actor, (trx) =>
        trx
          .updateTable('bill_payments')
          .set({ deleted_at: new Date() })
          .where('id', '=', body.payment_id)
          .where('deleted_at', 'is', null)
          .execute(),
      );
      return { id: body.payment_id };
    }
    const bill = await this.db
      .selectFrom('bills')
      .select(['total', 'paid_amount'])
      .where('id', '=', body.bill_id)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    if (!bill) throw new ApiError('This bill no longer exists.', 404);
    if (body.amount > Number(bill.total) - Number(bill.paid_amount) + 0.0005)
      throw new ApiError('This is more than what is left to pay.', 409);
    res.status(201);
    return this.db.withActor(actor, (trx) =>
      trx
        .insertInto('bill_payments')
        .values({
          bill_id: body.bill_id,
          amount: body.amount,
          paid_on: body.paid_on ?? today(),
          account: body.account,
          method: body.method,
          reference: body.reference || null,
          note: body.note || null,
          created_by: actor.userId,
          created_by_email: actor.email,
        })
        .returningAll()
        .executeTakeFirstOrThrow(),
    );
  }

  /** ?id= — cancels a bill (its entry is reversed). Paid bills: remove the payments first. */
  @Delete()
  async remove(
    @Query('id') id: string | undefined,
    @CurrentActor() actor: RequestActor,
  ) {
    if (!id) throw new ApiError('Missing id');
    const bill = await this.db
      .selectFrom('bills')
      .select('paid_amount')
      .where('id', '=', id)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    if (!bill) throw new ApiError('This bill no longer exists.', 404);
    if (Number(bill.paid_amount) > 0)
      throw new ApiError('This bill has payments. Remove them first.', 409);
    await this.db.withActor(actor, (trx) =>
      trx
        .updateTable('bills')
        .set({ deleted_at: new Date() })
        .where('id', '=', id)
        .execute(),
    );
    return { id };
  }
}

// ── Sales invoices ──

const issueSchema = z.object({
  order_id: zId,
  customer_tax_id: z.string().trim().max(50).optional(),
  invoice_date: zDate.optional(),
});
const cancelSchema = z.object({
  id: zId,
  reason: z.string().trim().max(500).optional(),
});

@Controller('finance/invoices')
@Public()
export class InvoicesController {
  constructor(private readonly db: Database) {}

  /** ?id= (with the company details for printing) | ?order_id= | list: ?kind=&from=&to=&q= */
  @Get()
  async get(@Query() query: Record<string, string>) {
    const q = params(query);
    const id = q.get('id');
    if (id) {
      const [invoice, settings] = await Promise.all([
        this.db
          .selectFrom('sales_invoices as v')
          .selectAll('v')
          .select((eb) =>
            one(
              eb,
              'orders as o',
              [
                'o.order_number',
                'o.created_at',
                'o.delivered_at',
                'o.payment_status',
              ],
              'o.id',
              'v.order_id',
            ).as('order'),
          )
          .where('v.id', '=', id)
          .executeTakeFirst(),
        this.db
          .selectFrom('erp_settings')
          .select('value')
          .where('key', '=', 'accounting')
          .executeTakeFirst(),
      ]);
      if (!invoice) throw new ApiError('This invoice no longer exists.', 404);
      return {
        ...invoice,
        company:
          (settings?.value as { company?: unknown } | null)?.company ?? {},
      };
    }
    let rows = this.db
      .selectFrom('sales_invoices')
      .select([
        'id',
        'number',
        'kind',
        'order_id',
        'credit_note_for',
        'invoice_date',
        'customer_name',
        'customer_phone',
        'amount_ht',
        'vat_amount',
        'stamp',
        'total',
        'status',
        'created_at',
      ])
      .where('deleted_at', 'is', null);
    if (q.get('order_id'))
      rows = rows.where('order_id', '=', q.get('order_id')!);
    if (q.get('kind')) rows = rows.where('kind', '=', q.get('kind')!);
    if (q.get('from')) rows = rows.where('invoice_date', '>=', q.get('from')!);
    if (q.get('to')) rows = rows.where('invoice_date', '<=', q.get('to')!);
    const term = q.get('q')?.replace(/[%,()]/g, ' ');
    if (term) {
      const like = `%${term}%`;
      rows = rows.where((eb) =>
        eb.or([
          eb('number', 'ilike', like),
          eb('customer_name', 'ilike', like),
          eb('customer_phone', 'ilike', like),
        ]),
      );
    }
    return rows
      .orderBy('created_at', 'desc')
      .limit(q.int('limit', 300, 2000))
      .execute();
  }

  /** { order_id, customer_tax_id?, invoice_date? } — issues the order's invoice. */
  @Post()
  issue(
    @Body(new Zod(issueSchema)) body: z.infer<typeof issueSchema>,
    @CurrentActor() actor: RequestActor,
  ) {
    return this.db.withActor(actor, (trx) =>
      this.db.call(
        'issue_invoice',
        {
          p_order_id: body.order_id,
          p_customer_tax_id: body.customer_tax_id ?? null,
          p_date: body.invoice_date ?? null,
          p_actor: actor.userId,
          p_actor_email: actor.email,
        },
        trx,
      ),
    );
  }

  /** { id, reason } — cancels an invoice with a credit note. */
  @Patch()
  cancel(
    @Body(new Zod(cancelSchema)) body: z.infer<typeof cancelSchema>,
    @CurrentActor() actor: RequestActor,
  ) {
    return this.db.withActor(actor, (trx) =>
      this.db.call(
        'cancel_invoice',
        {
          p_id: body.id,
          p_reason: body.reason ?? null,
          p_actor: actor.userId,
          p_actor_email: actor.email,
        },
        trx,
      ),
    );
  }
}

// ── Reports ──

interface TrialRow {
  account_code: string;
  account_name: string;
  account_class: number;
  account_type: string;
  opening: number;
  debit: number;
  credit: number;
  closing: number;
}

function csvCell(value: string | number | null | undefined) {
  const text = value === null || value === undefined ? '' : String(value);
  return /[";\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * Accounting reports for a period (?from=&to=&drafts=1): trial, ledger (&account=), income,
 * balance, vat, export (FEC-style CSV).
 */
@Controller('finance/reports')
@Public()
export class ReportsController {
  constructor(private readonly db: Database) {}

  private linesInPeriod(from: string, to: string) {
    return this.db
      .selectFrom('journal_lines as l')
      .innerJoin('journal_entries as e', 'e.id', 'l.entry_id')
      .where('e.deleted_at', 'is', null)
      .where('e.entry_date', '>=', from)
      .where('e.entry_date', '<=', to);
  }

  @Get()
  async get(
    @Query() query: Record<string, string>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const q = params(query);
    const to = q.get('to') ?? today();
    const from = q.get('from') ?? `${to.slice(0, 4)}-01-01`;
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(from) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(to) ||
      from > to
    )
      throw new ApiError('Invalid period');
    const drafts = q.bool('drafts');
    const report = q.get('report') ?? 'trial';
    const trialBalance = (start: string) =>
      this.db
        .call<TrialRow[]>('trial_balance', {
          p_from: start,
          p_to: to,
          p_include_drafts: drafts,
        })
        .then((rows) =>
          rows.map((r) => ({
            ...r,
            opening: Number(r.opening),
            debit: Number(r.debit),
            credit: Number(r.credit),
            closing: Number(r.closing),
          })),
        );

    if (report === 'vat')
      return this.db.call('vat_summary', {
        p_from: from,
        p_to: to,
        p_include_drafts: drafts,
      });

    if (report === 'ledger') {
      const account = q.get('account');
      if (!account) throw new ApiError('Choose an account');
      const [before, lines] = await Promise.all([
        trialBalance(from),
        this.linesInPeriod(from, to)
          .select([
            'l.id',
            'l.account_code',
            'l.label',
            'l.debit',
            'l.credit',
            'l.partner_name',
          ])
          .select((eb) =>
            one(
              eb,
              'journal_entries as je',
              [
                'je.id',
                'je.journal',
                'je.number',
                'je.entry_date',
                'je.label',
                'je.status',
                'je.deleted_at',
              ],
              'je.id',
              'l.entry_id',
            ).as('entry'),
          )
          .where('l.account_code', '=', account)
          .limit(5000)
          .execute(),
      ]);
      const opening = Number(
        before.find((r) => r.account_code === account)?.opening ?? 0,
      );
      type Entry = {
        entry_date: string;
        number: string | null;
        status: string;
      };
      const rows = lines
        .filter((l) => drafts || (l.entry as Entry).status === 'posted')
        .sort((a, b) => {
          const x = a.entry as Entry;
          const y = b.entry as Entry;
          return (
            x.entry_date.localeCompare(y.entry_date) ||
            (x.number ?? '').localeCompare(y.number ?? '')
          );
        });
      let balance = opening;
      return {
        account,
        opening,
        lines: rows.map((l) => {
          balance = round(balance + Number(l.debit) - Number(l.credit));
          return { ...l, balance };
        }),
        closing: balance,
      };
    }

    if (report === 'export') return this.export(from, to, drafts, res);

    const trial = await trialBalance(from);
    if (report === 'trial') {
      const totals = trial.reduce(
        (t, r) => ({ debit: t.debit + r.debit, credit: t.credit + r.credit }),
        { debit: 0, credit: 0 },
      );
      return {
        rows: trial,
        totals: { debit: round(totals.debit), credit: round(totals.credit) },
      };
    }
    if (report === 'income') {
      // Movements of the period only; income and expenses both shown positive.
      const income = trial
        .filter((r) => r.account_class === 7)
        .map((r) => ({
          code: r.account_code,
          name: r.account_name,
          amount: round(r.credit - r.debit),
        }));
      const expenses = trial
        .filter((r) => r.account_class === 6)
        .map((r) => ({
          code: r.account_code,
          name: r.account_name,
          amount: round(r.debit - r.credit),
        }));
      const totalIncome = round(income.reduce((s, r) => s + r.amount, 0));
      const totalExpenses = round(expenses.reduce((s, r) => s + r.amount, 0));
      return {
        income,
        expenses,
        total_income: totalIncome,
        total_expenses: totalExpenses,
        result: round(totalIncome - totalExpenses),
      };
    }
    if (report === 'balance') {
      // Balances at `to`: everything since the beginning of the books.
      const all = await trialBalance('1900-01-01');
      const result = round(
        -all
          .filter((r) => r.account_class >= 6)
          .reduce((s, r) => s + r.closing, 0),
      );
      const assets = all
        .filter((r) => r.account_class <= 5 && r.closing > 0.0005)
        .map((r) => ({
          code: r.account_code,
          name: r.account_name,
          amount: round(r.closing),
        }));
      const liabilities = all
        .filter((r) => r.account_class <= 5 && r.closing < -0.0005)
        .map((r) => ({
          code: r.account_code,
          name: r.account_name,
          amount: round(-r.closing),
        }));
      const totalAssets = round(assets.reduce((s, r) => s + r.amount, 0));
      const totalLiabilities = round(
        liabilities.reduce((s, r) => s + r.amount, 0),
      );
      return {
        assets,
        liabilities,
        result,
        total_assets: totalAssets,
        total_liabilities_and_equity: round(totalLiabilities + result),
      };
    }
    throw new ApiError('Unknown report');
  }

  private async export(
    from: string,
    to: string,
    drafts: boolean,
    res: Response,
  ) {
    const lines = await this.linesInPeriod(from, to)
      .leftJoin('accounts as a', 'a.code', 'l.account_code')
      .select([
        'l.account_code',
        'l.label',
        'l.debit',
        'l.credit',
        'l.partner_type',
        'l.partner_id',
        'l.partner_name',
        'a.name as account_name',
        'e.journal',
        'e.number',
        'e.entry_date',
        'e.label as entry_label',
        'e.status',
        'e.posted_at',
        'e.source_type',
      ])
      .limit(100_000)
      .execute();
    const journalNames: Record<string, string> = {
      VT: 'Ventes',
      AC: 'Achats',
      CA: 'Caisse',
      BQ: 'Banque',
      OD: 'Opérations diverses',
    };
    const header = [
      'JournalCode',
      'JournalLib',
      'EcritureNum',
      'EcritureDate',
      'CompteNum',
      'CompteLib',
      'CompAuxNum',
      'CompAuxLib',
      'PieceRef',
      'PieceDate',
      'EcritureLib',
      'Debit',
      'Credit',
      'ValidDate',
      'Statut',
    ];
    const rows = lines
      .filter((l) => drafts || l.status === 'posted')
      .sort(
        (a, b) =>
          a.entry_date.localeCompare(b.entry_date) ||
          (a.number ?? '').localeCompare(b.number ?? ''),
      )
      .map((l) =>
        [
          l.journal,
          journalNames[l.journal] ?? l.journal,
          l.number ?? 'BROUILLON',
          l.entry_date.replace(/-/g, ''),
          l.account_code,
          l.account_name ?? '',
          l.partner_id ?? '',
          l.partner_name ?? '',
          l.source_type,
          l.entry_date.replace(/-/g, ''),
          l.label || l.entry_label,
          Number(l.debit).toFixed(3).replace('.', ','),
          Number(l.credit).toFixed(3).replace('.', ','),
          l.posted_at ? l.posted_at.slice(0, 10).replace(/-/g, '') : '',
          l.status,
        ]
          .map(csvCell)
          .join(';'),
      );
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="ecritures-${from}-${to}.csv"`,
    );
    return new Raw('﻿' + [header.join(';'), ...rows].join('\r\n'));
  }
}

// ── Cash and bank ──

const treasuryCreate = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('movement'),
    account: z.enum(['cash', 'bank']),
    direction: z.enum(['in', 'out']),
    amount: z.number().positive().max(100_000_000),
    category: z
      .enum(TREASURY_CATEGORIES)
      .refine(
        (c) => c !== 'transfer' && c !== 'pos_difference',
        'Use a transfer for cash ↔ bank',
      ),
    occurred_on: zDate.optional(),
    label: z.string().trim().min(1).max(200),
    reference: z.string().trim().max(100).optional(),
  }),
  z.object({
    kind: z.literal('transfer'),
    from: z.enum(['cash', 'bank']),
    amount: z.number().positive().max(100_000_000),
    occurred_on: zDate.optional(),
    label: z.string().trim().max(200).optional(),
  }),
]);

@Controller('finance/treasury')
@Public()
export class TreasuryController {
  constructor(private readonly db: Database) {}

  /** Balances and a combined statement of every money movement (?account=cash|bank&from=&to=). */
  @Get()
  async get(@Query() query: Record<string, string>) {
    const q = params(query);
    const account = q.get('account');
    const from = q.get('from');
    const to = q.get('to');
    const accounts = account ? [account] : ['cash', 'bank'];
    const inRange = (query: any, column: string) => {
      let out = query;
      if (from) out = out.where(column, '>=', from);
      if (to) out = out.where(column, '<=', `${to}T23:59:59.999Z`);
      return out;
    };
    const orderName = (o: any) =>
      [o?.customer_first_name, o?.customer_last_name].filter(Boolean).join(' ');

    const [
      balances,
      payments,
      remittances,
      movements,
      billPayments,
      adSpend,
    ]: any[] = await Promise.all([
      this.db.call('treasury_balances'),
      inRange(
        this.db
          .selectFrom('order_payments as p')
          .select([
            'p.id',
            'p.amount',
            'p.method',
            'p.account',
            'p.received_at',
            'p.reference',
          ])
          .select((eb) =>
            one(
              eb,
              'orders as o',
              [
                'o.order_number',
                'o.customer_first_name',
                'o.customer_last_name',
              ],
              'o.id',
              'p.order_id',
            ).as('order'),
          )
          .where('p.account', 'in', accounts)
          .where('p.deleted_at', 'is', null),
        'p.received_at',
      )
        .orderBy('p.received_at', 'desc')
        .limit(500)
        .execute(),
      inRange(
        this.db
          .selectFrom('cod_remittances')
          .select([
            'id',
            'net_amount',
            'fees',
            'account',
            'received_on',
            'reference',
            'provider',
          ])
          .where('account', 'in', accounts)
          .where('deleted_at', 'is', null),
        'received_on',
      )
        .limit(500)
        .execute(),
      inRange(
        this.db
          .selectFrom('treasury_movements')
          .selectAll()
          .where('account', 'in', accounts)
          .where('deleted_at', 'is', null),
        'occurred_on',
      )
        .limit(500)
        .execute(),
      inRange(
        this.db
          .selectFrom('bill_payments as bp')
          .select([
            'bp.id',
            'bp.amount',
            'bp.account',
            'bp.paid_on',
            'bp.reference',
          ])
          .select((eb) =>
            one(
              eb,
              'bills as b',
              ['b.number', 'b.supplier_reference', 'b.payee'],
              'b.id',
              'bp.bill_id',
              (q2) =>
                q2.select((e: any) =>
                  one(
                    e,
                    'suppliers as s',
                    ['s.name'],
                    's.id',
                    'b.supplier_id',
                  ).as('supplier'),
                ),
            ).as('bill'),
          )
          .where('bp.account', 'in', accounts)
          .where('bp.deleted_at', 'is', null),
        'bp.paid_on',
      )
        .limit(500)
        .execute(),
      inRange(
        this.db
          .selectFrom('ad_spend as a')
          .select(['a.id', 'a.amount', 'a.account', 'a.spend_date'])
          .select((eb) =>
            one(
              eb,
              'ad_campaigns as c',
              ['c.name'],
              'c.id',
              'a.campaign_id',
            ).as('campaign'),
          )
          .where('a.account', 'in', accounts)
          .where('a.deleted_at', 'is', null),
        'a.spend_date',
      )
        .limit(500)
        .execute(),
    ]);

    type Line = {
      id: string;
      kind: string;
      date: string;
      account: string;
      amount: number;
      label: string;
      reference?: string | null;
      deletable?: boolean;
      category?: string;
    };
    const lines: Line[] = [
      ...payments.map((p: any) => ({
        id: p.id,
        kind: 'payment',
        date: p.received_at,
        account: p.account,
        amount: Number(p.amount),
        label: `${p.order?.order_number ?? ''} ${orderName(p.order)}`.trim(),
        reference: p.reference,
      })),
      ...remittances.map((r: any) => ({
        id: r.id,
        kind: 'remittance',
        date: r.received_on,
        account: r.account,
        amount: Number(r.net_amount),
        label: `Payout ${r.provider}`,
        reference: r.reference,
      })),
      ...movements.map((m: any) => ({
        id: m.id,
        kind: 'movement',
        date: m.occurred_on,
        account: m.account,
        amount: m.direction === 'in' ? Number(m.amount) : -Number(m.amount),
        label: m.label,
        reference: m.reference,
        category: m.category,
        deletable: m.category !== 'pos_difference',
      })),
      ...billPayments.map((b: any) => ({
        id: b.id,
        kind: 'bill_payment',
        date: b.paid_on,
        account: b.account,
        amount: -Number(b.amount),
        label:
          `${b.bill?.supplier?.name ?? b.bill?.payee ?? ''} ${b.bill?.supplier_reference ?? b.bill?.number ?? ''}`.trim(),
        reference: b.reference,
      })),
      ...adSpend.map((a: any) => ({
        id: a.id,
        kind: 'ad_spend',
        date: a.spend_date,
        account: a.account,
        amount: -Number(a.amount),
        label: `Ads ${a.campaign?.name ?? ''}`.trim(),
      })),
    ].sort((a, b) => b.date.localeCompare(a.date));

    return { balances, lines: lines.slice(0, 1000) };
  }

  @Post()
  async create(
    @Body(new Zod(treasuryCreate)) body: z.infer<typeof treasuryCreate>,
    @CurrentActor() actor: RequestActor,
  ) {
    if (body.kind === 'transfer') {
      const id = await this.db.withActor(actor, (trx) =>
        this.db.call(
          'record_cash_transfer',
          {
            p_from: body.from,
            p_amount: body.amount,
            p_date: body.occurred_on ?? null,
            p_label: body.label ?? '',
            p_actor: actor.userId,
            p_actor_email: actor.email,
          },
          trx,
        ),
      );
      return { transfer_id: id };
    }
    return this.db.withActor(actor, (trx) =>
      trx
        .insertInto('treasury_movements')
        .values({
          account: body.account,
          direction: body.direction,
          amount: body.amount,
          category: body.category,
          occurred_on: body.occurred_on ?? today(),
          label: body.label,
          reference: body.reference || null,
          created_by: actor.userId,
          created_by_email: actor.email,
        })
        .returningAll()
        .executeTakeFirstOrThrow(),
    );
  }

  /** ?id= — a movement entered by mistake (both sides of a transfer). */
  @Delete()
  async remove(
    @Query('id') id: string | undefined,
    @CurrentActor() actor: RequestActor,
  ) {
    if (!id) throw new ApiError('Missing id');
    return {
      removed: await this.db.withActor(actor, (trx) =>
        this.db.call('delete_treasury_movement', { p_id: id }, trx),
      ),
    };
  }
}
