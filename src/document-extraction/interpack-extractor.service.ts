import { Injectable } from '@nestjs/common';
import { PriceUnit, Prisma } from '@prisma/client';
import {
  DocumentExtractionInput,
  ExtractedInvoiceItem,
  OcrTable,
} from './document-extraction.types';

@Injectable()
export class InterpackExtractorService {
  supports(input: DocumentExtractionInput) {
    return this.normalize(input.supplierName ?? '').includes('interpack');
  }

  extractInvoice(input: DocumentExtractionInput): ExtractedInvoiceItem[] {
    const textItems = this.extractInvoiceFromText(input.rawText ?? '');

    if (textItems.length > 0) {
      return textItems;
    }

    return this.extractInvoiceFromRawData(input.rawData);
  }

  private extractInvoiceFromText(rawText: string) {
    const lines = rawText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    return this.dedupeItems([
      ...this.extractKnownDescriptionRows(lines, 1),
      ...this.extractKnownReferenceInlineRows(lines, 1),
      ...this.extractModernInvoice(lines, 1),
      ...this.extractLegacyInvoice(lines, 1),
      ...this.extractReferenceOnlyInvoice(lines, 1),
    ]);
  }

  private extractInvoiceFromRawData(
    rawData?: Prisma.JsonValue | null,
  ): ExtractedInvoiceItem[] {
    const items: ExtractedInvoiceItem[] = [];
    const ocrLines = this.getOcrLines(rawData);

    if (ocrLines.length > 0) {
      items.push(
        ...this.extractKnownDescriptionRows(ocrLines, 1),
        ...this.extractKnownReferenceInlineRows(ocrLines, 1),
        ...this.extractModernInvoice(ocrLines, 1),
        ...this.extractLegacyInvoice(ocrLines, 1),
        ...this.extractReferenceOnlyInvoice(ocrLines, 1),
      );
    }

    for (const table of this.getTables(rawData)) {
      items.push(...this.extractInvoiceFromTableRows(table));

      const lines = (table.rows ?? [])
        .map((row) => this.cleanCells(row).join(' '))
        .filter(Boolean);

      items.push(
        ...this.extractKnownDescriptionRows(lines, table.page),
        ...this.extractKnownReferenceInlineRows(lines, table.page),
        ...this.extractModernInvoice(lines, table.page),
        ...this.extractLegacyInvoice(lines, table.page),
        ...this.extractReferenceOnlyInvoice(lines, table.page),
      );
    }

    return this.dedupeItems(items);
  }

  private extractKnownDescriptionRows(lines: string[], pageNumber?: number) {
    const items: ExtractedInvoiceItem[] = [];

    for (const [index, line] of lines.entries()) {
      const known = this.findKnownDescription(line);

      if (!known) {
        continue;
      }

      const lineWithoutKnownDescription = this.removeKnownDescription(line);
      const inlineValues = this.resolveQuantityPriceTotal(
        this.extractNumbers(lineWithoutKnownDescription),
      );
      const reference =
        this.findKnownReference([line]) ??
        this.findKnownReference(lines.slice(index + 1, index + 2));

      if (inlineValues && this.lineMathIsValid(inlineValues)) {
        items.push(
          this.toInvoiceItem({
            descriptionRaw: known.descriptionRaw,
            reference,
            quantity: inlineValues.quantity,
            unitPrice: inlineValues.unitPrice,
            totalAmount: inlineValues.totalAmount,
            rowIndex: index,
            pageNumber,
            sourceLines: [line],
            extractorName: 'interpack-invoice-known-description-inline',
            originalQuantity: inlineValues.quantity,
            originalUnitPrice: inlineValues.unitPrice,
          }),
        );

        continue;
      }

      const numericStartIndex =
        reference &&
        this.normalizeReference(lines[index + 1] ?? '') === reference
          ? index + 2
          : index + 1;
      const numericLines = lines.slice(
        numericStartIndex,
        numericStartIndex + 4,
      );
      const sequentialValues = this.resolveQuantityPriceTotal(
        numericLines.flatMap((numericLine) => this.extractNumbers(numericLine)),
      );

      if (!sequentialValues || !this.lineMathIsValid(sequentialValues)) {
        continue;
      }

      items.push(
        this.toInvoiceItem({
          descriptionRaw: known.descriptionRaw,
          reference,
          quantity: sequentialValues.quantity,
          unitPrice: sequentialValues.unitPrice,
          totalAmount: sequentialValues.totalAmount,
          rowIndex: index,
          pageNumber,
          sourceLines: lines.slice(index, numericStartIndex + 4),
          extractorName: 'interpack-invoice-known-description',
          originalQuantity: sequentialValues.quantity,
          originalUnitPrice: sequentialValues.unitPrice,
        }),
      );
    }

    return items;
  }

