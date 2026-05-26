import 'dotenv/config';
import {
  PriceItemStatus,
  PriceListStatus,
  PriceUnit,
  PrismaClient,
} from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

type SotoRule = {
  minQuantity?: string;
  maxQuantity?: string;
  priceAmount: string;
  pricingMode?: 'UNIT_PRICE' | 'FLAT_TOTAL';
  rawUnitLabel?: string;
};

type SotoTariff = {
  descriptionRaw: string;
  matchCode: string;
  priceAmount: string;
  rules: SotoRule[];
};

const supplierName = 'SERVICIOS GRAFICOS SOTO';

const tariffs: SotoTariff[] = [
  {
    descriptionRaw: 'TARIFA TROQUELADO HASTA 52 x 70',
    matchCode: 'SOTO_TROQUELADO_HASTA_52X70',
    priceAmount: '52.0000',
    rules: [
      {
        maxQuantity: '1100',
        priceAmount: '52.0000',
        pricingMode: 'FLAT_TOTAL',
        rawUnitLabel: 'fijo hasta 1100 hojas',
      },
      { minQuantity: '1101', maxQuantity: '2100', priceAmount: '0.0450' },
      { minQuantity: '2101', maxQuantity: '3100', priceAmount: '0.0420' },
      { minQuantity: '3101', maxQuantity: '4100', priceAmount: '0.0380' },
      { minQuantity: '4101', maxQuantity: '5100', priceAmount: '0.0350' },
      { minQuantity: '5101', priceAmount: '0.0320' },
    ],
  },
  {
    descriptionRaw: 'TARIFA TROQUELADO MAS DE 52 x 70',
    matchCode: 'SOTO_TROQUELADO_MAS_52X70',
    priceAmount: '78.0000',
    rules: [
      {
        maxQuantity: '1100',
        priceAmount: '78.0000',
        pricingMode: 'FLAT_TOTAL',
        rawUnitLabel: 'fijo hasta 1100 hojas',
      },
      { minQuantity: '1101', maxQuantity: '2100', priceAmount: '0.0620' },
      { minQuantity: '2101', maxQuantity: '3100', priceAmount: '0.0580' },
      { minQuantity: '3101', maxQuantity: '4100', priceAmount: '0.0550' },
      { minQuantity: '4101', maxQuantity: '5100', priceAmount: '0.0520' },
      { minQuantity: '5101', priceAmount: '0.0480' },
    ],
  },
  {
    descriptionRaw: 'TARIFA TROQUELADO COMBO',
    matchCode: 'SOTO_TROQUELADO_COMBO',
    priceAmount: '0.0340',
    rules: [{ priceAmount: '0.0340' }],
  },
  {
    descriptionRaw: 'TARIFA TROQUELADO PIZZA DESDE 10000 HOJAS',
    matchCode: 'SOTO_TROQUELADO_PIZZA',
    priceAmount: '0.0300',
    rules: [{ minQuantity: '10000', priceAmount: '0.0300' }],
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
    update: {},
    create: {
      name: supplierName,
    },
  });

  await prisma.priceList.deleteMany({
    where: {
      supplierId: supplier.id,
      title: 'SOTO tarifas troquelado 2026',
    },
  });

  const priceList = await prisma.priceList.create({
    data: {
      supplierId: supplier.id,
      title: 'SOTO tarifas troquelado 2026',
      status: PriceListStatus.READY,
      validFrom: new Date('2026-04-29T00:00:00.000Z'),
      rawData: {
        source: 'script/import-soto-prices',
      },
    },
  });

  for (const tariff of tariffs) {
    await prisma.priceListItem.create({
      data: {
        priceListId: priceList.id,
        supplierId: supplier.id,
        descriptionRaw: tariff.descriptionRaw,
        descriptionNormalized: normalizeDescription(tariff.descriptionRaw),
        matchCode: tariff.matchCode,
        priceAmount: tariff.priceAmount,
        currency: 'EUR',
        priceUnit: PriceUnit.UNIT,
        priceQuantityBase: '1',
        rawUnitLabel: 'hoja',
        normalizedUnitPrice:
          tariff.rules[0].pricingMode === 'FLAT_TOTAL'
            ? null
            : tariff.priceAmount,
        normalizedUnit: PriceUnit.UNIT,
        status: PriceItemStatus.ACTIVE,
        rawData: {
          source: 'script/import-soto-prices',
          pricingMode: tariff.rules[0].pricingMode ?? 'UNIT_PRICE',
        },
        priceRules: {
          create: tariff.rules.map((rule) => ({
            minQuantity: rule.minQuantity,
            maxQuantity: rule.maxQuantity,
            priceAmount: rule.priceAmount,
            currency: 'EUR',
            priceUnit: PriceUnit.UNIT,
            priceQuantityBase: '1',
            rawUnitLabel: rule.rawUnitLabel ?? 'hoja',
            normalizedUnitPrice:
              rule.pricingMode === 'FLAT_TOTAL' ? null : rule.priceAmount,
            normalizedUnit: PriceUnit.UNIT,
            status: PriceItemStatus.ACTIVE,
            rawData: {
              source: 'script/import-soto-prices',
              pricingMode: rule.pricingMode ?? 'UNIT_PRICE',
            },
          })),
        },
      },
    });
  }

  console.log(
    `Imported SOTO test data. supplierId=${supplier.id} priceListId=${priceList.id} tariffs=${tariffs.length}`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
