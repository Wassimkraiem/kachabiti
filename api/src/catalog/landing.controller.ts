import { Body, Controller, Get, Put } from '@nestjs/common';
import {
  LANDING_SECTIONS,
  normalizeLandingConfig,
  parseLandingConfig,
  type LandingSection,
} from '@shared/landing-config';
import { CurrentActor, Requires } from '../auth/decorators';
import type { RequestActor } from '../auth/auth.guard';
import { ApiError } from '../common/api';
import { Database } from '../db/database';
import { invalidateCatalog } from './revalidate';

// Port of app/api/landing/route.ts: home page curation (Admin → Landing page).

const isIdList = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((id) => typeof id === 'string');

@Controller('landing')
@Requires('marketing')
export class LandingController {
  constructor(private readonly db: Database) {}

  /** Product picks per section (in order), featured categories (in order) and the layout config. */
  @Get()
  async get() {
    const [picks, config, featured] = await Promise.all([
      this.db
        .selectFrom('landing_products')
        .select(['section', 'product_id'])
        .where('deleted_at', 'is', null)
        .orderBy('position')
        .execute(),
      this.db
        .selectFrom('site_settings')
        .select('setting_value')
        .where('setting_key', '=', 'landing_config')
        .executeTakeFirst(),
      this.db
        .selectFrom('categories')
        .select('id')
        .where('is_featured', '=', true)
        .where('deleted_at', 'is', null)
        .orderBy('featured_position', (ob) => ob.asc().nullsLast())
        .orderBy('sort_order')
        .execute(),
    ]);
    return {
      sections: Object.fromEntries(
        LANDING_SECTIONS.map((section) => [
          section,
          picks
            .filter((row) => row.section === section)
            .map((row) => row.product_id),
        ]),
      ),
      config: parseLandingConfig(config?.setting_value),
      featuredCategories: featured.map((row) => row.id),
    };
  }

  /**
   * Any combination of { section, product_ids } (replaces a section's picks), { config } and
   * { featured_category_ids }, saved in one transaction.
   */
  @Put()
  async save(
    @Body() body: Record<string, any>,
    @CurrentActor() actor: RequestActor,
  ) {
    const hasPicks = body.section !== undefined;
    if (
      !hasPicks &&
      body.config === undefined &&
      body.featured_category_ids === undefined
    )
      throw new ApiError('Nothing to save');
    if (hasPicks) {
      if (!LANDING_SECTIONS.includes(body.section as LandingSection))
        throw new ApiError('Unknown section');
      if (!isIdList(body.product_ids))
        throw new ApiError('product_ids must be a list of product ids');
    }
    if (
      body.featured_category_ids !== undefined &&
      !isIdList(body.featured_category_ids)
    ) {
      throw new ApiError(
        'featured_category_ids must be a list of category ids',
      );
    }

    await this.db.withActor(actor, (trx) =>
      this.db.call(
        'save_landing_page',
        {
          p_section: hasPicks ? body.section : null,
          p_product_ids: hasPicks
            ? [...new Set(body.product_ids as string[])]
            : null,
          p_config:
            body.config !== undefined
              ? normalizeLandingConfig(body.config)
              : null,
          p_featured_category_ids:
            body.featured_category_ids !== undefined
              ? [...new Set(body.featured_category_ids as string[])]
              : null,
          p_actor: actor.userId,
        },
        trx,
      ),
    );
    await invalidateCatalog();
  }
}
