import {
  Body,
  Controller,
  Delete,
  Get,
  Logger,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { CreatePriceListItemDto } from './dto/create-price-list-item.dto';
import { UpdatePriceListItemDto } from './dto/update-price-list-item.dto';
import { PriceListItemsService } from './price-list-items.service';

@Controller('price-list-items')
export class PriceListItemsController {
  private readonly logger = new Logger(PriceListItemsController.name);

  constructor(private readonly priceListItemsService: PriceListItemsService) {}

  @Post()
  create(@Body() dto: CreatePriceListItemDto) {
    this.logger.debug(
      `POST /price-list-items received. supplierId=${dto.supplierId}`,
    );

    return this.priceListItemsService.create(dto);
  }

  @Get()
  findAll() {
    this.logger.debug('GET /price-list-items received');

    return this.priceListItemsService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    this.logger.debug(`GET /price-list-items/:id received. itemId=${id}`);

    return this.priceListItemsService.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdatePriceListItemDto) {
    this.logger.debug(`PATCH /price-list-items/:id received. itemId=${id}`);

    return this.priceListItemsService.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    this.logger.debug(`DELETE /price-list-items/:id received. itemId=${id}`);

    return this.priceListItemsService.remove(id);
  }
}
