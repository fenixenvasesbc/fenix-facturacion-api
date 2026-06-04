import { Injectable, Logger } from '@nestjs/common';
import {
  InvoiceItemValidationStatus,
  PriceItemStatus,
  PriceUnit,
  Prisma,
} from '@prisma/client';
import { ParsedInvoiceItem } from './invoice-parser.service';

type NegotiatedItem = Prisma.PriceListItemGetPayload<{
  include: {
    canonicalProduct: true;
    aliases: true;
    priceRules: true;
  };
}>;

type ValidationItem = {
  invoiceItem: ParsedInvoiceItem;
  matchedItem?: NegotiatedItem;
  validationStatus: InvoiceItemValidationStatus;
  differencePercent?: number;
};

type AiCorrection = {
  itemIndex: number;
  action: 'KEEP' | 'UPDATE' | 'DROP';
  matchCode: string | null;
  quantity: number | null;
  unit: PriceUnit | null;
  unitPrice: number | null;
  totalAmount: number | null;
  confidence: number;
  reason: string;
};

type AiInterpretationResponse = {
  corrections: AiCorrection[];
};

export type AiInvoiceInterpretationResult = {
  items: ParsedInvoiceItem[];
  attempted: boolean;
  appliedCorrections: number;
  returnedCorrections: number;
};

@Injectable()
export class AiInvoiceInterpreterService {
  private readonly logger = new Logger(AiInvoiceInterpreterService.name);
  private readonly endpoint = 'https://api.openai.com/v1/responses';

  async interpretItems(input: {
    supplierName: string;
    invoiceItems: ParsedInvoiceItem[];
    validationItems: ValidationItem[];
    negotiatedItems: NegotiatedItem[];
  }) {
    if (!this.isEnabledForSupplier(input.supplierName)) {
      this.logger.log(
        `AI invoice interpretation skipped. Supplier is not enabled. supplier=${input.supplierName}`,
      );

      return this.result(input.invoiceItems, false);
    }

    const apiKey = process.env.OPENAI_API_KEY;

    if (!apiKey) {
      this.logger.warn(
        'AI invoice interpretation skipped. OPENAI_API_KEY is not configured.',
      );

      return this.result(input.invoiceItems, false);
    }

    const allItemsToReview = input.validationItems
      .map((item, itemIndex) => ({
        item,
        itemIndex,
      }))
      .filter(
        ({ item }) => item.validationStatus !== InvoiceItemValidationStatus.OK,
      );
    const updatesAllowed = this.updatesAllowed();
    const itemsToReview = updatesAllowed
      ? allItemsToReview
      : allItemsToReview.filter(({ item }) => this.isDropCandidate(item));

    if (itemsToReview.length === 0) {
      this.logger.log(
        allItemsToReview.length === 0
          ? `AI invoice interpretation skipped. All items are already OK. supplier=${input.supplierName} itemCount=${input.invoiceItems.length}`
          : `AI invoice interpretation skipped. No actionable items for AI. supplier=${input.supplierName} itemsToReview=${allItemsToReview.length} updatesAllowed=${updatesAllowed}`,
      );

      return this.result(input.invoiceItems, false);
    }

    try {
      const interpretation = await this.requestInterpretation({
        apiKey,
        supplierName: input.supplierName,
        itemsToReview,
        negotiatedItems: input.negotiatedItems,
      });

      const result = this.applyCorrections(
        input.invoiceItems,
        interpretation,
        input.negotiatedItems,
      );

      this.logger.log(
        `AI invoice interpretation completed. supplier=${input.supplierName} returnedCorrections=${result.returnedCorrections} appliedCorrections=${result.appliedCorrections}`,
      );

      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      this.logger.warn(`AI invoice interpretation failed. ${message}`);

      return this.result(input.invoiceItems, true);
    }
  }

  private isEnabledForSupplier(supplierName: string) {
    if (process.env.OPENAI_INVOICE_AI_ENABLED === 'false') {
      return false;
    }

    const enabledSuppliers = (
      process.env.OPENAI_INVOICE_AI_SUPPLIERS ??
      'interpack,plastivalle,saica,saika,soto,mora y goma,drako'
    )
      .split(',')
      .map((value) => this.normalize(value))
      .filter(Boolean);

    return enabledSuppliers.some((supplier) =>
      this.normalize(supplierName).includes(supplier),
    );
  }

