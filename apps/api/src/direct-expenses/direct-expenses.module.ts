import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { GlModule } from '../gl/gl.module';
import { ApprovalsModule } from '../approvals/approvals.module';
import { Vendor, VendorSchema } from '../purchase/schemas/vendor.schema';
import { Project, ProjectSchema } from '../projects/schemas/project.schema';
import { Customer, CustomerSchema } from '../sales/schemas/customer.schema';
import { DirectExpense, DirectExpenseSchema } from './schemas/direct-expense.schema';
import { MileageSettings, MileageSettingsSchema } from './schemas/mileage-settings.schema';
import { DirectExpensesService } from './direct-expenses.service';
import { DirectExpensesController } from './direct-expenses.controller';

/**
 * Expenses paid straight from bank or cash (collection `expenses`). Not the
 * ExpensesModule, which is employees' expense claims. Depends only on the
 * ledger and approvals, so recurring expenses can import it without a cycle.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: DirectExpense.name, schema: DirectExpenseSchema },
      // The org's mileage preferences: default account, unit, rates by start date.
      { name: MileageSettings.name, schema: MileageSettingsSchema },
      // Read only: the vendor paid, the project a cost belongs to, the customer it is billed to.
      { name: Vendor.name, schema: VendorSchema },
      { name: Project.name, schema: ProjectSchema },
      { name: Customer.name, schema: CustomerSchema },
    ]),
    GlModule, // PostingService, AccountsService, AuditService, the ledger accounts
    ApprovalsModule, // the payment approval policy
  ],
  controllers: [DirectExpensesController],
  providers: [DirectExpensesService],
  exports: [DirectExpensesService],
})
export class DirectExpensesModule {}
