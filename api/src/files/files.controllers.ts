import { randomUUID } from 'node:crypto';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Post,
  Put,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { sql } from 'kysely';
import { z } from 'zod';
import { DOCUMENT_KINDS } from '@shared/erp/constants';
import type { RequestActor } from '../auth/auth.guard';
import { CurrentActor, Public } from '../auth/decorators';
import { ApiError, params, Raw, Zod, zDate, zId } from '../common/api';
import {
  deleteObject,
  publicUrl,
  putObject,
  signedUrl,
} from '../common/storage';
import { Database } from '../db/database';

// Ports of app/api/upload/image and app/api/finance/documents, on S3-compatible storage (AWS S3).
// Access rules come from lib/api-access.ts (upload: products or marketing; documents: finance).

type Upload = {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
  size: number;
};

const IMAGE_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

/** Shop images (products, categories, banners) in the public `products` bucket. */
@Controller('upload/image')
@Public()
export class UploadImageController {
  /** multipart `file` → { success, url, fileName } (the shape the admin forms read). */
  @Post()
  @HttpCode(200)
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }),
  )
  async upload(@UploadedFile() file: Upload | undefined) {
    if (!file) throw new ApiError('No file provided');
    const extension = IMAGE_TYPES[file.mimetype];
    if (!extension)
      throw new ApiError(
        'Invalid file type. Only JPEG, PNG, WebP, and GIF are allowed.',
      );
    const fileName = `product-${Date.now()}-${randomUUID().slice(0, 13)}.${extension}`;
    await putObject('products', fileName, file.buffer, file.mimetype);
    return new Raw({ success: true, url: publicUrl(fileName), fileName });
  }

  /** ?fileName= removes an uploaded image the form discarded. */
  @Delete()
  async remove(@Query('fileName') fileName: string | undefined) {
    // One object at the bucket's root: no paths, so nothing else can be named.
    if (!fileName || !/^[\w.-]+$/.test(fileName) || fileName.startsWith('.'))
      throw new ApiError('File name is required');
    await deleteObject('products', fileName);
    return new Raw({ success: true });
  }
}

const MAX_DOCUMENT = 20 * 1024 * 1024;
const DOCUMENT_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'text/csv',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];

const metaSchema = z.object({
  kind: z.enum(DOCUMENT_KINDS).default('other'),
  title: z.string().trim().min(1).max(200),
  related_type: z.string().trim().max(50).nullable().optional(),
  related_id: zId.nullable().optional(),
  partner_name: z.string().trim().max(150).nullable().optional(),
  document_date: zDate.nullable().optional(),
  expires_on: zDate.nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
});
const updateSchema = metaSchema.partial().extend({ id: zId });

/**
 * Document archive (contracts, supplier invoices, delivery notes, certificates...). Files live in
 * the private `documents` bucket and are only reached through links that expire after 5 minutes.
 */
@Controller('finance/documents')
@Public()
export class DocumentsController {
  constructor(private readonly db: Database) {}

  private documents() {
    return this.db
      .selectFrom('documents')
      .selectAll()
      .where('deleted_at', 'is', null);
  }

  /** ?id=&download=1 (signed link) | list: ?kind=&related_type=&related_id=&q= */
  @Get()
  async get(@Query() query: Record<string, string>) {
    const q = params(query);
    const id = q.get('id');
    if (id) {
      if (!zId.safeParse(id).success)
        throw new ApiError('This document no longer exists.', 404);
      const doc = await this.documents()
        .where('id', '=', id)
        .executeTakeFirst();
      if (!doc) throw new ApiError('This document no longer exists.', 404);
      if (!q.bool('download')) return doc;
      if (!doc.storage_path)
        throw new ApiError('This document has no file.', 404);
      return {
        url: await signedUrl('documents', doc.storage_path, 300, doc.file_name),
      };
    }
    let list = this.documents();
    for (const column of ['kind', 'related_type', 'related_id'] as const) {
      const value = q.get(column);
      if (value) list = list.where(column, '=', value as never);
    }
    const term = q.get('q');
    if (term) {
      const like = `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      list = list.where((eb) =>
        eb.or([
          eb('title', 'ilike', like),
          eb('partner_name', 'ilike', like),
          eb('file_name', 'ilike', like),
        ]),
      );
    }
    return list
      .orderBy('created_at', 'desc')
      .limit(q.int('limit', 300, 2000))
      .execute();
  }

  /** multipart/form-data: an optional `file` plus the fields of metaSchema. */
  @Post()
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_DOCUMENT } }),
  )
  async create(
    @UploadedFile() file: Upload | undefined,
    @Body() body: Record<string, unknown>,
    @CurrentActor() actor: RequestActor,
  ) {
    const fields = Object.fromEntries(
      Object.entries(body ?? {}).filter(
        ([, v]) => typeof v === 'string' && v !== '',
      ),
    );
    const meta = metaSchema.parse(fields);
    let upload: {
      storage_path: string;
      file_name: string;
      mime_type: string;
      size_bytes: number;
    } | null = null;
    if (file && file.size > 0) {
      if (!DOCUMENT_TYPES.includes(file.mimetype))
        throw new ApiError(
          'Upload a PDF, an image, a spreadsheet or a Word document.',
        );
      const safeName = file.originalname.replace(/[^\w.-]+/g, '_').slice(-100);
      const path = `${new Date().toISOString().slice(0, 7)}/${randomUUID()}-${safeName}`;
      await putObject('documents', path, file.buffer, file.mimetype);
      upload = {
        storage_path: path,
        file_name: file.originalname.slice(0, 200),
        mime_type: file.mimetype,
        size_bytes: file.size,
      };
    }
    return this.db
      .withActor(actor, (trx) =>
        trx
          .insertInto('documents')
          .values({
            ...meta,
            ...(upload ?? {}),
            created_by: actor.userId,
            created_by_email: actor.email,
          })
          .returningAll()
          .executeTakeFirstOrThrow(),
      )
      .catch(async (error: unknown) => {
        // No record, no file: don't leave it in storage.
        if (upload)
          await deleteObject('documents', upload.storage_path).catch(() => {});
        throw error;
      });
  }

  @Put()
  async update(
    @Body(new Zod(updateSchema)) body: z.infer<typeof updateSchema>,
    @CurrentActor() actor: RequestActor,
  ) {
    const { id, ...row } = body;
    const doc = await this.db.withActor(actor, (trx) =>
      trx
        .updateTable('documents')
        .set(row)
        .where('id', '=', id)
        .where('deleted_at', 'is', null)
        .returningAll()
        .executeTakeFirst(),
    );
    if (!doc) throw new ApiError('This document no longer exists.', 404);
    return doc;
  }

  /** ?id= — archived as deleted; the file stays in storage until the record is purged. */
  @Delete()
  async remove(
    @Query('id') id: string | undefined,
    @CurrentActor() actor: RequestActor,
  ) {
    if (!id || !zId.safeParse(id).success) throw new ApiError('Missing id');
    await this.db.withActor(actor, (trx) =>
      trx
        .updateTable('documents')
        .set({ deleted_at: sql`now()` })
        .where('id', '=', id)
        .where('deleted_at', 'is', null)
        .execute(),
    );
    return { id };
  }
}
