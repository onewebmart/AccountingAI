import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BankAccount, BankAccountSchema } from './schemas/bank-account.schema';
import { BankStatement, BankStatementSchema } from './schemas/bank-statement.schema';
import { BankStatementLine, BankStatementLineSchema } from './schemas/bank-statement-line.schema';
import { Journal, JournalSchema } from '../gl/schemas/journal.schema';
import { ReconciliationService } from './reconciliation.service';
import { BankingController } from './banking.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: BankAccount.name, schema: BankAccountSchema },
      { name: BankStatement.name, schema: BankStatementSchema },
      { name: BankStatementLine.name, schema: BankStatementLineSchema },
      { name: Journal.name, schema: JournalSchema },
    ]),
  ],
  controllers: [BankingController],
  providers: [ReconciliationService],
  exports: [ReconciliationService],
})
export class BankingModule {}
