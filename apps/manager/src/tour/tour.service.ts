import { BadRequestException, Inject, Injectable } from '@nestjs/common';

import {
  CartEntity,
  CartRepositoryInterface,
  CommentEntity,
  CommentRepositoryInterface,
  OrderDetailRepositoryInterface,
  OrderRepositoryInterface,
  PassengerRepositoryInterface,
  RedisCacheService,
  ScheduleEntity,
  ScheduleRepositoryInterface,
  ShareExperienceEntity,
  ShareExperienceRepositoryInterface,
  TourEntity,
  TourRepositoryInterface,
  UserEntity,
  UserRegisteredTourRepositoryInterface,
  UsersRepositoryInterface,
} from '@app/shared';

import {
  BookingTourDto,
  CartDto,
  CreateExperienceDto,
  ExperienceCommentDto,
  NewTouristDTO,
  TourCommentDto,
  UpdateTouristDTO,
} from './dtos';

import { TourStatus } from '@app/shared/models/enum';
import { SellerService } from '../seller/seller.service';
import { Cron } from '@nestjs/schedule';
import { RpcException } from '@nestjs/microservices';

@Injectable()
export class TourService {
  constructor(
    @Inject('UsersRepositoryInterface')
    private readonly usersRepository: UsersRepositoryInterface,
    @Inject('TourRepositoryInterface')
    private readonly tourRepository: TourRepositoryInterface,
    @Inject('CartRepositoryInterface')
    private readonly cartRepository: CartRepositoryInterface,
    @Inject('ShareExperienceRepositoryInterface')
    private readonly usedTourExperienceOfUserRepository: ShareExperienceRepositoryInterface,
    @Inject('UserRegisteredTourRepositoryInterface')
    private readonly userRegisteredTourRepository: UserRegisteredTourRepositoryInterface,
    @Inject('OrderDetailRepositoryInterface')
    private readonly orderDetailRepository: OrderDetailRepositoryInterface,
    @Inject('OrderRepositoryInterface')
    private readonly orderRepository: OrderRepositoryInterface,
    @Inject('CommentRepositoryInterface')
    private readonly commentRepository: CommentRepositoryInterface,
    @Inject('ScheduleRepositoryInterface')
    private readonly scheduleRepository: ScheduleRepositoryInterface,
    @Inject('PassengerRepositoryInterface')
    private readonly passengerRepository: PassengerRepositoryInterface,

    private readonly sellerService: SellerService,
    private readonly redisService: RedisCacheService,
  ) {}
  async tourHello(id: number) {
    return 'tourHello';
  }
  async getAllTours(): Promise<TourEntity[]> {
    // const currentDate = new Date();
    return await this.tourRepository.findAll({
      // where: { status: TourStatus.AVAILABLE },
      // skip ? skip : 1,
      order: { createdAt: 'DESC' },
      relations: { store: true, comments: { user: true } },
      take: 3,
    });
  }
  //   const kaka = await this.findOneByTourId('595dda98-c6fd-4687-9307-b88f7cc911fe')
  //   return (
  //     kaka.lastRegisterDate <= currentDate && currentDate <= kaka.startDate
  //   );
  // }
  async findTourOfUserRegistered(tourId: string) {
    return await this.userRegisteredTourRepository.findOneById(tourId);
  }
  async findOneByTourId(id: string): Promise<TourEntity> {
    return await this.tourRepository.findOneById(id);
  }
  async findTourDetail(id: string): Promise<TourEntity> {
    try {
      return await this.tourRepository.findByCondition({
        where: { id: id },
        relations: { schedules: true, store: true, comments: true },
      });
    } catch (err) {
      throw new BadRequestException(err);
    }
  }
  async getCommentOfTour(tourId: string): Promise<CommentEntity[]> {
    try {
      const findCommentsByTourId = await this.tourRepository.findByCondition({
        where: { id: tourId },
        relations: { comments: { user: true } },
      });
      if (!findCommentsByTourId) throw new BadRequestException('Can not found');
      return findCommentsByTourId.comments;
    } catch (e) {
      throw new BadRequestException(e);
    }
  }
  // Readonly<NewTouristDTO>
  async createTour(
    newTourDTO: Readonly<NewTouristDTO>,
    storeOfUserOwner,
  ): Promise<TourEntity> {
    try {
      if (
        newTourDTO.quantity * newTourDTO.price === 0 &&
        newTourDTO.startDate >= new Date(Date.now())
      ) {
        throw new BadRequestException('you can not create Tour');
      }
      const createTour = await this.tourRepository.create({
        ...newTourDTO,
        store: storeOfUserOwner,
      });
      const saveTour = await this.tourRepository.save({ ...createTour });
      const findNewTour = await this.findOneByTourId(saveTour.id);
      for (const scheduleDto of newTourDTO.schedules) {
        const schedule = new ScheduleEntity();
        schedule.day = scheduleDto.day;
        schedule.description = scheduleDto.description;
        schedule.imgUrl = scheduleDto.imgUrl;
        schedule.tourId = saveTour.id;
        await this.scheduleRepository.save({ ...schedule });
      }
      await this.userRegisteredTourRepository.save({
        tour: saveTour,
      });
      return saveTour;
    } catch (e) {
      throw new BadRequestException(e);
    }
  }

