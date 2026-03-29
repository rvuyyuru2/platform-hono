import { Injectable } from '@nestjs/common';

import { Author, CreateAuthorInput } from './author.model';

@Injectable()
export class AuthorsService {
  private authors: Author[] = [
    { id: 1, firstName: 'J.K.', lastName: 'Rowling', books: ['Harry Potter'] },
    { id: 2, firstName: 'George', lastName: 'Orwell', books: ['1984', 'Animal Farm'] },
    { id: 3, firstName: 'Isaac', lastName: 'Asimov', books: ['Foundation', 'I, Robot'] },
  ];
  private nextId = 4;

  findAll(): Author[] {
    return this.authors;
  }

  findOne(id: number): Author | undefined {
    return this.authors.find((a) => a.id === id);
  }

  create(input: CreateAuthorInput): Author {
    const author: Author = {
      id: this.nextId++,
      ...input,
      books: [],
    };
    this.authors.push(author);
    return author;
  }

  remove(id: number): boolean {
    const idx = this.authors.findIndex((a) => a.id === id);
    if (idx === -1) return false;
    this.authors.splice(idx, 1);
    return true;
  }
}
