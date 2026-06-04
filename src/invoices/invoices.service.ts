import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  InvoiceBillingResult,
  InvoiceStatus,
  PriceItemStatus,
  Prisma,
} from '@prisma/client';
import { DocumentExtractionService } from '../document-extraction/document-extraction.service';
import { OcrService } from '../ocr/ocr.service';
import { PrismaService } from '../prisma/prisma.service';
import { AiInvoiceInterpreterService } from './ai-invoice-interpreter.service';
import { FindInvoicesQueryDto } from './dto/find-invoices-query.dto';
import { InvoiceParserService } from './invoice-parser.service';
import { InvoiceValidationService } from './invoice-validation.service';
import { UploadInvoiceDto } from './dto/upload-invoice.dto';

@Injectable()
export class InvoicesService {
  private readonly logger = new Logger(InvoicesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ocrService: OcrService,
    private readonly invoiceParser: InvoiceParserService,
    private readonly invoiceValidation: InvoiceValidationService,
    private readonly documentExtraction: DocumentExtractionService,
    private readonly aiInvoiceInterpreter: AiInvoiceInterpreterService,
  ) {}

  async uploadAndValidate(dto: UploadInvoiceDto, file: Express.Multer.File) {
    this.logger.log(
      `Uploading invoice. supplierId=${dto.supplierId} filename=${file.originalname}`,
    );

    const supplier = await this.prisma.supplier.findUnique({
      where: {
        id: dto.supplierId,
      },
    });

    if (!supplier) {
      throw new NotFoundException('Proveedor no encontrado');
    }

    const invoice = await this.prisma.invoice.create({
      data: {
        supplierId: dto.supplierId,
        title: dto.title,
        invoiceNumber: dto.invoiceNumber,
        fileName: file.originalname,
        mimeType: file.mimetype,
        fileSize: file.size,
        documentUrl: file.path,
        status: InvoiceStatus.UPLOADED,
      },
    });

    return this.runPipeline(invoice.id);
  }

