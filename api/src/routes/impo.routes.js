const { Router } = require('express');
const ctrl = require('../controllers/impo.controller');

const router = Router();

router.get('/periodos', ctrl.periodos);
router.get('/catalogos', ctrl.catalogos);   // regiones, países y aduanas para los filtros
router.get('/matriz', ctrl.matriz);
router.get('/despachos', ctrl.listarDespachos);
router.get('/despachos/:nro', ctrl.obtenerDespacho);
router.get('/subpartidas', ctrl.resumenSubpartidas);
router.get('/ncm/:ncm/precios', ctrl.preciosPorNcm);
router.get('/ncm/:ncm/valores-bajos', ctrl.valoresBajos);
router.get('/importadores', ctrl.buscarImportadores);
router.get('/triangulaciones', ctrl.triangulaciones);

// Autocompletado: respuestas cortas para mientras el usuario escribe
router.get('/sugerencias/despachos', ctrl.sugerirDespachos);
router.get('/sugerencias/ncm', ctrl.sugerirNcm);
router.get('/sugerencias/importadores', ctrl.sugerirImportadores);

module.exports = router;
