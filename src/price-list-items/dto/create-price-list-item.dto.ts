import { PriceItemStatus, PriceUnit } from '@prisma/client';
import {
  IsEnum,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class CreatePriceListItemDto {
  @IsUUID()
  priceListId: string;

  @IsUUID()
  supplierId: string;

  @IsOptional()
  @IsUUID()
  canonicalProductId?: string;

  @IsString()
  @MaxLength(500)
  descriptionRaw: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  descriptionNormalized?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  channel?: string;

  @IsNumberString()
  priceAmount: string;

  @IsOptional()
  @IsString()
  @MaxLength(3)
  currency?: string;

  @IsOptional()
  @IsEnum(PriceUnit)
  priceUnit?: PriceUnit;

  @IsOptional()
  @IsNumberString()
  priceQuantityBase?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  rawUnitLabel?: string;

  @IsOptional()
  @IsNumberString()
  normalizedUnitPrice?: string;

  @IsOptional()
  @IsEnum(PriceUnit)
  normalizedUnit?: PriceUnit;

  @IsOptional()
  @IsNumberString()
  discountPercent?: string;

  @IsOptional()
  @IsNumberString()
  taxPercent?: string;

  @IsOptional()
  @IsEnum(PriceItemStatus)
  status?: PriceItemStatus;
}
