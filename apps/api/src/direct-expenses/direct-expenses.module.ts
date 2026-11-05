import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { GlModule } from '../gl/gl.module';
import { ApprovalsModule } from '../approvals/approvals.module';
import { Vendor, VendorSchema } from '../purchase/schemas/vendor.schema';
import { Project, ProjectSchema } from '../projects/schemas/project.schema';
import { DirectExpense, DirectExpenseSchema } from './schemas/direct-expense.schema';
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
      // Read only: the vendor paid, and the project a cost belongs to.
      { name: Vendor.name, schema: VendorSchema },
      { name: Project.name, schema: ProjectSchema },
    ]),
    GlModule, // PostingService, AccountsService, AuditService, the ledger accounts
    ApprovalsModule, // the payment approval policy
  ],
  controllers: [DirectExpensesController],
  providers: [DirectExpensesService],
  exports: [DirectExpensesService],
})
export class DirectExpensesModule {}
