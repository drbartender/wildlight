export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(message: string, status = 500, code = 'APP_ERROR') {
    super(message);
    this.name = this.constructor.name;
    this.status = status;
    this.code = code;
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super(message, 400, 'VALIDATION');
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Not found') {
    super(message, 404, 'NOT_FOUND');
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(message, 409, 'CONFLICT');
  }
}

export class PermissionError extends AppError {
  constructor(message = 'Forbidden') {
    super(message, 403, 'FORBIDDEN');
  }
}

export class ExternalServiceError extends AppError {
  readonly service: string;
  readonly upstreamCode?: string;
  constructor(service: string, upstreamCode?: string, message?: string) {
    super(message || `External service failure: ${service}`, 502, 'EXTERNAL_SERVICE');
    this.service = service;
    this.upstreamCode = upstreamCode;
  }
}
