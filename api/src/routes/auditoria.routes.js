const { Router } = require('express');
const ctrl = require('../controllers/auditoria.controller');
const { requireRol } = require('../middlewares/auth');

// Sólo administradores, siempre (no depende de AUTH_ENABLED)
const router = Router();
router.get('/', requireRol('admin'), ctrl.listar);
router.get('/resumen', requireRol('admin'), ctrl.resumen);

module.exports = router;
