import 'dotenv/config';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  PriceItemStatus,
  PriceListStatus,
  PriceUnit,
  Prisma,
  PrismaClient,
} from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

type PlastivalleCatalog = {
  proveedor: string;
  moneda: string;
  unidad_precio: string;
  productos: PlastivalleProduct[];
};

type PlastivalleProduct = {
  medida?: string;
  color?: string;
  tipo_asa?: string;
  descripcion: string;
  precio: number;
  matchcode: string;
};

const supplierName = 'PLASTIVALLE';
const catalogPath = join(
  process.cwd(),
  'scripts',
  'data',
  'plastivalle-precios-con-descripciones-y-matchcode.json',
);

function loadCatalog(): PlastivalleCatalog {
  return JSON.parse(readFileSync(catalogPath, 'utf8')) as PlastivalleCatalog;
}

function normalizeDescription(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

async function main() {
  const catalog = loadCatalog();
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
      legalName: 'PLASTIVALLE S.L.',
      taxId: 'B03730504',
    },
  });

  await prisma.priceList.deleteMany({
    where: {
      supplierId: supplier.id,
      title: 'PLASTIVALLE catalogo productos',
    },
  });

  const priceList = await prisma.priceList.create({
    data: {
      supplierId: supplier.id,
      title: 'PLASTIVALLE catalogo productos',
      status: PriceListStatus.READY,
      validFrom: new Date('2026-01-01T00:00:00.000Z'),
      rawData: {
        source: 'script/import-plastivalle-prices',
        catalog:
          'scripts/data/plastivalle-precios-con-descripciones-y-matchcode.json',
      },
    },
  });

  for (const product of catalog.productos) {
    const normalizedUnitPrice = product.precio / 1000;

    await prisma.priceListItem.create({
      data: {
        priceListId: priceList.id,
        supplierId: supplier.id,
        descriptionRaw: product.descripcion,
        descriptionNormalized: normalizeDescription(product.descripcion),
        matchCode: product.matchcode,
        priceAmount: product.precio.toFixed(4),
        currency: catalog.moneda || 'EUR',
        priceUnit: PriceUnit.THOUSAND_UNITS,
        priceQuantityBase: '1000',
        rawUnitLabel: 'millar',
        normalizedUnitPrice: normalizedUnitPrice.toFixed(6),
        normalizedUnit: PriceUnit.UNIT,
        status: PriceItemStatus.ACTIVE,
        rawData: {
          source: 'script/import-plastivalle-prices',
          originalProduct: product,
        } as Prisma.InputJsonObject,
        priceRules: {
          create: [
            {
              minQuantity: '1',
              priceAmount: product.precio.toFixed(4),
              currency: catalog.moneda || 'EUR',
              priceUnit: PriceUnit.THOUSAND_UNITS,
              priceQuantityBase: '1000',
              rawUnitLabel: 'millar',
              normalizedUnitPrice: normalizedUnitPrice.toFixed(6),
              normalizedUnit: PriceUnit.UNIT,
              status: PriceItemStatus.ACTIVE,
              rawData: {
                source: 'script/import-plastivalle-prices',
              },
            },
          ],
        },
      },
    });
  }

  console.log(
    `Imported PLASTIVALLE data. supplierId=${supplier.id} priceListId=${priceList.id} items=${catalog.productos.length}`,
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
