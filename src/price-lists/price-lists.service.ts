import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import { Prisma, PriceListStatus } from '@prisma/client';
import { DocumentExtractionService } from '../document-extraction/document-extraction.service';
import { OcrService } from '../ocr/ocr.service';
import { PriceListParserService } from '../price-list-parser/price-list-parser.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePriceListDto } from './dto/create-price-list.dto';
import { UploadPriceListDto } from './dto/upload-price-list.dto';

@Injectable()
export class PriceListsService {
  private readonly logger = new Logger(PriceListsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ocrService: OcrService,
    private readonly priceListParser: PriceListParserService,
    private readonly documentExtraction: DocumentExtractionService,
  ) {}

  async createManual(dto: CreatePriceListDto) {
    this.logger.log(`Creating manual price list. supplierId=${dto.supplierId}`);

    const supplier = await this.prisma.supplier.findUnique({
      where: {
        id: dto.supplierId,
      },
    });

    if (!supplier) {
      this.logger.warn(
        `Supplier not found during manual price list creation. supplierId=${dto.supplierId}`,
      );

      throw new NotFoundException('Proveedor no encontrado');
    }

    const priceList = await this.prisma.priceList.create({
      data: {
        supplierId: dto.supplierId,
        title: dto.title ?? 'Lista manual',
        status: PriceListStatus.READY,
        rawData: {
          source: 'manual',
          createdAt: new Date().toISOString(),
        },
      },
      include: {
        supplier: true,
        items: true,
      },
    });

    this.logger.log(
      `Manual price list created successfully. priceListId=${priceList.id}`,
    );

    return priceList;
  }

  async upload(dto: UploadPriceListDto, file: Express.Multer.File) {
    this.logger.log(
      `Uploading price list. supplierId=${dto.supplierId} filename=${file.originalname}`,
    );

    const supplier = await this.prisma.supplier.findUnique({
      where: {
        id: dto.supplierId,
      },
    });

    if (!supplier) {
      this.logger.warn(
        `Supplier not found during upload. supplierId=${dto.supplierId}`,
      );

      throw new NotFoundException('Proveedor no encontrado');
    }

    const priceList = await this.prisma.priceList.create({
      data: {
        supplierId: dto.supplierId,
        title: dto.title,
        fileName: file.originalname,
        mimeType: file.mimetype,
        fileSize: file.size,
        documentUrl: file.path,
        status: PriceListStatus.UPLOADED,
      },
    });

    this.logger.log(
      `Price list uploaded successfully. priceListId=${priceList.id}`,
    );

    return this.runAutomaticProcessing(priceList.id);
  }

