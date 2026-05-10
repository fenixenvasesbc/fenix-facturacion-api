import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class UploadInvoiceDto {
  @IsUUID()
  supplierId: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  invoiceNumber?: string;
}
