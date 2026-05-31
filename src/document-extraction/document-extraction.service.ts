import { Injectable, Logger } from '@nestjs/common';
import {
  DocumentExtractionInput,
  ExtractedInvoiceItem,
  ExtractedPriceListItem,
} from './document-extraction.types';
import { DrakoExtractorService } from './drako-extractor.service';
import { InterpackExtractorService } from './interpack-extractor.service';
import { MoraYGomaExtractorService } from './mora-y-goma-extractor.service';
import { SaicaExtractorService } from './saica-extractor.service';
import { SotoExtractorService } from './soto-extractor.service';

@Injectable()
export class DocumentExtractionService {
  private readonly logger = new Logger(DocumentExtractionService.name);

  constructor(
    private readonly drakoExtractor: DrakoExtractorService,
    private readonly interpackExtractor: InterpackExtractorService,
    private readonly moraYGomaExtractor: MoraYGomaExtractorService,
    private readonly saicaExtractor: SaicaExtractorService,
    private readonly sotoExtractor: SotoExtractorService,
  ) {}

  extractPriceList(input: DocumentExtractionInput): ExtractedPriceListItem[] {
    if (this.moraYGomaExtractor.supports(input)) {
      const items = this.moraYGomaExtractor.extractPriceList(input);

      if (items.length > 0) {
        this.logger.log(
          `Structured price list extraction succeeded. extractor=mora-y-goma count=${items.length}`,
        );

        return items;
      }
    }

    return [];
  }

  extractInvoice(input: DocumentExtractionInput): ExtractedInvoiceItem[] {
    if (this.interpackExtractor.supports(input)) {
      const items = this.interpackExtractor.extractInvoice(input);

      if (items.length > 0) {
        this.logger.log(
          `Structured invoice extraction succeeded. extractor=interpack count=${items.length}`,
        );

        return items;
      }
    }

    if (this.drakoExtractor.supports(input)) {
      const items = this.drakoExtractor.extractInvoice(input);

      if (items.length > 0) {
        this.logger.log(
          `Structured invoice extraction succeeded. extractor=drako count=${items.length}`,
        );

        return items;
      }
    }

    if (this.saicaExtractor.supports(input)) {
      const items = this.saicaExtractor.extractInvoice(input);

      if (items.length > 0) {
        this.logger.log(
          `Structured invoice extraction succeeded. extractor=saica count=${items.length}`,
        );

        return items;
      }
    }

    if (this.moraYGomaExtractor.supports(input)) {
      const items = this.moraYGomaExtractor.extractInvoice(input);

      if (items.length > 0) {
        this.logger.log(
          `Structured invoice extraction succeeded. extractor=mora-y-goma count=${items.length}`,
        );

        return items;
      }
    }

    if (this.sotoExtractor.supports(input)) {
      const items = this.sotoExtractor.extractInvoice(input);

      if (items.length > 0) {
        this.logger.log(
          `Structured invoice extraction succeeded. extractor=soto count=${items.length}`,
        );

        return items;
      }
    }

    return [];
  }
}
