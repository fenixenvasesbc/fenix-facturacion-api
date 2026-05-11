import { Module } from '@nestjs/common';
import { DocumentExtractionService } from './document-extraction.service';
import { MoraYGomaExtractorService } from './mora-y-goma-extractor.service';

@Module({
  providers: [DocumentExtractionService, MoraYGomaExtractorService],
  exports: [DocumentExtractionService],
})
export class DocumentExtractionModule {}
