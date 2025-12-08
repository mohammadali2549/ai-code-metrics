import { Component } from '@angular/core';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css'],
})
export class AppComponent {
  selectedItemId: number | null = null;
  showSubscriptionView = false;

  onItemSelected(itemId: number): void {
    this.selectedItemId = itemId;
  }

  openSubscriptionView(): void {
    this.showSubscriptionView = true;
  }

  closeSubscriptionView(): void {
    this.showSubscriptionView = false;
  }
}

