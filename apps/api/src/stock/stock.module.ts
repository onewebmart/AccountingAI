import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { GlModule } from '../gl/gl.module';
import { ItemsModule } from '../items/items.module';
import { MonthEndModule } from '../month-end/month-end.module';
import { OrdersModule } from '../orders/orders.module';
import { Item, ItemSchema } from '../items/schemas/item.schema';
import { PurchaseBill, PurchaseBillSchema } from '../purchase/schemas/purchase-bill.schema';
import { Vendor, VendorSchema } from '../purchase/schemas/vendor.schema';
import { SalesInvoice, SalesInvoiceSchema } from '../sales/schemas/sales-invoice.schema';
import { Customer, CustomerSchema } from '../sales/schemas/customer.schema';
import { GoodsReceipt, GoodsReceiptSchema, PurchaseOrder, PurchaseOrderSchema } from '../orders/schemas/purchase-docs.schema';
import { StockMove, StockMoveSchema } from './schemas/stock-move.schema';
import { StockService } from './stock.service';
import { StockController } from './stock.controller';

/** Stock under periodic inventory: moves, valuation, line-to-item links, reorders and the stock entries. */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: StockMove.name, schema: StockMoveSchema },
      { name: Item.name, schema: ItemSchema },
      { name: PurchaseBill.name, schema: PurchaseBillSchema },
      { name: SalesInvoice.name, schema: SalesInvoiceSchema },
      { name: Vendor.name, schema: VendorSchema },
      { name: Customer.name, schema: CustomerSchema },
      { name: PurchaseOrder.name, schema: PurchaseOrderSchema },
      { name: GoodsReceipt.name, schema: GoodsReceiptSchema },
    ]),
    GlModule, // AccountsService, AuditService, journals and the period lock
    ItemsModule, // ItemsService: a new item made from a line
    MonthEndModule, // AdjustmentsService: the stock entries go to the review queue
    OrdersModule, // PurchaseDocsService: a reorder becomes a draft PO
  ],
  controllers: [StockController],
  providers: [StockService],
  exports: [StockService],
})
export class StockModule {}
