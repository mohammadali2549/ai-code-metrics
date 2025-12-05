import { Test, TestingModule } from '@nestjs/testing';
import { ItemsService } from './items.service';
import { NotFoundException } from '@nestjs/common';

describe('ItemsService', () => {
  let service: ItemsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ItemsService],
    }).compile();

    service = module.get<ItemsService>(ItemsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findAll', () => {
    it('should return an array of items', () => {
      const items = service.findAll();
      expect(Array.isArray(items)).toBe(true);
      expect(items.length).toBeGreaterThan(0);
    });

    it('should return items with required properties', () => {
      const items = service.findAll();
      items.forEach((item) => {
        expect(item).toHaveProperty('id');
        expect(item).toHaveProperty('name');
        expect(item).toHaveProperty('description');
        expect(item).toHaveProperty('price');
        expect(item).toHaveProperty('imageUrl');
        expect(item).toHaveProperty('category');
      });
    });
  });

  describe('findOne', () => {
    it('should return a single item by id', () => {
      const item = service.findOne(1);
      expect(item).toBeDefined();
      expect(item.id).toBe(1);
    });

    it('should throw NotFoundException for non-existent id', () => {
      expect(() => service.findOne(999)).toThrow(NotFoundException);
    });
  });
});

