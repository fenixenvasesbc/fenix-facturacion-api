import 'dotenv/config';
import { PrismaClient, PriceItemStatus, PriceListStatus, PriceUnit } from '@prisma/client';

const prisma = new PrismaClient();

type SaicaProduct = {
  descriptionRaw: string;
  matchCode: string;
  channel: string;
  lengthMm: string;
  widthMm: string;
  heightMm: string;
  prices: Array<{
    minQuantity: string;
    priceAmount: string;
  }>;
};

type SaicaTariff = {
  idQuality: string;
  descriptionRaw: string;
  channel: string;
  priceAmount: string;
  validFrom: string;
};

const supplierName = 'SAICA PACK';

const products: SaicaProduct[] = [
  {
    descriptionRaw: 'PIZZA 30 ANONIMA MARRON SIN PAQUETES',
    matchCode: '17032620000',
    channel: 'E',
    lengthMm: '300',
    widthMm: '300',
    heightMm: '40',
    prices: [
      { minQuantity: '10000', priceAmount: '141.96' },
      { minQuantity: '20000', priceAmount: '134.21' },
      { minQuantity: '50000', priceAmount: '132.18' },
    ],
  },
  {
    descriptionRaw: 'PLANCHA IMPRESA MASA NEGRA',
    matchCode: '17032620000',
    channel: 'E',
    lengthMm: '840',
    widthMm: '830',
    heightMm: '0',
    prices: [
      { minQuantity: '2500', priceAmount: '384.49' },
      { minQuantity: '5000', priceAmount: '356.77' },
      { minQuantity: '10000', priceAmount: '334.83' },
    ],
  },
  {
    descriptionRaw: 'PLANCHA IMPRESA MASA NEGRA',
    matchCode: '17032620000',
    channel: 'E',
    lengthMm: '1060',
    widthMm: '830',
    heightMm: '0',
    prices: [
      { minQuantity: '2500', priceAmount: '465.50' },
      { minQuantity: '5000', priceAmount: '434.51' },
      { minQuantity: '10000', priceAmount: '409.50' },
    ],
  },
  {
    descriptionRaw: 'PLANCHA IMPRESA MASA ROSA',
    matchCode: '12032200000',
    channel: 'E',
    lengthMm: '760',
    widthMm: '760',
    heightMm: '0',
    prices: [
      { minQuantity: '2500', priceAmount: '419.22' },
      { minQuantity: '5000', priceAmount: '390.78' },
      { minQuantity: '10000', priceAmount: '367.74' },
    ],
  },
  {
    descriptionRaw: 'PIZZA 26 ANONIMA BLANCA SIN PAQUETES',
    matchCode: '12032200000',
    channel: 'E',
    lengthMm: '260',
    widthMm: '260',
    heightMm: '35',
    prices: [
      { minQuantity: '10000', priceAmount: '135.56' },
      { minQuantity: '20000', priceAmount: '129.43' },
      { minQuantity: '50000', priceAmount: '124.70' },
    ],
  },
  {
    descriptionRaw: 'ANONIMAS',
    matchCode: '57042700000',
    channel: 'C',
    lengthMm: '405',
    widthMm: '325',
    heightMm: '430',
    prices: [
      { minQuantity: '500', priceAmount: '864.50' },
      { minQuantity: '1000', priceAmount: '807.92' },
      { minQuantity: '2500', priceAmount: '767.26' },
    ],
  },
  {
    descriptionRaw: 'PIZZA 45 ANONIMA MARRON SIN PAQUETES BLANCA',
    matchCode: '12032200000',
    channel: 'E',
    lengthMm: '450',
    widthMm: '450',
    heightMm: '40',
    prices: [{ minQuantity: '5000', priceAmount: '371.44' }],
  },
  {
    descriptionRaw: 'PLANCHA IMPRESA MASA ROSA',
    matchCode: '12032200000',
    channel: 'E',
    lengthMm: '1060',
    widthMm: '830',
    heightMm: '0',
    prices: [
      { minQuantity: '2500', priceAmount: '598.78' },
      { minQuantity: '5000', priceAmount: '563.00' },
      { minQuantity: '10000', priceAmount: '533.31' },
    ],
  },
  {
    descriptionRaw: 'PLANCHA IMPRESA MASA NEGRA',
    matchCode: '17032620000',
    channel: 'E',
    lengthMm: '890',
    widthMm: '820',
    heightMm: '0',
    prices: [
      { minQuantity: '2500', priceAmount: '398.94' },
      { minQuantity: '5000', priceAmount: '370.66' },
      { minQuantity: '10000', priceAmount: '348.14' },
    ],
  },
  {
    descriptionRaw: 'PLANCHA IMPRESA MASA NEGRA',
    matchCode: '17032620000',
    channel: 'E',
    lengthMm: '760',
    widthMm: '760',
    heightMm: '0',
    prices: [
      { minQuantity: '2500', priceAmount: '332.18' },
      { minQuantity: '5000', priceAmount: '306.59' },
      { minQuantity: '10000', priceAmount: '286.52' },
    ],
  },
  {
    descriptionRaw: 'PLANCHA IMPRESA MASA NEGRA',
    matchCode: '17032620000',
    channel: 'E',
    lengthMm: '910',
    widthMm: '720',
    heightMm: '0',
    prices: [
      { minQuantity: '2500', priceAmount: '365.87' },
      { minQuantity: '5000', priceAmount: '338.88' },
      { minQuantity: '10000', priceAmount: '317.67' },
    ],
  },
  {
    descriptionRaw: 'PIZZA 31 ANONIMA BLANCA SIN PAQUETES',
    matchCode: '12032200000',
    channel: 'E',
    lengthMm: '310',
    widthMm: '310',
    heightMm: '40',
    prices: [
      { minQuantity: '10000', priceAmount: '196.66' },
      { minQuantity: '20000', priceAmount: '189.07' },
      { minQuantity: '50000', priceAmount: '182.00' },
    ],
  },
  {
    descriptionRaw: 'PIZZA 31 ANONIMA MARRON SIN PAQUETES',
    matchCode: '17032620000',
    channel: 'E',
    lengthMm: '310',
    widthMm: '310',
    heightMm: '40',
    prices: [
      { minQuantity: '10000', priceAmount: '161.04' },
      { minQuantity: '20000', priceAmount: '147.57' },
      { minQuantity: '50000', priceAmount: '144.64' },
    ],
  },
  {
    descriptionRaw: 'PIZZA 33 ANONIMA MARRON SIN PAQUETES',
    matchCode: '17032620000',
    channel: 'E',
    lengthMm: '330',
    widthMm: '330',
    heightMm: '40',
    prices: [
      { minQuantity: '10000', priceAmount: '156.14' },
      { minQuantity: '20000', priceAmount: '146.38' },
      { minQuantity: '50000', priceAmount: '144.04' },
    ],
  },
  {
    descriptionRaw: 'PIZZA 36 ANONIMA BLANCA SIN PAQUETES',
    matchCode: '12032200000',
    channel: 'E',
    lengthMm: '360',
    widthMm: '360',
    heightMm: '40',
    prices: [
      { minQuantity: '4000', priceAmount: '227.14' },
      { minQuantity: '7800', priceAmount: '216.28' },
    ],
  },
  {
    descriptionRaw: 'PIZZA 50 ANONIMA BLANCA SIN PAQUETES',
    matchCode: '12032200000',
    channel: 'E',
    lengthMm: '500',
    widthMm: '500',
    heightMm: '40',
    prices: [{ minQuantity: '6000', priceAmount: '400.26' }],
  },
  {
    descriptionRaw: 'PIZZA 33 ANONIMA BLANCA SIN PAQUETES',
    matchCode: '12032200000',
    channel: 'E',
    lengthMm: '330',
    widthMm: '330',
    heightMm: '40',
    prices: [
      { minQuantity: '10000', priceAmount: '177.23' },
      { minQuantity: '20000', priceAmount: '169.09' },
      { minQuantity: '50000', priceAmount: '167.13' },
    ],
  },
  {
    descriptionRaw: 'PIZZA 30 ANONIMA BLANCA SIN PAQUETES',
    matchCode: '12032200000',
    channel: 'E',
    lengthMm: '300',
    widthMm: '300',
    heightMm: '40',
    prices: [
      { minQuantity: '10000', priceAmount: '168.42' },
      { minQuantity: '20000', priceAmount: '156.28' },
      { minQuantity: '50000', priceAmount: '154.65' },
    ],
  },
  {
    descriptionRaw: 'PIZZA 40 ANONIMA BLANCA SIN PAQUETES',
    matchCode: '12032200000',
    channel: 'E',
    lengthMm: '400',
    widthMm: '400',
    heightMm: '40',
    prices: [{ minQuantity: '5000', priceAmount: '286.68' }],
  },
  {
    descriptionRaw: 'PIZZA 36 ANONIMA MARRON SIN PAQUETES (1SM9D)',
    matchCode: '17032620000',
    channel: 'E',
    lengthMm: '360',
    widthMm: '360',
    heightMm: '40',
    prices: [{ minQuantity: '5000', priceAmount: '192.04' }],
  },
  {
    descriptionRaw: 'PIZZA 50 ANONIMA MARRON SIN PAQUETES',
    matchCode: '17032620000',
    channel: 'E',
    lengthMm: '500',
    widthMm: '500',
    heightMm: '40',
    prices: [{ minQuantity: '6000', priceAmount: '338.83' }],
  },
  {
    descriptionRaw: 'PIZZA 40 ANONIMA MARRON SIN PAQUETES',
    matchCode: '17032620000',
    channel: 'E',
    lengthMm: '400',
    widthMm: '400',
    heightMm: '40',
    prices: [{ minQuantity: '5000', priceAmount: '234.57' }],
  },
  {
    descriptionRaw: 'PIZZA 26 ANONIMA MARRON SIN PAQUETES',
    matchCode: '17032620000',
    channel: 'E',
    lengthMm: '260',
    widthMm: '260',
    heightMm: '35',
    prices: [
      { minQuantity: '5000', priceAmount: '121.32' },
      { minQuantity: '10000', priceAmount: '112.74' },
      { minQuantity: '20000', priceAmount: '102.51' },
      { minQuantity: '50000', priceAmount: '101.66' },
    ],
  },
  {
    descriptionRaw: 'PIZZA 45 ANONIMA MARRON SIN PAQUETES',
    matchCode: '17032620000',
    channel: 'E',
    lengthMm: '450',
    widthMm: '450',
    heightMm: '40',
    prices: [{ minQuantity: '5000', priceAmount: '305.97' }],
  },
];

