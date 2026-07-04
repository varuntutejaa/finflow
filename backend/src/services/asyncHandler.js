// Express 4 does not catch a rejected promise returned by an async route
// handler — an unhandled rejection there hangs the request (no response
// ever sent) instead of reaching the error middleware in server.js. Wrapping
// every async handler with this keeps "throw -> error middleware" behavior
// consistent without repetitive try/catch blocks in every route.
export function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