  private extractKnownReferenceInlineRows(
    lines: string[],
    pageNumber?: number,
  ) {
    const items: ExtractedInvoiceItem[] = [];

    for (const [index, line] of lines.entries()) {
      const reference = this.findKnownReference([line]);
      const descriptionRaw = reference
        ? this.knownDescriptionByReference(reference)
        : undefined;

      if (!reference || !descriptionRaw) {
        continue;
      }

      const numbers = this.extractNumbers(line);
      const values = this.resolveQuantityPriceTotal(numbers);

      if (!values) {
        continue;
      }

      items.push(
        this.toInvoiceItem({
          descriptionRaw,
          reference,
          quantity: values.quantity,
          unitPrice: values.unitPrice,
          totalAmount: values.totalAmount,
          rowIndex: index,
          pageNumber,
          sourceLines: [line],
          extractorName: 'interpack-invoice-known-reference-inline',
          originalQuantity: values.quantity,
          originalUnitPrice: values.unitPrice,
        }),
      );
    }

    return items;
  }

  private extractInvoiceFromTableRows(table: OcrTable) {
    const items: ExtractedInvoiceItem[] = [];

    for (const [rowIndex, row] of (table.rows ?? []).entries()) {
      const cells = this.cleanCells(row);

      if (
        cells.length < 4 ||
        this.isNoiseLine(this.normalize(cells.join(' ')))
      ) {
        continue;
      }

      const numericCells = cells
        .map((cell, index) => ({
          cell,
          index,
          value: this.parseLocaleNumber(cell),
        }))
        .filter(
          (entry): entry is { cell: string; index: number; value: number } =>
            entry.value !== undefined,
        );

      if (numericCells.length < 3) {
        continue;
      }

      const values = this.resolveQuantityPriceTotal(
        numericCells.map((entry) => entry.value),
      );
      const quantityCell =
        numericCells.length >= 4 && numericCells.at(-2)?.value === 0
          ? numericCells.at(-4)
          : numericCells.at(-3);

      if (!values || !quantityCell) {
        continue;
      }

      if (
        values.unitPrice < 0 ||
        values.totalAmount < 0 ||
        !this.lineMathIsValid(values)
      ) {
        continue;
      }

      const productCells = cells.slice(0, quantityCell.index);
      const reference = this.findKnownReference(cells);
      const descriptionRaw = reference
        ? this.knownDescriptionByReference(reference)
        : this.findDescriptionCell(productCells);

      if (!descriptionRaw && !reference) {
        continue;
      }

      items.push(
        this.toInvoiceItem({
          descriptionRaw: descriptionRaw ?? reference ?? cells[0],
          reference,
          quantity: values.quantity,
          unitPrice: values.unitPrice,
          totalAmount: values.totalAmount,
          rowIndex,
          pageNumber: table.page,
          sourceLines: [cells.join(' | ')],
          extractorName: 'interpack-invoice-table',
          originalQuantity: values.quantity,
          originalUnitPrice: values.unitPrice,
        }),
      );
    }

    return items;
  }

