import { Module } from '@nestjs/common';
import { DocumentExtractionService } from './document-extraction.service';
import { MoraYGomaExtractorService } from './mora-y-goma-extractor.service';
import { SaicaExtractorService } from './saica-extractor.service';
import { SotoExtractorService } from './soto-extractor.service';

@Module({
  providers: [
    DocumentExtractionService,
    MoraYGomaExtractorService,
    SaicaExtractorService,
    SotoExtractorService,
  ],
  exports: [DocumentExtractionService],
})
export class DocumentExtractionModule {}
