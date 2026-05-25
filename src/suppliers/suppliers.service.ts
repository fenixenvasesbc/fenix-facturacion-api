import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PriceItemStatus, SupplierStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';

@Injectable()
export class SuppliersService {
  private readonly logger = new Logger(SuppliersService.name);

  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateSupplierDto) {
    this.logger.log(`Creating supplier: ${dto.name}`);

    const supplier = await this.prisma.supplier.create({
      data: {
        name: dto.name,
        legalName: dto.legalName,
        taxId: dto.taxId,
        email: dto.email,
        phone: dto.phone,
        address: dto.address,
      },
    });

    this.logger.log(`Supplier created successfully. supplierId=${supplier.id}`);

    return supplier;
  }

  async findAll() {
    this.logger.debug('Fetching active suppliers');

    return this.prisma.supplier.findMany({
      where: {
        status: SupplierStatus.ACTIVE,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async findOne(id: string) {
    this.logger.debug(`Fetching supplier by id. supplierId=${id}`);

    const supplier = await this.prisma.supplier.findUnique({
      where: { id },
    });

    if (!supplier || supplier.status === SupplierStatus.INACTIVE) {
      this.logger.warn(`Supplier not found or inactive. supplierId=${id}`);
      throw new NotFoundException('Proveedor no encontrado');
    }

    return supplier;
  }

  async update(id: string, dto: UpdateSupplierDto) {
    this.logger.log(`Updating supplier. supplierId=${id}`);

    await this.findOne(id);

    const supplier = await this.prisma.supplier.update({
      where: { id },
      data: {
        name: dto.name,
        legalName: dto.legalName,
        taxId: dto.taxId,
        email: dto.email,
        phone: dto.phone,
        address: dto.address,
      },
    });

    this.logger.log(`Supplier updated successfully. supplierId=${id}`);

    return supplier;
  }

  async findProducts(id: string) {
    this.logger.debug(`Fetching supplier products. supplierId=${id}`);

    await this.findOne(id);

    return this.prisma.priceListItem.findMany({
      where: {
        supplierId: id,
        status: {
          not: PriceItemStatus.INACTIVE,
        },
      },
      include: {
        priceList: true,
        canonicalProduct: true,
        aliases: true,
        priceRules: {
          where: {
            status: {
              not: PriceItemStatus.INACTIVE,
            },
          },
          orderBy: {
            minQuantity: 'asc',
          },
        },
      },
      orderBy: [
        {
          descriptionNormalized: 'asc',
        },
        {
          createdAt: 'desc',
        },
      ],
    });
  }

  async findAliases(id: string) {
    this.logger.debug(`Fetching supplier aliases. supplierId=${id}`);

    await this.findOne(id);

    return this.prisma.supplierProductAlias.findMany({
      where: {
        supplierId: id,
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

  async remove(id: string) {
    this.logger.warn(`Soft deleting supplier. supplierId=${id}`);

    await this.findOne(id);

    const supplier = await this.prisma.supplier.update({
      where: { id },
      data: {
        status: SupplierStatus.INACTIVE,
      },
    });

    this.logger.warn(`Supplier marked as inactive. supplierId=${id}`);

    return supplier;
  }
}
