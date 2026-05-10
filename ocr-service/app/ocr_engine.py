import base64
import io
import logging
from dataclasses import dataclass
from typing import Any

import fitz
import numpy as np
from paddleocr import PaddleOCR
from PIL import Image

logger = logging.getLogger(__name__)


@dataclass
class OcrInput:
    file_name: str | None
    mime_type: str | None
    content: bytes


class OcrEngine:
    def __init__(self) -> None:
        self._paddle: PaddleOCR | None = None

    @property
    def paddle(self) -> PaddleOCR:
        if self._paddle is None:
            logger.info("Loading PaddleOCR model")
            self._paddle = PaddleOCR(
                use_angle_cls=True,
                lang="es",
                show_log=False,
            )

        return self._paddle

    def decode_request(
        self,
        file_name: str | None,
        mime_type: str | None,
        content_base64: str,
    ) -> OcrInput:
        return OcrInput(
            file_name=file_name,
            mime_type=mime_type,
            content=base64.b64decode(content_base64),
        )

    def process(self, document: OcrInput) -> dict[str, Any]:
        if document.mime_type == "application/pdf" or self._is_pdf(document):
            return self._process_pdf(document)

        if document.mime_type in {"image/png", "image/jpeg", "image/jpg"}:
            return self._process_image(document.content, page=1)

        raise ValueError(f"Unsupported mime type: {document.mime_type}")

    def _process_pdf(self, document: OcrInput) -> dict[str, Any]:
        pdf = fitz.open(stream=document.content, filetype="pdf")
        embedded_text_parts: list[str] = []
        all_lines: list[dict[str, Any]] = []
        all_tables: list[dict[str, Any]] = []

        for page_index in range(pdf.page_count):
            page = pdf.load_page(page_index)
            embedded_text = page.get_text("text").strip()

            if embedded_text:
                embedded_text_parts.append(embedded_text)

            pixmap = page.get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False)
            image = Image.frombytes("RGB", [pixmap.width, pixmap.height], pixmap.samples)
            page_result = self._ocr_pil_image(image, page=page_index + 1)
            all_lines.extend(page_result["lines"])
            all_tables.extend(page_result["tables"])

        ocr_text = "\n".join(line["text"] for line in all_lines).strip()
        embedded_text = "\n\n".join(embedded_text_parts).strip()
        combined_text = embedded_text or ocr_text

        if embedded_text and ocr_text and ocr_text not in embedded_text:
            combined_text = f"{embedded_text}\n\n{ocr_text}"

        return {
            "text": combined_text,
            "engine": "paddleocr",
            "metadata": {
                "strategy": "pdf-embedded-text-and-paddleocr",
                "pageCount": pdf.page_count,
                "hasEmbeddedText": bool(embedded_text),
                "ocrLineCount": len(all_lines),
            },
            "lines": all_lines,
            "tables": all_tables,
        }

    def _process_image(self, content: bytes, page: int) -> dict[str, Any]:
        image = Image.open(io.BytesIO(content)).convert("RGB")
        return self._ocr_pil_image(image, page)

    def _ocr_pil_image(self, image: Image.Image, page: int) -> dict[str, Any]:
        result = self.paddle.ocr(np.array(image), cls=True)
        lines = self._normalize_paddle_result(result, page)

        return {
            "text": "\n".join(line["text"] for line in lines),
            "engine": "paddleocr",
            "metadata": {
                "strategy": "paddleocr-image",
                "pageCount": 1,
                "ocrLineCount": len(lines),
            },
            "lines": lines,
            "tables": self._build_tables(lines, page),
        }

    def _normalize_paddle_result(
        self,
        result: list[Any] | None,
        page: int,
    ) -> list[dict[str, Any]]:
        if not result:
            return []

        raw_lines = result[0] if result and isinstance(result[0], list) else result
        lines: list[dict[str, Any]] = []

        for raw_line in raw_lines:
            if not raw_line or len(raw_line) < 2:
                continue

            box = raw_line[0]
            text_data = raw_line[1]
            text = str(text_data[0]).strip()
            confidence = float(text_data[1])

            if not text:
                continue

            lines.append(
                {
                    "text": text,
                    "confidence": confidence,
                    "box": [[float(point[0]), float(point[1])] for point in box],
                    "page": page,
                }
            )

        return sorted(lines, key=lambda line: (self._box_top(line["box"]), self._box_left(line["box"])))

    def _build_tables(
        self,
        lines: list[dict[str, Any]],
        page: int,
    ) -> list[dict[str, Any]]:
        rows: list[list[dict[str, Any]]] = []

        for line in lines:
            top = self._box_top(line["box"])
            matched_row = None

            for row in rows:
                row_top = sum(self._box_top(item["box"]) for item in row) / len(row)

                if abs(row_top - top) <= 14:
                    matched_row = row
                    break

            if matched_row is None:
                rows.append([line])
            else:
                matched_row.append(line)

        table_rows: list[list[str]] = []

        for row in rows:
            ordered = sorted(row, key=lambda item: self._box_left(item["box"]))
            table_rows.append([item["text"] for item in ordered])

        return [{"page": page, "rows": table_rows}] if table_rows else []

    def _is_pdf(self, document: OcrInput) -> bool:
        return document.content.startswith(b"%PDF")

    def _box_top(self, box: list[list[float]]) -> float:
        return min(point[1] for point in box)

    def _box_left(self, box: list[list[float]]) -> float:
        return min(point[0] for point in box)
