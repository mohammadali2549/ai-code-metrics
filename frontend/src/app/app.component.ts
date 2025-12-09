import { Component } from '@angular/core';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css'],
})
export class AppComponent {
  selectedItemId: number | null = null;
  showSubscriptions = false;

  onItemSelected(itemId: number): void {
    this.selectedItemId = itemId;
  }

  openSubscriptions(): void {
    this.showSubscriptions = true;
  }

  closeSubscriptions(): void {
    this.showSubscriptions = false;
  }
}

