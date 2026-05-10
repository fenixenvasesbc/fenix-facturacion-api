import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class UploadPriceListDto {
  @IsUUID()
  supplierId: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;
}
