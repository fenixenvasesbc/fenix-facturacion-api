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

  it('extracts the FAC-877 invoice without creating channel-only phantom items', () => {
    const items = service.extractInvoice({
      supplierName: 'SAICA PACK',
      rawText: `
Nº Factura:
FAC/00877
2.941,81
€/millar
141,89
20.733
Canal: E
310x310x40
Calidad: 17032620000
PIZZA 31 ANÓNIMA MARRON SIN PAQUETES
245368
ALB/1537/2026
No
1.382,38
€/millar
275,65
5.015
Canal: E
400x400x40
Calidad: 12032200000
S/ORD: 13/02
PIZZA 40 ANÓNIMA BLANCA SIN PAQUETES
244969
ALB/1537/2026
No
3.147,74
€/millar
162,59
19.360
Canal: E
330x330x40
Calidad: 12032200000
S/ORD: 13/02
PIZZA 33 ANÓNIMA BLANCA SIN PAQUETES
244968
ALB/1497/2026
No
960,18
€/millar
184,65
5.200
Canal: E
360x360x40
Calidad: 17032620000
S/ORD: 13/02
PIZZA 36 ANÓNIMA MARRON SIN PAQUETES (1SM9D)
244970
ALB/1497/2026
No
829,58
€/millar
296,28
2.800
Canal: E
660x940
Calidad: 18832200000
S/ORD: 05/02
PLANCHA ANÓNIMA
244680
ALB/1191/2026
No
6.841,90
€/millar
138,50
49.400
Canal: E
330x330x40
Calidad: 17032620000
S/ORD: 05/02
PIZZA 33 ANÓNIMA MARRON SIN PAQUETES
244682
ALB/1101/2026
No
2.516,48
€/millar
129,05
19.500
Canal: E
300x300x40
Calidad: 17032620000
S/ORD: 05/02
PIZZA 30 ANÓNIMA MARRON SIN PAQUETES
244683
ALB/1101/2026
No
1.826,82
€/millar
357,15
5.115
Canal: E
450x450x40
Calidad: 12032200000
S/ORD: 2/02
PIZZA 45 ANÓNIMA MARRON SIN PAQUETES BLANCA
244440
ALB/1006/2026
No
Total líneas: 8
`,
    });

    expect(items).toHaveLength(8);
    expect(items.map((item) => item.descriptionRaw)).not.toContain(
      'Canal: E E 310x310x40',
    );
    expect(items.map((item) => item.descriptionRaw)).not.toContain(
      'Canal: E E 400x400x40',
    );

    const sheet = items.find((item) => item.size === '660x940');

    expect(sheet).toMatchObject({
      descriptionRaw: 'PLANCHA ANÓNIMA E 660x940',
      matchCode: '1BBM9BB',
      quantity: '1737.1200',
      unit: PriceUnit.M2,
      unitPrice: '0.477561',
    });
  });
});
