const { Router } = require('express');
const ctrl = require('../controllers/impo.controller');

const router = Router();

router.get('/periodos', ctrl.periodos);
router.get('/despachos', ctrl.listarDespachos);
router.get('/despachos/:nro', ctrl.obtenerDespacho);
router.get('/ncm/:ncm/precios', ctrl.preciosPorNcm);
router.get('/ncm/:ncm/valores-bajos', ctrl.valoresBajos);
router.get('/importadores', ctrl.buscarImportadores);
router.get('/triangulaciones', ctrl.triangulaciones);

module.exports = router;
