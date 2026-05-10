import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Logger,
  Param,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { randomUUID } from 'node:crypto';
import { extname } from 'path';
import { UploadInvoiceDto } from './dto/upload-invoice.dto';
import { InvoicesService } from './invoices.service';

@Controller('invoices')
export class InvoicesController {
  private readonly logger = new Logger(InvoicesController.name);

  constructor(private readonly invoicesService: InvoicesService) {}

  @Post('upload-and-validate')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: './uploads',
        filename: (_, file, callback) => {
          callback(null, `${randomUUID()}${extname(file.originalname)}`);
        },
      }),
      fileFilter: (_, file, callback) => {
        const allowedMimeTypes = [
          'application/pdf',
          'image/png',
          'image/jpeg',
          'image/jpg',
        ];

        if (!allowedMimeTypes.includes(file.mimetype)) {
          return callback(
            new BadRequestException('Solo se permiten PDF, JPG y PNG'),
            false,
          );
        }

        callback(null, true);
      },
      limits: {
        fileSize: 20 * 1024 * 1024,
      },
    }),
  )
  uploadAndValidate(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: UploadInvoiceDto,
  ) {
    this.logger.debug(
      `POST /invoices/upload-and-validate received. supplierId=${dto.supplierId}`,
    );

    if (!file) {
      throw new BadRequestException('Archivo requerido');
    }

    return this.invoicesService.uploadAndValidate(dto, file);
  }

  @Get()
  findAll() {
    this.logger.debug('GET /invoices received');

    return this.invoicesService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    this.logger.debug(`GET /invoices/:id received. invoiceId=${id}`);

    return this.invoicesService.findOne(id);
  }
}
