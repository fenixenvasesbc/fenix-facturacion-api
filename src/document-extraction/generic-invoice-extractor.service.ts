import { Injectable, Logger } from '@nestjs/common';
import { PriceUnit, Prisma } from '@prisma/client';
import {
  DocumentExtractionInput,
  ExtractedInvoiceItem,
  OcrTable,
} from './document-extraction.types';

type ColumnRole =
  | 'reference'
  | 'description'
  | 'quantity'
  | 'unit'
  | 'unitPrice'
  | 'totalAmount';

type HeaderMap = Partial<Record<ColumnRole, number>>;

type AiGenericExtractionResponse = {
  items: Array<{
    descriptionRaw: string;
    matchCode: string | null;
    reference: string | null;
    quantity: number | null;
    unit: PriceUnit | null;
    unitPrice: number | null;
    totalAmount: number | null;
    currency: string | null;
    rowIndex: number | null;
    confidence: number;
    reason: string;
  }>;
};

@Injectable()
export class GenericInvoiceExtractorService {
  private readonly logger = new Logger(GenericInvoiceExtractorService.name);
  private readonly endpoint = 'https://api.openai.com/v1/responses';

  async extractInvoice(
    input: DocumentExtractionInput,
  ): Promise<ExtractedInvoiceItem[]> {
    const deterministicItems = this.extractFromTables(input.rawData);

    if (deterministicItems.length > 0) {
      this.logger.log(
        `Generic invoice extraction succeeded. strategy=table-headers count=${deterministicItems.length}`,
      );

      return deterministicItems;
    }

    const aiItems = await this.extractWithAi(input);

    if (aiItems.length > 0) {
      this.logger.log(
        `Generic invoice extraction succeeded. strategy=ai-schema count=${aiItems.length}`,
      );
    }

    return aiItems;
  }

  private extractFromTables(rawData?: Prisma.JsonValue | null) {
    const items: ExtractedInvoiceItem[] = [];

    for (const table of this.getTables(rawData)) {
      const rows = table.rows ?? [];
      const header = this.findHeader(rows);

      if (!header) {
        continue;
      }

      for (const [rowIndex, row] of rows.entries()) {
        if (rowIndex <= header.rowIndex) {
          continue;
        }

        const item = this.parseStructuredRow({
          row,
          headerMap: header.map,
          rowIndex,
          pageNumber: table.page,
        });

        if (item) {
          items.push(item);
        }
      }
    }

    return items;
  }

  private findHeader(rows: string[][]) {
    for (const [rowIndex, row] of rows.entries()) {
      const map = this.buildHeaderMap(row);

      if (
        map.description !== undefined &&
        (map.unitPrice !== undefined || map.totalAmount !== undefined) &&
        (map.reference !== undefined || map.quantity !== undefined)
      ) {
        return { rowIndex, map };
      }
    }

    return undefined;
  }

  private buildHeaderMap(row: string[]): HeaderMap {
    const map: HeaderMap = {};

    for (const [index, cell] of row.entries()) {
      const normalized = this.normalize(cell);

      if (this.matchesAny(normalized, ['referencia', 'ref', 'codigo', 'cod'])) {
        map.reference ??= index;
        continue;
      }

      if (
        this.matchesAny(normalized, [
          'descripcion',
          'concepto',
          'articulo',
          'producto',
          'detalle',
        ])
      ) {
        map.description ??= index;
        continue;
      }

      if (this.matchesAny(normalized, ['unidad', 'ud', 'uds', 'u m'])) {
        map.unit ??= index;
        continue;
      }

      if (
        this.matchesAny(normalized, [
          'cantidad',
          'cant',
          'unidades',
          'unid',
        ])
      ) {
        map.quantity ??= index;
        continue;
      }

      if (
        this.matchesAny(normalized, [
          'precio',
          'precio unitario',
          'p unitario',
          'precio ud',
          'tarifa',
        ])
      ) {
        map.unitPrice ??= index;
        continue;
      }

      if (
        this.matchesAny(normalized, [
          'importe',
          'total',
          'base',
          'subtotal',
        ])
      ) {
        map.totalAmount ??= index;
      }
    }

    return map;
  }

