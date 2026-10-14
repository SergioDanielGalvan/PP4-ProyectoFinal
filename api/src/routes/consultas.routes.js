const { Router } = require('express');
const ctrl = require('../controllers/consultas.controller');
const { requireAuth, requireRol } = require('../middlewares/auth');

const router = Router();

// SQL libre: siempre exige token de administrador, aunque AUTH_ENABLED=false
router.post('/sql', requireRol('admin'), ctrl.sqlLibre);

// Consultas guardadas: mismo criterio que /api/impo
router.get('/', requireAuth, ctrl.listar);
router.get('/:nombre', requireAuth, ctrl.ejecutar);

module.exports = router;
