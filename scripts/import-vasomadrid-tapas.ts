import 'dotenv/config';
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

if (process.argv.includes('--help')) {
  console.log(
    [
      'Usage: pnpm run import:vasomadrid:tapas',
      '',
      'Optional env:',
      '  VASOMADRID_SUPPLIER_ID=<supplier-id>  Import into an existing supplier by id.',
      '',
      'If VASOMADRID_SUPPLIER_ID is omitted, the script searches supplier name "Vasomadrid" case-insensitively and creates it if missing.',
    ].join('\n'),
  );
  process.exit(0);
}

type VasomadridProduct = {
  referencia: string;
  descripcion: string;
  medidas_aplica: string[];
  color?: string;
  diametro_mm?: number;
  material?: string;
  precio: number;
};

const supplierName = 'Vasomadrid';
const priceListTitle = 'VASOMADRID tapas vasos';
const products: VasomadridProduct[] = [
  {
    referencia: 'TSMR4',
    descripcion: 'TAPA VASO CARTON 4oz TRAVEL BLANCA',
    medidas_aplica: ['4oz'],
    color: 'BLANCA',
    precio: 22.59,
  },
  {
    referencia: 'TSMR4N100',
    descripcion: 'TAPA VASO CARTON 4oz TRAVEL NEGRA',
    medidas_aplica: ['4oz'],
    color: 'NEGRA',
    precio: 22.59,
  },
  {
    referencia: 'TSRM6B100-70',
    descripcion: 'TAPA VASO CARTON 7.5oz TRAVEL BLANCA',
    medidas_aplica: ['7.5oz'],
    color: 'BLANCA',
    diametro_mm: 70,
    precio: 15.07,
  },
  {
    referencia: 'TSRM6N100-70',
    descripcion: 'TAPA VASO CARTON 7.5oz TRAVEL NEGRA',
    medidas_aplica: ['7.5oz'],
    color: 'NEGRA',
    diametro_mm: 70,
    precio: 15.8,
  },
  {
    referencia: 'TSMR8',
    descripcion: 'TAPA VASO CARTON 8oz BLANCA',
    medidas_aplica: ['8oz'],
    color: 'BLANCA',
    diametro_mm: 80,
    precio: 16.28,
  },
  {
    referencia: 'TSMR8',
    descripcion: 'TAPA VASO CARTON 10oz BLANCA',
    medidas_aplica: ['10oz'],
    color: 'BLANCA',
    diametro_mm: 80,
    precio: 16.28,
  },
  {
    referencia: 'TSMR8N',
    descripcion: 'TAPA VASO CARTON 8oz NEGRA',
    medidas_aplica: ['8oz'],
    color: 'NEGRA',
    diametro_mm: 80,
    precio: 23.56,
  },
  {
    referencia: 'TSMR8N',
    descripcion: 'TAPA VASO CARTON 10oz NEGRA',
    medidas_aplica: ['10oz'],
    color: 'NEGRA',
    diametro_mm: 80,
    precio: 23.56,
  },
  {
    referencia: '3321',
    descripcion: 'TAPA VASO CARTON 6oz TRAVEL NEGRA',
    medidas_aplica: ['6oz'],
    color: 'NEGRA',
    diametro_mm: 77,
    precio: 16.28,
  },
  {
    referencia: 'TPR8',
    descripcion: 'TAPA VASO CARTON 8oz PAPEL BLANCA',
    medidas_aplica: ['8oz'],
    color: 'BLANCA',
    material: 'PAPEL',
    diametro_mm: 80,
    precio: 21.25,
  },
  {
    referencia: 'TPR8',
    descripcion: 'TAPA VASO CARTON 10oz PAPEL BLANCA',
    medidas_aplica: ['10oz'],
    color: 'BLANCA',
    material: 'PAPEL',
    diametro_mm: 80,
    precio: 21.25,
  },
  {
    referencia: 'TPRSMR8',
    descripcion: 'TAPA VASO CARTON 8oz PAPEL BLANCA CON CIERRE',
    medidas_aplica: ['8oz'],
    color: 'BLANCA',
    material: 'PAPEL',
    diametro_mm: 80,
    precio: 21.25,
  },
  {
    referencia: 'TPRSMR8',
    descripcion: 'TAPA VASO CARTON 10oz PAPEL BLANCA CON CIERRE',
    medidas_aplica: ['10oz'],
    color: 'BLANCA',
    material: 'PAPEL',
    diametro_mm: 80,
    precio: 21.25,
  },
  {
    referencia: 'TSMR8CA',
    descripcion: 'TAPA VASO CARTON 8oz CAÑA DE AZUCAR',
    medidas_aplica: ['8oz'],
    material: 'CAÑA_DE_AZUCAR',
    diametro_mm: 80,
    precio: 24.68,
  },
  {
    referencia: 'TSMR8CA',
    descripcion: 'TAPA VASO CARTON 10oz CAÑA DE AZUCAR',
    medidas_aplica: ['10oz'],
    material: 'CAÑA_DE_AZUCAR',
    diametro_mm: 80,
    precio: 24.68,
  },
  {
    referencia: 'TSMR8CAC',
    descripcion: 'TAPA VASO CARTON 8oz CAÑA DE AZUCAR CON CIERRE',
    medidas_aplica: ['8oz'],
    material: 'CAÑA_DE_AZUCAR',
    diametro_mm: 80,
    precio: 24.67,
  },
  {
    referencia: 'TSMR8CAC',
    descripcion: 'TAPA VASO CARTON 10oz CAÑA DE AZUCAR CON CIERRE',
    medidas_aplica: ['10oz'],
    material: 'CAÑA_DE_AZUCAR',
    diametro_mm: 80,
    precio: 24.67,
  },
  {
    referencia: 'SL45',
    descripcion: 'TAPA VASO CARTON 12oz BLANCA',
    medidas_aplica: ['12oz'],
    color: 'BLANCA',
    diametro_mm: 90,
    precio: 25.72,
  },
  {
    referencia: 'SL45',
    descripcion: 'TAPA VASO CARTON 16oz BLANCA',
    medidas_aplica: ['16oz'],
    color: 'BLANCA',
    diametro_mm: 90,
    precio: 25.72,
  },
  {
    referencia: 'LHRDSB16',
    descripcion: 'TAPA VASO CARTON 12oz NEGRA',
    medidas_aplica: ['12oz'],
    color: 'NEGRA',
    precio: 25.72,
  },
  {
    referencia: 'LHRDSB16',
    descripcion: 'TAPA VASO CARTON 16oz NEGRA',
    medidas_aplica: ['16oz'],
    color: 'NEGRA',
    precio: 25.72,
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

async function findOrCreateSupplier() {
  const supplierId = process.env.VASOMADRID_SUPPLIER_ID;

  if (supplierId) {
    const supplier = await prisma.supplier.findUnique({
      where: {
        id: supplierId,
      },
    });

    if (!supplier) {
      throw new Error(`Supplier not found. VASOMADRID_SUPPLIER_ID=${supplierId}`);
    }

    return supplier;
  }

  const existing = await prisma.supplier.findFirst({
    where: {
      name: {
        equals: supplierName,
        mode: 'insensitive',
      },
    },
  });

  if (existing) {
    return existing;
  }

  return prisma.supplier.create({
    data: {
      name: supplierName,
      legalName: 'Vasomadrid',
    },
  });
}

async function main() {
  const supplier = await findOrCreateSupplier();

  await prisma.priceList.deleteMany({
    where: {
      supplierId: supplier.id,
      title: priceListTitle,
    },
  });

  const priceList = await prisma.priceList.create({
    data: {
      supplierId: supplier.id,
      title: priceListTitle,
      status: PriceListStatus.READY,
      validFrom: new Date('2026-01-01T00:00:00.000Z'),
      rawData: {
        source: 'script/import-vasomadrid-tapas',
        proveedor: 'Vasomadrid',
        categoria: 'Tapas vasos',
        unidad_precio: 'EUR/1000',
      },
    },
  });

  for (const product of products) {
    const normalizedUnitPrice = product.precio / 1000;

    await prisma.priceListItem.create({
      data: {
        priceListId: priceList.id,
        supplierId: supplier.id,
        descriptionRaw: product.descripcion,
        descriptionNormalized: normalizeDescription(product.descripcion),
        matchCode: product.referencia,
        priceAmount: product.precio.toFixed(4),
        currency: 'EUR',
        priceUnit: PriceUnit.THOUSAND_UNITS,
        priceQuantityBase: '1000',
        rawUnitLabel: 'millar',
        normalizedUnitPrice: normalizedUnitPrice.toFixed(6),
        normalizedUnit: PriceUnit.UNIT,
        status: PriceItemStatus.ACTIVE,
        rawData: {
          source: 'script/import-vasomadrid-tapas',
          category: 'Tapas vasos',
          originalProduct: product,
        } as Prisma.InputJsonObject,
        priceRules: {
          create: [
            {
              minQuantity: '1',
              priceAmount: product.precio.toFixed(4),
              currency: 'EUR',
              priceUnit: PriceUnit.THOUSAND_UNITS,
              priceQuantityBase: '1000',
              rawUnitLabel: 'millar',
              normalizedUnitPrice: normalizedUnitPrice.toFixed(6),
              normalizedUnit: PriceUnit.UNIT,
              status: PriceItemStatus.ACTIVE,
              rawData: {
                source: 'script/import-vasomadrid-tapas',
              },
            },
          ],
        },
      },
    });
  }

  console.log(
    `Imported VASOMADRID tapas. supplierId=${supplier.id} priceListId=${priceList.id} items=${products.length}`,
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
