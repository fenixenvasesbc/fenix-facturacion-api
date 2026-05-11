import { Module } from '@nestjs/common';
import { DocumentExtractionModule } from '../document-extraction/document-extraction.module';
import { OcrModule } from '../ocr/ocr.module';
import { PrismaModule } from '../prisma/prisma.module';
import { InvoiceParserService } from './invoice-parser.service';
import { InvoiceValidationService } from './invoice-validation.service';
import { InvoicesController } from './invoices.controller';
import { InvoicesService } from './invoices.service';

@Module({
  imports: [PrismaModule, OcrModule, DocumentExtractionModule],
  controllers: [InvoicesController],
  providers: [InvoicesService, InvoiceParserService, InvoiceValidationService],
  exports: [InvoicesService],
})
export class InvoicesModule {}
