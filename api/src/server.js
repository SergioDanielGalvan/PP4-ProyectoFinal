require('dotenv').config();
const app = require('./app');

const PORT = Number(process.env.PORT || 3000);

if ((process.env.JWT_SECRET || '').length < 32) {
  console.warn('Aviso: JWT_SECRET no está configurado (mínimo 32 caracteres); el login no va a funcionar.');
}

app.listen(PORT, () => {
  console.log(`API comex-impo en http://localhost:${PORT}`);
  console.log(`Página de prueba: http://localhost:${PORT}/impo.html`);
});
