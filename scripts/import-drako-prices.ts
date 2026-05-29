import 'dotenv/config';
import { readFile } from 'fs/promises';
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

type DrakoCatalog = {
  productos: DrakoCatalogProduct[];
};

type DrakoCatalogProduct = {
  categoria: string;
  descripcion: string;
  medidas?: string;
  medida?: string;
  forma?: string;
  color?: string;
  precios: Record<string, number | { precio_unitario?: number; total: number }>;
};

const supplierName = 'DRAKO IMPRESORES';

function normalizeDescription(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function normalizeKey(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function matchCode(product: DrakoCatalogProduct) {
  const category = normalizeDescription(product.categoria);
  const description = normalizeDescription(product.descripcion);
  const measure = product.medidas ?? product.medida ?? '';

  if (category.includes('papel antigrasa')) {
    if (measure.includes('25x28')) {
      return 'DRAKO_ANTIGRASA_25X28';
    }

    if (
      measure.includes('31x31') ||
      measure.includes('28x34') ||
      measure.includes('28x31')
    ) {
      return 'DRAKO_ANTIGRASA_31X31_28X34_28X31';
    }

    if (measure.includes('30x40')) {
      return 'DRAKO_ANTIGRASA_30X40';
    }

    if (measure.includes('16x28')) {
      return 'DRAKO_ANTIGRASA_16X28';
    }

    return 'DRAKO_ANTIGRASA';
  }

  if (category.includes('adhesivo')) {
    const shape = product.forma ? normalizeKey(product.forma) : 'GENERICO';
    const size = normalizeKey(product.medida ?? '').replace('_CM', 'CM');

    return size
      ? `DRAKO_ADHESIVO_${shape}_${size}`
      : `DRAKO_ADHESIVO_${shape}`;
  }

  if (category.includes('lamina') && description.includes('2 cara')) {
    return 'DRAKO_LAMINAS_2_CARAS';
  }

  if (category.includes('lamina')) {
    return 'DRAKO_LAMINAS_1_CARA';
  }

  if (category.includes('mantel')) {
    const color = normalizeDescription(product.color ?? '');

    if (color.includes('blanco') && color.includes('kraft')) {
      return 'DRAKO_MANTELES_BLANCO_KRAFT';
    }

    if (color.includes('kraft')) {
      return 'DRAKO_MANTELES_KRAFT';
    }

    if (color.includes('blanco')) {
      return 'DRAKO_MANTELES_BLANCO';
    }

    return 'DRAKO_MANTELES';
  }

  return `DRAKO_${normalizeKey(product.categoria)}_${normalizeKey(product.descripcion)}`;
}

function displayDescription(product: DrakoCatalogProduct) {
  return [
    product.categoria,
    product.descripcion,
    product.medidas ?? product.medida,
    product.forma,
    product.color,
  ]
    .filter(Boolean)
    .join(' - ');
}

function priceEntryValue(
  quantity: string,
  value: number | { precio_unitario?: number; total: number },
) {
  const quantityNumber = Number(quantity);
  const total = typeof value === 'number' ? value : value.total;
  const unitPrice =
    typeof value === 'number'
      ? total / quantityNumber
      : value.precio_unitario ?? total / quantityNumber;

  return {
    total: total.toFixed(4),
    unitPrice: unitPrice.toFixed(6),
  };
}

async function main() {
  const catalogPath = process.argv[2] ?? process.env.DRAKO_CATALOG_PATH;

  if (!catalogPath) {
    throw new Error(
      'Indica la ruta del catalogo: pnpm run import:drako -- /ruta/catalogo_productos_drako.json',
    );
  }

  const catalog = JSON.parse(
    await readFile(catalogPath, 'utf8'),
  ) as DrakoCatalog;

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
      legalName: 'DRAKO IMPRESORES, S.L.U.',
      taxId: 'B22644348',
    },
  });

  await prisma.priceList.deleteMany({
    where: {
      supplierId: supplier.id,
      title: 'DRAKO catalogo productos',
    },
  });

  const priceList = await prisma.priceList.create({
    data: {
      supplierId: supplier.id,
      title: 'DRAKO catalogo productos',
      status: PriceListStatus.READY,
      validFrom: new Date('2026-05-25T00:00:00.000Z'),
      rawData: {
        source: 'script/import-drako-prices',
        catalogPath,
      },
    },
  });

  for (const product of catalog.productos) {
    const rules = Object.entries(product.precios).sort(
      ([left], [right]) => Number(left) - Number(right),
    );
    const firstRule = rules[0];

    if (!firstRule) {
      continue;
    }

    const firstPrice = priceEntryValue(firstRule[0], firstRule[1]);
    const descriptionRaw = displayDescription(product);

    await prisma.priceListItem.create({
      data: {
        priceListId: priceList.id,
        supplierId: supplier.id,
        descriptionRaw,
        descriptionNormalized: normalizeDescription(descriptionRaw),
        matchCode: matchCode(product),
        priceAmount: firstPrice.total,
        currency: 'EUR',
        priceUnit: PriceUnit.UNIT,
        priceQuantityBase: firstRule[0],
        rawUnitLabel: 'unidad',
        normalizedUnitPrice: firstPrice.unitPrice,
        normalizedUnit: PriceUnit.UNIT,
        status: PriceItemStatus.ACTIVE,
        rawData: {
          source: 'script/import-drako-prices',
          originalProduct: product,
        },
        priceRules: {
          create: rules.map(([quantity, value]) => {
            const price = priceEntryValue(quantity, value);

            return {
              minQuantity: quantity,
              priceAmount: price.total,
              currency: 'EUR',
              priceUnit: PriceUnit.UNIT,
              priceQuantityBase: quantity,
              rawUnitLabel: 'unidad',
              normalizedUnitPrice: price.unitPrice,
              normalizedUnit: PriceUnit.UNIT,
              status: PriceItemStatus.ACTIVE,
              rawData: {
                source: 'script/import-drako-prices',
                originalPrice: value,
              },
            };
          }),
        },
      },
    });
  }

  console.log(
    `Imported DRAKO test data. supplierId=${supplier.id} priceListId=${priceList.id} products=${catalog.productos.length}`,
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
