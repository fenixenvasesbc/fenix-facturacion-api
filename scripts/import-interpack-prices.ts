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

type InterpackCatalog = {
  proveedor: string;
  moneda: string;
  categorias: InterpackCategory[];
};

type InterpackCategory = {
  categoria: string;
  color?: string;
  tirada?: number;
  productos: InterpackProduct[];
};

type InterpackProduct = {
  categoria?: string;
  proveedor?: string;
  tipo_precio?: string;
  referencia?: string;
  gramaje?: string;
  ancho_cm?: number;
  largo_cm?: number;
  cantidad_minima?: number;
  tirada?: number;
  medida?: {
    ancho_cm: number;
    fuelle_cm: number;
    largo_cm: number;
    formato: string;
  };
  precios_por_millar?: Record<string, Record<string, number>>;
  precios_por_resma?: Record<string, number>;
  precios_por_resma_impresa?: Record<string, number>;
};

type ImportRule = {
  minQuantity?: string;
  priceAmount: string;
  priceUnit: PriceUnit;
  priceQuantityBase: string;
  rawUnitLabel: string;
  normalizedUnitPrice: string;
  normalizedUnit: PriceUnit;
  rawData?: Record<string, unknown>;
};

type ImportItem = {
  descriptionRaw: string;
  matchCode: string;
  priceAmount: string;
  priceUnit: PriceUnit;
  priceQuantityBase: string;
  rawUnitLabel: string;
  normalizedUnitPrice: string;
  normalizedUnit: PriceUnit;
  rawData: Record<string, unknown>;
  rules: ImportRule[];
};

const supplierName = 'INTERPACK EMBALAJES AL ANDALUS';
const catalogPath = join(
  process.cwd(),
  'scripts',
  'data',
  'catalogo-productos-interpack-completo-actualizado.json',
);

function loadCatalog(): InterpackCatalog {
  return JSON.parse(readFileSync(catalogPath, 'utf8')) as InterpackCatalog;
}

