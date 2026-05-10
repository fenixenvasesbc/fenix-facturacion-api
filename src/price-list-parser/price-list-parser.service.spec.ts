import { PriceUnit } from '@prisma/client';
import { PriceListParserService } from './price-list-parser.service';

describe('PriceListParserService', () => {
  let service: PriceListParserService;

  beforeEach(() => {
    service = new PriceListParserService();
  });

  it('parses thousand-unit prices and normalizes to unit price', () => {
    const items = service.parse({
      rawText: 'Tornillo zincado caja profesional 459,40 € por millar dto 5%',
    });

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      priceAmount: '459.4000',
      priceUnit: PriceUnit.THOUSAND_UNITS,
      priceQuantityBase: '1000.0000',
      normalizedUnitPrice: '0.459400',
      normalizedUnit: PriceUnit.UNIT,
      discountPercent: '5.0000',
      channel: 'profesional',
    });
  });
});
