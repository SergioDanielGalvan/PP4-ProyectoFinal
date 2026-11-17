const { Router } = require('express');
const ctrl = require('../controllers/periodos.controller');
const { requireRol } = require('../middlewares/auth');

// Sólo administradores, siempre (no depende de AUTH_ENABLED)
const router = Router();
router.get('/', requireRol('admin'), ctrl.listar);
router.get('/trabajo', requireRol('admin'), ctrl.trabajo);
router.post('/:periodo/borrar', requireRol('admin'), ctrl.borrar);

module.exports = router;