  private async requestInterpretation(input: {
    apiKey: string;
    supplierName: string;
    itemsToReview: Array<{ item: ValidationItem; itemIndex: number }>;
    negotiatedItems: NegotiatedItem[];
  }): Promise<AiInterpretationResponse> {
    const model = process.env.OPENAI_MODEL ?? 'gpt-4.1-mini';
    const body = {
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
              text: JSON.stringify({
                supplierName: input.supplierName,
                invoiceItems: input.itemsToReview.map(
                  ({ item, itemIndex }) => ({
                    itemIndex,
                    descriptionRaw: item.invoiceItem.descriptionRaw,
                    descriptionNormalized:
                      item.invoiceItem.descriptionNormalized,
                    matchCode: item.invoiceItem.matchCode ?? null,
                    quantity: this.numberOrNull(item.invoiceItem.quantity),
                    unit: item.invoiceItem.unit,
                    unitPrice: this.numberOrNull(item.invoiceItem.unitPrice),
                    totalAmount: this.numberOrNull(
                      item.invoiceItem.totalAmount,
                    ),
                    validationStatus: item.validationStatus,
                    differencePercent: item.differencePercent ?? null,
                    rawData: item.invoiceItem.rawData,
                  }),
                ),
                negotiatedItems: this.toNegotiatedCandidatePayload(
                  input.negotiatedItems,
                ),
              }),
            },
          ],
        },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'invoice_item_interpretation',
          strict: true,
          schema: this.responseSchema(),
        },
      },
    };

    this.logger.log(
      `Requesting AI invoice interpretation. supplier=${input.supplierName} items=${input.itemsToReview.length} candidates=${input.negotiatedItems.length} model=${model}`,
    );

    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
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

    return JSON.parse(outputText) as AiInterpretationResponse;
  }

  private systemPrompt() {
    return [
      'Eres una capa de interpretación para facturas de proveedores.',
      'Tu tarea NO es decidir si hay sobrecoste.',
      'Tu tarea principal es identificar items que NO son productos reales y devolver action DROP.',
      'Solo propongas UPDATE si hay evidencia clara y el sistema lo permite; si no, usa KEEP.',
      'Usa primero matchCode exacto contra negotiatedItems.matchCode.',
      'Si no hay matchCode exacto, usa descripción normalizada y referencias equivalentes.',
      'No inventes productos ni matchCodes: matchCode debe existir en negotiatedItems o ser null.',
      'Si el item no es un producto real sino IVA, total, descuento, cabecera o fragmento duplicado/invertido, devuelve action DROP.',
      'Si una descripción indica paquetes de 1000 hojas, puede interpretarse como precio por millar: cantidad normalizada = paquetes * 1000 y unitPrice normalizado = precio / 1000.',
      'La corrección debe cuadrar matemáticamente: quantity * unitPrice ~= totalAmount.',
      'Si no estás seguro, devuelve KEEP con confianza baja.',
    ].join('\n');
  }

  private responseSchema() {
    return {
      type: 'object',
      additionalProperties: false,
      required: ['corrections'],
      properties: {
        corrections: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: [
              'itemIndex',
              'action',
              'matchCode',
              'quantity',
              'unit',
              'unitPrice',
              'totalAmount',
              'confidence',
              'reason',
            ],
            properties: {
              itemIndex: {
                type: 'integer',
              },
              action: {
                type: 'string',
                enum: ['KEEP', 'UPDATE', 'DROP'],
              },
              matchCode: {
                type: ['string', 'null'],
              },
              quantity: {
                type: ['number', 'null'],
              },
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
              unitPrice: {
                type: ['number', 'null'],
              },
              totalAmount: {
                type: ['number', 'null'],
              },
              confidence: {
                type: 'number',
              },
              reason: {
                type: 'string',
              },
            },
          },
        },
      },
    };
  }

  private toNegotiatedCandidatePayload(negotiatedItems: NegotiatedItem[]) {
    return negotiatedItems
      .filter((item) => item.status === PriceItemStatus.ACTIVE)
      .slice(0, 80)
      .map((item) => ({
        id: item.id,
        matchCode: item.matchCode,
        descriptionRaw: item.descriptionRaw,
        descriptionNormalized: item.descriptionNormalized,
        priceAmount: item.priceAmount.toString(),
        priceUnit: item.priceUnit,
        priceQuantityBase: item.priceQuantityBase.toString(),
        normalizedUnitPrice: item.normalizedUnitPrice?.toString() ?? null,
        normalizedUnit: item.normalizedUnit,
        priceRules: item.priceRules.map((rule) => ({
          minQuantity: rule.minQuantity?.toString() ?? null,
          maxQuantity: rule.maxQuantity?.toString() ?? null,
          priceAmount: rule.priceAmount.toString(),
          priceUnit: rule.priceUnit,
          priceQuantityBase: rule.priceQuantityBase.toString(),
          normalizedUnitPrice: rule.normalizedUnitPrice?.toString() ?? null,
          normalizedUnit: rule.normalizedUnit,
        })),
      }));
  }

  private applyCorrections(
    invoiceItems: ParsedInvoiceItem[],
    interpretation: AiInterpretationResponse,
    negotiatedItems: NegotiatedItem[],
  ) {
    const confidenceThreshold = Number(
      process.env.OPENAI_INVOICE_AI_CONFIDENCE_THRESHOLD ?? '0.85',
    );
    const knownMatchCodes = new Set(
      negotiatedItems
        .map((item) => item.matchCode)
        .filter((value): value is string => Boolean(value))
        .map((value) => this.normalizeMatchCode(value)),
    );
    const corrected = invoiceItems.map((item) => ({ ...item }));
    const droppedIndexes = new Set<number>();
    const corrections = interpretation.corrections ?? [];
    const updatesAllowed = this.updatesAllowed();
    let appliedCorrections = 0;

    this.logger.log(
      `AI corrections received. returnedCorrections=${corrections.length} confidenceThreshold=${confidenceThreshold} updatesAllowed=${updatesAllowed}`,
    );

    for (const correction of corrections) {
      const current = corrected[correction.itemIndex];

      if (!current) {
        this.logger.warn(
          `AI correction skipped. Invalid itemIndex=${correction.itemIndex} action=${correction.action}`,
        );
        continue;
      }

      if (correction.confidence < confidenceThreshold) {
        this.logger.warn(
          `AI correction skipped. Low confidence itemIndex=${correction.itemIndex} confidence=${correction.confidence.toFixed(2)} threshold=${confidenceThreshold} reason="${correction.reason}"`,
        );
        continue;
      }

      if (correction.action === 'DROP') {
        droppedIndexes.add(correction.itemIndex);
        appliedCorrections += 1;
        this.logger.log(
          `AI correction applied. action=DROP itemIndex=${correction.itemIndex} confidence=${correction.confidence.toFixed(2)} reason="${correction.reason}"`,
        );
        continue;
      }

      if (correction.action !== 'UPDATE') {
        this.logger.log(
          `AI correction skipped. action=${correction.action} itemIndex=${correction.itemIndex} confidence=${correction.confidence.toFixed(2)} reason="${correction.reason}"`,
        );
        continue;
      }

      if (!updatesAllowed) {
        this.logger.warn(
          `AI correction skipped. UPDATE disabled itemIndex=${correction.itemIndex} matchCode=${correction.matchCode ?? '-'} reason="${correction.reason}"`,
        );
        continue;
      }

      const normalizedMatchCode = this.normalizeMatchCode(correction.matchCode);

      if (!normalizedMatchCode || !knownMatchCodes.has(normalizedMatchCode)) {
        this.logger.warn(
          `AI correction skipped. Unknown matchCode=${correction.matchCode ?? '-'} itemIndex=${correction.itemIndex}`,
        );
        continue;
      }

      if (!this.correctionMathIsValid(correction, current)) {
        this.logger.warn(
          `AI correction skipped. Math check failed. itemIndex=${correction.itemIndex} reason="${correction.reason}"`,
        );
        continue;
      }

      corrected[correction.itemIndex] = {
        ...current,
        matchCode: correction.matchCode ?? current.matchCode,
        quantity:
          correction.quantity === null
            ? current.quantity
            : this.decimalString(correction.quantity, 4),
        unit: correction.unit ?? current.unit,
        unitPrice:
          correction.unitPrice === null
            ? current.unitPrice
            : this.decimalString(correction.unitPrice, 6),
        totalAmount:
          correction.totalAmount === null
            ? current.totalAmount
            : this.decimalString(correction.totalAmount, 4),
        rawData: {
          ...current.rawData,
          aiInterpretation: {
            provider: 'openai',
            matchCode: correction.matchCode,
            quantity: correction.quantity,
            unit: correction.unit,
            unitPrice: correction.unitPrice,
            totalAmount: correction.totalAmount,
            confidence: correction.confidence,
            reason: correction.reason,
          },
        },
      };
      appliedCorrections += 1;

      this.logger.log(
        `AI correction applied. itemIndex=${correction.itemIndex} matchCode=${correction.matchCode} confidence=${correction.confidence.toFixed(2)} reason="${correction.reason}"`,
      );
    }

    return this.result(
      corrected.filter((_, index) => !droppedIndexes.has(index)),
      true,
      appliedCorrections,
      corrections.length,
    );
  }

  private result(
    items: ParsedInvoiceItem[],
    attempted: boolean,
    appliedCorrections = 0,
    returnedCorrections = 0,
  ): AiInvoiceInterpretationResult {
    return {
      items,
      attempted,
      appliedCorrections,
      returnedCorrections,
    };
  }

  private correctionMathIsValid(
    correction: AiCorrection,
    current: ParsedInvoiceItem,
  ) {
    const quantity = correction.quantity ?? this.numberOrNull(current.quantity);
    const unitPrice =
      correction.unitPrice ?? this.numberOrNull(current.unitPrice);
    const totalAmount =
      correction.totalAmount ?? this.numberOrNull(current.totalAmount);

    if (quantity === null || unitPrice === null || totalAmount === null) {
      return true;
    }

    return Math.abs(quantity * unitPrice - totalAmount) <= 0.05;
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
      this.logger.log('OpenAI usage not returned in response.');
      return;
    }

    this.logger.log(
      [
        'OpenAI usage',
        `inputTokens=${response.usage.input_tokens ?? '-'}`,
        `outputTokens=${response.usage.output_tokens ?? '-'}`,
        `totalTokens=${response.usage.total_tokens ?? '-'}`,
      ].join(' | '),
    );
  }

  private numberOrNull(value?: string | null) {
    if (value === undefined || value === null) {
      return null;
    }

    const number = Number(value);

    return Number.isFinite(number) ? number : null;
  }

  private decimalString(value: number, fractionDigits: number) {
    return value.toFixed(fractionDigits);
  }

  private normalizeMatchCode(value?: string | null) {
    return value?.trim().toUpperCase();
  }

  private updatesAllowed() {
    return process.env.OPENAI_INVOICE_AI_ALLOW_UPDATE === 'true';
  }

  private isDropCandidate(item: ValidationItem) {
    const description = this.normalize(item.invoiceItem.descriptionRaw);
    const matchCode = this.normalize(item.invoiceItem.matchCode ?? '');

    if (
      description.includes('i v a') ||
      matchCode === 'i v a' ||
      description.includes('base imponible') ||
      description.includes('bruto') ||
      description.includes('descuento') ||
      description.includes('total')
    ) {
      return true;
    }

    return (
      this.looksLikeProductDescription(item.invoiceItem.matchCode) &&
      this.looksLikeReferenceFragment(item.invoiceItem.descriptionRaw)
    );
  }

  private looksLikeProductDescription(value?: string | null) {
    const normalized = this.normalize(value ?? '');

    return (
      normalized.includes('periodico') ||
      normalized.includes('paq') ||
      normalized.includes('antigrasa') ||
      normalized.includes('celulosa') ||
      normalized.includes('bolsa') ||
      normalized.includes('cliche')
    );
  }

  private looksLikeReferenceFragment(value?: string | null) {
    if (!value) {
      return false;
    }

    const normalized = this.normalize(value);

    return (
      /[A-Z]/.test(value) &&
      !normalized.includes('periodico') &&
      !normalized.includes('paq') &&
      !normalized.includes('antigrasa') &&
      !normalized.includes('celulosa') &&
      !normalized.includes('bolsa') &&
      !normalized.includes('cliche')
    );
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
