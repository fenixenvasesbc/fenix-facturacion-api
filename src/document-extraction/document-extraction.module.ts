import { Module } from '@nestjs/common';
import { DrakoExtractorService } from './drako-extractor.service';
import { DocumentExtractionService } from './document-extraction.service';
import { InterpackExtractorService } from './interpack-extractor.service';
import { MoraYGomaExtractorService } from './mora-y-goma-extractor.service';
import { PlastivalleExtractorService } from './plastivalle-extractor.service';
import { SaicaExtractorService } from './saica-extractor.service';
import { SotoExtractorService } from './soto-extractor.service';

@Module({
  providers: [
    DocumentExtractionService,
    DrakoExtractorService,
    InterpackExtractorService,
    MoraYGomaExtractorService,
    PlastivalleExtractorService,
    SaicaExtractorService,
    SotoExtractorService,
  ],
  exports: [DocumentExtractionService],
})
export class DocumentExtractionModule {}
