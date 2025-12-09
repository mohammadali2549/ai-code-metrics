import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { HttpClientModule } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { AppComponent } from './app.component';
import { CarouselComponent } from './carousel/carousel.component';
import { ItemDetailsComponent } from './item-details/item-details.component';
import { SubscriptionsComponent } from './subscriptions/subscriptions.component';

@NgModule({
  declarations: [
    AppComponent,
    CarouselComponent,
    ItemDetailsComponent,
    SubscriptionsComponent,
  ],
  imports: [BrowserModule, HttpClientModule, FormsModule],
  providers: [],
  bootstrap: [AppComponent],
})
export class AppModule {}

