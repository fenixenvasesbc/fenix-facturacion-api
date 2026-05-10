import { Module } from '@nestjs/common';

import { OcrModule } from '../ocr/ocr.module';
import { PriceListParserModule } from '../price-list-parser/price-list-parser.module';
import { PrismaModule } from '../prisma/prisma.module';
import { PriceListsController } from './price-lists.controller';
import { PriceListsService } from './price-lists.service';

@Module({
  imports: [PrismaModule, OcrModule, PriceListParserModule],
  controllers: [PriceListsController],
  providers: [PriceListsService],
  exports: [PriceListsService],
})
export class PriceListsModule {}
