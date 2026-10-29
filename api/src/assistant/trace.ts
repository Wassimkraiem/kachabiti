import { randomUUID } from 'crypto';

// Langfuse tracing over its public ingestion API (no SDK): one trace per bot turn, with a
// generation per model call and a span per tool call. Off unless LANGFUSE_PUBLIC_KEY and
// LANGFUSE_SECRET_KEY are set. Customer details are masked before anything leaves the server.

const configured = () =>
  Boolean(process.env.LANGFUSE_PUBLIC_KEY && process.env.LANGFUSE_SECRET_KEY);

/** Hides phone numbers, e-mails and long digit runs in text sent to Langfuse. */
export function mask(text: string): string {
  return text
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[email]')
    .replace(/(?:\+?216[\s.-]?)?\b[2-9]\d(?:[\s.-]?\d){6}\b/g, '[phone]')
    .replace(/\b\d{9,}\b/g, '[number]');
}

/** mask() over any JSON-like value; address and name fields are dropped entirely. */
function maskValue(value: unknown): unknown {
  if (typeof value === 'string') return mask(value);
  if (Array.isArray(value)) return value.map(maskValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [
        k,
        /^(address|full_name|name_of_customer|city|phone)$/.test(k)
          ? '[hidden]'
          : // Images are not sent: Langfuse would store the customer's photo.
            k === 'source' && (v as { type?: string })?.type === 'base64'
            ? '[image]'
            : maskValue(v),
      ]),
    );
  }
  return value;
}

type Event = { id: string; type: string; timestamp: string; body: object };

export class Trace {
  readonly id = randomUUID();
  private readonly events: Event[] = [];

  constructor(
    name: string,
    customerId: string,
    metadata: Record<string, unknown>,
  ) {
    this.push('trace-create', {
      id: this.id,
      name,
      userId: customerId,
      metadata,
    });
  }

  private push(type: string, body: object) {
    this.events.push({
      id: randomUUID(),
      type,
      timestamp: new Date().toISOString(),
      body,
    });
  }

  generation(input: {
    model: string;
    start: Date;
    end: Date;
    input: unknown;
    output: unknown;
    usage: {
      input: number;
      output: number;
      cacheRead: number;
      cacheWrite: number;
    };
    costUsd: number;
  }) {
    this.push('generation-create', {
      id: randomUUID(),
      traceId: this.id,
      name: 'claude',
      model: input.model,
      startTime: input.start.toISOString(),
      endTime: input.end.toISOString(),
      input: maskValue(input.input),
      output: maskValue(input.output),
      usageDetails: {
        input: input.usage.input,
        output: input.usage.output,
        cache_read_input_tokens: input.usage.cacheRead,
        cache_creation_input_tokens: input.usage.cacheWrite,
      },
      costDetails: { total: input.costUsd },
    });
  }

  span(name: string, start: Date, input: unknown, output: unknown) {
    this.push('span-create', {
      id: randomUUID(),
      traceId: this.id,
      name,
      startTime: start.toISOString(),
      endTime: new Date().toISOString(),
      input: maskValue(input),
      output: maskValue(output),
    });
  }

  end(output: unknown, metadata: Record<string, unknown>) {
    this.push('trace-create', {
      id: this.id,
      output: maskValue(output),
      metadata,
    });
  }

  /** Sends everything in one request. Never throws: tracing must not break a reply. */
  async flush(): Promise<string | null> {
    if (!configured()) return null;
    const base = process.env.LANGFUSE_BASE_URL || 'https://cloud.langfuse.com';
    const auth = Buffer.from(
      `${process.env.LANGFUSE_PUBLIC_KEY}:${process.env.LANGFUSE_SECRET_KEY}`,
    ).toString('base64');
    try {
      const response = await fetch(`${base}/api/public/ingestion`, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ batch: this.events }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok && response.status !== 207) {
        console.warn(`Langfuse ingestion failed: ${response.status}`);
        return null;
      }
      return this.id;
    } catch (error) {
      console.warn(`Langfuse ingestion failed: ${(error as Error).message}`);
      return null;
    }
  }
}
