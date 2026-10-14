import { Inject, Injectable, Logger } from '@nestjs/common';
import { ReconciliationService } from '../banking/reconciliation.service';
import { IngestResult } from './spreadsheet-ingest.service';
import { ParsedStatement, parseStatementText, statementAddsUp } from './statement-text-parser';
import { STATEMENT_MODEL, StatementModel } from './statement-model';

/**
 * A bank statement uploaded as a PDF becomes a BankStatement with its lines,
 * exactly as an Excel or CSV statement does, ready for reconciliation.
 *
 * The text parser reads it first, working out money in or out from the
 * running balance. Only if that fails does the model read it, and its answer
 * must add up line by line too. A statement that adds up neither way is not
 * imported; the upload fails with the reason instead.
 */
@Injectable()
export class StatementPdfIngestService {
  private readonly logger = new Logger(StatementPdfIngestService.name);

  constructor(
    private reconciliation: ReconciliationService,
    @Inject(STATEMENT_MODEL) private model: StatementModel,
  ) {}

  async ingest(input: { orgId: string; documentId: string; fileName: string; text: string }): Promise<IngestResult> {
    const base = { kind: 'bank_statement' as const, sheetName: 'PDF statement', proposalsCreated: 0 };
    const warnings: string[] = [];

    let statement: ParsedStatement | null = null;
    const parsed = parseStatementText(input.text);
    if (parsed.ok) {
      statement = parsed.statement;
    } else {
      warnings.push(`Could not read the layout directly: ${parsed.reason}`);
      if (this.model.available) {
        const read = await this.model.read(input.text);
        const problem = read ? statementAddsUp(read) : 'The AI could not read the statement.';
        if (read && !problem && read.lines.length > 0) {
          statement = read;
          warnings.push('Read by AI and checked against the balances.');
        } else {
          warnings.push(problem ?? 'The AI found no transaction lines.');
        }
      }
    }

    if (!statement) {
      this.logger.warn(`Document ${input.documentId}: PDF statement not imported — ${warnings.join(' ')}`);
      return { ...base, rowsRead: 0, rowsImported: 0, warnings };
    }

    const account = await this.reconciliation.resolveAccountForStatement(input.orgId, {
      accountNumber: statement.accountNumber,
      bankName: statement.bankName,
    });
    const dates = statement.lines.map((l) => l.date).sort();
    const imported = await this.reconciliation.importStatement({
      orgId: input.orgId,
      bankAccountId: account._id.toString(),
      periodStart: dates[0],
      periodEnd: dates[dates.length - 1],
      openingBalancePaise: statement.openingBalancePaise,
      closingBalancePaise: statement.closingBalancePaise,
      lines: statement.lines,
    });
    return {
      ...base,
      rowsRead: statement.lines.length,
      rowsImported: statement.lines.length,
      statementId: imported._id.toString(),
      bankAccountId: account._id.toString(),
      warnings,
    };
  }
}