  private parseStructuredRow(input: {
    row: string[];
    headerMap: HeaderMap;
    rowIndex: number;
    pageNumber?: number;
  }) {
    const row = input.row.map((cell) => String(cell ?? '').trim());
    const get = (role: ColumnRole) => {
      const index = input.headerMap[role];
      return index === undefined ? undefined : row[index]?.trim();
    };

    const resolvedIdentity = this.resolveRowIdentity(row, input.headerMap);
    const descriptionRaw = resolvedIdentity.descriptionRaw;
    const reference = resolvedIdentity.reference;
    const quantity = this.parseNumberSafe(get('quantity'));
    const rawUnit = get('unit');
    const unitPrice = this.parseNumberSafe(get('unitPrice'));
    const totalAmount = this.parseNumberSafe(get('totalAmount'));
    const unit = this.resolveUnit(rawUnit, descriptionRaw);

    if (!descriptionRaw || this.isNoise(descriptionRaw)) {
      return undefined;
    }

    if (unitPrice === undefined && totalAmount === undefined) {
      return undefined;
    }

    const resolvedUnitPrice =
      unitPrice ?? this.inferUnitPrice(quantity, totalAmount);

    if (resolvedUnitPrice === undefined) {
      return undefined;
    }

    return this.toItem({
      descriptionRaw,
      matchCode: reference,
      reference,
      quantity,
      unit,
      unitPrice: resolvedUnitPrice,
      totalAmount,
      rowIndex: input.rowIndex,
      pageNumber: input.pageNumber,
      confidence: reference ? 0.9 : 0.78,
      warnings: reference ? [] : ['No se detecto referencia/matchCode'],
      rawData: {
        extractor: {
          name: 'generic-invoice-table',
          cells: row,
          headerMap: input.headerMap,
          rawUnit,
          identityStrategy: resolvedIdentity.strategy,
        },
      },
    });
  }

  private resolveRowIdentity(row: string[], headerMap: HeaderMap) {
    const referenceCell =
      headerMap.reference === undefined
        ? undefined
        : row[headerMap.reference]?.trim();
    const descriptionIndex = headerMap.description;
    const descriptionCell =
      descriptionIndex === undefined ? undefined : row[descriptionIndex]?.trim();
    const numericStartIndex = this.firstNumericColumnIndex(headerMap, row.length);
    const trailingDescription = this.collectDescriptionCells(
      row,
      descriptionIndex === undefined ? 0 : descriptionIndex + 1,
      numericStartIndex,
    );
    const reference = this.cleanReference(referenceCell);

    if (
      this.isGenericReferenceLabel(reference) &&
      this.looksLikeReferenceCode(descriptionCell)
    ) {
      return {
        reference: this.cleanReference(descriptionCell),
        descriptionRaw: trailingDescription || descriptionCell,
        strategy: 'promoted-description-code',
      };
    }

    const descriptionRaw =
      descriptionCell && !this.isNoise(descriptionCell)
        ? [descriptionCell, trailingDescription]
            .filter(Boolean)
            .join(' ')
            .replace(/\s+/g, ' ')
            .trim()
        : trailingDescription;

    return {
      reference,
      descriptionRaw,
      strategy: 'header-map',
    };
  }

  private firstNumericColumnIndex(headerMap: HeaderMap, fallback: number) {
    return Math.min(
      ...[
        headerMap.quantity,
        headerMap.unit,
        headerMap.unitPrice,
        headerMap.totalAmount,
      ].filter((value): value is number => value !== undefined),
      fallback,
    );
  }

