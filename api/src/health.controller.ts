import { Controller, Get } from '@nestjs/common';
import { sql } from 'kysely';
import { Public } from './auth/decorators';
import { Database } from './db/database';

@Controller('health')
export class HealthController {
  constructor(private readonly db: Database) {}

  @Get()
  @Public()
  async check() {
    await sql`select 1`.execute(this.db);
    return { status: 'ok' };
  }
}
