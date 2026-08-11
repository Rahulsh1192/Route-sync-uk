import { Module } from '@nestjs/common';
import { BookingsController } from './bookings.controller';
import { BookingsService } from './bookings.service';
import { PrismaModule } from '../../database/prisma.module';
import { GeoModule } from '../geo/geo.module';

@Module({
  imports: [PrismaModule, GeoModule],
  controllers: [BookingsController],
  providers: [BookingsService],
  exports: [BookingsService],
})
export class BookingsModule {}
