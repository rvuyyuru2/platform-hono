import {
  InternalServerErrorException,
  VERSION_NEUTRAL,
  VersioningOptions,
  VersioningType,
} from '@nestjs/common';
import { VersionValue } from '@nestjs/common/interfaces';
import { isString, isUndefined } from '@nestjs/common/utils/shared.utils';

type VersionedRoute = <
  TRequest extends Record<string, any> = any,
  TResponse = any,
>(
  req: TRequest,
  res: TResponse,
  next: () => void,
) => any;

/**
 * Implements NestJS API versioning (URI, Header, Media Type, Custom).
 *
 * This mirrors the logic from `platform-express` and `platform-fastify`
 * so all four versioning strategies work identically.
 */
export function applyVersionFilter(
  handler: Function,
  version: VersionValue,
  versioningOptions: VersioningOptions,
): VersionedRoute {
  const callNext: VersionedRoute = (_req, _res, next) => {
    if (!next) {
      throw new InternalServerErrorException(
        'HTTP adapter does not support filtering on version',
      );
    }
    return next();
  };

  // URI versioning is path-based — handler always matches
  if (
    version === VERSION_NEUTRAL ||
    versioningOptions.type === VersioningType.URI
  ) {
    return (req, res, next) => handler(req, res, next);
  }

  // Custom extractor
  if (versioningOptions.type === VersioningType.CUSTOM) {
    return (req, res, next) => {
      const extracted = (versioningOptions as any).extractor(req);

      if (Array.isArray(version)) {
        if (
          Array.isArray(extracted) &&
          version.some((v) => (extracted as string[]).includes(v as string))
        ) {
          return handler(req, res, next);
        }
        if (isString(extracted) && version.includes(extracted)) {
          return handler(req, res, next);
        }
      } else if (isString(version)) {
        if (Array.isArray(extracted) && extracted.includes(version)) {
          return handler(req, res, next);
        }
        if (isString(extracted) && version === extracted) {
          return handler(req, res, next);
        }
      }

      return callNext(req, res, next);
    };
  }

  // Media Type (Accept header)
  if (versioningOptions.type === VersioningType.MEDIA_TYPE) {
    return (req, res, next) => {
      const acceptHeader: string | undefined =
        req.headers?.['accept'] ?? req.header?.('accept');
      const versionParam = acceptHeader
        ? acceptHeader.split(';')[1]
        : undefined;

      if (isUndefined(versionParam)) {
        if (Array.isArray(version) && version.includes(VERSION_NEUTRAL)) {
          return handler(req, res, next);
        }
      } else {
        const headerVersion = versionParam.split(
          (versioningOptions as any).key,
        )[1];
        if (Array.isArray(version)) {
          if (version.includes(headerVersion)) {
            return handler(req, res, next);
          }
        } else if (isString(version) && version === headerVersion) {
          return handler(req, res, next);
        }
      }

      return callNext(req, res, next);
    };
  }

  // Header versioning
  if (versioningOptions.type === VersioningType.HEADER) {
    return (req, res, next) => {
      const headerName = (versioningOptions as any).header.toLowerCase();
      const headerValue: string | undefined =
        req.headers?.[headerName] ?? req.header?.(headerName);

      if (isUndefined(headerValue)) {
        if (Array.isArray(version) && version.includes(VERSION_NEUTRAL)) {
          return handler(req, res, next);
        }
      } else {
        if (Array.isArray(version)) {
          if (version.includes(headerValue)) {
            return handler(req, res, next);
          }
        } else if (isString(version) && version === headerValue) {
          return handler(req, res, next);
        }
      }

      return callNext(req, res, next);
    };
  }

  throw new Error('Unsupported versioning type');
}
