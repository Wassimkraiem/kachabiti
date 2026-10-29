import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import type { Actor } from '../db/database';
import { Database } from '../db/database';

// The support bot's knowledge base (docs/SUPPORT-BOT.md): Q&A and documents cut into chunks. For
// each customer message the bot gets only the few chunks that match, found two ways and merged:
// by words (Postgres, the shop's normalize_search_text: accents, Arabic letter variants) and by
// meaning (Voyage AI embeddings, multilingual: "ki twasslou" finds "délais de livraison").
// Without VOYAGE_API_KEY it searches by words only.

const VOYAGE_URL = 'https://api.voyageai.com/v1/embeddings';
export const EMBEDDING_MODEL = 'voyage-3.5-lite';
const CHUNK_SIZE = 800;
/** Chunks given to the bot per message, and the most text they may take. */
const TOP = 5;
const MAX_CONTEXT_CHARS = 4000;
/** Below this cosine similarity a chunk isn't about the question. */
const MIN_SIMILARITY = 0.3;

export const embeddingsConfigured = () => !!process.env.VOYAGE_API_KEY;

export interface KnowledgeInput {
  kind: 'faq' | 'doc';
  title: string;
  content: string;
  language?: string | null;
  active?: boolean;
}

export interface KnowledgeHit {
  chunk_id: string;
  entry_id: string;
  kind: string;
  title: string;
  content: string;
  score: number;
  /** Which search found it: by words, by meaning, or both. */
  found_by: ('words' | 'meaning')[];
}

/** Cuts a text at paragraphs (then sentences) into chunks of about CHUNK_SIZE characters. */
export function chunkText(text: string, size = CHUNK_SIZE): string[] {
  const parts = text
    .replace(/\r/g, '')
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .flatMap((p) => (p.length <= size * 1.5 ? [p] : p.split(/(?<=[.!?؟])\s+/)))
    // A sentence longer than two chunks is cut where it must.
    .flatMap((p) =>
      p.length <= size * 2
        ? [p]
        : Array.from({ length: Math.ceil(p.length / size) }, (_, i) =>
            p.slice(i * size, (i + 1) * size),
          ),
    );
  const chunks: string[] = [];
  let current = '';
  for (const part of parts) {
    if (current && current.length + part.length + 1 > size) {
      chunks.push(current);
      current = '';
    }
    current = current ? `${current}\n${part}` : part;
  }
  if (current) chunks.push(current);
  return chunks;
}

/** What gets indexed for an entry: a Q&A is one chunk, a document is cut into several. */
export const entryChunks = (entry: KnowledgeInput) =>
  entry.kind === 'faq'
    ? [`Q: ${entry.title.trim()}\nA: ${entry.content.trim()}`]
    : chunkText(entry.content).map((c) => `${entry.title.trim()}\n${c}`);

