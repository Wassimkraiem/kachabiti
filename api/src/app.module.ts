import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { TeamController } from './admin/team.controller';
import { AssistantController } from './assistant/assistant.controller';
import { AssistantService } from './assistant/assistant.service';
import { KnowledgeController } from './assistant/knowledge.controller';
import { KnowledgeService } from './assistant/knowledge';
import { AuthController } from './auth/auth.controller';
import { AccountController } from './storefront/account.controller';
import { AuthGuard } from './auth/auth.guard';
import { CategoriesController } from './catalog/categories.controller';
import {
  ProductDiscountsController,
  ReelsController,
  SaleBannersController,
} from './catalog/content.controllers';
import { LandingController } from './catalog/landing.controller';
import {
  ColorsController,
  SizesController,
} from './catalog/options.controller';
import { ProductImagesController } from './catalog/product-images.controller';
import { ProductsController } from './catalog/products.controller';
import { VariantsController } from './catalog/variants.controller';
import { ApiExceptionFilter, ApiResponseInterceptor } from './common/api';
import { DatabaseModule } from './db/database';
import {
  DocumentsController,
  UploadImageController,
} from './files/files.controllers';
import { HealthController } from './health.controller';
import { NotificationEvents } from './notifications/notification-events';
import { ColissimoTracking } from './sales/colissimo-tracking';
import {
  HomeListsController,
  StorefrontController,
} from './storefront/storefront.controller';
import {
  AccessDeniedController,
  ActivityController,
  ErpSettingsController,
  GoalsController,
  MeController,
  MyWorkController,
  NotificationsController,
  OwnerOverviewController,
  PerformanceController,
  StaffController,
  TrashController,
} from './admin/admin.controllers';
import {
  CartController,
  ContactController,
  DocsController,
  NewsletterController,
} from './admin/public.controllers';
import { CampaignsController } from './crm/campaigns.controller';
import {
  CustomersController,
  InteractionsController,
  TasksController,
} from './crm/crm.controllers';
import { MetaWebhookController } from './crm/meta-webhook.controller';
import {
  AccountingController,
  AccountsController,
  BankController,
  BillsController,
  InvoicesController,
  ReportsController,
  TreasuryController,
} from './finance/finance.controllers';
import { PosController } from './pos/pos.controller';
import {
  CostingController,
  MaterialsController,
  PurchaseOrdersController,
  PurchasePricesController,
  ReceiptsController,
} from './purchasing/purchasing.controllers';
import { DeliveryController } from './sales/delivery.controller';
import { ColissimoPortalController } from './sales/colissimo-portal.controller';
import { OrdersController } from './sales/orders.controller';
import {
  PaymentsController,
  RemittancesController,
  SalesOrdersController,
} from './sales/sales.controllers';
import {
  CollectionsController,
  LocationsController,
  StockCostsController,
  StockMovementsController,
  StockReportsController,
  StockTrackingController,
  SuppliersController,
} from './stock/stock.controllers';

@Module({
  imports: [DatabaseModule],
  controllers: [
    HealthController,
    AuthController,
    AccountController,
    TeamController,
    UploadImageController,
    DocumentsController,
    CategoriesController,
    ProductsController,
    VariantsController,
    ProductImagesController,
    ColorsController,
    SizesController,
    ProductDiscountsController,
    SaleBannersController,
    ReelsController,
    LandingController,
    SuppliersController,
    CollectionsController,
    LocationsController,
    StockTrackingController,
    StockCostsController,
    StockMovementsController,
    StockReportsController,
    OrdersController,
    SalesOrdersController,
    PaymentsController,
    RemittancesController,
    DeliveryController,
    ColissimoPortalController,
    CustomersController,
    InteractionsController,
    TasksController,
    MetaWebhookController,
    AssistantController,
    KnowledgeController,
    CampaignsController,
    PosController,
    PurchaseOrdersController,
    ReceiptsController,
    MaterialsController,
    CostingController,
    PurchasePricesController,
    AccountingController,
    AccountsController,
    BankController,
    BillsController,
    InvoicesController,
    ReportsController,
    TreasuryController,
    OwnerOverviewController,
    ActivityController,
    ErpSettingsController,
    GoalsController,
    MeController,
    AccessDeniedController,
    MyWorkController,
    PerformanceController,
    StaffController,
    NotificationsController,
    TrashController,
    CartController,
    ContactController,
    NewsletterController,
    DocsController,
    StorefrontController,
    HomeListsController,
  ],
  providers: [
    NotificationEvents,
    ColissimoTracking,
    AssistantService,
    KnowledgeService,
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_INTERCEPTOR, useClass: ApiResponseInterceptor },
    { provide: APP_FILTER, useClass: ApiExceptionFilter },
  ],
})
export class AppModule {}
