// Página de prueba: la prueba visual y, enseguida, la pupilometría (como quedará en la
// visiometría), con los dos resultados al final. No guarda nada.
import { crearGuia, CLIPS_VISTA } from '../js/guia-voz.js';
import { precargarModelo, montarPruebaOjos, examenOjos, pintarResultados } from '../js/ojos.js';
import { montarVista, examenVista } from '../js/vista.js';

const guia = crearGuia();
guia.precargar(CLIPS_VISTA);
guia.precargar();   // los de la pupilometría
precargarModelo().catch((e) => console.warn('[demo] sin modelo', e));

const $ = (id) => document.getElementById(id);

$('empezar').addEventListener('click', async () => {
    guia.desbloquear();   // dentro del toque: iPhone
    $('empezar').disabled = true;
    const ui = montarVista(document.body);
    ui.guia = guia;
    ui.liberarModelo = false;   // la pupilometría reutiliza el detector
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

    // Pupilometría, sin volver a tocar nada (el audio ya quedó desbloqueado en el toque)
    const uo = montarPruebaOjos(document.body);
    uo.guia = guia;
    let ro;
    for (;;) {
        try {
            ro = await examenOjos(uo);
            break;
        } catch (error) {   // solo si niega la cámara
            uo.titulo.textContent = 'Necesitamos tu cámara';
            uo.indicacion.textContent = 'Permite la cámara y toca el botón.';
            uo.reintentar.hidden = false;
            await new Promise((ok) => { uo.reintentar.onclick = ok; });
            uo.reintentar.hidden = true;
        }
    }
    if (ro.realizado) await guia.decir('fin-visio');
    uo.quitar();

    pintar(r);
    const caja = $('resultado-ojos');
    pintarResultados(caja, ro);
    if (!ro.realizado) {
        caja.hidden = false;
        caja.replaceChildren(Object.assign(document.createElement('h3'), { textContent: `Pupilometría no realizada: ${ro.motivo}` }));
    }
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
        // Cómo se verificó el otro ojo tapado: por la imagen (la palma) o por los párpados (cerrado)
        const tapado = (o, otro) => (!o.oclusionVerificada ? `ojo ${otro} tapado: NO verificado`
            : `ojo ${otro} tapado: sí (por ${o.metodoOclusion === 'imagen' ? 'la imagen' : 'los párpados'})${o.destapes ? `, se destapó ${o.destapes} vez/veces` : ''}`);
        const ojo = (o) => (o.snellen ? `${o.snellen}${o.limiteDePantalla ? ' (o mejor: límite de la pantalla)' : ''}` : `peor que ${o.peorQue || '20/200'}`);
        caja.append(el('h2', `Concepto: ${r.concepto}`));
        const ul = document.createElement('ul');
        ul.append(
            el('li', `Ojo derecho: ${ojo(r.ojos.OD)} · reloj: ${r.ojos.OD.reloj} · ${tapado(r.ojos.OD, 'izquierdo')}`),
            el('li', `Ojo izquierdo: ${ojo(r.ojos.OI)} · reloj: ${r.ojos.OI.reloj} · ${tapado(r.ojos.OI, 'derecho')}`),
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
