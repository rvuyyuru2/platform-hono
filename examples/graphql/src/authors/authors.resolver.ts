import { Inject, NotFoundException } from '@nestjs/common';
import { Args, Int, Mutation, Query, Resolver, Subscription } from '@nestjs/graphql';
import { PubSub } from 'graphql-subscriptions';

import { GraphQLUpload } from '../../../../src/drivers';
import type { StreamUploadFile } from '../../../../src/drivers';
import { Author, CreateAuthorInput } from './author.model';
import { AuthorsService } from './authors.service';

@Resolver(() => Author)
export class AuthorsResolver {
  constructor(
    private readonly authorsService: AuthorsService,
    @Inject('PUB_SUB') private readonly pubSub: PubSub,
  ) {}

  // ── Queries ───────────────────────────────

  @Query(() => [Author], { name: 'authors' })
  findAll() {
    return this.authorsService.findAll();
  }

  @Query(() => Author, { name: 'author' })
  findOne(@Args('id', { type: () => Int }) id: number) {
    const author = this.authorsService.findOne(id);
    if (!author) {
      throw new NotFoundException(`Author #${id} not found`);
    }
    return author;
  }

  // ── Mutations ─────────────────────────────

  @Mutation(() => Author)
  createAuthor(@Args('input') input: CreateAuthorInput) {
    const author = this.authorsService.create(input);
    this.pubSub.publish('authorCreated', { authorCreated: author });
    return author;
  }

  @Mutation(() => Boolean)
  removeAuthor(@Args('id', { type: () => Int }) id: number) {
    return this.authorsService.remove(id);
  }

  // ── File upload via GraphQL ───────────────

  @Mutation(() => Boolean)
  async uploadAuthorPhoto(
    @Args('file', { type: () => GraphQLUpload }) file: Promise<StreamUploadFile>,
  ) {
    const { createReadStream, originalFilename, mimetype } = await file;
    const readStream = createReadStream();

    // Consume the stream (in production you'd write to disk/S3)
    const chunks: Uint8Array[] = [];
    for await (const chunk of readStream) {
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);

    console.log(`Received file: ${originalFilename} (${mimetype}, ${buffer.length} bytes)`);
    return true;
  }

  // ── Subscriptions ─────────────────────────

  @Subscription(() => Author, { nullable: true })
  authorCreated() {
    return this.pubSub.asyncIterableIterator('authorCreated');
  }
}
