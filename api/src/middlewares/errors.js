class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function notFound(req, res) {
  res.status(404).json({ error: `No existe la ruta ${req.method} ${req.originalUrl}` });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message });
  }
  console.error(`[${new Date().toLocaleString('es-AR')}] ${req.method} ${req.originalUrl}\n`, err);
  const respuesta = { error: 'Error interno al consultar la base de datos.' };
  // En desarrollo (npm run dev) se muestra la causa; en producción no se exponen detalles internos
  if (process.env.NODE_ENV !== 'production') respuesta.detalle = err.sqlMessage || err.message;
  res.status(500).json(respuesta);
}

module.exports = { HttpError, notFound, errorHandler };
