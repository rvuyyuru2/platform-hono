import { INestApplicationContext } from '@nestjs/common';
import { AbstractWsAdapter } from '@nestjs/websockets';
import { MessageMappingProperties } from '@nestjs/websockets';
import { EMPTY, Observable, fromEvent, mergeMap, filter, takeUntil } from 'rxjs';

/**
 * WebSocket adapter for use with the Hono platform.
 *
 * Uses the native `ws` package (peer dependency) and works with
 * NestJS @WebSocketGateway decorators out of the box.
 *
 * Usage:
 *   app.useWebSocketAdapter(new HonoWsAdapter(app));
 */
export class HonoWsAdapter extends AbstractWsAdapter {
  constructor(appOrHttpServer?: INestApplicationContext) {
    super(appOrHttpServer);
  }

  public create(
    port: number,
    options?: Record<string, any> & { namespace?: string; server?: any },
  ): any {
    // Lazy-load ws to keep it optional
    const { WebSocketServer } = require('ws');

    // If an HTTP server is already bound (normal NestJS bootstrap),
    // attach to it instead of opening a new port.
    const httpServer = (this as any).httpServer;
    if (port === 0 && httpServer) {
      return new WebSocketServer({
        server: httpServer,
        ...options,
      });
    }

    return new WebSocketServer({
      port,
      ...options,
    });
  }

  public bindMessageHandlers(
    client: any,
    handlers: MessageMappingProperties[],
    transform: (data: any) => Observable<any>,
  ) {
    const close$ = fromEvent(client, 'close');
    const source$ = fromEvent(client, 'message');

    const handleMessage = mergeMap((buffer: any) => {
      const data = this.parseMessage(buffer);
      const messageHandler = handlers.find(
        (h) => h.message === (data as any)?.event,
      );
      if (!messageHandler) {
        return EMPTY;
      }
      return transform(messageHandler.callback(data));
    });

    source$
      .pipe(handleMessage, filter((result) => result !== undefined), takeUntil(close$))
      .subscribe((response) => {
        if (client.readyState === 1 /* WebSocket.OPEN */) {
          client.send(JSON.stringify(response));
        }
      });
  }

  public close(server: any) {
    return new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  }

  private parseMessage(buffer: any): unknown {
    try {
      const data =
        typeof buffer.data === 'string'
          ? buffer.data
          : buffer.data?.toString?.('utf8') ?? buffer.toString('utf8');
      return JSON.parse(data);
    } catch {
      return buffer;
    }
  }
}
