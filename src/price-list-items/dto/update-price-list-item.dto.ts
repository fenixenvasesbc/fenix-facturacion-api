import { PriceItemStatus, PriceUnit } from '@prisma/client';
import {
  IsEnum,
  IsInt,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class UpdatePriceListItemDto {
  @IsOptional()
  @IsUUID()
  canonicalProductId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  descriptionRaw?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  descriptionNormalized?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  channel?: string;

  @IsOptional()
  @IsNumberString()
  priceAmount?: string;

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

  @IsOptional()
  @IsInt()
  rowIndex?: number;

  @IsOptional()
  @IsInt()
  pageNumber?: number;
}
