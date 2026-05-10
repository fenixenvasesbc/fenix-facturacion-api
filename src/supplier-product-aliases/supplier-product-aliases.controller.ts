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
import { CreateSupplierProductAliasDto } from './dto/create-supplier-product-alias.dto';
import { UpdateSupplierProductAliasDto } from './dto/update-supplier-product-alias.dto';
import { SupplierProductAliasesService } from './supplier-product-aliases.service';

@Controller('supplier-product-aliases')
export class SupplierProductAliasesController {
  private readonly logger = new Logger(SupplierProductAliasesController.name);

  constructor(
    private readonly supplierProductAliasesService: SupplierProductAliasesService,
  ) {}

  @Post()
  create(@Body() dto: CreateSupplierProductAliasDto) {
    this.logger.debug(
      `POST /supplier-product-aliases received. supplierId=${dto.supplierId}`,
    );

    return this.supplierProductAliasesService.create(dto);
  }

  @Get()
  findAll() {
    this.logger.debug('GET /supplier-product-aliases received');

    return this.supplierProductAliasesService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    this.logger.debug(
      `GET /supplier-product-aliases/:id received. aliasId=${id}`,
    );

    return this.supplierProductAliasesService.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateSupplierProductAliasDto) {
    this.logger.debug(
      `PATCH /supplier-product-aliases/:id received. aliasId=${id}`,
    );

    return this.supplierProductAliasesService.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    this.logger.debug(
      `DELETE /supplier-product-aliases/:id received. aliasId=${id}`,
    );

    return this.supplierProductAliasesService.remove(id);
  }
}
