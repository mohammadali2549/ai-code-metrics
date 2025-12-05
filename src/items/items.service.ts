import { Injectable, NotFoundException } from '@nestjs/common';
import { ItemDto } from './dto/item.dto';

@Injectable()
export class ItemsService {
  private readonly items: ItemDto[] = [
    {
      id: 1,
      name: 'Laptop Pro',
      description: 'High-performance laptop with latest processor and stunning display.',
      price: 1299.99,
      imageUrl: 'https://images.unsplash.com/photo-1496181133206-80ce9b88a853?w=800',
      category: 'Electronics',
    },
    {
      id: 2,
      name: 'Wireless Headphones',
      description: 'Premium noise-cancelling headphones with exceptional sound quality.',
      price: 299.99,
      imageUrl: 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=800',
      category: 'Audio',
    },
    {
      id: 3,
      name: 'Smart Watch',
      description: 'Feature-rich smartwatch with health tracking and notifications.',
      price: 399.99,
      imageUrl: 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=800',
      category: 'Wearables',
    },
    {
      id: 4,
      name: 'Camera DSLR',
      description: 'Professional DSLR camera for stunning photography.',
      price: 899.99,
      imageUrl: 'https://images.unsplash.com/photo-1516035069371-29a1b244b32a?w=800',
      category: 'Photography',
    },
    {
      id: 5,
      name: 'Gaming Console',
      description: 'Next-generation gaming console with immersive gaming experience.',
      price: 499.99,
      imageUrl: 'https://images.unsplash.com/photo-1606144042614-b2417e99c4e3?w=800',
      category: 'Gaming',
    },
    {
      id: 6,
      name: 'Tablet',
      description: 'Sleek and powerful tablet for work and entertainment.',
      price: 599.99,
      imageUrl: 'https://images.unsplash.com/photo-1544244015-0df4b3ffc6b0?w=800',
      category: 'Electronics',
    },
  ];

  findAll(): ItemDto[] {
    return this.items;
  }

  findOne(id: number): ItemDto {
    const item = this.items.find((item) => item.id === id);
    if (!item) {
      throw new NotFoundException(`Item with ID ${id} not found`);
    }
    return item;
  }
}

