import { ArgumentsHost, Catch, HttpException } from '@nestjs/common';
import { BaseExceptionFilter, HttpAdapterHost } from '@nestjs/core';
import type { Request } from 'express';
import { SESSION_ERRORS, SessionError } from './session.error';
import type { SessionErrorCode } from './session.error';

@Catch()
export class SessionExceptionFilter extends BaseExceptionFilter {
  constructor(private readonly adapterHost: HttpAdapterHost) {
    super(adapterHost.httpAdapter);
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    if (!/^\/sessions(?:\/|$)/i.test(request.path)) {
      super.catch(exception, host);
      return;
    }
    let code: SessionErrorCode = 'INTERNAL_ERROR';
    if (exception instanceof SessionError) code = exception.code;
    else if (exception instanceof HttpException) {
      if (exception.getStatus() === 401) code = 'UNAUTHORIZED';
      if (exception.getStatus() === 400) code = 'VALIDATION_ERROR';
      if (exception.getStatus() === 404) code = 'SESSION_NOT_FOUND';
    }
    const { statusCode, message } = SESSION_ERRORS[code];
    this.adapterHost.httpAdapter.reply(
      http.getResponse(),
      { statusCode, code, message },
      statusCode,
    );
  }
}
