import { TestBed } from '@angular/core/testing';
import {
  HttpClientTestingModule,
  HttpTestingController,
} from '@angular/common/http/testing';
import { ItemService } from './item.service';
import { Item } from '../models/item.model';

describe('ItemService', () => {
  let service: ItemService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [ItemService],
    });
    service = TestBed.inject(ItemService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('getItems', () => {
    it('should return an array of items', () => {
      const mockItems: Item[] = [
        {
          id: 1,
          name: 'Test Item',
          description: 'Test Description',
          price: 99.99,
          imageUrl: 'test.jpg',
          category: 'Test',
        },
      ];

      service.getItems().subscribe((items) => {
        expect(items.length).toBe(1);
        expect(items).toEqual(mockItems);
      });

      const req = httpMock.expectOne('http://localhost:3000/items');
      expect(req.request.method).toBe('GET');
      req.flush(mockItems);
    });
  });

  describe('getItemById', () => {
    it('should return a single item by id', () => {
      const mockItem: Item = {
        id: 1,
        name: 'Test Item',
        description: 'Test Description',
        price: 99.99,
        imageUrl: 'test.jpg',
        category: 'Test',
      };

      service.getItemById(1).subscribe((item) => {
        expect(item).toEqual(mockItem);
      });

      const req = httpMock.expectOne('http://localhost:3000/items/1');
      expect(req.request.method).toBe('GET');
      req.flush(mockItem);
    });
  });
});

