const { Router } = require('express');
const ctrl = require('../controllers/impo.controller');

const router = Router();

router.get('/periodos', ctrl.periodos);
router.get('/destinaciones', ctrl.listarDestinaciones);
router.get('/destinaciones/:nro', ctrl.obtenerDestinacion);
router.get('/ncm/:ncm/precios', ctrl.preciosPorNcm);
router.get('/ncm/:ncm/valores-bajos', ctrl.valoresBajos);
router.get('/importadores', ctrl.buscarImportadores);
router.get('/triangulaciones', ctrl.triangulaciones);

module.exports = router;