  private extractModernInvoice(lines: string[], pageNumber?: number) {
    const items: ExtractedInvoiceItem[] = [];
    let index = 0;

    while (index < lines.length) {
      const line = lines[index];
      const normalized = this.normalize(line);

      if (this.isNoiseLine(normalized) || this.isNumericLine(line)) {
        index += 1;
        continue;
      }

      const referenceIndex = this.findReferenceIndex(lines, index + 1);

      if (referenceIndex === undefined || referenceIndex - index > 3) {
        index += 1;
        continue;
      }

      const numericLines = lines.slice(referenceIndex + 1, referenceIndex + 4);

      if (
        numericLines.length < 3 ||
        !numericLines.every((value) => this.isNumericLine(value))
      ) {
        index += 1;
        continue;
      }

      const quantityRaw = this.parseLocaleNumber(numericLines[0]);
      const priceRaw = this.parseLocaleNumber(numericLines[1]);
      const totalAmount = this.parseLocaleNumber(numericLines[2]);

      if (
        quantityRaw === undefined ||
        priceRaw === undefined ||
        totalAmount === undefined ||
        priceRaw < 0 ||
        totalAmount < 0
      ) {
        index += 1;
        continue;
      }

      const trailingDetail = this.extractTrailingDetail(
        lines[referenceIndex + 4],
      );
      const descriptionRaw = [
        lines
          .slice(index, referenceIndex)
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim(),
        trailingDetail,
      ]
        .filter(Boolean)
        .join(' ');
      const reference = this.normalizeInvoiceReference(lines[referenceIndex]);
      const isThousandPriced = this.isThousandPricedInvoiceItem(descriptionRaw);
      const quantity = isThousandPriced ? quantityRaw * 1000 : quantityRaw;
      const unitPrice = isThousandPriced ? priceRaw / 1000 : priceRaw;

      items.push(
        this.toInvoiceItem({
          descriptionRaw,
          reference,
          quantity,
          unitPrice,
          totalAmount,
          rowIndex: index,
          pageNumber,
          sourceLines: lines.slice(
            index,
            referenceIndex + (trailingDetail ? 5 : 4),
          ),
          extractorName: 'interpack-invoice-modern',
          originalQuantity: quantityRaw,
          originalUnitPrice: priceRaw,
        }),
      );

      index = referenceIndex + (trailingDetail ? 5 : 4);
    }

    return items;
  }

  private extractReferenceOnlyInvoice(lines: string[], pageNumber?: number) {
    const items: ExtractedInvoiceItem[] = [];

    for (let index = 0; index < lines.length - 3; index += 1) {
      const reference = this.normalizeReference(lines[index]);
      const knownDescription = this.knownDescriptionByReference(reference);

      if (!knownDescription) {
        continue;
      }

      const numericLines = lines.slice(index + 1, index + 4);

      if (!numericLines.every((value) => this.isNumericLine(value))) {
        continue;
      }

      const quantity = this.parseLocaleNumber(numericLines[0]);
      const unitPrice = this.parseLocaleNumber(numericLines[1]);
      const totalAmount = this.parseLocaleNumber(numericLines[2]);

      if (
        quantity === undefined ||
        unitPrice === undefined ||
        totalAmount === undefined ||
        unitPrice < 0 ||
        totalAmount < 0
      ) {
        continue;
      }

      items.push(
        this.toInvoiceItem({
          descriptionRaw: knownDescription,
          reference,
          quantity,
          unitPrice,
          totalAmount,
          rowIndex: index,
          pageNumber,
          sourceLines: lines.slice(index, index + 4),
          extractorName: 'interpack-invoice-reference-only',
          originalQuantity: quantity,
          originalUnitPrice: unitPrice,
        }),
      );
    }

    return items;
  }

  private extractLegacyInvoice(lines: string[], pageNumber?: number) {
    const items: ExtractedInvoiceItem[] = [];

    for (let index = 0; index < lines.length - 2; index += 1) {
      const normalized = this.normalize(lines[index]);

      if (
        this.isNoiseLine(normalized) ||
        this.isNumericLine(lines[index]) ||
        this.extractNumbers(lines[index]).length >= 2 ||
        !this.isLegacyCategoryLine(normalized)
      ) {
        continue;
      }

      const descriptionIndex = index + 1;
      const descriptionRaw = lines[descriptionIndex];
      const descriptionNormalized = this.normalize(descriptionRaw);

      if (
        this.isNoiseLine(descriptionNormalized) ||
        this.isNumericLine(descriptionRaw) ||
        descriptionNormalized.includes('cliche')
      ) {
        continue;
      }

      const numericIndex = this.findLegacyNumericIndex(
        lines,
        descriptionIndex + 1,
      );

      if (numericIndex === undefined) {
        continue;
      }

      const numbers = this.extractNumbers(lines[numericIndex]);
      const totalAmount = this.parseLocaleNumber(lines[numericIndex + 1] ?? '');

      if (
        numbers.length < 2 ||
        totalAmount === undefined ||
        numbers[1] < 0 ||
        totalAmount < 0
      ) {
        continue;
      }

      const isMillar = this.normalize(descriptionRaw).includes('millar');
      const quantity = isMillar ? numbers[0] * 1000 : numbers[0];
      const unitPrice = isMillar ? numbers[1] / 1000 : numbers[1];

      items.push(
        this.toInvoiceItem({
          descriptionRaw,
          quantity,
          unitPrice,
          totalAmount,
          rowIndex: index,
          pageNumber,
          sourceLines: lines.slice(index, numericIndex + 2),
          extractorName: 'interpack-invoice-legacy',
          originalQuantity: numbers[0],
          originalUnitPrice: numbers[1],
        }),
      );
    }

    return items;
  }

