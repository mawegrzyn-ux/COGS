function errorHandler(err, req, res, next) {
  const status = err.status || err.statusCode || 500;
  console.error(`[error] ${req.method} ${req.path} →`, err.message);
  res.status(status).json({
    error: {
      message: err.message || 'Internal Server Error',
      ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
    },
  });
}
module.exports = errorHandler;
