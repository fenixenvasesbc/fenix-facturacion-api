import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSupplierProductAliasDto } from './dto/create-supplier-product-alias.dto';
import { UpdateSupplierProductAliasDto } from './dto/update-supplier-product-alias.dto';

@Injectable()
export class SupplierProductAliasesService {
  private readonly logger = new Logger(SupplierProductAliasesService.name);

  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateSupplierProductAliasDto) {
    this.logger.log(
      `Creating supplier product alias. supplierId=${dto.supplierId}`,
    );

    return this.prisma.supplierProductAlias.create({
      data: {
        supplierId: dto.supplierId,
        canonicalProductId: dto.canonicalProductId,
        priceListItemId: dto.priceListItemId,
        aliasRaw: dto.aliasRaw,
        aliasNormalized:
          dto.aliasNormalized ?? this.normalizeAlias(dto.aliasRaw),
        confidence: dto.confidence,
      },
      include: {
        supplier: true,
        canonicalProduct: true,
        priceListItem: true,
      },
    });
  }

  async findAll() {
    this.logger.debug('Fetching supplier product aliases');

    return this.prisma.supplierProductAlias.findMany({
      include: {
        supplier: true,
        canonicalProduct: true,
        priceListItem: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async findBySupplier(supplierId: string) {
    this.logger.debug(`Fetching aliases by supplier. supplierId=${supplierId}`);

    return this.prisma.supplierProductAlias.findMany({
      where: {
        supplierId,
      },
      include: {
        canonicalProduct: true,
        priceListItem: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async findOne(id: string) {
    this.logger.debug(`Fetching supplier product alias. aliasId=${id}`);

    const alias = await this.prisma.supplierProductAlias.findUnique({
      where: {
        id,
      },
      include: {
        supplier: true,
        canonicalProduct: true,
        priceListItem: true,
      },
    });

    if (!alias) {
      throw new NotFoundException('Alias de producto no encontrado');
    }

    return alias;
  }

  async update(id: string, dto: UpdateSupplierProductAliasDto) {
    this.logger.log(`Updating supplier product alias. aliasId=${id}`);

    await this.findOne(id);

    return this.prisma.supplierProductAlias.update({
      where: {
        id,
      },
      data: {
        supplierId: dto.supplierId,
        canonicalProductId: dto.canonicalProductId,
        priceListItemId: dto.priceListItemId,
        aliasRaw: dto.aliasRaw,
        aliasNormalized:
          dto.aliasNormalized ??
          (dto.aliasRaw ? this.normalizeAlias(dto.aliasRaw) : undefined),
        confidence: dto.confidence,
      },
      include: {
        supplier: true,
        canonicalProduct: true,
        priceListItem: true,
      },
    });
  }

  async remove(id: string) {
    this.logger.warn(`Deleting supplier product alias. aliasId=${id}`);

    await this.findOne(id);

    return this.prisma.supplierProductAlias.delete({
      where: {
        id,
      },
    });
  }

  private normalizeAlias(value: string) {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }
}
