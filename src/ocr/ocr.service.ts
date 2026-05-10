import { Injectable, Logger } from '@nestjs/common';
import { readFile } from 'fs/promises';
import { inflateSync } from 'zlib';

export interface OcrDocument {
  path: string;
  fileName?: string | null;
  mimeType?: string | null;
}

export interface OcrResult {
  text: string;
  engine: string;
  metadata: Record<string, unknown>;
  lines?: unknown[];
  tables?: unknown[];
}

@Injectable()
export class OcrService {
  private readonly logger = new Logger(OcrService.name);

  async extractText(document: OcrDocument): Promise<OcrResult> {
    this.logger.log(
      `Extracting text. filename=${document.fileName ?? 'unknown'} mimeType=${document.mimeType ?? 'unknown'}`,
    );

    const externalResult = await this.tryExternalOcr(document);

    if (externalResult) {
      return externalResult;
    }

    if (document.mimeType === 'application/pdf') {
      const buffer = await readFile(document.path);
      const text = this.extractEmbeddedPdfText(buffer);

      return {
        text,
        engine: 'embedded-pdf',
        metadata: {
          strategy: 'pdf-text-streams',
          textLength: text.length,
          hasText: text.trim().length > 0,
        },
      };
    }

    throw new Error(
      'OCR externo requerido para imágenes. Configura OCR_SERVICE_URL para procesar JPG/PNG.',
    );
  }

