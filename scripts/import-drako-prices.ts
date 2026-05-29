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

const catalog: DrakoCatalog = {
  productos: [
    {
      categoria: 'Papel antigrasa',
      descripcion: 'Impresion de papel antigrasa',
      medidas: '30x40 cm',
      precios: {
        '5000': 110,
        '10000': 155,
        '15000': 220,
      },
    },
    {
      categoria: 'Papel antigrasa',
      descripcion: 'Impresion de papel antigrasa',
      medidas: '31x31 cm / 28x34 cm / 28x31 cm',
      precios: {
        '5000': 110,
        '10000': 155,
        '15000': 220,
      },
    },
    {
      categoria: 'Papel antigrasa',
      descripcion: 'Impresion de papel antigrasa',
      medidas: '16x28 cm',
      precios: {
        '5000': 75,
        '10000': 105,
        '15000': 145,
      },
    },
    {
      categoria: 'Papel antigrasa',
      descripcion: 'Impresion de papel antigrasa (Intelpack)',
      medidas: '25x28 cm',
      precios: {
        '5000': 95,
        '10000': 135,
        '15000': 165,
      },
    },
    {
      categoria: 'Adhesivos',
      descripcion: 'Adhesivo redondo',
      medida: '5 cm',
      forma: 'Redondo',
      precios: {
        '1000': 45,
        '3000': 85,
        '5000': 125,
      },
    },
    {
      categoria: 'Adhesivos',
      descripcion: 'Adhesivo redondo',
      medida: '7 cm',
      forma: 'Redondo',
      precios: {
        '1000': 55,
        '3000': 95,
        '5000': 135,
      },
    },
    {
      categoria: 'Adhesivos',
      descripcion: 'Adhesivo cuadrado',
      medida: '5 cm',
      forma: 'Cuadrado',
      precios: {
        '1000': 45,
        '3000': 85,
        '5000': 125,
      },
    },
    {
      categoria: 'Adhesivos',
      descripcion: 'Adhesivo cuadrado',
      medida: '7 cm',
      forma: 'Cuadrado',
      precios: {
        '1000': 55,
        '3000': 95,
        '5000': 135,
      },
    },
    {
      categoria: 'Laminas',
      descripcion: 'Laminas 1 cara',
      medidas: '52x70 cm',
      precios: {
        '500': {
          precio_unitario: 0.33,
          total: 165,
        },
        '1000': {
          precio_unitario: 0.215,
          total: 215,
        },
        '3000': {
          precio_unitario: 0.14,
          total: 420,
        },
      },
    },
    {
      categoria: 'Laminas',
      descripcion: 'Laminas 2 caras a color',
      medidas: '52x70 cm',
      precios: {
        '500': {
          precio_unitario: 0.52,
          total: 260,
        },
        '1000': {
          precio_unitario: 0.345,
          total: 345,
        },
        '2000': {
          precio_unitario: 0.206,
          total: 412,
        },
        '3000': {
          total: 620,
        },
        '6000': {
          precio_unitario: 0.153,
          total: 920,
        },
      },
    },
    {
      categoria: 'Manteles',
      descripcion: 'Manteles',
      color: 'Blanco/Kraft',
      precios: {
        '500': 85,
        '1000': 125,
        '2000': 175,
        '8000': 400,
        '12000': 600,
      },
    },
    {
      categoria: 'Manteles',
      descripcion: 'Manteles',
      color: 'Blanco',
      precios: {
        '3000': 195,
      },
    },
    {
      categoria: 'Manteles',
      descripcion: 'Manteles',
      color: 'Kraft',
      precios: {
        '3000': 130,
      },
    },
  ],
};

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
        catalog: 'embedded',
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
