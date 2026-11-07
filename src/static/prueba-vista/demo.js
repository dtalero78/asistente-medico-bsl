// Página de prueba de la prueba visual: la corre sola y muestra el resultado. No guarda nada.
import { crearGuia, CLIPS_VISTA } from '../js/guia-voz.js';
import { precargarModelo } from '../js/ojos.js';
import { montarVista, examenVista } from '../js/vista.js';

const guia = crearGuia();
guia.precargar(CLIPS_VISTA);
precargarModelo().catch((e) => console.warn('[demo] sin modelo', e));

const $ = (id) => document.getElementById(id);

$('empezar').addEventListener('click', async () => {
    guia.desbloquear();   // dentro del toque: iPhone
    $('empezar').disabled = true;
    const ui = montarVista(document.body);
    ui.guia = guia;
    let r;
    for (;;) {
        try {
            r = await examenVista(ui);
            break;
        } catch (error) {
            ui.titulo.textContent = 'Necesitamos tu cámara';
            ui.indicacion.textContent = 'Permite la cámara y toca Reintentar.';
            await new Promise((ok) => {
                const b = document.createElement('button');
                b.className = 'bsl-vista-boton';
                b.textContent = 'Reintentar';
                b.onclick = ok;
                ui.botones.replaceChildren(b);
            });
        }
    }
    ui.quitar();
    pintar(r);
    $('empezar').disabled = false;
});

function pintar(r) {
    const caja = $('resultado');
    caja.hidden = false;
    caja.replaceChildren();
    const el = (tag, texto) => { const n = document.createElement(tag); n.textContent = texto; return n; };
    if (!r.realizado) {
        caja.append(el('h2', 'No se completó'), el('p', r.motivo));
    } else {
        const ojo = (o) => (o.snellen ? `${o.snellen}${o.limiteDePantalla ? ' (o mejor: límite de la pantalla)' : ''}` : `peor que ${o.peorQue || '20/200'}`);
        caja.append(el('h2', `Concepto: ${r.concepto}`));
        const ul = document.createElement('ul');
        ul.append(
            el('li', `Ojo derecho: ${ojo(r.ojos.OD)} · reloj: ${r.ojos.OD.reloj}${r.ojos.OD.oclusionVerificada ? '' : ' · tapado sin verificar'}`),
            el('li', `Ojo izquierdo: ${ojo(r.ojos.OI)} · reloj: ${r.ojos.OI.reloj}${r.ojos.OI.oclusionVerificada ? '' : ' · tapado sin verificar'}`),
            el('li', `Colores: ${r.colores.correctas}/${r.colores.total} (${r.colores.lectura}${r.colores.tipo ? `, ${r.colores.tipo}` : ''})`),
            el('li', `Distancia mediana: ${r.distanciaMedianaMm ? Math.round(r.distanciaMedianaMm / 10) + ' cm' : '—'} · pantalla: ${r.escala.pxPorMm} px/mm (${r.escala.metodo})`),
            el('li', `Duración: ${r.duracion_s} s`),
            ...r.motivos.map((m) => el('li', m)),
        );
        caja.append(ul);
    }
    const pre = el('pre', JSON.stringify(r, null, 2));
    caja.append(pre);
}
