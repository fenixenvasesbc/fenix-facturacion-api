import { Module } from '@nestjs/common';
import { DocumentExtractionService } from './document-extraction.service';
import { MoraYGomaExtractorService } from './mora-y-goma-extractor.service';
import { SaicaExtractorService } from './saica-extractor.service';

@Module({
  providers: [
    DocumentExtractionService,
    MoraYGomaExtractorService,
    SaicaExtractorService,
  ],
  exports: [DocumentExtractionService],
})
export class DocumentExtractionModule {}
