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
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';
import { SuppliersService } from './suppliers.service';

@Controller('suppliers')
export class SuppliersController {
  private readonly logger = new Logger(SuppliersController.name);

  constructor(private readonly suppliersService: SuppliersService) {}

  @Post()
  create(@Body() dto: CreateSupplierDto) {
    this.logger.debug(`POST /suppliers received. name=${dto.name}`);
    return this.suppliersService.create(dto);
  }

  @Get()
  findAll() {
    this.logger.debug('GET /suppliers received');
    return this.suppliersService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    this.logger.debug(`GET /suppliers/:id received. supplierId=${id}`);
    return this.suppliersService.findOne(id);
  }

  @Get(':id/products')
  findProducts(@Param('id') id: string) {
    this.logger.debug(`GET /suppliers/:id/products received. supplierId=${id}`);

    return this.suppliersService.findProducts(id);
  }

  @Get(':id/aliases')
  findAliases(@Param('id') id: string) {
    this.logger.debug(`GET /suppliers/:id/aliases received. supplierId=${id}`);

    return this.suppliersService.findAliases(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateSupplierDto) {
    this.logger.debug(`PATCH /suppliers/:id received. supplierId=${id}`);
    return this.suppliersService.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    this.logger.debug(`DELETE /suppliers/:id received. supplierId=${id}`);
    return this.suppliersService.remove(id);
  }
}