  private toInvoiceItem(input: {
    descriptionRaw: string;
    reference?: string;
    quantity: number;
    unitPrice: number;
    totalAmount: number;
    rowIndex: number;
    pageNumber?: number;
    sourceLines: string[];
    extractorName: string;
    originalQuantity?: number;
    originalUnitPrice?: number;
  }): ExtractedInvoiceItem {
    const matchCode = this.resolveMatchCode(
      input.descriptionRaw,
      input.reference,
    );
    const alternateMatchCodes = this.resolveAlternateMatchCodes(
      input.descriptionRaw,
      input.reference,
    );
    const warnings = this.validateLineMath(
      input.quantity,
      input.unitPrice,
      input.totalAmount,
    );

    return {
      descriptionRaw: input.descriptionRaw,
      descriptionNormalized: this.normalize(input.descriptionRaw),
      matchCode,
      reference: input.reference,
      quantity: this.decimalString(input.quantity, 4),
      unit: PriceUnit.UNIT,
      unitPrice: this.decimalString(input.unitPrice, 6),
      totalAmount: this.decimalString(input.totalAmount, 4),
      currency: 'EUR',
      rowIndex: input.rowIndex,
      pageNumber: input.pageNumber,
      confidence: warnings.length === 0 ? 0.94 : 0.82,
      warnings,
      rawData: {
        extractor: {
          name: input.extractorName,
          reference: input.reference,
          originalQuantity:
            input.originalQuantity === undefined
              ? undefined
              : this.decimalString(input.originalQuantity, 4),
          originalUnitPrice:
            input.originalUnitPrice === undefined
              ? undefined
              : this.decimalString(input.originalUnitPrice, 6),
          alternateMatchCodes,
          sourceLines: input.sourceLines,
        },
      },
    };
  }

  private resolveMatchCode(descriptionRaw: string, reference?: string) {
    const normalized = this.normalize(descriptionRaw);
    const knownMatchCode = reference
      ? this.knownMatchCodeByReference(reference)
      : undefined;

    if (knownMatchCode) {
      return knownMatchCode;
    }

    if (normalized.includes('cliche')) {
      return 'CLICHES';
    }

    if (normalized.includes('resma') || normalized.includes('antigrasa')) {
      const resmaMatchCode = this.resolveResmaMatchCode(descriptionRaw);

      return this.isGenericInterpackReference(reference)
        ? resmaMatchCode
        : (reference ?? resmaMatchCode);
    }

    if (normalized.includes('bolsa')) {
      return reference ?? this.resolveBagMatchCode(descriptionRaw);
    }

    return reference;
  }

  private resolveAlternateMatchCodes(
    descriptionRaw: string,
    reference?: string,
  ) {
    const normalized = this.normalize(descriptionRaw);
    const knownMatchCode = reference
      ? this.knownMatchCodeByReference(reference)
      : undefined;

    if (knownMatchCode) {
      return undefined;
    }

    const derived = normalized.includes('bolsa')
      ? this.resolveBagMatchCode(descriptionRaw)
      : normalized.includes('resma') || normalized.includes('antigrasa')
        ? this.resolveResmaMatchCode(descriptionRaw)
        : undefined;
    const alternates =
      normalized.includes('resma') || normalized.includes('antigrasa')
        ? this.resolveResmaAlternateMatchCodes(descriptionRaw)
        : [];

    if (!derived || derived === reference) {
      return alternates.length > 0 ? alternates : undefined;
    }

    const primary = this.resolveMatchCode(descriptionRaw, reference);

    return [derived, ...alternates]
      .filter((value, index, values) => values.indexOf(value) === index)
      .filter((value) => value !== reference && value !== primary);
  }

  private resolveBagMatchCode(descriptionRaw: string) {
    const normalized = this.normalize(descriptionRaw);
    const measureMatch = /(\d+)\s*\+\s*(\d+)\s*[*x]\s*(\d+)/i.exec(
      descriptionRaw,
    );
    const colorCode = normalized.includes('blanco')
      ? 'B'
      : normalized.includes('marron')
        ? 'M'
        : normalized.includes('antigrasa')
          ? 'A'
          : undefined;

    if (measureMatch && colorCode) {
      return `${measureMatch[1]}${measureMatch[2]}${measureMatch[3]}${colorCode}I`;
    }

    return undefined;
  }

