import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { ItemDetailsComponent } from './item-details.component';
import { ItemService } from '../services/item.service';
import { of, throwError } from 'rxjs';
import { Item } from '../models/item.model';

describe('ItemDetailsComponent', () => {
  let component: ItemDetailsComponent;
  let fixture: ComponentFixture<ItemDetailsComponent>;
  let itemService: ItemService;

  const mockItem: Item = {
    id: 1,
    name: 'Test Item',
    description: 'Test Description',
    price: 99.99,
    imageUrl: 'test.jpg',
    category: 'Test',
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [ItemDetailsComponent],
      imports: [HttpClientTestingModule],
      providers: [ItemService],
    }).compileComponents();

    fixture = TestBed.createComponent(ItemDetailsComponent);
    component = fixture.componentInstance;
    itemService = TestBed.inject(ItemService);
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should load item on init if itemId is set', () => {
    component.itemId = 1;
    spyOn(itemService, 'getItemById').and.returnValue(of(mockItem));

    fixture.detectChanges();

    expect(component.item).toEqual(mockItem);
    expect(component.loading).toBe(false);
  });

  it('should load item when itemId changes', () => {
    spyOn(itemService, 'getItemById').and.returnValue(of(mockItem));

    component.itemId = 1;
    component.ngOnChanges({ itemId: { currentValue: 1, previousValue: null, firstChange: false, isFirstChange: () => false } });

    expect(component.item).toEqual(mockItem);
    expect(itemService.getItemById).toHaveBeenCalledWith(1);
  });

  it('should handle error when loading item', () => {
    component.itemId = 1;
    spyOn(itemService, 'getItemById').and.returnValue(
      throwError(() => new Error('Error'))
    );
    spyOn(console, 'error');

    fixture.detectChanges();

    expect(component.error).toBeTruthy();
    expect(component.loading).toBe(false);
    expect(console.error).toHaveBeenCalled();
  });

  it('should clear item when itemId is null', () => {
    component.item = mockItem;
    component.itemId = null;

    component.ngOnChanges({ itemId: { currentValue: null, previousValue: 1, firstChange: false, isFirstChange: () => false } });

    expect(component.item).toBeNull();
    expect(component.error).toBeNull();
  });

  it('should call buyNow and show alert', () => {
    component.item = mockItem;
    spyOn(window, 'alert');

    component.buyNow();

    expect(window.alert).toHaveBeenCalled();
  });
});

