import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async check() {
    const suppliersCount = await this.prisma.supplier.count();

    return {
      status: 'ok',
      database: 'connected',
      suppliersCount,
      timestamp: new Date().toISOString(),
    };
  }
}
