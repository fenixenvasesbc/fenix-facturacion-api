# Fenix OCR Service

Microservicio OCR para facturacion Fenix.

Endpoints:

- `GET /health`
- `POST /ocr` con JSON: `fileName`, `mimeType`, `contentBase64`
- `POST /ocr/upload` con multipart `file`

El servicio usa FastAPI, PaddleOCR, OpenCV y PyMuPDF. En el primer procesamiento PaddleOCR puede descargar modelos de idioma.