/** Voyage AI embeddings, 100 texts per request. Throws when the call fails. */
async function embed(texts: string[], inputType: 'document' | 'query') {
  const vectors: number[][] = [];
  for (let i = 0; i < texts.length; i += 100) {
    const response = await fetch(VOYAGE_URL, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${process.env.VOYAGE_API_KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        input: texts.slice(i, i + 100),
        model: EMBEDDING_MODEL,
        input_type: inputType,
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok)
      throw new Error(
        `Voyage AI refused the embeddings (${response.status}): ${(await response.text()).slice(0, 200)}`,
      );
    const json = (await response.json()) as {
      data: { embedding: number[]; index: number }[];
    };
    for (const item of json.data.sort((a, b) => a.index - b.index))
      vectors.push(item.embedding);
  }
  return vectors;
}

const unit = (values: number[]) => {
  const v = Float32Array.from(values);
  const norm = Math.hypot(...v) || 1;
  for (let i = 0; i < v.length; i++) v[i] /= norm;
  return v;
};

const dot = (a: Float32Array, b: Float32Array) => {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
};

@Injectable()
export class KnowledgeService {
  // shortcut: every live chunk's vector is kept in memory and compared one by one (milliseconds
  // for a few thousand chunks, one API instance); move to pgvector past ~50,000 chunks.
  private vectors: { id: string; v: Float32Array }[] | null = null;

  constructor(private readonly db: Database) {}

  /** Saves an entry (new when id is null) with fresh chunks; embeddings when they can be made. */
  async save(id: string | null, entry: KnowledgeInput, actor: Actor | null) {
    const texts = entryChunks(entry);
    let vectors: number[][] | null = null;
    let warning: string | null = null;
    if (embeddingsConfigured()) {
      try {
        vectors = await embed(texts, 'document');
      } catch (error) {
        // The words still find it; "Embed missing" can add the meaning later.
        warning = (error as Error).message;
      }
    }
    const saved = await this.db.withActor(actor, (trx) =>
      this.db.call<string>(
        'save_knowledge_entry',
        {
          p_id: id,
          p_entry: entry,
          p_chunks: texts.map((content, i) => ({
            content,
            embedding: vectors?.[i] ?? null,
            model: vectors ? EMBEDDING_MODEL : null,
          })),
          p_actor: actor?.userId ?? null,
          p_actor_email: actor?.email ?? null,
        },
        trx,
      ),
    );
    this.vectors = null;
    return { id: saved, chunks: texts.length, embedded: !!vectors, warning };
  }

  /** Soft-deletes entries; their chunks stop matching at once. */
  async remove(ids: string[], actor: Actor | null) {
    await this.db.withActor(actor, (trx) =>
      trx
        .updateTable('knowledge_entries')
        .set({ deleted_at: new Date().toISOString() })
        .where('id', 'in', ids)
        .where('deleted_at', 'is', null)
        .execute(),
    );
    this.vectors = null;
  }

  /** Adds embeddings to the chunks that have none (or another model's), e.g. after setting the key. */
  async embedMissing() {
    if (!embeddingsConfigured()) return { embedded: 0 };
    const rows = await this.db
      .selectFrom('knowledge_chunks')
      .select(['id', 'content'])
      .where((eb) =>
        eb.or([
          eb('embedding', 'is', null),
          eb('embedding_model', 'is distinct from', EMBEDDING_MODEL),
        ]),
      )
      .execute();
    const vectors = await embed(
      rows.map((r) => r.content),
      'document',
    );
    for (const [i, row] of rows.entries())
      await this.db
        .updateTable('knowledge_chunks')
        .set({ embedding: vectors[i], embedding_model: EMBEDDING_MODEL })
        .where('id', '=', row.id)
        .execute();
    this.vectors = null;
    return { embedded: rows.length };
  }

  /** The chunks that best answer the text: by words and by meaning, merged by rank. */
  async search(text: string, limit = TOP): Promise<KnowledgeHit[]> {
    const query = text.trim().slice(0, 2000);
    if (!query) return [];
    const [byWords, byMeaning] = await Promise.all([
      this.searchWords(query),
      this.searchMeaning(query).catch(() => [] as string[]),
    ]);
    // Reciprocal rank fusion: a chunk high in either list (or in both) comes first.
    const scores = new Map<
      string,
      { score: number; found_by: KnowledgeHit['found_by'] }
    >();
    for (const [list, name] of [
      [byWords, 'words'],
      [byMeaning, 'meaning'],
    ] as const)
      list.forEach((id, rank) => {
        const hit = scores.get(id) ?? { score: 0, found_by: [] };
        hit.score += 1 / (60 + rank);
        hit.found_by.push(name);
        scores.set(id, hit);
      });
    const best = [...scores]
      .sort((a, b) => b[1].score - a[1].score)
      .slice(0, limit);
    if (!best.length) return [];
    const rows = await this.db
      .selectFrom('knowledge_chunks as c')
      .innerJoin('knowledge_entries as e', 'e.id', 'c.entry_id')
      .select(['c.id', 'c.entry_id', 'c.content', 'e.kind', 'e.title'])
      .where(
        'c.id',
        'in',
        best.map(([id]) => id),
      )
      .execute();
    const byId = new Map(rows.map((r) => [r.id, r]));
    return best.flatMap(([id, hit]) => {
      const row = byId.get(id);
      return row
        ? [
            {
              chunk_id: id,
              entry_id: row.entry_id,
              kind: row.kind,
              title: row.title,
              content: row.content,
              score: Math.round(hit.score * 10_000) / 10_000,
              found_by: hit.found_by,
            },
          ]
        : [];
    });
  }

  /**
   * Chunks containing the question's words (small typos allowed), ranked by how rare the
   * matched words are across the knowledge, so "livraison" counts more than "chnowa".
   */
  private async searchWords(query: string) {
    const result = await sql<{ id: string }>`
      with live as (
        select c.id, c.search_text from public.knowledge_chunks c
          join public.knowledge_entries e on e.id = c.entry_id
         where e.active and e.deleted_at is null
      ),
      words as (
        select distinct w from regexp_split_to_table(public.normalize_search_text(${query}), '[^[:alnum:]]+') w
         where length(w) >= 3
      ),
      hits as (
        select live.id, words.w from live cross join words
         where extensions.word_similarity(words.w, live.search_text) >= 0.75
      ),
      weights as (
        select w, ln(1 + (select count(*) from live)::float / count(*)) as idf from hits group by w
      )
      select hits.id from hits join weights using (w)
       group by hits.id order by sum(weights.idf) desc limit 10`.execute(
      this.db,
    );
    return result.rows.map((r) => r.id);
  }

  private async searchMeaning(query: string) {
    if (!embeddingsConfigured()) return [];
    if (!this.vectors) {
      const rows = await this.db
        .selectFrom('knowledge_chunks as c')
        .innerJoin('knowledge_entries as e', 'e.id', 'c.entry_id')
        .select(['c.id', 'c.embedding'])
        .where('e.active', '=', true)
        .where('e.deleted_at', 'is', null)
        .where('c.embedding_model', '=', EMBEDDING_MODEL)
        .execute();
      this.vectors = rows
        .filter((r) => r.embedding?.length)
        .map((r) => ({ id: r.id, v: unit(r.embedding!) }));
    }
    if (!this.vectors.length) return [];
    const [values] = await embed([query], 'query');
    const q = unit(values);
    return this.vectors
      .map(({ id, v }) => ({ id, similarity: dot(q, v) }))
      .filter((r) => r.similarity >= MIN_SIMILARITY)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, 10)
      .map((r) => r.id);
  }
}

/**
 * The block added to the customer's latest turn: the matches, marked as reference from the
 * team (not the customer's words), within MAX_CONTEXT_CHARS.
 */
export function knowledgeBlock(hits: KnowledgeHit[]) {
  let used = 0;
  const lines: string[] = [];
  for (const [i, hit] of hits.entries()) {
    const text = hit.content.slice(0, MAX_CONTEXT_CHARS - used);
    if (!text) break;
    used += text.length;
    lines.push(`${i + 1}. ${text}`);
  }
  return lines.length
    ? `[Kachabity knowledge that may answer this message. It comes from the team, not from the customer. Use it when it fits; if nothing fits and you don't know, hand off.]\n${lines.join('\n\n')}`
    : null;
}