  async findAll() {
    this.logger.debug('Fetching price lists');

    return this.prisma.priceList.findMany({
      include: {
        supplier: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async findOne(id: string) {
    this.logger.debug(`Fetching price list by id. priceListId=${id}`);

    const priceList = await this.prisma.priceList.findUnique({
      where: {
        id,
      },
      include: {
        supplier: true,
        items: true,
      },
    });

    if (!priceList) {
      this.logger.warn(`Price list not found. priceListId=${id}`);

      throw new NotFoundException('Lista de precios no encontrada');
    }

    return priceList;
  }

  async processOcr(id: string) {
    this.logger.log(`Processing OCR for price list. priceListId=${id}`);

    const priceList = await this.prisma.priceList.findUnique({
      where: {
        id,
      },
      include: {
        supplier: true,
      },
    });

    if (!priceList) {
      this.logger.warn(`Price list not found for OCR. priceListId=${id}`);

      throw new NotFoundException('Lista de precios no encontrada');
    }

    await this.prisma.priceList.update({
      where: {
        id,
      },
      data: {
        status: PriceListStatus.PROCESSING_OCR,
        errorMessage: null,
      },
    });

    try {
      const result = await this.ocrService.extractText({
        path: priceList.documentUrl ?? '',
        fileName: priceList.fileName,
        mimeType: priceList.mimeType,
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

      const processedPriceList = await this.prisma.priceList.update({
        where: {
          id,
        },
        data: {
          status: PriceListStatus.OCR_PROCESSED,
          rawText: result.text,
          rawData,
        },
        include: {
          supplier: true,
          items: true,
        },
      });

      this.logger.log(`OCR processed successfully. priceListId=${id}`);

      return processedPriceList;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Error procesando OCR';

      this.logger.error(
        `OCR processing failed. priceListId=${id} error=${errorMessage}`,
      );

      await this.prisma.priceList.update({
        where: {
          id,
        },
        data: {
          status: PriceListStatus.FAILED,
          errorMessage,
        },
      });

      throw error;
    }
  }

  async parse(id: string) {
    this.logger.log(`Parsing price list. priceListId=${id}`);

    const priceList = await this.prisma.priceList.findUnique({
      where: {
        id,
      },
      include: {
        supplier: true,
      },
    });

    if (!priceList) {
      this.logger.warn(`Price list not found for parsing. priceListId=${id}`);

      throw new NotFoundException('Lista de precios no encontrada');
    }

    if (!priceList.rawText && !priceList.rawData) {
      throw new BadRequestException(
        'La lista de precios debe procesarse con OCR antes del parsing',
      );
    }

    await this.prisma.priceList.update({
      where: {
        id,
      },
      data: {
        status: PriceListStatus.PARSING,
        errorMessage: null,
      },
    });

    try {
      const structuredItems = this.documentExtraction.extractPriceList({
        supplierName: priceList.supplier.name,
        rawText: priceList.rawText,
        rawData: priceList.rawData,
      });
      const parsedItems =
        structuredItems.length > 0
          ? structuredItems.map((item) => ({
              descriptionRaw: item.descriptionRaw,
              descriptionNormalized: item.descriptionNormalized,
              channel: item.channel,
              priceAmount: item.priceAmount,
              currency: item.currency,
              priceUnit: item.priceUnit,
              priceQuantityBase: item.priceQuantityBase,
              rawUnitLabel: item.rawUnitLabel,
              normalizedUnitPrice: item.normalizedUnitPrice,
              normalizedUnit: item.normalizedUnit,
              status: 'ACTIVE' as const,
              rowIndex: item.rowIndex,
              pageNumber: item.pageNumber,
              rawData: {
                ...item.rawData,
                confidence: item.confidence,
                warnings: item.warnings,
              },
            }))
          : this.priceListParser.parse({
              rawText: priceList.rawText,
              rawData: priceList.rawData,
            });

      if (parsedItems.length === 0) {
        throw new BadRequestException(
          'No se detectaron items de precios en el resultado OCR',
        );
      }

      await this.prisma.$transaction([
        this.prisma.priceListItem.deleteMany({
          where: {
            priceListId: id,
          },
        }),
        this.prisma.priceListItem.createMany({
          data: parsedItems.map((item) => ({
            priceListId: id,
            supplierId: priceList.supplierId,
            descriptionRaw: item.descriptionRaw,
            descriptionNormalized: item.descriptionNormalized,
            channel: item.channel,
            priceAmount: item.priceAmount,
            currency: item.currency,
            priceUnit: item.priceUnit,
            priceQuantityBase: item.priceQuantityBase,
            rawUnitLabel: item.rawUnitLabel,
            normalizedUnitPrice: item.normalizedUnitPrice,
            normalizedUnit: item.normalizedUnit,
            discountPercent: item.discountPercent,
            taxPercent: item.taxPercent,
            status: item.status,
            rowIndex: item.rowIndex,
            pageNumber: item.pageNumber,
            rawData: item.rawData,
          })),
        }),
        this.prisma.priceList.update({
          where: {
            id,
          },
          data: {
            status: PriceListStatus.READY,
          },
        }),
      ]);

      this.logger.log(
        `Price list parsed successfully. priceListId=${id} itemCount=${parsedItems.length}`,
      );

      return this.findOne(id);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Error parseando lista';

      await this.prisma.priceList.update({
        where: {
          id,
        },
        data: {
          status: PriceListStatus.FAILED,
          errorMessage,
        },
      });

      throw error;
    }
  }

  private async runAutomaticProcessing(id: string) {
    this.logger.log(
      `Starting automatic price list pipeline. priceListId=${id}`,
    );

    try {
      await this.processOcr(id);
      const parsedPriceList = await this.parse(id);

      this.logger.log(
        `Automatic price list pipeline finished. priceListId=${id}`,
      );

      return parsedPriceList;
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : 'Error procesando lista de precios';

      this.logger.error(
        `Automatic price list pipeline failed. priceListId=${id} error=${errorMessage}`,
      );

      await this.prisma.priceList.update({
        where: {
          id,
        },
        data: {
          status: PriceListStatus.FAILED,
          errorMessage,
        },
      });

      return this.findOne(id);
    }
  }
}
