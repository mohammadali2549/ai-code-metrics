import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { HttpClientModule } from '@angular/common/http';
import { AppComponent } from './app.component';
import { CarouselComponent } from './carousel/carousel.component';
import { ItemDetailsComponent } from './item-details/item-details.component';

@NgModule({
  declarations: [AppComponent, CarouselComponent, ItemDetailsComponent],
  imports: [BrowserModule, HttpClientModule],
  providers: [],
  bootstrap: [AppComponent],
})
export class AppModule {}

