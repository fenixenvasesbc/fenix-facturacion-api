import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreatePriceListDto {
  @IsUUID()
  supplierId: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;
}
