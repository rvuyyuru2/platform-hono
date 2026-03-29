import { Field, Float, InputType, Int, ObjectType } from '@nestjs/graphql';

@ObjectType()
export class Recipe {
  @Field(() => Int)
  id: number;

  @Field()
  title: string;

  @Field({ nullable: true })
  description?: string;

  @Field(() => [String])
  ingredients: string[];

  @Field(() => Float)
  rating: number;

  @Field()
  createdAt: Date;
}

@InputType()
export class CreateRecipeInput {
  @Field()
  title: string;

  @Field({ nullable: true })
  description?: string;

  @Field(() => [String])
  ingredients: string[];
}
