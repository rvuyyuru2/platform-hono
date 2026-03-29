import { Args, Int, Mutation, Query, Resolver } from '@nestjs/graphql';
import { NotFoundException } from '@nestjs/common';

import { CreateRecipeInput, Recipe } from './recipe.model';
import { RecipesService } from './recipes.service';

@Resolver(() => Recipe)
export class RecipesResolver {
  constructor(private readonly recipesService: RecipesService) {}

  @Query(() => [Recipe], { name: 'recipes' })
  findAll() {
    return this.recipesService.findAll();
  }

  @Query(() => Recipe, { name: 'recipe' })
  findOne(@Args('id', { type: () => Int }) id: number) {
    const recipe = this.recipesService.findOne(id);
    if (!recipe) {
      throw new NotFoundException(`Recipe #${id} not found`);
    }
    return recipe;
  }

  @Mutation(() => Recipe)
  createRecipe(@Args('input') input: CreateRecipeInput) {
    return this.recipesService.create(input);
  }

  @Mutation(() => Boolean)
  removeRecipe(@Args('id', { type: () => Int }) id: number) {
    return this.recipesService.remove(id);
  }
}
