const { Router } = require('express');
const ctrl = require('../controllers/empresas.controller');
const { requireRol } = require('../middlewares/auth');

// Sólo el administrador general (no depende de AUTH_ENABLED)
const router = Router();
router.get('/', requireRol('general'), ctrl.listar);
router.post('/', requireRol('general'), ctrl.crear);
router.patch('/:id', requireRol('general'), ctrl.modificar);

module.exports = router;
