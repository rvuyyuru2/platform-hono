import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Ip,
  Logger,
  Post,
  Query,
  Param,
  Redirect,
  Req,
  Res,
  Sse,
  UseInterceptors,
  Headers,
} from '@nestjs/common';
import type { MessageEvent, RawBodyRequest } from '@nestjs/common';
import type { Context } from 'hono';
import { Observable, interval, map } from 'rxjs';

import type { HonoRequest } from '../../../src/interfaces';
import {
  FileInterceptor,
  FilesInterceptor,
  UploadedFile,
  UploadedFiles,
} from '../../../src/multer';
import type { MemoryStorageFile } from '../../../src/multer';
import { AppService } from './app.service';

@Controller()
export class AppController {
  private readonly logger = new Logger(AppController.name);

  constructor(private readonly appService: AppService) {}

  // ── Basic GET ─────────────────────────────

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('/json')
  getJson() {
    return { message: 'Hello World', timestamp: Date.now() };
  }

  // ── Request decorators ────────────────────

  @Get('/user/:userId')
  getUser(@Param('userId') userId: string) {
    return { userId };
  }

  @Get('/search')
  search(@Query() query: Record<string, unknown>) {
    return { query };
  }

  @Get('/ip')
  getIp(@Ip() ip: string) {
    return { ip };
  }

  @Get('/headers')
  getHeaders(@Headers('user-agent') ua: string) {
    return { userAgent: ua };
  }

  // ── POST with body & rawBody ──────────────

  @Post('/echo')
  echo(@Body() body: Record<string, unknown>) {
    return body;
  }

  @Post('/raw')
  raw(@Req() req: RawBodyRequest<HonoRequest>) {
    const rawBody = (req as any).rawBody;
    return {
      hasRawBody: !!rawBody,
      bodyLength: rawBody?.length,
    };
  }

  // ── Status codes & redirects ──────────────

  @HttpCode(HttpStatus.NO_CONTENT)
  @Post('/no-content')
  noContent() {
    return;
  }

  @Get('/redirect')
  @Redirect('/')
  redirect() {
    return { url: '/' };
  }

  @Get('/redirect-ctx')
  redirectCtx(@Res() ctx: Context) {
    ctx.res = ctx.redirect('/', 302);
  }

  // ── Custom Hono response ──────────────────

  @Get('/custom-response')
  customResponse(@Res() ctx: Context) {
    ctx.res.headers.set('X-Custom-Header', 'CustomValue');
    ctx.res = new Response('Custom Response Body', {
      status: 202,
      headers: ctx.res.headers,
    });
  }

  // ── Error handling ────────────────────────

  @Get('/error')
  throwError() {
    throw new Error('Intentional error for testing');
  }

  // ── File upload (single) ──────────────────

  @Post('/upload')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 5 * 1024 * 1024 },
    }),
  )
  uploadFile(
    @Body() body: Record<string, unknown>,
    @UploadedFile() file: MemoryStorageFile,
  ) {
    return {
      fieldName: file?.fieldName,
      originalFilename: file?.originalFilename,
      size: file?.size,
      mimetype: file?.mimetype,
      bodyKeys: Object.keys(body),
    };
  }

  // ── File upload (multiple) ────────────────

  @Post('/uploads')
  @UseInterceptors(FilesInterceptor('files', 10))
  uploadFiles(@UploadedFiles() files: MemoryStorageFile[]) {
    return files.map((f) => ({
      originalFilename: f.originalFilename,
      size: f.size,
      mimetype: f.mimetype,
    }));
  }

  // ── SSE (Server-Sent Events) ──────────────

  @Sse('/events')
  events(): Observable<MessageEvent> {
    return interval(1000).pipe(
      map((i) => ({ data: { count: i, ts: Date.now() } })),
    );
  }
}
