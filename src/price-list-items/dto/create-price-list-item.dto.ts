import { PriceItemStatus, PriceUnit } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsIn,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export const PRICING_MODES = ['UNIT_PRICE', 'FLAT_TOTAL'] as const;
export type PricingMode = (typeof PRICING_MODES)[number];

export class CreatePriceListItemPriceDto {
  @IsOptional()
  @IsNumberString()
  minQuantity?: string;

  @IsOptional()
  @IsNumberString()
  maxQuantity?: string;

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

  @IsOptional()
  @IsIn(PRICING_MODES)
  pricingMode?: PricingMode;
}

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

  @IsOptional()
  @IsString()
  @MaxLength(100)
  matchCode?: string;

  @IsOptional()
  @IsNumberString()
  lengthMm?: string;

  @IsOptional()
  @IsNumberString()
  widthMm?: string;

  @IsOptional()
  @IsNumberString()
  heightMm?: string;

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
  @IsIn(PRICING_MODES)
  pricingMode?: PricingMode;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreatePriceListItemPriceDto)
  prices?: CreatePriceListItemPriceDto[];
}
