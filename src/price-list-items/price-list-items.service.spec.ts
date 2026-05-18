import { Test, TestingModule } from '@nestjs/testing';
import { PriceItemStatus, PriceUnit } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PriceListItemsService } from './price-list-items.service';

describe('PriceListItemsService', () => {
  let service: PriceListItemsService;
  let prisma: {
    priceListItem: {
      findUnique: jest.Mock;
      update: jest.Mock;
    };
  };

  beforeEach(async () => {
    prisma = {
      priceListItem: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PriceListItemsService,
        {
          provide: PrismaService,
          useValue: prisma,
        },
      ],
    }).compile();

    service = module.get<PriceListItemsService>(PriceListItemsService);
  });

  it('recalculates normalized unit price when price amount changes', async () => {
    const currentItem = {
      id: 'price-list-item-id',
      priceListId: 'price-list-id',
      supplierId: 'supplier-id',
      descriptionRaw: 'KRAFT-BICO',
      descriptionNormalized: 'kraft bico',
      priceAmount: { toString: () => '0.4591' },
      priceQuantityBase: { toString: () => '1' },
      priceUnit: PriceUnit.M2,
      normalizedUnitPrice: { toString: () => '0.459100' },
      normalizedUnit: PriceUnit.M2,
      status: PriceItemStatus.ACTIVE,
      supplier: {},
      priceList: {},
      canonicalProduct: null,
      aliases: [],
    };

    prisma.priceListItem.findUnique.mockResolvedValue(currentItem);
    prisma.priceListItem.update.mockResolvedValue({
      ...currentItem,
      priceAmount: '0.5078',
      normalizedUnitPrice: '0.507800',
    });

    await service.update('price-list-item-id', {
      priceAmount: '0.5078',
    });

    expect(prisma.priceListItem.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          priceAmount: '0.5078',
          normalizedUnitPrice: '0.507800',
        }),
      }),
    );
  });
});
