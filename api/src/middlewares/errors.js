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
  // Cuerpo mal armado o demasiado grande (lo detecta express.json antes de llegar al controlador)
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'El cuerpo del pedido no es un JSON válido.' });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'El cuerpo del pedido supera el tamaño permitido (100 kB).' });
  }
  console.error(`[${new Date().toLocaleString('es-AR')}] ${req.method} ${req.originalUrl}\n`, err);
  const respuesta = { error: 'Error interno al consultar la base de datos.' };
  // En desarrollo (npm run dev) se muestra la causa; en producción no se exponen detalles internos
  if (process.env.NODE_ENV !== 'production') respuesta.detalle = err.sqlMessage || err.message;
  res.status(500).json(respuesta);
}

module.exports = { HttpError, notFound, errorHandler };
