import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { PriceListItemsController } from './price-list-items.controller';
import { PriceListItemsService } from './price-list-items.service';

@Module({
  imports: [PrismaModule],
  controllers: [PriceListItemsController],
  providers: [PriceListItemsService],
  exports: [PriceListItemsService],
})
export class PriceListItemsModule {}
