import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { CarouselComponent } from './carousel.component';
import { ItemService } from '../services/item.service';
import { of, throwError } from 'rxjs';
import { Item } from '../models/item.model';

describe('CarouselComponent', () => {
  let component: CarouselComponent;
  let fixture: ComponentFixture<CarouselComponent>;
  let itemService: ItemService;

  const mockItems: Item[] = [
    {
      id: 1,
      name: 'Item 1',
      description: 'Description 1',
      price: 99.99,
      imageUrl: 'image1.jpg',
      category: 'Category 1',
    },
    {
      id: 2,
      name: 'Item 2',
      description: 'Description 2',
      price: 199.99,
      imageUrl: 'image2.jpg',
      category: 'Category 2',
    },
  ];

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [CarouselComponent],
      imports: [HttpClientTestingModule],
      providers: [ItemService],
    }).compileComponents();

    fixture = TestBed.createComponent(CarouselComponent);
    component = fixture.componentInstance;
    itemService = TestBed.inject(ItemService);
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should load items on init', () => {
    spyOn(itemService, 'getItems').and.returnValue(of(mockItems));

    fixture.detectChanges();

    expect(component.items).toEqual(mockItems);
    expect(itemService.getItems).toHaveBeenCalled();
  });

  it('should handle error when loading items', () => {
    spyOn(itemService, 'getItems').and.returnValue(
      throwError(() => new Error('Error'))
    );
    spyOn(console, 'error');

    fixture.detectChanges();

    expect(component.items).toEqual([]);
    expect(console.error).toHaveBeenCalled();
  });

  it('should emit itemSelected when selectItem is called', () => {
    spyOn(component.itemSelected, 'emit');

    component.selectItem(1);

    expect(component.itemSelected.emit).toHaveBeenCalledWith(1);
  });

  it('should move to next item', () => {
    component.items = mockItems;
    component.currentIndex = 0;

    component.next();

    expect(component.currentIndex).toBe(1);
  });

  it('should wrap to first item when at end', () => {
    component.items = mockItems;
    component.currentIndex = 1;

    component.next();

    expect(component.currentIndex).toBe(0);
  });

  it('should move to previous item', () => {
    component.items = mockItems;
    component.currentIndex = 1;

    component.previous();

    expect(component.currentIndex).toBe(0);
  });

  it('should wrap to last item when at beginning', () => {
    component.items = mockItems;
    component.currentIndex = 0;

    component.previous();

    expect(component.currentIndex).toBe(1);
  });

  it('should go to specific slide', () => {
    component.items = mockItems;

    component.goToSlide(1);

    expect(component.currentIndex).toBe(1);
  });
});

