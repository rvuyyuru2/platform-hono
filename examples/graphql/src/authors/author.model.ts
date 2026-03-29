import { Field, InputType, Int, ObjectType } from '@nestjs/graphql';

@ObjectType()
export class Author {
  @Field(() => Int)
  id: number;

  @Field()
  firstName: string;

  @Field()
  lastName: string;

  @Field(() => [String], { nullable: true })
  books?: string[];
}

@InputType()
export class CreateAuthorInput {
  @Field()
  firstName: string;

  @Field()
  lastName: string;
}
