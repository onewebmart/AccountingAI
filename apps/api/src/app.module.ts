import { Module, MiddlewareConsumer, NestModule, RequestMethod } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import configuration from './config/configuration';
import { DatabaseModule } from './database/database.module';
import { RedisModule } from './redis/redis.module';
import { HealthModule } from './health/health.module';
import { TenancyModule } from './tenancy/tenancy.module';
import { TenantMiddleware } from './tenancy/tenant.middleware';
import { AuthModule } from './auth/auth.module';
import { JournalsModule } from './journals/journals.module';
import { GlModule } from './gl/gl.module';
import { DocumentsModule } from './documents/documents.module';
import { ProposalsModule } from './proposals/proposals.module';
import { PurchaseModule } from './purchase/purchase.module';
import { SalesModule } from './sales/sales.module';
import { BankingModule } from './banking/banking.module';
import { GstModule } from './gst/gst.module';
import { ReportsModule } from './reports/reports.module';
import { ExportsModule } from './exports/exports.module';
import { InsightsModule } from './insights/insights.module';
import { OrgSettingsModule } from './org-settings/org-settings.module';
import { PlatformAdminModule } from './platform-admin/platform-admin.module';
import { WhiteLabelModule } from './white-label/white-label.module';
import { CrmModule } from './crm/crm.module';
import { WorkspaceModule } from './workspace/workspace.module';
import { IngestModule } from './ingest/ingest.module';
import { TdsModule } from './tds/tds.module';
import { ClosingModule } from './closing/closing.module';
import { AutomationModule } from './automation/automation.module';
import { MigrationModule } from './migration/migration.module';
import { BankFeedsModule } from './bank-feeds/bank-feeds.module';
import { AuditTrailModule } from './audit/audit-trail.module';
import { PartyPaymentsModule } from './payments/party-payments.module';
import { PortalModule } from './portal/portal.module';
import { AttachmentsModule } from './attachments/attachments.module';
import { InboundModule } from './inbound/inbound.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      envFilePath: ['.env.local', '.env'],
    }),
    // BullMQ — shared Redis connection for all queues
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          host: config.get<string>('redis.host'),
          port: config.get<number>('redis.port'),
        },
      }),
    }),
    DatabaseModule,
    RedisModule,
    HealthModule,
    TenancyModule,
    AuthModule,
    JournalsModule,
    GlModule,
    DocumentsModule,
    ProposalsModule,
    PurchaseModule,
    SalesModule,
    BankingModule,
    GstModule,
    ReportsModule,
    ExportsModule,
    InsightsModule,
    OrgSettingsModule,
    PlatformAdminModule,
    WhiteLabelModule,
    IngestModule,
    TdsModule,
    ClosingModule,
    AutomationModule,
    MigrationModule,
    BankFeedsModule,
    AuditTrailModule,
    PartyPaymentsModule,
    PortalModule,
    AttachmentsModule,
    InboundModule,
    CrmModule,
    WorkspaceModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // Apply tenant middleware to all API routes so every request
    // runs with the correct orgId in AsyncLocalStorage context.
    consumer
      .apply(TenantMiddleware)
      .forRoutes({ path: '*', method: RequestMethod.ALL });
  }
}
