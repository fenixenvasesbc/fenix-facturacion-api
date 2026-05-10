import { Module } from '@nestjs/common';
import { PriceListParserService } from './price-list-parser.service';

@Module({
  providers: [PriceListParserService],
  exports: [PriceListParserService],
})
export class PriceListParserModule {}