  private async tryExternalOcr(
    document: OcrDocument,
  ): Promise<OcrResult | null> {
    const ocrServiceUrl = process.env.OCR_SERVICE_URL;

    if (!ocrServiceUrl) {
      return null;
    }

    const buffer = await readFile(document.path);
    const response = await fetch(ocrServiceUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        fileName: document.fileName,
        mimeType: document.mimeType,
        contentBase64: buffer.toString('base64'),
      }),
    });

    if (!response.ok) {
      throw new Error(`OCR service failed with status ${response.status}`);
    }

    const payload = (await response.json()) as {
      text?: string;
      engine?: string;
      metadata?: Record<string, unknown>;
      lines?: unknown[];
      tables?: unknown[];
    };

    return {
      text: payload.text ?? '',
      engine: payload.engine ?? 'external-ocr',
      metadata: payload.metadata ?? {},
      lines: payload.lines ?? [],
      tables: payload.tables ?? [],
    };
  }

  private extractEmbeddedPdfText(buffer: Buffer): string {
    const pdf = buffer.toString('latin1');
    const streams = this.extractPdfStreams(pdf);
    const unicodeMaps = this.extractUnicodeMaps(streams);
    const fontMaps = this.extractFontMaps(pdf);
    const textParts: string[] = [];

    for (const stream of streams) {
      textParts.push(
        ...this.extractTextFromContentStream(stream, fontMaps, unicodeMaps),
      );
    }

    return this.normalizeText(textParts.join('\n'));
  }

  private extractPdfStreams(pdf: string): string[] {
    const streams: string[] = [];
    const streamRegex = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
    let match: RegExpExecArray | null;

    while ((match = streamRegex.exec(pdf)) !== null) {
      const raw = Buffer.from(match[1], 'latin1');

      try {
        streams.push(inflateSync(raw).toString('latin1'));
      } catch {
        streams.push(match[1]);
      }
    }

    return streams;
  }

  private extractUnicodeMaps(streams: string[]) {
    const maps = new Map<string, Map<number, string>>();
    let index = 0;

    for (const stream of streams) {
      if (!stream.includes('beginbfchar') && !stream.includes('beginbfrange')) {
        continue;
      }

      const map = new Map<number, string>();
      const charRegex = /<([0-9a-fA-F]{4})>\s*<([0-9a-fA-F]+)>/g;
      let charMatch: RegExpExecArray | null;

      while ((charMatch = charRegex.exec(stream)) !== null) {
        map.set(
          Number.parseInt(charMatch[1], 16),
          this.decodeUtf16Hex(charMatch[2]),
        );
      }

      const rangeRegex =
        /<([0-9a-fA-F]{4})>\s*<([0-9a-fA-F]{4})>\s*<([0-9a-fA-F]+)>/g;
      let rangeMatch: RegExpExecArray | null;

      while ((rangeMatch = rangeRegex.exec(stream)) !== null) {
        const start = Number.parseInt(rangeMatch[1], 16);
        const end = Number.parseInt(rangeMatch[2], 16);
        const target = Number.parseInt(rangeMatch[3], 16);

        for (let code = start; code <= end; code += 1) {
          map.set(code, String.fromCodePoint(target + code - start));
        }
      }

      maps.set(String(index), map);
      index += 1;
    }

    return maps;
  }

  private extractFontMaps(pdf: string) {
    const fontMaps = new Map<string, Map<number, string>>();
    const fontRegex =
      /\/([A-Za-z0-9]+)\s+\d+\s+0\s+R[\s\S]{0,400}?\/ToUnicode\s+(\d+)\s+0\s+R/g;
    let fontMatch: RegExpExecArray | null;
    let mapIndex = 0;

    while ((fontMatch = fontRegex.exec(pdf)) !== null) {
      const alias = fontMatch[1];
      const unicodeIndex = String(mapIndex);
      mapIndex += 1;

      if (fontMaps.has(alias)) {
        continue;
      }

      const map = this.findUnicodeMapByObjectId(pdf, fontMatch[2]);

      if (map.size > 0) {
        fontMaps.set(alias, map);
      } else {
        const indexedMap = this.extractUnicodeMaps(
          this.extractPdfStreams(pdf),
        ).get(unicodeIndex);

        if (indexedMap) {
          fontMaps.set(alias, indexedMap);
        }
      }
    }

    return fontMaps;
  }

  private findUnicodeMapByObjectId(pdf: string, objectId: string) {
    const map = new Map<number, string>();
    const objectRegex = new RegExp(
      `${objectId}\\s+0\\s+obj[\\s\\S]*?stream\\r?\\n([\\s\\S]*?)\\r?\\nendstream`,
    );
    const match = objectRegex.exec(pdf);

    if (!match) {
      return map;
    }

    let content = match[1];

    try {
      content = inflateSync(Buffer.from(content, 'latin1')).toString('latin1');
    } catch {
      // Some PDFs store ToUnicode streams uncompressed.
    }

    const charRegex = /<([0-9a-fA-F]{4})>\s*<([0-9a-fA-F]+)>/g;
    let charMatch: RegExpExecArray | null;

    while ((charMatch = charRegex.exec(content)) !== null) {
      map.set(
        Number.parseInt(charMatch[1], 16),
        this.decodeUtf16Hex(charMatch[2]),
      );
    }

    return map;
  }

  private extractTextFromContentStream(
    stream: string,
    fontMaps: Map<string, Map<number, string>>,
    unicodeMaps: Map<string, Map<number, string>>,
  ) {
    const parts: string[] = [];
    let currentFont: string | null = null;
    const tokenRegex =
      /\/([A-Za-z0-9]+)\s+[0-9.]+\s+Tf|\[((?:.|\n)*?)\]\s*TJ|<([0-9a-fA-F]+)>\s*Tj|\(((?:\\.|[^\\)])*)\)\s*Tj/g;
    let match: RegExpExecArray | null;

    while ((match = tokenRegex.exec(stream)) !== null) {
      if (match[1]) {
        currentFont = match[1];
        continue;
      }

      const fontMap =
        (currentFont ? fontMaps.get(currentFont) : undefined) ??
        unicodeMaps.values().next().value;

      if (match[2]) {
        const hexParts = [...match[2].matchAll(/<([0-9a-fA-F]+)>/g)].map(
          (hexMatch) => hexMatch[1],
        );
        parts.push(
          hexParts.map((hex) => this.decodePdfHex(hex, fontMap)).join(''),
        );
      }

      if (match[3]) {
        parts.push(this.decodePdfHex(match[3], fontMap));
      }

      if (match[4]) {
        parts.push(this.decodePdfLiteral(match[4]));
      }
    }

    return parts.filter((part) => part.trim().length > 0);
  }

  private decodePdfHex(hex: string, map?: Map<number, string>) {
    if (map && map.size > 0) {
      const chars: string[] = [];

      for (let index = 0; index < hex.length; index += 4) {
        const code = Number.parseInt(hex.slice(index, index + 4), 16);
        chars.push(map.get(code) ?? '');
      }

      return chars.join('');
    }

    return this.decodeUtf16Hex(hex);
  }

  private decodeUtf16Hex(hex: string) {
    const bytes = Buffer.from(hex, 'hex');

    if (bytes.length >= 2) {
      return bytes.swap16().toString('utf16le').replace(/\0/g, '');
    }

    return bytes.toString('utf8');
  }

  private decodePdfLiteral(value: string) {
    return value
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '\r')
      .replace(/\\t/g, '\t')
      .replace(/\\\(/g, '(')
      .replace(/\\\)/g, ')')
      .replace(/\\\\/g, '\\');
  }

  private normalizeText(text: string) {
    return text
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }
}
