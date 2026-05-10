import { Test, TestingModule } from '@nestjs/testing';
import { PriceListsService } from './price-lists.service';
import { PriceListsController } from './price-lists.controller';

describe('PriceListsController', () => {
  let controller: PriceListsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PriceListsController],
      providers: [
        {
          provide: PriceListsService,
          useValue: {},
        },
      ],
    }).compile();

    controller = module.get<PriceListsController>(PriceListsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
