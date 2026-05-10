import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { SupplierProductAliasesController } from './supplier-product-aliases.controller';
import { SupplierProductAliasesService } from './supplier-product-aliases.service';

@Module({
  imports: [PrismaModule],
  controllers: [SupplierProductAliasesController],
  providers: [SupplierProductAliasesService],
  exports: [SupplierProductAliasesService],
})
export class SupplierProductAliasesModule {}
