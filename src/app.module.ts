import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { HealthModule } from './health/health.module';
import { SuppliersModule } from './suppliers/suppliers.module';
import { PriceListsModule } from './price-lists/price-lists.module';

@Module({
  imports: [PrismaModule, HealthModule, SuppliersModule, PriceListsModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
