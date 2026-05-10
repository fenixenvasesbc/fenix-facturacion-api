import base64
import logging

from fastapi import FastAPI, File, HTTPException, UploadFile

from app.ocr_engine import OcrEngine
from app.schemas import OcrRequest, OcrResponse

logging.basicConfig(level=logging.INFO)

app = FastAPI(title="Fenix OCR Service", version="0.1.0")
engine = OcrEngine()


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "ocr"}


@app.post("/ocr", response_model=OcrResponse)
def process_ocr(payload: OcrRequest) -> dict:
    try:
        document = engine.decode_request(
            file_name=payload.fileName,
            mime_type=payload.mimeType,
            content_base64=payload.contentBase64,
        )

        return engine.process(document)
    except Exception as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


@app.post("/ocr/upload", response_model=OcrResponse)
async def process_uploaded_ocr(file: UploadFile = File(...)) -> dict:
    try:
        content = await file.read()
        document = engine.decode_request(
            file_name=file.filename,
            mime_type=file.content_type,
            content_base64=base64.b64encode(content).decode("ascii"),
        )

        return engine.process(document)
    except Exception as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
