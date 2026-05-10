import {
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class CreateSupplierProductAliasDto {
  @IsUUID()
  supplierId: string;

  @IsOptional()
  @IsUUID()
  canonicalProductId?: string;

  @IsOptional()
  @IsUUID()
  priceListItemId?: string;

  @IsString()
  @MaxLength(500)
  aliasRaw: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  aliasNormalized?: string;

  @IsOptional()
  @IsNumberString()
  confidence?: string;
}
