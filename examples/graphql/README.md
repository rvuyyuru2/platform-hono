# GraphQL Example

Demonstrates platform-hono with Apollo Server v5 and NestJS GraphQL (code-first).

## Features

- Apollo Server v5 via `HonoGraphQLDriver`
- Code-first schema generation (`autoSchemaFile`)
- Two domain modules (Authors, Recipes)
- Queries, Mutations, Subscriptions
- GraphQL file upload via `GraphQLUpload` scalar
- Error formatting
- `graphql-ws` subscriptions

## Run

```bash
# From the repo root
bun run build
cd examples/graphql
bun run --bun src/main.ts
```

## Endpoints

| URL | Description |
|-----|-------------|
| `http://localhost:3000/graphql` | GraphQL endpoint (POST queries, GET playground) |

## Example Queries

### List all authors

```graphql
query {
  authors {
    id
    firstName
    lastName
    books
  }
}
```

### Get a single author

```graphql
query {
  author(id: 1) {
    id
    firstName
    lastName
    books
  }
}
```

### Create an author

```graphql
mutation {
  createAuthor(input: { firstName: "Terry", lastName: "Pratchett" }) {
    id
    firstName
    lastName
  }
}
```

### List all recipes

```graphql
query {
  recipes {
    id
    title
    description
    ingredients
    rating
    createdAt
  }
}
```

### Create a recipe

```graphql
mutation {
  createRecipe(input: {
    title: "Margherita Pizza"
    description: "Simple Italian pizza"
    ingredients: ["dough", "tomato sauce", "mozzarella", "basil"]
  }) {
    id
    title
    ingredients
  }
}
```

### Subscribe to new authors

```graphql
subscription {
  authorCreated {
    id
    firstName
    lastName
  }
}
```

### Upload a file

```graphql
mutation($file: Upload!) {
  uploadAuthorPhoto(file: $file)
}
```

Use a multipart form request or a GraphQL client that supports file uploads.
