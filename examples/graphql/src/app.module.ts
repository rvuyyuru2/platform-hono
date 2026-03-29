import type { ApolloDriverConfig } from '@nestjs/apollo';
import { Module } from '@nestjs/common';
import { GraphQLModule } from '@nestjs/graphql';

import { join } from 'node:path';

import { HonoGraphQLDriver } from '../../../src/drivers';
import { AuthorsModule } from './authors/authors.module';
import { RecipesModule } from './recipes/recipes.module';

@Module({
  imports: [
    GraphQLModule.forRoot<ApolloDriverConfig>({
      driver: HonoGraphQLDriver,
      sortSchema: true,
      autoSchemaFile: join(process.cwd(), 'schema.gql'),
      path: '/graphql',
      subscriptions: {
        'graphql-ws': true,
      },
      formatError: (err) => {
        return {
          message: err.message,
          locations: err.locations,
          path: err.path,
          extensions: err.extensions,
        };
      },
    }),
    AuthorsModule,
    RecipesModule,
  ],
})
export class AppModule {}
