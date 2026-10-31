// Every error response in SkinSync has the shape:
// { "error": { "code", "message", "details", "correlationId" } }
class AppError extends Error {
  constructor(status, code, message, details = null) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

// Validates input against a zod schema; returns parsed data or throws a 400.
function parse(schema, data) {
  const result = schema.safeParse(data);
  if (!result.success) {
    const details = result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
    throw new AppError(400, 'VALIDATION_ERROR', 'Request validation failed', details);
  }
  return result.data;
}

module.exports = { AppError, parse };