const tariffs: SaicaTariff[] = [
  {
    idQuality: '1BBM9BB',
    descriptionRaw: 'BLANCO-M90-BLANCO M/O',
    channel: 'E',
    priceAmount: '496.67',
    validFrom: '2026-04-27',
  },
  {
    idQuality: '1BBM9D',
    descriptionRaw: 'BLANCO-M90-D M/O',
    channel: 'E',
    priceAmount: '427.46',
    validFrom: '2026-04-27',
  },
  {
    idQuality: '1DM9D',
    descriptionRaw: 'D-M90-D M/O',
    channel: 'E',
    priceAmount: '358.23',
    validFrom: '2026-04-27',
  },
  {
    idQuality: '1SM9D',
    descriptionRaw: 'SK125-M90-D M/O',
    channel: 'E',
    priceAmount: '364.52',
    validFrom: '2026-04-27',
  },
  {
    idQuality: '1SM9S',
    descriptionRaw: 'SK125-M90-SK125 M/O',
    channel: 'E',
    priceAmount: '438.68',
    validFrom: '2026-04-27',
  },
  {
    idQuality: '1TBM9BB',
    descriptionRaw: 'TB-M90-BLANCO M/O ESPECIAL',
    channel: 'E',
    priceAmount: '496.67',
    validFrom: '2026-04-27',
  },
];

