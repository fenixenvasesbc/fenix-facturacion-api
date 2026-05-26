import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PriceItemStatus, PriceUnit } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreatePriceListItemDto,
  CreatePriceListItemPriceDto,
} from './dto/create-price-list-item.dto';
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

    const firstPrice = dto.prices?.[0];
    const legacyPriceAmount = dto.priceAmount ?? firstPrice?.priceAmount;

    if (!legacyPriceAmount) {
      throw new BadRequestException(
        'Debe indicar priceAmount o al menos una regla en prices',
      );
    }

    const legacyPriceUnit =
      dto.priceUnit ?? firstPrice?.priceUnit ?? PriceUnit.UNKNOWN;
    const priceQuantityBase =
      dto.priceQuantityBase ?? firstPrice?.priceQuantityBase ?? '1.0000';
    const normalizedUnitPrice =
      dto.normalizedUnitPrice ??
      firstPrice?.normalizedUnitPrice ??
      (this.isFlatTotal(dto.pricingMode ?? firstPrice?.pricingMode)
        ? undefined
        : this.calculateNormalizedUnitPrice(
            legacyPriceAmount,
            priceQuantityBase,
          ));
    const normalizedUnit =
      dto.normalizedUnit ??
      firstPrice?.normalizedUnit ??
      this.defaultNormalizedUnit(legacyPriceUnit);

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
        matchCode: this.normalizeMatchCode(dto.matchCode),
        lengthMm: dto.lengthMm,
        widthMm: dto.widthMm,
        heightMm: dto.heightMm,
        priceAmount: legacyPriceAmount,
        currency: dto.currency ?? firstPrice?.currency ?? 'EUR',
        priceUnit: legacyPriceUnit,
        priceQuantityBase,
        rawUnitLabel: dto.rawUnitLabel ?? firstPrice?.rawUnitLabel,
        normalizedUnitPrice,
        normalizedUnit,
        discountPercent: dto.discountPercent ?? firstPrice?.discountPercent,
        taxPercent: dto.taxPercent ?? firstPrice?.taxPercent,
        status: dto.status ?? PriceItemStatus.ACTIVE,
        rawData: {
          source: 'manual',
          pricingMode: dto.pricingMode ?? firstPrice?.pricingMode,
          createdAt: new Date().toISOString(),
        },
        priceRules:
          dto.prices && dto.prices.length > 0
            ? {
                create: dto.prices.map((price) =>
                  this.toPriceRuleCreateInput(price),
                ),
              }
            : undefined,
      },
      include: {
        supplier: true,
        priceList: true,
        canonicalProduct: true,
        aliases: true,
        priceRules: {
          orderBy: {
            minQuantity: 'asc',
          },
        },
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
    });

    if (!item || item.status === PriceItemStatus.INACTIVE) {
      throw new NotFoundException('Producto de lista de precios no encontrado');
    }

    return item;
  }

  async update(id: string, dto: UpdatePriceListItemDto) {
    this.logger.log(`Updating price list item. priceListItemId=${id}`);

    const currentItem = await this.findOne(id);
    const priceQuantityBase =
      dto.priceQuantityBase ?? currentItem.priceQuantityBase.toString();
    const normalizedUnitPrice =
      dto.normalizedUnitPrice ??
      (dto.priceAmount !== undefined || dto.priceQuantityBase !== undefined
        ? this.calculateNormalizedUnitPrice(
            dto.priceAmount ?? currentItem.priceAmount.toString(),
            priceQuantityBase,
          )
        : undefined);
    const normalizedUnit =
      dto.normalizedUnit ??
      (dto.priceUnit !== undefined
        ? this.defaultNormalizedUnit(dto.priceUnit)
        : undefined);

    const updateArgs = {
      where: {
        id,
      },
      data: {
        canonicalProductId: dto.canonicalProductId,
        descriptionRaw: dto.descriptionRaw,
        descriptionNormalized: dto.descriptionNormalized,
        channel: dto.channel,
        matchCode:
          dto.matchCode === undefined
            ? undefined
            : this.normalizeMatchCode(dto.matchCode),
        lengthMm: dto.lengthMm,
        widthMm: dto.widthMm,
        heightMm: dto.heightMm,
        priceAmount: dto.priceAmount,
        currency: dto.currency,
        priceUnit: dto.priceUnit,
        priceQuantityBase: dto.priceQuantityBase,
        rawUnitLabel: dto.rawUnitLabel,
        normalizedUnitPrice,
        normalizedUnit,
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
        priceRules: {
          where: {
            status: {
              not: PriceItemStatus.INACTIVE,
            },
          },
          orderBy: {
            minQuantity: 'asc' as const,
          },
        },
      },
    };

    if (dto.prices === undefined) {
      return this.prisma.priceListItem.update(updateArgs);
    }

    const findUniqueArgs = {
      where: updateArgs.where,
      include: updateArgs.include,
    };

    const updatedItem = await this.prisma.$transaction(async (tx) => {
      await tx.priceListItem.update({
        where: updateArgs.where,
        data: updateArgs.data,
      });

      await tx.priceListItemPrice.deleteMany({
        where: {
          priceListItemId: id,
        },
      });

      if (dto.prices && dto.prices.length > 0) {
        await tx.priceListItemPrice.createMany({
          data: dto.prices.map((price) => ({
            priceListItemId: id,
            ...this.toPriceRuleCreateInput(price),
          })),
        });
      }

      return tx.priceListItem.findUnique(findUniqueArgs);
    });

    if (!updatedItem) {
      throw new NotFoundException('Producto de lista de precios no encontrado');
    }

    return updatedItem;
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

  private normalizeMatchCode(value?: string) {
    const normalized = value?.trim();

    return normalized ? normalized.toUpperCase() : undefined;
  }

  private toPriceRuleCreateInput(price: CreatePriceListItemPriceDto) {
    const priceQuantityBase = price.priceQuantityBase ?? '1.0000';
    const priceUnit = price.priceUnit ?? PriceUnit.UNKNOWN;
    const normalizedUnitPrice =
      price.normalizedUnitPrice ??
      (this.isFlatTotal(price.pricingMode)
        ? undefined
        : this.calculateNormalizedUnitPrice(
            price.priceAmount,
            priceQuantityBase,
          ));

    return {
      minQuantity: price.minQuantity,
      maxQuantity: price.maxQuantity,
      priceAmount: price.priceAmount,
      currency: price.currency ?? 'EUR',
      priceUnit,
      priceQuantityBase,
      rawUnitLabel: price.rawUnitLabel,
      normalizedUnitPrice,
      normalizedUnit:
        price.normalizedUnit ?? this.defaultNormalizedUnit(priceUnit),
      discountPercent: price.discountPercent,
      taxPercent: price.taxPercent,
      status: price.status ?? PriceItemStatus.ACTIVE,
      rawData: {
        source: 'manual',
        pricingMode: price.pricingMode,
        createdAt: new Date().toISOString(),
      },
    };
  }

  private isFlatTotal(pricingMode?: string) {
    return pricingMode === 'FLAT_TOTAL';
  }
}