  private resolveResmaMatchCode(descriptionRaw: string) {
    const knownDescription = this.findKnownDescription(descriptionRaw);

    if (knownDescription) {
      return knownDescription.matchCode;
    }

    const normalized = this.normalize(descriptionRaw);

    if (
      normalized.includes('antigrasa') &&
      /75\s*[x*]\s*100/i.test(descriptionRaw) &&
      /500\s*h/i.test(descriptionRaw)
    ) {
      return 'INTERPACK_RESMA_ANTIGRASA_75X100_500H';
    }

    if (normalized.includes('celulosa')) {
      const gramaje = /(\d+(?:[,.]\d+)?)\s*gr/i.exec(descriptionRaw)?.[1];

      return gramaje
        ? `INTERPACK_CELULOSA_${this.formatMeasureToken(gramaje)}G`
        : 'INTERPACK_CELULOSA';
    }

    if (normalized.includes('antigrasa')) {
      const cutMatch =
        /corte\s*(\d+(?:[,.]\d+)?)\s*[x*]\s*(\d+(?:[,.]\d+)?)/i.exec(
          descriptionRaw,
        );
      const anySizeMatch =
        /(\d+(?:[,.]\d+)?)\s*[x*]\s*(\d+(?:[,.]\d+)?)\s*cm?\s*millar/i.exec(
          descriptionRaw,
        );
      if (cutMatch) {
        return `INTERPACK_RESMA_ANTIGRASA_CORTE_${this.preserveCutMeasure(
          cutMatch[1],
          cutMatch[2],
        )}`;
      }

      if (anySizeMatch) {
        return `INTERPACK_RESMA_ANTIGRASA_CORTE_${this.normalizeCutMeasure(
          anySizeMatch[1],
          anySizeMatch[2],
        )}`;
      }

      const widthMatch = /(\d+(?:[,.]\d+)?)\s*[x*]\s*86/i.exec(descriptionRaw);

      if (widthMatch) {
        return `INTERPACK_RESMA_ANTIGRASA_ANCHO_${this.formatMeasureToken(
          widthMatch[1],
        )}`;
      }

      return 'INTERPACK_RESMA_ANTIGRASA';
    }

    return undefined;
  }

  private resolveResmaAlternateMatchCodes(descriptionRaw: string) {
    const normalized = this.normalize(descriptionRaw);

    if (!normalized.includes('antigrasa')) {
      return [];
    }

    const cutMatch =
      /corte\s*(\d+(?:[,.]\d+)?)\s*[x*]\s*(\d+(?:[,.]\d+)?)/i.exec(
        descriptionRaw,
      );
    const anySizeMatch =
      /(\d+(?:[,.]\d+)?)\s*[x*]\s*(\d+(?:[,.]\d+)?)\s*cm?\s*millar/i.exec(
        descriptionRaw,
      );
    const sizeMatch = cutMatch ?? anySizeMatch;

    if (!sizeMatch) {
      return [];
    }

    return [
      `INTERPACK_RESMA_ANTIGRASA_CORTE_${this.normalizeCutMeasure(
        sizeMatch[1],
        sizeMatch[2],
      )}`,
      `INTERPACK_RESMA_ANTIGRASA_CORTE_${this.preserveCutMeasure(
        sizeMatch[2],
        sizeMatch[1],
      )}`,
    ];
  }

  private normalizeCutMeasure(firstRaw: string, secondRaw: string) {
    const first = this.measureInteger(firstRaw);
    const second = this.measureInteger(secondRaw);
    const ordered = [first, second].sort((left, right) => left - right);

    return `${ordered[0]}X${ordered[1]}`;
  }

  private preserveCutMeasure(firstRaw: string, secondRaw: string) {
    return `${this.measureInteger(firstRaw)}X${this.measureInteger(secondRaw)}`;
  }

  private measureInteger(value: string) {
    const parsed = this.parseLocaleNumber(value);

    if (parsed === undefined) {
      return 0;
    }

    return Math.trunc(parsed);
  }

  private findReferenceIndex(lines: string[], startIndex: number) {
    for (
      let index = startIndex;
      index < Math.min(lines.length, startIndex + 4);
      index += 1
    ) {
      if (
        this.isInterpackReference(lines[index]) ||
        (this.isTextReferenceCandidate(lines[index]) &&
          this.nextThreeLinesAreNumeric(lines, index + 1))
      ) {
        return index;
      }
    }

    return undefined;
  }

