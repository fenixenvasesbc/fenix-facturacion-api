import { PriceUnit } from '@prisma/client';
import { MoraYGomaExtractorService } from './mora-y-goma-extractor.service';

describe('MoraYGomaExtractorService', () => {
  let service: MoraYGomaExtractorService;

  beforeEach(() => {
    service = new MoraYGomaExtractorService();
  });

  it('extracts invoice rows using MORA Y GOMA table columns', () => {
    const items = service.extractInvoice({
      supplierName: 'MORA Y GOMA',
      rawData: {
        ocr: {
          tables: [
            {
              page: 1,
              rows: [
                [
                  'Su ref',
                  'HOJAS/ROLLOS',
                  'TAMANO',
                  'CANAL',
                  'DESCRIPCION',
                  'M.2/KGS.',
                  'PRECIO',
                  'IMPORTE',
                ],
                [
                  'tarancon',
                  '2.500',
                  '76,0*50,0',
                  'BICO-BICO',
                  '950,00',
                  '0,4334',
                  '411,73',
                ],
              ],
            },
          ],
        },
      },
    });

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      descriptionRaw: 'BICO-BICO 76,0*50,0',
      quantity: '950.0000',
      unit: PriceUnit.M2,
      unitPrice: '0.433400',
      totalAmount: '411.7300',
    });
  });
});
