import { HonoRequest as BaseHonoRequest } from 'hono';

/**
 * Extended Hono request. Using declaration merging approach
 * so the base HonoRequest methods remain intact.
 */
export type HonoRequest = BaseHonoRequest & {
  [key: string]: any;
};

/**
 * Body-parser content type accepted by `useBodyParser()`.
 */
export type TypeBodyParser =
  | 'application/json'
  | 'text/plain'
  | 'application/x-www-form-urlencoded';

/**
 * Lifecycle hook types exposed by the adapter.
 */
export type OnRequestHook = (
  request: HonoRequest,
  response: any,
  done: () => void,
) => void | Promise<void>;

export type OnResponseHook = (
  request: HonoRequest,
  response: any,
) => void | Promise<void>;

export type OnErrorHook = (
  error: Error,
  request: HonoRequest,
  response: any,
) => void | Promise<void>;