  private findLegacyNumericIndex(lines: string[], startIndex: number) {
    for (
      let index = startIndex;
      index < Math.min(lines.length, startIndex + 4);
      index += 1
    ) {
      const numbers = this.extractNumbers(lines[index]);

      if (numbers.length >= 2) {
        return index;
      }
    }

    return undefined;
  }

  private isInterpackReference(value: string) {
    const clean = this.normalizeReference(value);

    return (
      this.isKnownInvoiceReference(clean) ||
      (/^[A-Z0-9]{3,}$/.test(clean) && /[A-Z]/.test(clean) && /\d/.test(clean))
    );
  }

  private isTextReferenceCandidate(value: string) {
    const trimmed = value.trim();
    const normalized = this.normalize(trimmed);

    if (
      trimmed.length < 3 ||
      trimmed.length > 40 ||
      this.isNumericLine(trimmed) ||
      this.isNoiseLine(normalized)
    ) {
      return false;
    }

    if (/[a-z]/.test(trimmed)) {
      return false;
    }

    return /[A-Z]/.test(trimmed) && /^[A-Z0-9ÁÉÍÓÚÜÑ.,*+\-/\s]+$/.test(trimmed);
  }

  private nextThreeLinesAreNumeric(lines: string[], startIndex: number) {
    return lines
      .slice(startIndex, startIndex + 3)
      .every((line) => this.isNumericLine(line));
  }

  private isKnownInvoiceReference(reference: string) {
    return [
      'CLICHES',
      'RESMAANTIMP',
      'RESMA2',
    ].includes(reference);
  }

  private isGenericInterpackReference(reference?: string) {
    return reference === 'RESMAANTIMP';
  }

  private normalizeReference(value: string) {
    return value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  }

  private normalizeInvoiceReference(value: string) {
    const rawReference = value.trim().replace(/\s+/g, ' ').toUpperCase();
    const normalizedReference = this.normalizeReference(rawReference);
    const knownReferences: Record<string, string> = {
      CLICHES: 'CLICHES',
      RESMAANTIMP: 'RESMAANTIMP',
      RESMA2: 'RESMA2',
    };

    return knownReferences[normalizedReference] ?? rawReference;
  }

  private findKnownReference(cells: string[]) {
    const knownReferences = ['RESMA2'];

    for (const cell of cells) {
      const normalized = this.normalizeReference(cell);
      const reference = knownReferences.find((knownReference) =>
        normalized.includes(knownReference),
      );

      if (reference) {
        return reference;
      }
    }

    return undefined;
  }

  private findDescriptionCell(cells: string[]) {
    return cells.find((cell) => {
      const normalized = this.normalize(cell);

      return (
        normalized.includes('bolsa') ||
        normalized.includes('resma') ||
        normalized.includes('antigrasa') ||
        normalized.includes('celulosa')
      );
    });
  }

  private findKnownDescription(value: string) {
    const normalized = this.normalize(value);

    if (
      normalized.includes('resma') &&
      normalized.includes('antigrasa') &&
      /75\s*[x*]\s*100/i.test(value) &&
      /500\s*h/i.test(value)
    ) {
      return {
        descriptionRaw: 'RESMA ANTIGRASA 75*100 500H',
        matchCode: 'INTERPACK_RESMA_ANTIGRASA_75X100_500H',
      };
    }

    return undefined;
  }

  private removeKnownDescription(value: string) {
    return value.replace(
      /resma\s+antigrasa\s+75\s*[x*]\s*100\s+500\s*h(?:ojas)?/i,
      ' ',
    );
  }

  private knownDescriptionByReference(reference: string) {
    const knownReferences: Record<string, string> = {
      RESMA2: 'RESMA ANTIGRASA 75*100 500H',
    };

    return knownReferences[reference];
  }

  private knownMatchCodeByReference(reference: string) {
    const knownReferences: Record<string, string> = {
      RESMA2: 'INTERPACK_RESMA_ANTIGRASA_75X100_500H',
      CLICHES: 'CLICHES',
    };

    return knownReferences[reference];
  }

  private isThousandPricedInvoiceItem(descriptionRaw: string) {
    const normalized = this.normalize(descriptionRaw);

    return (
      normalized.includes('bolsa') ||
      normalized.includes('paq') && /1000\s*h/i.test(descriptionRaw)
    );
  }

  private extractTrailingDetail(value?: string) {
    if (!value) {
      return undefined;
    }

    const normalized = this.normalize(value);

    if (normalized.startsWith('corte')) {
      return value;
    }

    return undefined;
  }

