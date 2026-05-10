import {
  Body,
  Controller,
  Get,
  Logger,
  Param,
  Post,
  UploadedFile,
  UseInterceptors,
  BadRequestException,
} from '@nestjs/common';

import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { randomUUID } from 'node:crypto';
import { extname } from 'path';

import { PriceListsService } from './price-lists.service';
import { UploadPriceListDto } from './dto/upload-price-list.dto';

@Controller('price-lists')
export class PriceListsController {
  private readonly logger = new Logger(PriceListsController.name);

  constructor(private readonly priceListsService: PriceListsService) {}

  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: './uploads',

        filename: (_, file, callback) => {
          const uniqueName = `${randomUUID()}${extname(file.originalname)}`;

          callback(null, uniqueName);
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
  async upload(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: UploadPriceListDto,
  ) {
    this.logger.debug(
      `POST /price-lists/upload received. filename=${file?.originalname}`,
    );

    if (!file) {
      this.logger.warn('Upload attempted without file');

      throw new BadRequestException('Archivo requerido');
    }

    return this.priceListsService.upload(dto, file);
  }

  @Get()
  findAll() {
    this.logger.debug('GET /price-lists received');

    return this.priceListsService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    this.logger.debug(`GET /price-lists/:id received. priceListId=${id}`);

    return this.priceListsService.findOne(id);
  }

  @Post(':id/process-ocr')
  processOcr(@Param('id') id: string) {
    this.logger.debug(
      `POST /price-lists/:id/process-ocr received. priceListId=${id}`,
    );

    return this.priceListsService.processOcr(id);
  }

  @Post(':id/parse')
  parse(@Param('id') id: string) {
    this.logger.debug(
      `POST /price-lists/:id/parse received. priceListId=${id}`,
    );

    return this.priceListsService.parse(id);
  }
}
