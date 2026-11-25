const { Router } = require('express');
const ctrl = require('../controllers/periodos.controller');
const { requireRol } = require('../middlewares/auth');

// Sólo el administrador general, siempre (no depende de AUTH_ENABLED)
const router = Router();
router.get('/', requireRol('general'), ctrl.listar);
router.get('/trabajo', requireRol('general'), ctrl.trabajo);
router.post('/:periodo/borrar', requireRol('general'), ctrl.borrar);

module.exports = router;