  private isLegacyCategoryLine(normalized: string) {
    return (
      normalized.includes('resma') ||
      normalized.includes('papel antigra') ||
      normalized.includes('p antigra') ||
      normalized.includes('cliches')
    );
  }

  private validateLineMath(
    quantity: number,
    unitPrice: number,
    totalAmount: number,
  ) {
    const expected = quantity * unitPrice;
    const difference = Math.abs(expected - totalAmount);

    if (difference > 0.05) {
      return [
        `Importe no cuadra: ${this.decimalString(quantity, 4)} * ${this.decimalString(unitPrice, 6)} = ${this.decimalString(expected, 2)} vs ${this.decimalString(totalAmount, 2)}`,
      ];
    }

    return [];
  }

  private resolveQuantityPriceTotal(numbers: number[]) {
    if (numbers.length < 3) {
      return undefined;
    }

    const values =
      numbers.length >= 4 && numbers.at(-2) === 0
        ? [numbers.at(-4), numbers.at(-3), numbers.at(-1)]
        : numbers.slice(-3);
    const [quantity, unitPrice, totalAmount] = values;

    if (
      quantity === undefined ||
      unitPrice === undefined ||
      totalAmount === undefined
    ) {
      return undefined;
    }

    return {
      quantity,
      unitPrice,
      totalAmount,
    };
  }

  private lineMathIsValid(values: {
    quantity: number;
    unitPrice: number;
    totalAmount: number;
  }) {
    return (
      Math.abs(values.quantity * values.unitPrice - values.totalAmount) <= 0.05
    );
  }

  private dedupeItems(items: ExtractedInvoiceItem[]) {
    const bestByKey = new Map<string, ExtractedInvoiceItem>();
    const normalizedItems = items.map((item) =>
      this.normalizeKnownReferenceItem(item),
    );
    const completeKnownMatchCodes = new Set(
      normalizedItems
        .filter(
          (item) =>
            this.isKnownReferenceMatchCode(item.matchCode) &&
            item.quantity !== undefined &&
            item.totalAmount !== undefined,
        )
        .map((item) => item.matchCode),
    );

    for (const item of normalizedItems) {
      if (
        this.isKnownReferenceMatchCode(item.matchCode) &&
        completeKnownMatchCodes.has(item.matchCode) &&
        (item.quantity === undefined || item.totalAmount === undefined)
      ) {
        continue;
      }

      const key = [
        item.matchCode ?? '',
        item.reference ?? '',
        item.descriptionNormalized,
        item.quantity ?? '',
        item.totalAmount ?? '',
      ].join('|');
      const previous = bestByKey.get(key);

      if (
        !previous ||
        this.itemQualityScore(item) > this.itemQualityScore(previous)
      ) {
        bestByKey.set(key, item);
      }
    }

    return [...bestByKey.values()];
  }

  private normalizeKnownReferenceItem(
    item: ExtractedInvoiceItem,
  ): ExtractedInvoiceItem {
    const reference =
      this.findKnownReference([item.reference ?? '', item.descriptionRaw]) ??
      item.reference;
    const matchCode = reference
      ? this.knownMatchCodeByReference(reference)
      : undefined;
    const descriptionRaw = reference
      ? this.knownDescriptionByReference(reference)
      : undefined;

    if (!matchCode || !descriptionRaw) {
      return item;
    }

    return {
      ...item,
      descriptionRaw,
      descriptionNormalized: this.normalize(descriptionRaw),
      matchCode,
      reference,
    };
  }

  private isKnownReferenceMatchCode(value?: string) {
    return value === 'INTERPACK_RESMA_ANTIGRASA_75X100_500H';
  }

  private itemQualityScore(item: ExtractedInvoiceItem) {
    return (
      item.confidence +
      (item.warnings.length === 0 ? 1 : 0) +
      (item.descriptionRaw !== item.reference ? 0.25 : 0)
    );
  }

  private isNumericLine(value: string) {
    return this.parseLocaleNumber(value) !== undefined;
  }

  private extractNumbers(value: string) {
    return Array.from(
      value.matchAll(/-?\d{1,3}(?:\.\d{3})*(?:,\d+)?|-?\d+(?:[,.]\d+)?/g),
    )
      .map((match) => this.parseLocaleNumber(match[0]))
      .filter((value): value is number => value !== undefined);
  }

