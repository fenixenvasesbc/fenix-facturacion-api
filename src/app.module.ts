import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { HealthModule } from './health/health.module';
import { SuppliersModule } from './suppliers/suppliers.module';
import { PriceListsModule } from './price-lists/price-lists.module';
import { PriceListItemsModule } from './price-list-items/price-list-items.module';
import { CanonicalProductsModule } from './canonical-products/canonical-products.module';
import { SupplierProductAliasesModule } from './supplier-product-aliases/supplier-product-aliases.module';
import { InvoicesModule } from './invoices/invoices.module';

@Module({
  imports: [
    PrismaModule,
    HealthModule,
    SuppliersModule,
    PriceListsModule,
    PriceListItemsModule,
    CanonicalProductsModule,
    SupplierProductAliasesModule,
    InvoicesModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
