import { Injectable, Logger } from '@nestjs/common';
import {
  DocumentExtractionInput,
  ExtractedInvoiceItem,
  ExtractedPriceListItem,
} from './document-extraction.types';
import { MoraYGomaExtractorService } from './mora-y-goma-extractor.service';

@Injectable()
export class DocumentExtractionService {
  private readonly logger = new Logger(DocumentExtractionService.name);

  constructor(private readonly moraYGomaExtractor: MoraYGomaExtractorService) {}

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
    if (this.moraYGomaExtractor.supports(input)) {
      const items = this.moraYGomaExtractor.extractInvoice(input);

      if (items.length > 0) {
        this.logger.log(
          `Structured invoice extraction succeeded. extractor=mora-y-goma count=${items.length}`,
        );

        return items;
      }
    }

    return [];
  }
}
