import { Logger } from '@nestjs/common';
import { config } from '../config';

const logger = new Logger('Revalidate');

/**
 * Asks Next.js to drop its cached catalog (app/api/internal/revalidate → invalidateCatalog()).
 * Called after every catalog write; a failure is logged and never fails the write, because the
 * cache also expires on its own after 5 minutes.
 */
export async function invalidateCatalog(): Promise<void> {
  if (!config.NEXT_URL || !config.REVALIDATE_SECRET) return;
  try {
    const response = await fetch(
      new URL('/api/internal/revalidate', config.NEXT_URL),
      {
        method: 'POST',
        headers: { 'x-revalidate-secret': config.REVALIDATE_SECRET },
        signal: AbortSignal.timeout(3000),
      },
    );
    if (!response.ok) logger.warn(`Next.js answered ${response.status}`);
  } catch (error) {
    logger.warn(`Could not reach Next.js: ${(error as Error).message}`);
  }
}
