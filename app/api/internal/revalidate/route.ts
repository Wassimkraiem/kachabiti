import { timingSafeEqual } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { invalidateCatalog } from '@/lib/catalog-cache';

// Called by the NestJS API (api/src/catalog/revalidate.ts) after catalog writes, since only
// Next.js can clear its own data cache. Shared secret: REVALIDATE_SECRET.
export async function POST(request: NextRequest) {
    const secret = process.env.REVALIDATE_SECRET;
    const given = request.headers.get('x-revalidate-secret') ?? '';
    if (!secret || given.length !== secret.length || !timingSafeEqual(Buffer.from(given), Buffer.from(secret))) {
        return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }
    invalidateCatalog();
    return NextResponse.json({ success: true });
}