function normalizeDescription(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function normalizedUnitPrice(priceAmount: string, priceQuantityBase: string) {
  return (Number(priceAmount) / Number(priceQuantityBase)).toFixed(6);
}

async function main() {
  const supplier = await prisma.supplier.upsert({
    where: {
      id:
        (
          await prisma.supplier.findFirst({
            where: {
              name: {
                equals: supplierName,
                mode: 'insensitive',
              },
            },
            select: {
              id: true,
            },
          })
        )?.id ?? '00000000-0000-0000-0000-000000000000',
    },
    create: {
      name: supplierName,
      legalName: 'Cartonajes Bañeres S.A.',
      taxId: 'A03009263',
    },
    update: {},
  });

  await prisma.priceList.deleteMany({
    where: {
      supplierId: supplier.id,
      OR: [
        {
          title: {
            startsWith: 'SAICA nuevos precios',
          },
        },
        {
          title: {
            startsWith: 'SAICA tarifa plancha',
          },
        },
      ],
    },
  });

  const productList = await prisma.priceList.create({
    data: {
      supplierId: supplier.id,
      title: `SAICA nuevos precios ${new Date().toISOString()}`,
      status: PriceListStatus.READY,
      rawData: {
        source: 'script/import-saica-prices',
        document: 'nuevos precios saica.pdf',
      },
    },
  });

  const tariffList = await prisma.priceList.create({
    data: {
      supplierId: supplier.id,
      title: `SAICA tarifa plancha ${new Date().toISOString()}`,
      status: PriceListStatus.READY,
      rawData: {
        source: 'script/import-saica-prices',
        document: 'SAICA 3.pdf',
      },
    },
  });

  for (const product of products) {
    const firstPrice = product.prices[0];

    await prisma.priceListItem.create({
      data: {
        priceListId: productList.id,
        supplierId: supplier.id,
        descriptionRaw: product.descriptionRaw,
        descriptionNormalized: normalizeDescription(product.descriptionRaw),
        matchCode: product.matchCode,
        channel: product.channel,
        lengthMm: product.lengthMm,
        widthMm: product.widthMm,
        heightMm: product.heightMm,
        priceAmount: firstPrice.priceAmount,
        currency: 'EUR',
        priceUnit: PriceUnit.THOUSAND_UNITS,
        priceQuantityBase: '1000',
        rawUnitLabel: 'millar',
        normalizedUnitPrice: normalizedUnitPrice(firstPrice.priceAmount, '1000'),
        normalizedUnit: PriceUnit.UNIT,
        status: PriceItemStatus.ACTIVE,
        rawData: {
          source: 'script/import-saica-prices',
        },
        priceRules: {
          create: product.prices.map((price) => ({
            minQuantity: price.minQuantity,
            priceAmount: price.priceAmount,
            currency: 'EUR',
            priceUnit: PriceUnit.THOUSAND_UNITS,
            priceQuantityBase: '1000',
            rawUnitLabel: 'millar',
            normalizedUnitPrice: normalizedUnitPrice(price.priceAmount, '1000'),
            normalizedUnit: PriceUnit.UNIT,
            status: PriceItemStatus.ACTIVE,
            rawData: {
              source: 'script/import-saica-prices',
            },
          })),
        },
      },
    });
  }

  for (const tariff of tariffs) {
    await prisma.priceListItem.create({
      data: {
        priceListId: tariffList.id,
        supplierId: supplier.id,
        descriptionRaw: tariff.descriptionRaw,
        descriptionNormalized: normalizeDescription(tariff.descriptionRaw),
        matchCode: tariff.idQuality,
        channel: tariff.channel,
        priceAmount: tariff.priceAmount,
        currency: 'EUR',
        priceUnit: PriceUnit.M2,
        priceQuantityBase: '1000',
        rawUnitLabel: '1000 m2',
        normalizedUnitPrice: normalizedUnitPrice(tariff.priceAmount, '1000'),
        normalizedUnit: PriceUnit.M2,
        status: PriceItemStatus.ACTIVE,
        rawData: {
          source: 'script/import-saica-prices',
          validFrom: tariff.validFrom,
        },
        priceRules: {
          create: {
            priceAmount: tariff.priceAmount,
            currency: 'EUR',
            priceUnit: PriceUnit.M2,
            priceQuantityBase: '1000',
            rawUnitLabel: '1000 m2',
            normalizedUnitPrice: normalizedUnitPrice(tariff.priceAmount, '1000'),
            normalizedUnit: PriceUnit.M2,
            status: PriceItemStatus.ACTIVE,
            rawData: {
              source: 'script/import-saica-prices',
              validFrom: tariff.validFrom,
            },
          },
        },
      },
    });
  }

  console.log(
    `Imported SAICA test data. supplierId=${supplier.id} productListId=${productList.id} tariffListId=${tariffList.id} products=${products.length} tariffs=${tariffs.length}`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
