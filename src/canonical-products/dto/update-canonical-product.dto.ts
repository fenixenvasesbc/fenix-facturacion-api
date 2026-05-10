import { PartialType } from '@nestjs/mapped-types';
import { CreateCanonicalProductDto } from './create-canonical-product.dto';

export class UpdateCanonicalProductDto extends PartialType(
  CreateCanonicalProductDto,
) {}