  private parseLocaleNumber(value: string) {
    const clean = value.trim().replace(/\s/g, '');

    if (!/^-?\d{1,3}(?:\.\d{3})*(?:,\d+)?$|^-?\d+(?:[,.]\d+)?$/.test(clean)) {
      return undefined;
    }

    if (clean.includes(',') && clean.includes('.')) {
      return Number(clean.replace(/\./g, '').replace(',', '.'));
    }

    if (/^-?\d{1,3}(?:\.\d{3})+$/.test(clean)) {
      return Number(clean.replace(/\./g, ''));
    }

    return Number(clean.replace(',', '.'));
  }

  private decimalString(value: number, fractionDigits: number) {
    return value.toFixed(fractionDigits);
  }

  private formatMeasureToken(value: string) {
    return value
      .replace(',', '_')
      .replace('.', '_')
      .replace(/[^0-9_]/g, '');
  }

  private isNoiseLine(normalizedLine: string) {
    return [
      'factura',
      'interpack embalajes',
      'cliente',
      'codigo',
      'descripcion',
      'cantidad',
      'precio',
      'importe',
      'subtotal',
      'total',
      'iva',
      'base imponible',
      'fecha',
      'vencimiento',
      'forma de pago',
      'observaciones',
      'referencia',
      'albaran',
      'domiciliacion',
      'abono error',
      'abono',
    ].some((term) => normalizedLine.includes(term));
  }

  private getTables(rawData?: Prisma.JsonValue | null): OcrTable[] {
    const raw = rawData as
      | {
          ocr?: {
            tables?: unknown[];
          };
        }
      | null
      | undefined;

    return (raw?.ocr?.tables ?? [])
      .map((table) => this.normalizeOcrTable(table))
      .filter((table): table is OcrTable => Boolean(table));
  }

  private normalizeOcrTable(table: unknown): OcrTable | undefined {
    if (!table || typeof table !== 'object') {
      return undefined;
    }

    const candidate = table as {
      page?: unknown;
      rows?: unknown;
      cells?: unknown;
    };
    const rows = Array.isArray(candidate.rows)
      ? candidate.rows
      : Array.isArray(candidate.cells)
        ? candidate.cells
        : [];

    return {
      page: typeof candidate.page === 'number' ? candidate.page : undefined,
      rows: rows
        .map((row) => this.normalizeOcrRow(row))
        .filter((row) => row.length > 0),
    };
  }

  private normalizeOcrRow(row: unknown): string[] {
    if (Array.isArray(row)) {
      return row.map((cell) => String(cell).trim()).filter(Boolean);
    }

    if (row && typeof row === 'object') {
      const candidate = row as {
        cells?: unknown;
        text?: unknown;
        content?: unknown;
        value?: unknown;
      };

      if (Array.isArray(candidate.cells)) {
        return candidate.cells
          .map((cell) => String(cell).trim())
          .filter(Boolean);
      }

      const text =
        candidate.text ?? candidate.content ?? candidate.value ?? undefined;

      return text === undefined ? [] : [String(text).trim()].filter(Boolean);
    }

    return row === undefined || row === null
      ? []
      : [String(row).trim()].filter(Boolean);
  }

  private getOcrLines(rawData?: Prisma.JsonValue | null) {
    const raw = rawData as
      | {
          ocr?: {
            lines?: unknown[];
          };
        }
      | null
      | undefined;

    return (raw?.ocr?.lines ?? [])
      .flatMap((line) => this.normalizeOcrLine(line))
      .filter(Boolean);
  }

  private normalizeOcrLine(line: unknown): string[] {
    if (typeof line === 'string') {
      return [line.trim()].filter(Boolean);
    }

    if (Array.isArray(line)) {
      return [
        line
          .map((cell) => String(cell).trim())
          .filter(Boolean)
          .join(' '),
      ].filter(Boolean);
    }

    if (line && typeof line === 'object') {
      const candidate = line as {
        text?: unknown;
        content?: unknown;
        value?: unknown;
        description?: unknown;
        cells?: unknown;
      };

      if (Array.isArray(candidate.cells)) {
        return [
          candidate.cells
            .map((cell) => String(cell).trim())
            .filter(Boolean)
            .join(' '),
        ].filter(Boolean);
      }

      const text =
        candidate.text ??
        candidate.content ??
        candidate.value ??
        candidate.description;

      return text === undefined ? [] : [String(text).trim()].filter(Boolean);
    }

    return [];
  }

  private cleanCells(row: unknown[]) {
    return row.map((cell) => String(cell).trim()).filter(Boolean);
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
