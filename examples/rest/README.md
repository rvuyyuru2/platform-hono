# REST Example

Demonstrates platform-hono with a standard NestJS REST application.

## Features

- CRUD operations (`/cats`)
- File upload (single & multiple)
- SSE (Server-Sent Events)
- Request decorators (`@Param`, `@Query`, `@Body`, `@Ip`, `@Headers`)
- Raw body access
- Redirects
- Custom Hono response
- Exception filters (global catch-all + 404)
- CORS
- Static assets
- Body size limits

## Run

```bash
# From the repo root
bun run build
cd examples/rest
bun run ../../node_modules/.bin/nest start --entryFile main
```

Or directly:

```bash
bun run --bun examples/rest/src/main.ts
```

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | Hello world |
| GET | `/json` | JSON response |
| GET | `/user/:userId` | Path params |
| GET | `/search?q=foo` | Query params |
| GET | `/ip` | Client IP |
| GET | `/headers` | Read User-Agent |
| POST | `/echo` | JSON echo |
| POST | `/raw` | Raw body info |
| POST | `/no-content` | 204 response |
| GET | `/redirect` | Redirect to `/` |
| GET | `/custom-response` | Custom Hono response |
| GET | `/error` | Triggers exception filter |
| POST | `/upload` | Single file upload |
| POST | `/uploads` | Multiple file upload |
| GET | `/events` | SSE stream |
| GET | `/cats` | List all cats |
| GET | `/cats/:id` | Get cat by ID |
| POST | `/cats` | Create cat |
| PUT | `/cats/:id` | Update cat |
| DELETE | `/cats/:id` | Delete cat |
