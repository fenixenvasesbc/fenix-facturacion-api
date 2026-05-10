import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { CanonicalProductsController } from './canonical-products.controller';
import { CanonicalProductsService } from './canonical-products.service';

@Module({
  imports: [PrismaModule],
  controllers: [CanonicalProductsController],
  providers: [CanonicalProductsService],
  exports: [CanonicalProductsService],
})
export class CanonicalProductsModule {}