function normalizeDescription(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function formatMeasureToken(value: number | string) {
  return String(value)
    .replace(',', '_')
    .replace('.', '_')
    .replace(/[^0-9_]/g, '');
}

function bagReference(product: InterpackProduct, colorCode: string) {
  if (!product.medida) {
    throw new Error('Bag product without medida');
  }

  return `${product.medida.ancho_cm}${product.medida.fuelle_cm}${product.medida.largo_cm}${colorCode}I`;
}

function cutMatchCode(reference: string) {
  const match = /(\d+(?:[,.]\d+)?)\s*x\s*(\d+(?:[,.]\d+)?)/i.exec(reference);

  if (!match) {
    return `INTERPACK_RESMA_ANTIGRASA_CORTE_${reference.toUpperCase()}`;
  }

  const first = Math.trunc(Number(match[1].replace(',', '.')));
  const second = Math.trunc(Number(match[2].replace(',', '.')));
  const ordered = [first, second].sort((left, right) => left - right);

  return `INTERPACK_RESMA_ANTIGRASA_CORTE_${ordered[0]}X${ordered[1]}`;
}

function bagRules(product: InterpackProduct, variant: string): ImportRule[] {
  return Object.entries(product.precios_por_millar ?? {})
    .sort(([left], [right]) => Number(left) - Number(right))
    .map(([quantity, prices]) => {
      const price = prices[variant] ?? Object.values(prices)[0];

      return {
        minQuantity: quantity,
        priceAmount: price.toFixed(4),
        priceUnit: PriceUnit.THOUSAND_UNITS,
        priceQuantityBase: '1000',
        rawUnitLabel: 'millar',
        normalizedUnitPrice: (price / 1000).toFixed(6),
        normalizedUnit: PriceUnit.UNIT,
        rawData: {
          variant,
          originalPrices: prices,
        },
      };
    });
}

function resmaRules(
  prices: Record<string, number>,
  rawUnitLabel = 'resma',
): ImportRule[] {
  return Object.entries(prices)
    .map(([quantityLabel, price]) => ({
      minQuantity: quantityLabel.replace(/\D/g, '') || '1',
      priceAmount: price.toFixed(4),
      priceUnit: PriceUnit.UNIT,
      priceQuantityBase: '1',
      rawUnitLabel,
      normalizedUnitPrice: price.toFixed(6),
      normalizedUnit: PriceUnit.UNIT,
      rawData: {
        originalQuantityLabel: quantityLabel,
      },
    }))
    .sort(
      (left, right) =>
        Number(left.minQuantity ?? '0') - Number(right.minQuantity ?? '0'),
    );
}

function millarRules(
  prices: Record<string, number>,
  minQuantity?: number,
): ImportRule[] {
  const preferred =
    prices.impresion_continua ??
    prices.impresion_centrada_1_color ??
    Object.values(prices)[0];

  return [
    {
      minQuantity: minQuantity ? String(minQuantity) : undefined,
      priceAmount: preferred.toFixed(4),
      priceUnit: PriceUnit.THOUSAND_UNITS,
      priceQuantityBase: '1000',
      rawUnitLabel: 'millar',
      normalizedUnitPrice: (preferred / 1000).toFixed(6),
      normalizedUnit: PriceUnit.UNIT,
      rawData: {
        preferredVariant: 'impresion_continua',
        originalPrices: prices,
      },
    },
  ];
}

function firstRuleValues(rules: ImportRule[]) {
  const first = rules[0];

  return {
    priceAmount: first.priceAmount,
    priceUnit: first.priceUnit,
    priceQuantityBase: first.priceQuantityBase,
    rawUnitLabel: first.rawUnitLabel,
    normalizedUnitPrice: first.normalizedUnitPrice,
    normalizedUnit: first.normalizedUnit,
  };
}

function createBagItems(category: InterpackCategory): ImportItem[] {
  const color = normalizeDescription(category.color ?? '');
  const colorCodes = color.includes('marron') ? ['M'] : ['B'];

  return category.productos.flatMap((product) =>
    colorCodes.map((colorCode) => {
      const rules = bagRules(product, '1T-1C');
      const first = firstRuleValues(rules);
      const reference = bagReference(product, colorCode);
      const descriptionRaw = `${category.categoria} ${product.medida?.formato} ${colorCode}`;

      return {
        descriptionRaw,
        matchCode: reference,
        ...first,
        rawData: {
          source: 'script/import-interpack-prices',
          originalCategory: category.categoria,
          originalColor: category.color,
          originalProduct: product,
          generatedReference: reference,
          preferredVariant: '1T-1C',
        },
        rules,
      };
    }),
  );
}

function createSmallRunItems(category: InterpackCategory): ImportItem[] {
  return category.productos.map((product) => {
    const oneTintPrice = Number(
      (product.precios_por_millar as unknown as Record<string, number>)?.[
        '1T'
      ] ??
        Object.values(
          (product.precios_por_millar as unknown as Record<string, number>) ??
            {},
        )[0],
    );
    const rules: ImportRule[] = [
      {
        minQuantity: String(product.tirada ?? category.tirada ?? 15000),
        priceAmount: oneTintPrice.toFixed(4),
        priceUnit: PriceUnit.THOUSAND_UNITS,
        priceQuantityBase: '1000',
        rawUnitLabel: 'millar',
        normalizedUnitPrice: (oneTintPrice / 1000).toFixed(6),
        normalizedUnit: PriceUnit.UNIT,
        rawData: {
          preferredVariant: '1T',
          originalPrices: product.precios_por_millar,
        },
      },
    ];
    const first = firstRuleValues(rules);
    const descriptionRaw = `${category.categoria} ${product.referencia} ${product.medida?.formato}`;

    return {
      descriptionRaw,
      matchCode: product.referencia ?? descriptionRaw,
      ...first,
      rawData: {
        source: 'script/import-interpack-prices',
        originalCategory: category.categoria,
        originalProduct: product,
        preferredVariant: '1T',
      },
      rules,
    };
  });
}

function createResmaItem(product: InterpackProduct): ImportItem | undefined {
  const category = product.categoria ?? '';
  const normalizedCategory = normalizeDescription(category);

  if (normalizedCategory.includes('papel blanco satinado 1 cara')) {
    const rules = resmaRules(product.precios_por_resma ?? {});
    const first = firstRuleValues(rules);
    const gramaje = formatMeasureToken(product.gramaje ?? '');

    return {
      descriptionRaw: `${category} ${product.gramaje} g ref ${product.referencia}`,
      matchCode: `INTERPACK_CELULOSA_${gramaje}G`,
      ...first,
      rawData: {
        source: 'script/import-interpack-prices',
        originalProduct: product,
      },
      rules,
    };
  }

  if (
    normalizedCategory.includes('papel antigrasa') &&
    product.tipo_precio !== 'resma_impresa'
  ) {
    const rules = resmaRules(product.precios_por_resma ?? {});
    const first = firstRuleValues(rules);

    return {
      descriptionRaw: `${category} ancho ${product.ancho_cm} cm ${product.gramaje ?? ''}`,
      matchCode: `INTERPACK_RESMA_ANTIGRASA_ANCHO_${formatMeasureToken(
        product.ancho_cm ?? '',
      )}`,
      ...first,
      rawData: {
        source: 'script/import-interpack-prices',
        originalProduct: product,
      },
      rules,
    };
  }

  if (
    normalizedCategory.includes('papel antigrasa impreso') &&
    product.referencia
  ) {
    const rules = millarRules(
      product.precios_por_resma_impresa ?? {},
      product.cantidad_minima,
    );
    const first = firstRuleValues(rules);

    return {
      descriptionRaw: `${category} corte ${product.referencia} ${product.gramaje ?? ''}`,
      matchCode: cutMatchCode(product.referencia),
      ...first,
      rawData: {
        source: 'script/import-interpack-prices',
        originalProduct: product,
      },
      rules,
    };
  }

  return undefined;
}

function fixedResmaItem(): ImportItem {
  const rules: ImportRule[] = [
    {
      minQuantity: '1',
      priceAmount: '44.0000',
      priceUnit: PriceUnit.UNIT,
      priceQuantityBase: '1',
      rawUnitLabel: 'paquete',
      normalizedUnitPrice: '44.000000',
      normalizedUnit: PriceUnit.UNIT,
      rawData: {
        source: 'manual-business-rule',
      },
    },
  ];
  const first = firstRuleValues(rules);

  return {
    descriptionRaw: 'Resma antigrasa 75x100 500 hojas',
    matchCode: 'INTERPACK_RESMA_ANTIGRASA_75X100_500H',
    ...first,
    rawData: {
      source: 'script/import-interpack-prices',
      businessRule: 'Tarifa fija agregada manualmente',
    },
    rules,
  };
}

function buildItems(catalog: InterpackCatalog): ImportItem[] {
  const items: ImportItem[] = [];

  for (const category of catalog.categorias) {
    const normalizedCategory = normalizeDescription(category.categoria);

    if (normalizedCategory.includes('bolsas de papel')) {
      items.push(...createBagItems(category));
      continue;
    }

    if (normalizedCategory.includes('pequenas tiradas')) {
      items.push(...createSmallRunItems(category));
      continue;
    }

    if (normalizedCategory.includes('papel por resmas')) {
      for (const product of category.productos) {
        const item = createResmaItem(product);

        if (item) {
          items.push(item);
        }
      }
    }
  }

  items.push(fixedResmaItem());

  return items;
}

async function main() {
  const catalog = loadCatalog();
  const items = buildItems(catalog);
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
      legalName: 'INTERPACK EMBALAJES AL ANDALUS S.L.',
    },
  });

  await prisma.priceList.deleteMany({
    where: {
      supplierId: supplier.id,
      title: 'INTERPACK catalogo productos 2026',
    },
  });

  const priceList = await prisma.priceList.create({
    data: {
      supplierId: supplier.id,
      title: 'INTERPACK catalogo productos 2026',
      status: PriceListStatus.READY,
      validFrom: new Date('2026-01-01T00:00:00.000Z'),
      rawData: {
        source: 'script/import-interpack-prices',
        catalog:
          'scripts/data/catalogo-productos-interpack-completo-actualizado.json',
      },
    },
  });

  for (const item of items) {
    await prisma.priceListItem.create({
      data: {
        priceListId: priceList.id,
        supplierId: supplier.id,
        descriptionRaw: item.descriptionRaw,
        descriptionNormalized: normalizeDescription(item.descriptionRaw),
        matchCode: item.matchCode,
        priceAmount: item.priceAmount,
        currency: 'EUR',
        priceUnit: item.priceUnit,
        priceQuantityBase: item.priceQuantityBase,
        rawUnitLabel: item.rawUnitLabel,
        normalizedUnitPrice: item.normalizedUnitPrice,
        normalizedUnit: item.normalizedUnit,
        status: PriceItemStatus.ACTIVE,
        rawData: item.rawData as Prisma.InputJsonObject,
        priceRules: {
          create: item.rules.map((rule) => ({
            minQuantity: rule.minQuantity,
            priceAmount: rule.priceAmount,
            currency: 'EUR',
            priceUnit: rule.priceUnit,
            priceQuantityBase: rule.priceQuantityBase,
            rawUnitLabel: rule.rawUnitLabel,
            normalizedUnitPrice: rule.normalizedUnitPrice,
            normalizedUnit: rule.normalizedUnit,
            status: PriceItemStatus.ACTIVE,
            rawData: {
              source: 'script/import-interpack-prices',
              ...rule.rawData,
            } as Prisma.InputJsonObject,
          })),
        },
      },
    });
  }

  console.log(
    `Imported INTERPACK data. supplierId=${supplier.id} priceListId=${priceList.id} items=${items.length}`,
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
