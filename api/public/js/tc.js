/* ============================================================
   tc.js  ·  Tipo de cambio del dólar (aviso en la NavBar)
   ------------------------------------------------------------
   La clase PHP original hacía scraping del formulario de AFIP
   con curl (POST + cookies + parseo de HTML). Eso funciona en
   el servidor, pero NO desde el navegador: AFIP no habilita
   CORS ni devuelve JSON, así que fetch sería bloqueado.

   Acá usamos dolarapi.com, que expone la cotización oficial en
   JSON y con CORS habilitado, pensada para front-end.

   Si más adelante deployás con hosting PHP, podés exponer tu
   clase AFIP como un endpoint propio (mismo origen, sin CORS)
   y cambiar TC_API por esa URL: el resto sigue igual.
   ============================================================ */

const TC_API = "https://dolarapi.com/v1/dolares/oficial";

function formatearPesos(valor) {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(valor);
}

async function cargarTipoCambio() {
  const el = document.getElementById("tc-dolar");
  if (!el) return;

  try {
    const r = await fetch(TC_API);
    if (!r.ok) throw new Error("HTTP " + r.status);
    const d = await r.json();

    el.querySelector(".tc-valor").textContent = formatearPesos(d.venta);
    const fecha = d.fechaActualizacion
      ? new Date(d.fechaActualizacion).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" })
      : "";
    el.title =
      `Dólar oficial · Compra ${formatearPesos(d.compra)} / ` +
      `Venta ${formatearPesos(d.venta)}` +
      (fecha ? ` · Actualizado ${fecha}` : "") +
      " · Fuente: dolarapi.com";
    el.classList.remove("d-none");
  } catch (error) {
    // Sin conexión o API caída: ocultamos el aviso para no romper la barra.
    el.classList.add("d-none");
    console.warn("No se pudo obtener el tipo de cambio:", error);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  cargarTipoCambio();
  // Se actualiza cada 30 minutos mientras la página quede abierta
  setInterval(cargarTipoCambio, 30 * 60 * 1000);
});
