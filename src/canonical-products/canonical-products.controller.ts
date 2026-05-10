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
import { CanonicalProductsService } from './canonical-products.service';
import { CreateCanonicalProductDto } from './dto/create-canonical-product.dto';
import { UpdateCanonicalProductDto } from './dto/update-canonical-product.dto';

@Controller('canonical-products')
export class CanonicalProductsController {
  private readonly logger = new Logger(CanonicalProductsController.name);

  constructor(
    private readonly canonicalProductsService: CanonicalProductsService,
  ) {}

  @Post()
  create(@Body() dto: CreateCanonicalProductDto) {
    this.logger.debug(`POST /canonical-products received. name=${dto.name}`);

    return this.canonicalProductsService.create(dto);
  }

  @Get()
  findAll() {
    this.logger.debug('GET /canonical-products received');

    return this.canonicalProductsService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    this.logger.debug(
      `GET /canonical-products/:id received. canonicalProductId=${id}`,
    );

    return this.canonicalProductsService.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateCanonicalProductDto) {
    this.logger.debug(
      `PATCH /canonical-products/:id received. canonicalProductId=${id}`,
    );

    return this.canonicalProductsService.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    this.logger.debug(
      `DELETE /canonical-products/:id received. canonicalProductId=${id}`,
    );

    return this.canonicalProductsService.remove(id);
  }
}
