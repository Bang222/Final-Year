import { Controller, Get, Inject, UseInterceptors } from '@nestjs/common';
import { ManagerService } from './manager.service';
import { RedisCacheService, SharedService } from '@app/shared';
import {
  Ctx,
  MessagePattern,
  Payload,
  RmqContext,
} from '@nestjs/microservices';
import { CacheInterceptor } from '@nestjs/cache-manager';
import { TourService } from './tour/tour.service';
import { NewTouristDTO } from './tour/dtos';

@Controller('manager')
export class ManagerController {
  constructor(
    private readonly managerService: ManagerService,
    private readonly redisService: RedisCacheService,
    @Inject('SharedServiceInterface')
    private readonly sharedService: SharedService,
    private readonly tourService: TourService,
  ) {}
  @Get('hello')
  async hello() {
    return this.managerService.getHello();
  }
  @MessagePattern({ cmd: 'manager' })
  @UseInterceptors(CacheInterceptor)
  async getTourHello(@Ctx() context: RmqContext) {
    this.sharedService.acknowledgeMessage(context);
    const hello = await this.redisService.get('hello');
    if (hello) {
      console.log('Cache');
      return hello;
    }
    const h = this.managerService.getHello();
    await this.redisService.set('hello', h);
    return h;
  }
  @MessagePattern({ cmd: 'tour' })
  async tourHello(
    @Ctx() context: RmqContext,
    @Payload() payload: { id: number },
  ) {
    this.sharedService.acknowledgeMessage(context);
    return this.tourService.tourHello(payload.id);
  }
  @MessagePattern({ cmd: 'create-tour' })
  async createTour(
    @Ctx() context: RmqContext,
    @Payload() newTourDto: NewTouristDTO,
  ) {
    this.sharedService.acknowledgeMessage(context);
    return this.tourService.createTour(newTourDto);
  }
  @MessagePattern({ cmd: 'get-tours' })
  async getAllTour(@Ctx() context: RmqContext) {
    this.sharedService.acknowledgeMessage(context);
    return this.tourService.getTours();
  }
}