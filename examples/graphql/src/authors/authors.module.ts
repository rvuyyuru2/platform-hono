import { Module } from '@nestjs/common';
import { PubSub } from 'graphql-subscriptions';

import { AuthorsResolver } from './authors.resolver';
import { AuthorsService } from './authors.service';

@Module({
  providers: [
    AuthorsResolver,
    AuthorsService,
    {
      provide: 'PUB_SUB',
      useValue: new PubSub(),
    },
  ],
})
export class AuthorsModule {}