  async updateTour(
    tourId: string,
    userId: string,
    updateTouristDto: UpdateTouristDTO,
  ): Promise<TourEntity> {
    try {
      const findTourNeedUpdate = await this.findOneByTourId(tourId);
      if (!findTourNeedUpdate) {
        throw new BadRequestException('Tour Not Exists');
      }
      const checkTourOfStore = await this.sellerService.getTourEachStore(
        userId,
      );
      if (!checkTourOfStore.tours.includes(findTourNeedUpdate)) {
        throw new BadRequestException('You not A Store owner');
      }
      const updateTour = await this.tourRepository.save({
        ...findTourNeedUpdate,
        ...updateTouristDto,
      });
      return updateTour;
    } catch (e) {
      throw new BadRequestException(e);
    }
  }

  async createCart(
    cartDto: CartDto,
    user: Readonly<UserEntity>,
  ): Promise<CartEntity> {
    try {
      const tour = await this.findOneByTourId(cartDto.tourId);
      const cartFromDb = await this.cartRepository.findByCondition({
        relations: ['tour', 'user'],
        where: [{ tour: { id: cartDto?.tourId }, user: { id: user?.id } }],
      });
      if (!cartFromDb) {
        return await this.cartRepository.save({
          tour: tour,
          user: user,
        });
      } else {
        return await this.cartRepository.save({
          ...cartFromDb,
        });
      }
    } catch (e) {
      throw new BadRequestException(e);
    }
  }
  // async implementStrategyPattern(status: string) {
  //
  // }
  async bookingTour(
    tourId: string,
    userId: string,
    bookingTourDto: Readonly<BookingTourDto>,
  ) {
    try {
      const findTourById = await this.findOneByTourId(tourId);
      const price: number = findTourById.price;
      const findUserById = await this.usersRepository.findOneById(userId);

      const quantity =
        bookingTourDto.adultPassengers +
        bookingTourDto.infantPassengers +
        bookingTourDto.toddlerPassengers +
        bookingTourDto.childPassengers;
      if (+findTourById.quantity < quantity)
        throw new BadRequestException('not Enough slot');

      const totalPrice =
        bookingTourDto.adultPassengers * price +
        bookingTourDto.childPassengers * price +
        bookingTourDto.toddlerPassengers * 0.5 * price +
        bookingTourDto.infantPassengers * 0.15 * price;

      const createOrder = await this.orderRepository.create({
        firstName: bookingTourDto.firstName,
        fullName: bookingTourDto.fullName,
        email: bookingTourDto.email,
        address: bookingTourDto.address,
        phone: bookingTourDto.phone,
        totalPrice: totalPrice,
        participants: quantity,
        userId: userId,
      });
      if (!findTourById.status.includes(TourStatus.AVAILABLE))
        throw new RpcException('not Enough slot');
      const {
        firstName,
        fullName,
        email,
        address,
        passenger,
        phone,
        ...orderDetailFilter
      } = bookingTourDto;
      const createOrderDetail = await this.orderDetailRepository.create({
        ...orderDetailFilter,
        tourId: tourId,
      });
      const saveOder = await this.orderRepository.save({ ...createOrder });
      const saveOrderDetail = await this.orderDetailRepository.save({
        ...createOrderDetail,
        orderId: saveOder.id,
      });
      for (const data of bookingTourDto.passenger) {
        if (data.type === 'Adult') {
          await this.passengerRepository.save({
            name: data.name,
            type: 'Adult',
            sex: data.sex,
            orderDetail: saveOrderDetail,
            dayOfBirth: data.dayOfBirth ? data.dayOfBirth : '',
          });
        }
        if (data.type === 'Child') {
          await this.passengerRepository.save({
            name: data.name,
            type: 'Child',
            sex: data.sex,
            orderDetail: saveOrderDetail,
            dayOfBirth: data.dayOfBirth ? data.dayOfBirth : '',
          });
        }
        if (data.type === 'Toddler') {
          await this.passengerRepository.save({
            name: data.name,
            type: 'Toddler',
            sex: data.sex,
            orderDetail: saveOrderDetail,
            dayOfBirth: data.dayOfBirth,
          });
        }
        if (data.type === 'Infant') {
          await this.passengerRepository.save({
            name: data.name,
            type: 'Infant',
            sex: data.sex,
            orderDetail: saveOrderDetail,
            dayOfBirth: data.dayOfBirth,
          });
        }
      }
      const updateQuantity = await this.tourRepository.save({
        ...findTourById,
        quantity: +findTourById.quantity - Number(quantity),
      });
      if (updateQuantity.quantity < 1) {
        await this.tourRepository.save({
          ...updateQuantity,
          status: TourStatus.FULL,
        });
      }
      const findUserRegisteredTour =
        await this.userRegisteredTourRepository.findByCondition({
          where: { tourId },
          relations: { users: true },
        });
      if (!findUserRegisteredTour.users.includes(findUserById)) {
        await this.userRegisteredTourRepository.save({
          ...findUserRegisteredTour,
          users: [...findUserRegisteredTour.users, findUserById],
        });
      }
      const findTourInCart = await this.cartRepository.findByCondition({
        where: { tourId },
      });
      if (findTourInCart) {
        await this.cartRepository.remove({ ...findTourInCart });
      }
      return 'booking success';
    } catch (e) {
      throw new BadRequestException(e);
    }
  }
  async createContentExperienceOfUser(
    userId: string,
    createExperienceDto: CreateExperienceDto,
  ): Promise<ShareExperienceEntity> {
    try {
      return await this.usedTourExperienceOfUserRepository.save({
        ...createExperienceDto,
        anonymous: Boolean(createExperienceDto.anonymous),
        userId,
      });
    } catch (e) {
      throw new RpcException(e);
    }
  }
  async createCommentOfTour(
    userId: string,
    tourCommentDto: TourCommentDto,
  ): Promise<CommentEntity> {
    try {
      const comment = await this.commentRepository.save({
        ...tourCommentDto,
        userId,
      });
      return await this.commentRepository.findByCondition({
        where: { id: comment.id },
        relations: { user: true },
      });
    } catch (e) {
      throw new BadRequestException(e);
    }
  }
  async createCommentOfExperienceOfUser(
    userId: string,
    experienceCommentDto: ExperienceCommentDto,
  ): Promise<CommentEntity> {
    try {
      return await this.commentRepository.save({
        ...experienceCommentDto,
        userId,
      });
    } catch (e) {
      throw new BadRequestException(e);
    }
  }
  async getExperienceOfUser() {
    try {
      const findExperienceOfUser =
        await this.usedTourExperienceOfUserRepository.findAll({
          relations: { comments: { user: true }, user: true },
        });
      return findExperienceOfUser;
    } catch (e) {
      throw new BadRequestException(e);
    }
  }
  async upvoteOfTour(userId: string, tourId: string) {
    const findTourById = await this.findOneByTourId(tourId);
    if (findTourById.upVote.includes(userId)) {
      const updateUpVoteExistUserId = findTourById.upVote.filter(
        (item) => item !== userId,
      );
      const findTour = await this.tourRepository.save({
        ...findTourById,
        upVote: [...updateUpVoteExistUserId],
      });
      return { status: findTour.upVote, total: -1 };
    } else {
      const findTour = await this.tourRepository.save({
        ...findTourById,
        upVote: [...findTourById.upVote, userId],
      });
      return { status: findTour.upVote, total: 1 };
    }
  }
  async upvoteOfExperienceOfUser(userId: string, experienceId: string) {
    try {
      const findExperienceOfUserById =
        await this.usedTourExperienceOfUserRepository.findOneById(experienceId);
      if (findExperienceOfUserById.upVote.includes(userId)) {
        const updateUpVoteExistUserId = findExperienceOfUserById.upVote.filter(
          (item) => item !== userId,
        );
        const totalUpvote = await this.usedTourExperienceOfUserRepository.save({
          ...findExperienceOfUserById,
          upVote: [...updateUpVoteExistUserId],
        });
        return totalUpvote.upVote.length - 1;
      } else {
        const updateUpvote = await this.usedTourExperienceOfUserRepository.save(
          {
            ...findExperienceOfUserById,
            upVote: [...findExperienceOfUserById.upVote, userId],
          },
        );
        return updateUpvote.upVote.length - 1;
      }
    } catch (e) {
      throw new BadRequestException(e);
    }
  }
  // automatic update Status
  // @Cron('0 14 * * *')
  @Cron(' * 0 * * *')
  async updateStatusTourAutomatic() {
    const currentDate = new Date();
    // eslint-disable-next-line prefer-const
    let getAllTour;
    try {
      let tourCache = await this.redisService.get('tourView');
      if (tourCache) {
        tourCache = getAllTour;
      }
      getAllTour = await this.tourRepository.findAll({
        where: [
          { status: TourStatus.LAST },
          { status: TourStatus.TRAVELING },
          { status: TourStatus.FULL },
          { status: TourStatus.AVAILABLE },
        ],
      });

      for (const x of getAllTour) {
        // nằm trong khoảng thời gian từ cuối đăng kí đến khi bắt đầu
        if (x.lastRegisterDate <= currentDate && currentDate < x.startDate) {
          await this.tourRepository.save({ ...x, status: TourStatus.LAST });
        }
        //traveling
        if (x.startDate <= currentDate && currentDate <= x.endDate) {
          await this.tourRepository.save({
            ...x,
            status: TourStatus.TRAVELING,
          });
        }
        //Ending
        if (currentDate > x.endDate) {
          await this.tourRepository.save({ ...x, status: TourStatus.DONE });
        }
      }
    } catch (e) {
      throw new BadRequestException(e);
    }
  }
  // @Cron('0 14 * * *')
}
