import { Component, OnInit, Output, EventEmitter } from '@angular/core';
import { Item } from '../models/item.model';
import { ItemService } from '../services/item.service';

@Component({
  selector: 'app-carousel',
  templateUrl: './carousel.component.html',
  styleUrls: ['./carousel.component.css'],
})
export class CarouselComponent implements OnInit {
  items: Item[] = [];
  currentIndex = 0;
  @Output() itemSelected = new EventEmitter<number>();

  constructor(private itemService: ItemService) {}

  ngOnInit(): void {
    this.loadItems();
  }

  loadItems(): void {
    this.itemService.getItems().subscribe({
      next: (items) => {
        this.items = items;
      },
      error: (error) => {
        console.error('Error loading items:', error);
      },
    });
  }

  selectItem(itemId: number): void {
    this.itemSelected.emit(itemId);
  }

  next(): void {
    if (this.items.length > 0) {
      this.currentIndex = (this.currentIndex + 1) % this.items.length;
    }
  }

  previous(): void {
    if (this.items.length > 0) {
      this.currentIndex =
        this.currentIndex === 0
          ? this.items.length - 1
          : this.currentIndex - 1;
    }
  }

  goToSlide(index: number): void {
    this.currentIndex = index;
  }
}

