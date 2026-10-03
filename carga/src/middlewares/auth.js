// Punto de enganche con la plantilla Login.
// Con AUTH_ENABLED=false (modo prueba) deja pasar todo.
// Con AUTH_ENABLED=true exige la sesión que arme la plantilla (req.session.user).
function requireAuth(req, res, next) {
  if (process.env.AUTH_ENABLED !== 'true') return next();
  if (req.session && req.session.user) return next();
  return res.status(401).json({ error: 'Iniciá sesión para consultar importaciones.' });
}

module.exports = { requireAuth };