  private collectDescriptionCells(
    row: string[],
    startIndex: number,
    endIndex: number,
  ) {
    return row
      .slice(startIndex, endIndex)
      .map((cell) => cell.trim())
      .filter(Boolean)
      .filter((cell) => !this.isNoise(cell))
      .filter((cell) => !this.isNumericOnly(cell))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private async extractWithAi(input: DocumentExtractionInput) {
    if (process.env.OPENAI_GENERIC_INVOICE_EXTRACTION_ENABLED === 'false') {
      this.logger.log(
        'Generic AI extraction skipped. OPENAI_GENERIC_INVOICE_EXTRACTION_ENABLED=false',
      );
      return [];
    }

    const apiKey = process.env.OPENAI_API_KEY;

    if (!apiKey) {
      this.logger.warn(
        'Generic AI extraction skipped. OPENAI_API_KEY is not configured.',
      );
      return [];
    }

    const payload = this.buildAiPayload(input);

    if (!payload.rawText && payload.tables.length === 0) {
      return [];
    }

    try {
      const model = process.env.OPENAI_MODEL ?? 'gpt-4.1-mini';
      this.logger.log(
        `Requesting generic AI invoice extraction. supplier=${input.supplierName ?? '-'} model=${model}`,
      );

      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          input: [
            {
              role: 'system',
              content: [
                {
                  type: 'input_text',
                  text: this.systemPrompt(),
                },
              ],
            },
            {
              role: 'user',
              content: [
                {
                  type: 'input_text',
                  text: JSON.stringify(payload),
                },
              ],
            },
          ],
          text: {
            format: {
              type: 'json_schema',
              name: 'generic_invoice_extraction',
              strict: true,
              schema: this.responseSchema(),
            },
          },
        }),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`OpenAI API error ${response.status}: ${text}`);
      }

      const data = await response.json();
      this.logOpenAiUsage(data);
      const outputText = this.extractOutputText(data);

      if (!outputText) {
        throw new Error('OpenAI response did not include output text.');
      }

      const parsed = JSON.parse(outputText) as AiGenericExtractionResponse;
      return this.aiItemsToExtractedItems(parsed.items ?? []);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Generic AI extraction failed. ${message}`);
      return [];
    }
  }

  private aiItemsToExtractedItems(items: AiGenericExtractionResponse['items']) {
    return items
      .filter((item) => item.confidence >= 0.75)
      .filter((item) => item.descriptionRaw && !this.isNoise(item.descriptionRaw))
      .map((item, index) =>
        this.toItem({
          descriptionRaw: item.descriptionRaw,
          matchCode: this.cleanReference(item.matchCode ?? item.reference),
          reference: this.cleanReference(item.reference ?? item.matchCode),
          quantity: item.quantity ?? undefined,
          unit: item.unit ?? PriceUnit.UNIT,
          unitPrice: item.unitPrice ?? 0,
          totalAmount: item.totalAmount ?? undefined,
          rowIndex: item.rowIndex ?? index,
          confidence: item.confidence,
          warnings: ['Extraido por IA generica'],
          rawData: {
            extractor: {
              name: 'generic-invoice-ai',
              reason: item.reason,
            },
          },
        }),
      )
      .filter((item) => Number(item.unitPrice) > 0);
  }

  private toItem(input: {
    descriptionRaw: string;
    matchCode?: string;
    reference?: string;
    quantity?: number;
    unit: PriceUnit;
    unitPrice: number;
    totalAmount?: number;
    rowIndex: number;
    pageNumber?: number;
    confidence: number;
    warnings: string[];
    rawData: Prisma.InputJsonObject;
  }): ExtractedInvoiceItem {
    const normalizedUnitPrice = this.normalizeUnitPrice(
      input.descriptionRaw,
      input.unit,
      input.unitPrice,
    );
    const normalizedUnit = this.normalizeOutputUnit(input.descriptionRaw, input.unit);
    const normalizedQuantity = this.normalizeQuantity(
      input.descriptionRaw,
      input.unit,
      input.quantity,
    );

    return {
      descriptionRaw: input.descriptionRaw.trim(),
      descriptionNormalized: this.normalize(input.descriptionRaw),
      matchCode: input.matchCode,
      reference: input.reference,
      quantity:
        normalizedQuantity === undefined
          ? undefined
          : this.decimalString(normalizedQuantity, 4),
      unit: normalizedUnit,
      unitPrice: this.decimalString(normalizedUnitPrice, 6),
      totalAmount:
        input.totalAmount === undefined
          ? undefined
          : this.decimalString(input.totalAmount, 4),
      currency: 'EUR',
      rowIndex: input.rowIndex,
      pageNumber: input.pageNumber,
      confidence: input.confidence,
      warnings: input.warnings,
      rawData: input.rawData,
    };
  }

  private normalizeUnitPrice(
    descriptionRaw: string,
    unit: PriceUnit,
    unitPrice: number,
  ) {
    if (
      unit === PriceUnit.THOUSAND_UNITS ||
      this.looksPricedPerThousand(descriptionRaw)
    ) {
      return unitPrice / 1000;
    }

    return unitPrice;
  }

  private normalizeOutputUnit(descriptionRaw: string, unit: PriceUnit) {
    if (
      unit === PriceUnit.THOUSAND_UNITS ||
      this.looksPricedPerThousand(descriptionRaw)
    ) {
      return PriceUnit.UNIT;
    }

    return unit;
  }

  private normalizeQuantity(
    descriptionRaw: string,
    unit: PriceUnit,
    quantity?: number,
  ) {
    if (quantity === undefined) {
      return undefined;
    }

    if (
      unit === PriceUnit.THOUSAND_UNITS ||
      this.looksPricedPerThousand(descriptionRaw)
    ) {
      return quantity * 1000;
    }

    return quantity;
  }

  private resolveUnit(rawUnit?: string, descriptionRaw?: string) {
    const normalized = this.normalize(`${rawUnit ?? ''} ${descriptionRaw ?? ''}`);

    if (
      normalized.includes('millar') ||
      normalized.includes('millares') ||
      normalized.includes('1000 unidades') ||
      normalized.includes('mil unidades')
    ) {
      return PriceUnit.THOUSAND_UNITS;
    }

    if (normalized.includes('m2') || normalized.includes('metro cuadrado')) {
      return PriceUnit.M2;
    }

    if (normalized.includes('kg') || normalized.includes('kilo')) {
      return PriceUnit.KG;
    }

    return PriceUnit.UNIT;
  }

  private looksPricedPerThousand(descriptionRaw: string) {
    const normalized = this.normalize(descriptionRaw);

    if (
      normalized.includes('maquetacion') ||
      normalized.includes('cliche') ||
      normalized.includes('molde') ||
      normalized.includes('porte') ||
      normalized.includes('transporte')
    ) {
      return false;
    }

    if (this.looksLikeReferenceCode(descriptionRaw)) {
      return true;
    }

    return (
      normalized.includes('vaso') ||
      normalized.includes('tapa') ||
      normalized.includes('bolsa') ||
      normalized.includes('carton') ||
      normalized.includes('papel')
    );
  }

  private inferUnitPrice(quantity?: number, totalAmount?: number) {
    if (!quantity || totalAmount === undefined) {
      return undefined;
    }

    return totalAmount / quantity;
  }

  private buildAiPayload(input: DocumentExtractionInput) {
    return {
      supplierName: input.supplierName ?? null,
      rawText: (input.rawText ?? '').slice(0, 12000),
      tables: this.getTables(input.rawData)
        .slice(0, 4)
        .map((table) => ({
          page: table.page ?? null,
          rows: (table.rows ?? []).slice(0, 80),
        })),
    };
  }

  private systemPrompt() {
    return [
      'Eres una capa de extraccion generica de facturas.',
      'Devuelve solo lineas reales de productos o servicios facturados.',
      'Ignora cabeceras, albaranes, vencimientos, bases imponibles, IVA, totales, formas de pago y observaciones.',
      'Mapea columnas al schema del sistema: Referencia/Codigo -> matchCode/reference, Descripcion/Concepto -> descriptionRaw, Cantidad -> quantity, Precio -> unitPrice, Importe -> totalAmount.',
      'No decidas si hay sobrecoste y no inventes productos.',
      'Si la factura cobra por millar, unit debe ser THOUSAND_UNITS y unitPrice debe ser el precio por millar mostrado en factura.',
      'Si es un servicio fijo como maquetacion, cliche, porte o transporte, unit debe ser UNIT.',
      'Si no tienes claro que una fila sea producto/servicio real, no la devuelvas.',
    ].join('\n');
  }

  private responseSchema() {
    return {
      type: 'object',
      additionalProperties: false,
      required: ['items'],
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: [
              'descriptionRaw',
              'matchCode',
              'reference',
              'quantity',
              'unit',
              'unitPrice',
              'totalAmount',
              'currency',
              'rowIndex',
              'confidence',
              'reason',
            ],
            properties: {
              descriptionRaw: { type: 'string' },
              matchCode: { type: ['string', 'null'] },
              reference: { type: ['string', 'null'] },
              quantity: { type: ['number', 'null'] },
              unit: {
                type: ['string', 'null'],
                enum: [
                  'UNIT',
                  'THOUSAND_UNITS',
                  'M2',
                  'ML',
                  'KG',
                  'TON',
                  'BOX',
                  'PACK',
                  'PALLET',
                  'SERVICE',
                  'UNKNOWN',
                  null,
                ],
              },
              unitPrice: { type: ['number', 'null'] },
              totalAmount: { type: ['number', 'null'] },
              currency: { type: ['string', 'null'] },
              rowIndex: { type: ['integer', 'null'] },
              confidence: { type: 'number' },
              reason: { type: 'string' },
            },
          },
        },
      },
    };
  }

  private getTables(rawData?: Prisma.JsonValue | null): OcrTable[] {
    const raw = rawData as
      | {
          ocr?: {
            tables?: OcrTable[];
          };
        }
      | null
      | undefined;

    return raw?.ocr?.tables ?? [];
  }

  private dedupe(items: ExtractedInvoiceItem[]) {
    const seen = new Set<string>();

    return items.filter((item) => {
      const key = [
        item.matchCode ?? '',
        item.descriptionNormalized,
        item.quantity ?? '',
        item.unitPrice,
        item.totalAmount ?? '',
      ].join('|');

      if (seen.has(key)) {
        return false;
      }

      seen.add(key);
      return true;
    });
  }

  private isNoise(value: string) {
    const normalized = this.normalize(value);

    if (this.isNumericOnly(value)) {
      return true;
    }

    return [
      'albaran',
      'vencimiento',
      'vencimientos',
      'operacion asegurada',
      'credito',
      'caucion',
      'base imponible',
      'total factura',
      'forma de pago',
      'i v a',
      'iva',
      'retencion',
    ].some((term) => normalized.includes(term));
  }

  private isNumericOnly(value: string) {
    return /^[-+]?\d{1,3}(?:[.\s]\d{3})*(?:,\d+)?$|^[-+]?\d+(?:[,.]\d+)?$/.test(
      value.trim(),
    );
  }

  private matchesAny(value: string, terms: string[]) {
    return terms.some((term) => value === term || value.includes(term));
  }

  private cleanReference(value?: string | null) {
    const cleaned = value?.trim();

    if (!cleaned || this.isNoise(cleaned)) {
      return undefined;
    }

    return cleaned.replace(/\s+/g, ' ').toUpperCase();
  }

  private isGenericReferenceLabel(value?: string) {
    const normalized = this.normalize(value ?? '');

    return [
      'folio',
      'referencia',
      'ref',
      'codigo',
      'cod',
      'articulo',
      'producto',
    ].includes(normalized);
  }

  private looksLikeReferenceCode(value?: string) {
    if (!value) {
      return false;
    }

    const trimmed = value.trim();

    return (
      /[a-z]/i.test(trimmed) &&
      /\d/.test(trimmed) &&
      !/\s{2,}/.test(trimmed) &&
      trimmed.split(/\s+/).length <= 2
    );
  }

  private parseNumberSafe(value?: string) {
    if (!value) {
      return undefined;
    }

    const match = value.match(
      /-?\d{1,3}(?:[.\s]\d{3})*(?:,\d+)?|-?\d+(?:[,.]\d+)?/,
    );

    if (!match) {
      return undefined;
    }

    return this.parseNumber(match[0]);
  }

  private parseNumber(value: string) {
    const clean = value.replace(/\s/g, '');

    if (clean.includes(',') && clean.includes('.')) {
      return Number(clean.replace(/\./g, '').replace(',', '.'));
    }

    return Number(clean.replace(',', '.'));
  }

  private extractOutputText(data: unknown) {
    const response = data as {
      output_text?: unknown;
      output?: Array<{
        content?: Array<{
          type?: string;
          text?: unknown;
        }>;
      }>;
    };

    if (typeof response.output_text === 'string') {
      return response.output_text;
    }

    return response.output
      ?.flatMap((item) => item.content ?? [])
      .map((content) => content.text)
      .find((text): text is string => typeof text === 'string');
  }

  private logOpenAiUsage(data: unknown) {
    const response = data as {
      usage?: {
        input_tokens?: unknown;
        output_tokens?: unknown;
        total_tokens?: unknown;
      };
    };

    if (!response.usage) {
      this.logger.log('OpenAI usage not returned in generic extraction.');
      return;
    }

    this.logger.log(
      [
        'OpenAI generic extraction usage',
        `inputTokens=${response.usage.input_tokens ?? '-'}`,
        `outputTokens=${response.usage.output_tokens ?? '-'}`,
        `totalTokens=${response.usage.total_tokens ?? '-'}`,
      ].join(' | '),
    );
  }

  private decimalString(value: number, fractionDigits: number) {
    return value.toFixed(fractionDigits);
  }

  private normalize(value: string) {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }
}
