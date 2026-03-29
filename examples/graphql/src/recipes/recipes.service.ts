import { Injectable } from '@nestjs/common';

import { CreateRecipeInput, Recipe } from './recipe.model';

@Injectable()
export class RecipesService {
  private recipes: Recipe[] = [
    {
      id: 1,
      title: 'Spaghetti Carbonara',
      description: 'Classic Italian pasta dish',
      ingredients: ['spaghetti', 'eggs', 'pancetta', 'parmesan', 'black pepper'],
      rating: 4.5,
      createdAt: new Date('2024-01-15'),
    },
    {
      id: 2,
      title: 'Caesar Salad',
      description: 'Fresh romaine with creamy dressing',
      ingredients: ['romaine lettuce', 'croutons', 'parmesan', 'caesar dressing'],
      rating: 4.2,
      createdAt: new Date('2024-02-20'),
    },
  ];
  private nextId = 3;

  findAll(): Recipe[] {
    return this.recipes;
  }

  findOne(id: number): Recipe | undefined {
    return this.recipes.find((r) => r.id === id);
  }

  create(input: CreateRecipeInput): Recipe {
    const recipe: Recipe = {
      id: this.nextId++,
      ...input,
      rating: 0,
      createdAt: new Date(),
    };
    this.recipes.push(recipe);
    return recipe;
  }

  remove(id: number): boolean {
    const idx = this.recipes.findIndex((r) => r.id === id);
    if (idx === -1) return false;
    this.recipes.splice(idx, 1);
    return true;
  }
}