  async findAll(query: FindInvoicesQueryDto = {}) {
    return this.prisma.invoice.findMany({
      where: {
        supplierId: query.supplierId,
        status: query.status,
        billingResult: query.billingResult,
      },
      include: {
        supplier: true,
        items: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async findOne(id: string) {
    const invoice = await this.prisma.invoice.findUnique({
      where: {
        id,
      },
      include: {
        supplier: true,
        items: {
          include: {
            matchedPriceListItem: true,
            matchedPriceListItemPrice: true,
            canonicalProduct: true,
          },
        },
      },
    });

    if (!invoice) {
      throw new NotFoundException('Factura no encontrada');
    }

    return invoice;
  }

  private async runPipeline(id: string) {
    try {
      await this.processOcr(id);
      const parsedItems = await this.parse(id);
      const validation = await this.validate(id, parsedItems);

      return {
        invoiceId: id,
        ...validation,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Error validando factura';

      await this.prisma.invoice.update({
        where: {
          id,
        },
        data: {
          status: InvoiceStatus.FAILED,
          billingResult: InvoiceBillingResult.NEEDS_REVIEW,
          errorMessage,
        },
      });

      return {
        invoiceId: id,
        status: 'DIFFERENCES_FOUND',
        billingResult: InvoiceBillingResult.NEEDS_REVIEW,
        message: errorMessage,
        summary: {
          totalItems: 0,
          ok: 0,
          overcharges: 0,
          undercharges: 0,
          notFound: 0,
          unitMismatches: 0,
          requiresReview: 0,
        },
        differences: [],
      };
    }
  }

  private async processOcr(id: string) {
    const invoice = await this.prisma.invoice.findUnique({
      where: {
        id,
      },
      include: {
        supplier: true,
      },
    });

    if (!invoice) {
      throw new NotFoundException('Factura no encontrada');
    }

    await this.prisma.invoice.update({
      where: {
        id,
      },
      data: {
        status: InvoiceStatus.PROCESSING_OCR,
        errorMessage: null,
      },
    });

    const result = await this.ocrService.extractText({
      path: invoice.documentUrl ?? '',
      fileName: invoice.fileName,
      mimeType: invoice.mimeType,
    });

    const rawData: Prisma.InputJsonObject = {
      ocr: {
        engine: result.engine,
        metadata: result.metadata as Prisma.InputJsonObject,
        lines: (result.lines ?? []) as Prisma.InputJsonArray,
        tables: (result.tables ?? []) as Prisma.InputJsonArray,
        processedAt: new Date().toISOString(),
      },
    };

    return this.prisma.invoice.update({
      where: {
        id,
      },
      data: {
        status: InvoiceStatus.OCR_PROCESSED,
        rawText: result.text,
        rawData,
      },
    });
  }

  private async parse(id: string) {
    const invoice = await this.prisma.invoice.findUnique({
      where: {
        id,
      },
      include: {
        supplier: true,
      },
    });

    if (!invoice) {
      throw new NotFoundException('Factura no encontrada');
    }

    if (!invoice.rawText && !invoice.rawData) {
      throw new BadRequestException(
        'La factura debe procesarse con OCR antes del parsing',
      );
    }

    await this.prisma.invoice.update({
      where: {
        id,
      },
      data: {
        status: InvoiceStatus.PARSING,
      },
    });

    const structuredItems = this.documentExtraction.extractInvoice({
      supplierName: invoice.supplier.name,
      rawText: invoice.rawText,
      rawData: invoice.rawData,
    });
    const parsedItems =
      structuredItems.length > 0
        ? structuredItems.map((item) => ({
            descriptionRaw: item.descriptionRaw,
            descriptionNormalized: item.descriptionNormalized,
            matchCode: item.matchCode,
            channel: item.channel,
            lengthMm: item.lengthMm,
            widthMm: item.widthMm,
            heightMm: item.heightMm,
            quantity: item.quantity,
            unit: item.unit,
            unitPrice: item.unitPrice,
            totalAmount: item.totalAmount,
            currency: item.currency,
            rowIndex: item.rowIndex,
            pageNumber: item.pageNumber,
            rawData: {
              ...item.rawData,
              reference: item.reference,
              size: item.size,
              channel: item.channel,
              matchCode: item.matchCode,
              confidence: item.confidence,
              warnings: item.warnings,
            },
          }))
        : this.invoiceParser.parse({
            rawText: invoice.rawText,
            rawData: invoice.rawData,
          });

    if (parsedItems.length === 0) {
      throw new BadRequestException(
        'No se detectaron productos facturados en el resultado OCR',
      );
    }

    return parsedItems;
  }

  private async validate(
    id: string,
    parsedItems: ReturnType<InvoiceParserService['parse']>,
  ) {
    const invoice = await this.prisma.invoice.findUnique({
      where: {
        id,
      },
      include: {
        supplier: true,
      },
    });

    if (!invoice) {
      throw new NotFoundException('Factura no encontrada');
    }

    await this.prisma.invoice.update({
      where: {
        id,
      },
      data: {
        status: InvoiceStatus.VALIDATING,
      },
    });

    const negotiatedItems = await this.prisma.priceListItem.findMany({
      where: {
        supplierId: invoice.supplierId,
        status: 'ACTIVE',
      },
      include: {
        canonicalProduct: true,
        aliases: true,
        priceRules: {
          where: {
            status: {
              not: PriceItemStatus.INACTIVE,
            },
          },
          orderBy: {
            minQuantity: 'asc',
          },
        },
      },
      orderBy: {
        updatedAt: 'desc',
      },
    });

    const initialValidation = this.invoiceValidation.validate(
      parsedItems,
      negotiatedItems,
    );
    const aiInterpretation = await this.aiInvoiceInterpreter.interpretItems({
      supplierName: invoice.supplier.name,
      invoiceItems: parsedItems,
      validationItems: initialValidation.items,
      negotiatedItems,
    });
    const validation =
      aiInterpretation.appliedCorrections > 0
        ? this.invoiceValidation.validate(
            aiInterpretation.items,
            negotiatedItems,
          )
        : initialValidation;

    if (aiInterpretation.attempted) {
      this.logger.log(
        [
          'AI invoice interpretation summary',
          `invoiceId=${id}`,
          `returnedCorrections=${aiInterpretation.returnedCorrections}`,
          `appliedCorrections=${aiInterpretation.appliedCorrections}`,
          `initial=${this.formatValidationSummary(initialValidation.response.summary)}`,
          `final=${this.formatValidationSummary(validation.response.summary)}`,
        ].join(' | '),
      );
    }

    await this.prisma.$transaction([
      this.prisma.invoiceItem.deleteMany({
        where: {
          invoiceId: id,
        },
      }),
      this.prisma.invoiceItem.createMany({
        data: validation.items.map((item) => ({
          invoiceId: id,
          supplierId: invoice.supplierId,
          matchedPriceListItemId: item.matchedItem?.id,
          canonicalProductId: item.matchedItem?.canonicalProductId,
          matchedPriceListItemPriceId: item.matchedPriceRule?.id,
          descriptionRaw: item.invoiceItem.descriptionRaw,
          descriptionNormalized: item.invoiceItem.descriptionNormalized,
          matchCode: item.invoiceItem.matchCode,
          lengthMm: item.invoiceItem.lengthMm,
          widthMm: item.invoiceItem.widthMm,
          heightMm: item.invoiceItem.heightMm,
          quantity: item.invoiceItem.quantity,
          unit: item.invoiceItem.unit,
          unitPrice: item.invoiceItem.unitPrice,
          totalAmount: item.invoiceItem.totalAmount,
          currency: item.invoiceItem.currency,
          discountPercent: item.invoiceItem.discountPercent,
          taxPercent: item.invoiceItem.taxPercent,
          validationStatus: item.validationStatus,
          differencePercent:
            item.differencePercent === undefined
              ? undefined
              : item.differencePercent.toFixed(4),
          rawData: item.invoiceItem.rawData,
        })),
      }),
      this.prisma.invoice.update({
        where: {
          id,
        },
        data: {
          status: InvoiceStatus.VALIDATED,
          validationStatus: validation.response.status,
          billingResult: validation.response.billingResult,
          validationResult:
            validation.response as unknown as Prisma.InputJsonObject,
        },
      }),
    ]);

    return validation.response;
  }

  private formatValidationSummary(summary: {
    totalItems: number;
    ok: number;
    overcharges: number;
    undercharges: number;
    notFound: number;
    unitMismatches: number;
    requiresReview: number;
  }) {
    return `total=${summary.totalItems},ok=${summary.ok},overcharges=${summary.overcharges},undercharges=${summary.undercharges},notFound=${summary.notFound},unitMismatches=${summary.unitMismatches},requiresReview=${summary.requiresReview}`;
  }
}
