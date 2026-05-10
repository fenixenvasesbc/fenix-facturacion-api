import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PriceItemStatus, PriceUnit } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePriceListItemDto } from './dto/create-price-list-item.dto';
import { UpdatePriceListItemDto } from './dto/update-price-list-item.dto';

@Injectable()
export class PriceListItemsService {
  private readonly logger = new Logger(PriceListItemsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreatePriceListItemDto) {
    this.logger.log(
      `Creating price list item. supplierId=${dto.supplierId} priceListId=${dto.priceListId}`,
    );

    const priceList = await this.prisma.priceList.findUnique({
      where: {
        id: dto.priceListId,
      },
    });

    if (!priceList) {
      throw new NotFoundException('Lista de precios no encontrada');
    }

    if (priceList.supplierId !== dto.supplierId) {
      throw new BadRequestException(
        'La lista de precios no pertenece al proveedor indicado',
      );
    }

    const priceQuantityBase = dto.priceQuantityBase ?? '1.0000';
    const normalizedUnitPrice =
      dto.normalizedUnitPrice ??
      this.calculateNormalizedUnitPrice(dto.priceAmount, priceQuantityBase);
    const normalizedUnit =
      dto.normalizedUnit ??
      this.defaultNormalizedUnit(dto.priceUnit ?? PriceUnit.UNKNOWN);

    return this.prisma.priceListItem.create({
      data: {
        priceListId: dto.priceListId,
        supplierId: dto.supplierId,
        canonicalProductId: dto.canonicalProductId,
        descriptionRaw: dto.descriptionRaw,
        descriptionNormalized:
          dto.descriptionNormalized ??
          this.normalizeDescription(dto.descriptionRaw),
        channel: dto.channel,
        priceAmount: dto.priceAmount,
        currency: dto.currency ?? 'EUR',
        priceUnit: dto.priceUnit ?? PriceUnit.UNKNOWN,
        priceQuantityBase,
        rawUnitLabel: dto.rawUnitLabel,
        normalizedUnitPrice,
        normalizedUnit,
        discountPercent: dto.discountPercent,
        taxPercent: dto.taxPercent,
        status: dto.status ?? PriceItemStatus.ACTIVE,
        rawData: {
          source: 'manual',
          createdAt: new Date().toISOString(),
        },
      },
      include: {
        supplier: true,
        priceList: true,
        canonicalProduct: true,
        aliases: true,
      },
    });
  }

  async findAll() {
    this.logger.debug('Fetching active price list items');

    return this.prisma.priceListItem.findMany({
      where: {
        status: {
          not: PriceItemStatus.INACTIVE,
        },
      },
      include: {
        supplier: true,
        priceList: true,
        canonicalProduct: true,
        aliases: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async findOne(id: string) {
    this.logger.debug(`Fetching price list item. priceListItemId=${id}`);

    const item = await this.prisma.priceListItem.findUnique({
      where: {
        id,
      },
      include: {
        supplier: true,
        priceList: true,
        canonicalProduct: true,
        aliases: true,
      },
    });

    if (!item || item.status === PriceItemStatus.INACTIVE) {
      throw new NotFoundException('Producto de lista de precios no encontrado');
    }

    return item;
  }

  async update(id: string, dto: UpdatePriceListItemDto) {
    this.logger.log(`Updating price list item. priceListItemId=${id}`);

    await this.findOne(id);

    return this.prisma.priceListItem.update({
      where: {
        id,
      },
      data: {
        canonicalProductId: dto.canonicalProductId,
        descriptionRaw: dto.descriptionRaw,
        descriptionNormalized: dto.descriptionNormalized,
        channel: dto.channel,
        priceAmount: dto.priceAmount,
        currency: dto.currency,
        priceUnit: dto.priceUnit,
        priceQuantityBase: dto.priceQuantityBase,
        rawUnitLabel: dto.rawUnitLabel,
        normalizedUnitPrice: dto.normalizedUnitPrice,
        normalizedUnit: dto.normalizedUnit,
        discountPercent: dto.discountPercent,
        taxPercent: dto.taxPercent,
        status: dto.status,
        rowIndex: dto.rowIndex,
        pageNumber: dto.pageNumber,
      },
      include: {
        supplier: true,
        priceList: true,
        canonicalProduct: true,
        aliases: true,
      },
    });
  }

  async remove(id: string) {
    this.logger.warn(`Soft deleting price list item. priceListItemId=${id}`);

    await this.findOne(id);

    return this.prisma.priceListItem.update({
      where: {
        id,
      },
      data: {
        status: PriceItemStatus.INACTIVE,
      },
    });
  }

  private calculateNormalizedUnitPrice(
    priceAmount: string,
    priceQuantityBase: string,
  ) {
    const amount = Number(priceAmount);
    const quantityBase = Number(priceQuantityBase);

    if (
      !Number.isFinite(amount) ||
      !Number.isFinite(quantityBase) ||
      quantityBase <= 0
    ) {
      return undefined;
    }

    return (amount / quantityBase).toFixed(6);
  }

  private defaultNormalizedUnit(priceUnit: PriceUnit) {
    if (priceUnit === PriceUnit.THOUSAND_UNITS) {
      return PriceUnit.UNIT;
    }

    return priceUnit === PriceUnit.UNKNOWN ? undefined : priceUnit;
  }

  private normalizeDescription(value: string) {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }
}
