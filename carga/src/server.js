require('dotenv').config();
const app = require('./app');

const PORT = Number(process.env.PORT || 3000);

app.listen(PORT, () => {
  console.log(`API comex-impo en http://localhost:${PORT}`);
  console.log(`Página de prueba: http://localhost:${PORT}/impo.html`);
});
