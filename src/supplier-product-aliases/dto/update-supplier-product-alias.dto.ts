import { PartialType } from '@nestjs/mapped-types';
import { CreateSupplierProductAliasDto } from './create-supplier-product-alias.dto';

export class UpdateSupplierProductAliasDto extends PartialType(
  CreateSupplierProductAliasDto,
) {}
