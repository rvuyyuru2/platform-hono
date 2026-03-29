import { Injectable } from '@nestjs/common';

import { CreateCatDto } from './dto/create-cat.dto';

export interface Cat {
  id: number;
  name: string;
  age: number;
  breed: string;
}

@Injectable()
export class CatsService {
  private cats: Cat[] = [
    { id: 1, name: 'Tom', age: 3, breed: 'Persian' },
    { id: 2, name: 'Garfield', age: 5, breed: 'Tabby' },
  ];
  private nextId = 3;

  findAll(): Cat[] {
    return this.cats;
  }

  findOne(id: number): Cat | undefined {
    return this.cats.find((c) => c.id === id);
  }

  create(dto: CreateCatDto): Cat {
    const cat: Cat = { id: this.nextId++, ...dto };
    this.cats.push(cat);
    return cat;
  }

  update(id: number, dto: CreateCatDto): Cat | undefined {
    const idx = this.cats.findIndex((c) => c.id === id);
    if (idx === -1) return undefined;
    this.cats[idx] = { ...this.cats[idx], ...dto };
    return this.cats[idx];
  }

  remove(id: number): boolean {
    const idx = this.cats.findIndex((c) => c.id === id);
    if (idx === -1) return false;
    this.cats.splice(idx, 1);
    return true;
  }
}
