from pydantic import BaseModel, Field


class OcrRequest(BaseModel):
    fileName: str | None = None
    mimeType: str | None = None
    contentBase64: str = Field(min_length=1)


class OcrLine(BaseModel):
    text: str
    confidence: float
    box: list[list[float]]
    page: int


class OcrTable(BaseModel):
    page: int
    rows: list[list[str]]


class OcrResponse(BaseModel):
    text: str
    engine: str
    metadata: dict
    lines: list[OcrLine]
    tables: list[OcrTable]
