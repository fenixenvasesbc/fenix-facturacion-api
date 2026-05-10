import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCanonicalProductDto } from './dto/create-canonical-product.dto';
import { UpdateCanonicalProductDto } from './dto/update-canonical-product.dto';

@Injectable()
export class CanonicalProductsService {
  private readonly logger = new Logger(CanonicalProductsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateCanonicalProductDto) {
    this.logger.log(`Creating canonical product. name=${dto.name}`);

    return this.prisma.canonicalProduct.create({
      data: {
        name: dto.name,
        description: dto.description,
        category: dto.category,
        defaultUnit: dto.defaultUnit,
      },
    });
  }

  async findAll() {
    this.logger.debug('Fetching canonical products');

    return this.prisma.canonicalProduct.findMany({
      include: {
        aliases: true,
      },
      orderBy: {
        name: 'asc',
      },
    });
  }

  async findOne(id: string) {
    this.logger.debug(`Fetching canonical product. canonicalProductId=${id}`);

    const product = await this.prisma.canonicalProduct.findUnique({
      where: {
        id,
      },
      include: {
        aliases: true,
        priceItems: true,
      },
    });

    if (!product) {
      throw new NotFoundException('Producto canónico no encontrado');
    }

    return product;
  }

  async update(id: string, dto: UpdateCanonicalProductDto) {
    this.logger.log(`Updating canonical product. canonicalProductId=${id}`);

    await this.findOne(id);

    return this.prisma.canonicalProduct.update({
      where: {
        id,
      },
      data: {
        name: dto.name,
        description: dto.description,
        category: dto.category,
        defaultUnit: dto.defaultUnit,
      },
    });
  }

  async remove(id: string) {
    this.logger.warn(`Deleting canonical product. canonicalProductId=${id}`);

    await this.findOne(id);

    return this.prisma.canonicalProduct.delete({
      where: {
        id,
      },
    });
  }
}
