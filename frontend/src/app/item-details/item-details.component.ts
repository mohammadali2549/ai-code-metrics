import {
  Component,
  Input,
  OnInit,
  OnChanges,
  SimpleChanges,
} from '@angular/core';
import { Item } from '../models/item.model';
import { ItemService } from '../services/item.service';

@Component({
  selector: 'app-item-details',
  templateUrl: './item-details.component.html',
  styleUrls: ['./item-details.component.css'],
})
export class ItemDetailsComponent implements OnInit, OnChanges {
  @Input() itemId: number | null = null;
  item: Item | null = null;
  loading = false;
  error: string | null = null;

  constructor(private itemService: ItemService) {}

  ngOnInit(): void {
    if (this.itemId) {
      this.loadItem(this.itemId);
    }
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['itemId'] && this.itemId) {
      this.loadItem(this.itemId);
    } else if (!this.itemId) {
      this.item = null;
      this.error = null;
    }
  }

  loadItem(id: number): void {
    this.loading = true;
    this.error = null;
    this.item = null;

    this.itemService.getItemById(id).subscribe({
      next: (item) => {
        this.item = item;
        this.loading = false;
      },
      error: (error) => {
        this.error = 'Failed to load item details. Please try again.';
        this.loading = false;
        console.error('Error loading item:', error);
      },
    });
  }

  buyNow(): void {
    if (this.item) {
      alert(`Thank you for your interest in ${this.item.name}!\nPrice: $${this.item.price.toFixed(2)}\n\nThis is a demo application.`);
    }
  }
}

