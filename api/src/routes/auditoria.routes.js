const { Router } = require('express');
const ctrl = require('../controllers/auditoria.controller');
const { requireRol } = require('../middlewares/auth');

// Sólo administradores (general: todo; admin: su empresa), siempre (no depende de AUTH_ENABLED)
const router = Router();
router.get('/', requireRol('general', 'admin'), ctrl.listar);
router.get('/resumen', requireRol('general', 'admin'), ctrl.resumen);

module.exports = router;
