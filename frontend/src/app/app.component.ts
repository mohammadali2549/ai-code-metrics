import { Component } from '@angular/core';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css'],
})
export class AppComponent {
  showSubscriptions = false;
  selectedItemId: number | null = null;

  onItemSelected(itemId: number): void {
    this.selectedItemId = itemId;
  }

  openSubscriptions(): void {
    this.showSubscriptions = true;
  }

  openLanding(): void {
    this.showSubscriptions = false;
  }
}

