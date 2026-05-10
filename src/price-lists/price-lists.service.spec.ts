import { Test, TestingModule } from '@nestjs/testing';
import { OcrService } from '../ocr/ocr.service';
import { PriceListParserService } from '../price-list-parser/price-list-parser.service';
import { PrismaService } from '../prisma/prisma.service';
import { PriceListsService } from './price-lists.service';

describe('PriceListsService', () => {
  let service: PriceListsService;
  let prisma: {
    supplier: {
      findUnique: jest.Mock;
    };
    priceList: {
      create: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
    };
    priceListItem: {
      deleteMany: jest.Mock;
      createMany: jest.Mock;
    };
    $transaction: jest.Mock;
  };
  let ocrService: {
    extractText: jest.Mock;
  };
  let priceListParser: {
    parse: jest.Mock;
  };

  beforeEach(async () => {
    prisma = {
      supplier: {
        findUnique: jest.fn(),
      },
      priceList: {
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      priceListItem: {
        deleteMany: jest.fn(),
        createMany: jest.fn(),
      },
      $transaction: jest.fn(),
    };
    ocrService = {
      extractText: jest.fn(),
    };
    priceListParser = {
      parse: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PriceListsService,
        {
          provide: PrismaService,
          useValue: prisma,
        },
        {
          provide: OcrService,
          useValue: ocrService,
        },
        {
          provide: PriceListParserService,
          useValue: priceListParser,
        },
      ],
    }).compile();

    service = module.get<PriceListsService>(PriceListsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('runs OCR and parsing automatically after upload', async () => {
    const priceList = {
      id: 'price-list-id',
      supplierId: 'supplier-id',
      documentUrl: 'uploads/list.pdf',
      fileName: 'list.pdf',
      mimeType: 'application/pdf',
      rawText: 'Producto 10,00 € unidad',
      rawData: null,
    };
    const finalPriceList = {
      ...priceList,
      items: [],
    };

    prisma.supplier.findUnique.mockResolvedValue({ id: 'supplier-id' });
    prisma.priceList.create.mockResolvedValue(priceList);
    prisma.priceList.findUnique
      .mockResolvedValueOnce(priceList)
      .mockResolvedValueOnce({
        ...priceList,
        rawText: 'Producto 10,00 € unidad',
        rawData: { ocr: {} },
      })
      .mockResolvedValueOnce(finalPriceList);
    prisma.priceList.update.mockResolvedValue(priceList);
    prisma.$transaction.mockResolvedValue([]);
    ocrService.extractText.mockResolvedValue({
      text: 'Producto 10,00 € unidad',
      engine: 'test',
      metadata: {},
      lines: [],
      tables: [],
    });
    priceListParser.parse.mockReturnValue([
      {
        descriptionRaw: 'Producto',
        descriptionNormalized: 'producto',
        priceAmount: '10.0000',
        currency: 'EUR',
        priceUnit: 'UNIT',
        priceQuantityBase: '1.0000',
        normalizedUnitPrice: '10.000000',
        normalizedUnit: 'UNIT',
        status: 'ACTIVE',
        rowIndex: 0,
        rawData: {},
      },
    ]);

    const result = await service.upload(
      { supplierId: 'supplier-id', title: 'Lista demo' },
      {
        originalname: 'list.pdf',
        mimetype: 'application/pdf',
        size: 100,
        path: 'uploads/list.pdf',
      } as Express.Multer.File,
    );

    expect(ocrService.extractText).toHaveBeenCalled();
    expect(priceListParser.parse).toHaveBeenCalled();
    expect(prisma.priceListItem.createMany).toHaveBeenCalled();
    expect(result).toEqual(finalPriceList);
  });
});
