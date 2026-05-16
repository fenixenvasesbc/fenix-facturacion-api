import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { InvoiceBillingResult, InvoiceStatus } from '@prisma/client';

export class FindInvoicesQueryDto {
  @IsOptional()
  @IsUUID()
  supplierId?: string;

  @IsOptional()
  @IsEnum(InvoiceStatus)
  status?: InvoiceStatus;

  @IsOptional()
  @IsEnum(InvoiceBillingResult)
  billingResult?: InvoiceBillingResult;
}
