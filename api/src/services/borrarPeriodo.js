// Borrado de un período desde la página (pestaña Períodos, sólo administradores).
//
// Dos alcances:
//   'liq'   sólo la liquidación (tabla liq): es la tabla más grande y la menos
//           consultada; el mes sigue en todas las consultas, sin los tributos.
//   'todo'  liquidación, ítems y carátulas del mes, en ese orden (de las hojas
//           a la raíz, para no dejar ítems sin carátula si se corta a la mitad).
//
// Un mes son millones de filas: se borra en tandas de LOTE filas, cada una en su
// propia transacción (TiDB limita el tamaño de una transacción), y el trabajo corre
// en segundo plano: la API responde enseguida y la página consulta el avance.
// Si el proceso se corta (reinicio de Render), lo ya borrado queda borrado y
// volver a pedir el mismo borrado termina lo que faltaba.
// Hay un solo trabajo a la vez.

const LOTE = 20000;
const TABLAS = { liq: ['liq'], todo: ['liq', 'item', 'caratula'] };

let trabajo = null;   // el último (en curso o terminado), para mostrar el avance

const estado = () => (trabajo ? { ...trabajo, borradas: { ...trabajo.borradas } } : null);
const enCurso = () => Boolean(trabajo && trabajo.estado === 'en_curso');

// Corre el borrado. `al_terminar` recibe el trabajo (para vaciar cachés).
// Devuelve la promesa del trabajo (las pruebas la esperan; la API no).
function iniciar({ pool, periodo, alcance, usuario, alTerminar = () => {}, lote = LOTE }) {
  if (enCurso()) {
    const err = new Error(`Ya hay un borrado en curso (${trabajo.periodo}).`);
    err.enCurso = true;
    throw err;
  }
  const tablas = TABLAS[alcance];
  if (!tablas) throw new Error(`Alcance desconocido: ${alcance}`);
  trabajo = {
    periodo, alcance, usuario,
    estado: 'en_curso',
    tabla: tablas[0],
    borradas: Object.fromEntries(tablas.map((t) => [t, 0])),
    inicio: new Date().toISOString(),
    fin: null,
    error: null,
  };
  const actual = trabajo;
  const promesa = (async () => {
    try {
      for (const t of tablas) {
        actual.tabla = t;
        for (;;) {
          // El nombre de la tabla sale de la lista fija de arriba, nunca del pedido
          const [r] = await pool.query(`DELETE FROM \`${t}\` WHERE Periodo = ? LIMIT ?`, [periodo, lote]);
          actual.borradas[t] += r.affectedRows;
          if (r.affectedRows < lote) break;
        }
      }
      actual.estado = 'terminado';
    } catch (err) {
      actual.estado = 'error';
      actual.error = err.message;
      console.error(`[períodos] falló el borrado de ${periodo} (${alcance}):`, err.message);
    } finally {
      actual.tabla = null;
      actual.fin = new Date().toISOString();
      try { alTerminar(actual); } catch { /* las cachés no frenan nada */ }
    }
    return actual;
  })();
  return promesa;
}

// Sólo para las pruebas
const _reiniciar = () => { trabajo = null; };

module.exports = { iniciar, estado, enCurso, TABLAS, LOTE, _reiniciar };
