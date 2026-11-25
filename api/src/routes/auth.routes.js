const { Router } = require('express');
const ctrl = require('../controllers/auth.controller');
const { requireLogin, requireRol } = require('../middlewares/auth');

const router = Router();

router.post('/login', ctrl.login);
router.get('/yo', requireLogin, ctrl.yo);
router.post('/clave', requireLogin, ctrl.cambiarClave);

router.get('/usuarios', requireRol('general', 'admin'), ctrl.listarUsuarios);
router.post('/usuarios', requireRol('general', 'admin'), ctrl.crearUsuario);
router.patch('/usuarios/:id', requireRol('general', 'admin'), ctrl.modificarUsuario);
router.delete('/usuarios/:id', requireRol('general', 'admin'), ctrl.eliminarUsuario);

module.exports = router;
