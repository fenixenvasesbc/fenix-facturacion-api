import { PriceUnit } from '@prisma/client';
import { SaicaExtractorService } from './saica-extractor.service';

describe('SaicaExtractorService', () => {
  let service: SaicaExtractorService;

  beforeEach(() => {
    service = new SaicaExtractorService();
  });

  it('extracts invoice items from SAICA embedded text', () => {
    const items = service.extractInvoice({
      supplierName: 'SAICA PACK',
      rawText: `
Nº Factura:
FAC/02110
3.687,45
€/millar
181,80
20.283
Canal: E
310x310x40
Calidad: 12032200000
S/ORD: 20/04
PIZZA 31 ANÓNIMA BLANCA SIN PAQUETES
247836
ALB/3177/2026
No
1.366,49
€/millar
238,48
5.730
Canal: E
630x1080
Calidad: 17032620000
S/ORD: 26/04
PLANCHA ANÓNIMA
247991
ALB/3176/2026
No
Total líneas: 2
`,
    });

    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      descriptionRaw: 'PIZZA 31 ANÓNIMA BLANCA SIN PAQUETES E 310x310x40',
      matchCode: '12032200000',
      channel: 'E',
      lengthMm: '310.0000',
      widthMm: '310.0000',
      heightMm: '40.0000',
      quantity: '20283.0000',
      unit: PriceUnit.UNIT,
      unitPrice: '0.181800',
      totalAmount: '3687.4500',
    });
    expect(items[1]).toMatchObject({
      descriptionRaw: 'PLANCHA ANÓNIMA E 630x1080',
      matchCode: '1SM9D',
      lengthMm: '630.0000',
      widthMm: '1080.0000',
      heightMm: undefined,
      quantity: '3898.6920',
      unit: PriceUnit.M2,
      unitPrice: '0.350500',
    });
  });

  it('maps anonymous sheet quality 18832200000 to BLANCO-M90-BLANCO tariff', () => {
    const items = service.extractInvoice({
      supplierName: 'SAICA PACK',
      rawText: `
1.105,43
€/millar
332,96
3.320
Canal: E
840x830
Calidad: 18832200000
S/ORD: 26/04
PLANCHA ANÓNIMA
247998
ALB/3176/2026
No
`,
    });

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      matchCode: '1BBM9BB',
      quantity: '2314.7040',
      unit: PriceUnit.M2,
      unitPrice: '0.477569',
    });
  });
});
